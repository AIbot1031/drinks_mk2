import math
import re
from pathlib import Path

import pandas as pd
import chromadb

BASE_DIR = Path(__file__).resolve().parent
EXCEL_PATH = (
    BASE_DIR / "飲料推薦系統_綜合特徵表_營養風味補全.xlsx"
)
SHEET_NAME = "綜合飲料特徵"
DB_PATH = BASE_DIR / "chroma_db"
# Tune these defaults when product policy defines different meanings for "low".
LOW_CALORIE_MAX_KCAL = 200
LOW_CAFFEINE_MAX_MG = 100

# Scalar fields use descriptive labels; they are separate from binary feature labels.
FIELD_LABELS = {
    "brand": "品牌",
    "category": "分類",
    "name": "品項",
    "taste": "風味描述",
    "notes": "備註",
    "sweetness": "建議甜度",
    "ice": "冰塊",
    "price": "價格（元）",
    "price_text": "價格原文",
    "calories": "熱量（kcal）",
    "caffeine": "咖啡因（mg）",
    "status": "資料狀態",
    "richness_score": "濃郁度評分",
}

# Add binary tea, milk, and allergen labels here when their source names are known.
FEATURE_LABELS = {
    "tea_black": "紅茶",
    "tea_green": "綠茶",
    "tea_qing": "青茶",
    "tea_oolong": "烏龍茶",
    "tea_jinxuan": "金萱茶",
    "tea_puer": "普洱茶",
    "tea_buckwheat": "蕎麥茶",
    "tea_other": "其他茶種",
    "tea_none": "無茶",
    "milk_fresh": "鮮奶",
    "milk_plant": "植物奶",
    "milk_creamer": "奶精",
    "milk_none": "無奶",
    "allergen_egg": "蛋類過敏原",
}

# These source text tokens identify only toppings explicitly named in the menu.
TOPPING_KEYWORDS = {
    "topping_pearl": ("珍珠", "波霸"),
    "topping_coconut_jelly": ("椰果",),
}
TOPPING_LABELS = {
    "topping_pearl": "珍珠／波霸",
    "topping_coconut_jelly": "椰果",
}
TEA_FILTER_KEYS = tuple(
    key for key in FEATURE_LABELS if key.startswith("tea_") and key != "tea_none"
)
MILK_FILTER_KEYS = tuple(
    key for key in FEATURE_LABELS if key.startswith("milk_") and key != "milk_none"
)

# 保留最基本的測試架構：
# 1) 讀 Excel
# 2) 轉成可搜尋字串
# 3) 寫入 Chroma
# 4) 做相似度查詢


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Map source headers to canonical names and coalesce duplicate aliases."""
    aliases = {
        "brand": ("品牌", "brand"),
        "category": ("分類", "category"),
        "name": ("品項", "name"),
        "taste": ("口感、風味", "推論依據", "taste"),
        "sweetness": ("建議甜度", "sweetness"),
        "ice": ("冰塊", "ice"),
        "calories": ("熱量_kcal", "熱量", "calories"),
        "caffeine": ("咖啡因_mg", "咖啡因", "caffeine"),
        "notes": ("備註", "notes"),
        "price_text": ("價格原文", "price_text"),
        "price": ("價格_元", "price"),
        "richness_score": ("richness_score",),
        "status": ("資料狀態", "status"),
    }
    normalized = df.copy()
    for canonical, source_names in aliases.items():
        present = [name for name in source_names if name in normalized.columns]
        if not present:
            continue

        # Prefer the first populated alias while avoiding duplicate canonical columns.
        normalized[canonical] = normalized[present].bfill(axis=1).iloc[:, 0]
        normalized = normalized.drop(
            columns=[name for name in present if name != canonical]
        )
    return normalized


def to_text(value):
    """Convert a spreadsheet cell to trimmed text, treating missing values as empty."""
    if pd.isna(value):
        return ""
    return str(value).strip()


def to_number(value):
    """Convert a cell to a finite numeric value when one is available."""
    if pd.isna(value):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def caffeine_bounds(value):
    """Normalize exact values and ranges without inventing an upper bound."""
    text = to_text(value).replace(",", "")
    numbers = [float(number) for number in re.findall(r"\d+(?:\.\d+)?", text)]
    if not numbers:
        return {}

    if text.startswith(("≥", ">=", ">")):
        return {"caffeine_min_mg": numbers[0]}
    if text.startswith(("≤", "<=", "<")):
        return {
            "caffeine_min_mg": 0,
            "caffeine_max_mg": numbers[0],
        }
    if len(numbers) >= 2:
        return {
            "caffeine_min_mg": min(numbers),
            "caffeine_max_mg": max(numbers),
        }
    return {
        "caffeine_min_mg": numbers[0],
        "caffeine_max_mg": numbers[0],
    }


def to_flag(value):
    """Convert common spreadsheet yes/no encodings to bool; unknowns stay unknown."""
    text = to_text(value).casefold()
    if text in {"有", "是", "true", "1"}:
        return True
    if text in {"無", "否", "false", "0"}:
        return False

    number = to_number(value)
    return number > 0 if number is not None else None


def feature_label(key: str) -> str:
    """Use known feature labels and keep duplicated allergen headers explicitly unknown."""
    if key in FEATURE_LABELS:
        return FEATURE_LABELS[key]

    duplicate_allergen = re.fullmatch(r"allergen_[^.]+\.(\d+)", key)
    if duplicate_allergen:
        column_number = int(duplicate_allergen.group(1)) + 1
        return f"未命名過敏原欄位 {column_number}"
    if key.startswith("allergen_"):
        return f"{key[len('allergen_'):]} 過敏原"
    return key.replace("_", " ")


def detect_toppings(name: str, notes: str) -> dict:
    """Detect explicitly named pearl and coconut-jelly toppings in source text."""
    source_text = f"{name} {notes}"
    return {
        key: any(term in source_text for term in terms)
        for key, terms in TOPPING_KEYWORDS.items()
    }


def any_flag_filter(keys: tuple[str, ...]) -> dict:
    """Build a Chroma OR filter for a group of boolean feature metadata keys."""
    return {"$or": [{key: True} for key in keys]}


def build_document(row: pd.Series) -> str:
    """Build searchable text from descriptive fields and positive feature flags."""
    fields = {
        "brand": row.get("brand", ""),
        "category": row.get("category", ""),
        "name": row.get("name", ""),
        "taste": row.get("taste", ""),
        "notes": row.get("notes", ""),
        "sweetness": row.get("sweetness", ""),
        "ice": row.get("ice", ""),
        "price": row.get("price", ""),
        "price_text": row.get("price_text", ""),
        "calories": row.get("calories", ""),
        "caffeine": row.get("caffeine", ""),
        "status": row.get("status", ""),
        "richness_score": row.get("richness_score", ""),
    }

    parts = []
    for key, value in fields.items():
        if pd.isna(value):
            continue
        value = str(value).strip()
        if value:
            label = FIELD_LABELS.get(key, key)
            parts.append(f"{label}: {value}")

    for key, value in row.items():
        if not key.startswith(("tea_", "milk_", "allergen_")):
            continue
        if to_flag(value) is not True:
            continue

        label = feature_label(key)
        parts.append(f"{label}: 有")

    # Add only toppings explicitly found in the product name or notes.
    for key, is_present in detect_toppings(
        to_text(row.get("name", "")), to_text(row.get("notes", ""))
    ).items():
        if is_present:
            parts.append(f"配料: {TOPPING_LABELS[key]}")

    return "。".join(parts)


def load_drink_rows(file_path: Path):
    """Load the configured worksheet and skip rows without a usable drink name."""
    df = pd.read_excel(file_path, sheet_name=SHEET_NAME)
    df = normalize_columns(df)
    if "name" not in df.columns:
        raise ValueError(f"工作表「{SHEET_NAME}」缺少品項欄位")

    rows = []
    for idx, row in df.iterrows():
        name = to_text(row.get("name", ""))
        if not name:
            continue

        document = build_document(row)
        rows.append(
            {
                "id": f"drink_{idx}",
                "document": document,
                "metadata": build_metadata(row, name),
            }
        )

    return rows


def build_metadata(row: pd.Series, name: str) -> dict:
    """Create Chroma metadata for display, numeric filtering, and feature filters."""
    metadata = {
        "brand": to_text(row.get("brand", "")),
        "category": to_text(row.get("category", "")),
        "name": name,
        "taste": to_text(row.get("taste", "")),
        "notes": to_text(row.get("notes", "")),
        "price": to_text(row.get("price", "")),
        "caffeine": to_text(row.get("caffeine", "")),
        "calories": to_text(row.get("calories", "")),
        "sweetness": to_text(row.get("sweetness", "")),
    }

    calories = to_number(row.get("calories"))
    if calories is not None:
        metadata["calories_kcal"] = calories

    metadata.update(caffeine_bounds(row.get("caffeine")))

    for key, value in row.items():
        if not key.startswith(("tea_", "milk_", "allergen_")):
            continue
        flag = to_flag(value)
        if flag is None:
            continue

        duplicate_allergen = re.fullmatch(r"allergen_[^.]+\.(\d+)", key)
        if duplicate_allergen:
            column_number = int(duplicate_allergen.group(1)) + 1
            metadata[f"allergen_unknown_{column_number}"] = flag
        else:
            metadata[key] = flag

    metadata.update(detect_toppings(name, metadata["notes"]))
    return metadata


def main():
    """Rebuild the test collection, then run semantic and structured queries."""
    if not EXCEL_PATH.exists():
        raise FileNotFoundError(f"找不到 Excel 檔：{EXCEL_PATH}")

    client = chromadb.PersistentClient(path=str(DB_PATH))
    collection_name = "drink_menu_basic"

    try:
        client.get_collection(name=collection_name)
        client.delete_collection(name=collection_name)
        print(f"已重置 Chroma 集合：{collection_name}")
    except chromadb.errors.NotFoundError:
        pass

    collection = client.get_or_create_collection(name=collection_name)

    rows = load_drink_rows(EXCEL_PATH)
    print(f"共讀到 {len(rows)} 筆飲料資料")

    collection.add(
        ids=[r["id"] for r in rows],
        documents=[r["document"] for r in rows],
        metadatas=[r["metadata"] for r in rows],
    )
    print("資料已寫入 Chroma")

    # where conditions enforce hard requirements; vector similarity ranks preferences.
    queries = [
        {
            "text": "想喝清爽茶類，口感淡雅、回甘",
            "where": any_flag_filter(TEA_FILTER_KEYS),
        },
        {"text": "想要一杯果香濃郁、酸甜的飲料"},
        {"text": "不要花生、堅果類"},
        {"text": "不要奶類", "where": {"milk_none": True}},
        {"text": "提神的飲料"},
        {
            "text": "有奶茶感覺，偏香濃、甜一點",
            "where": any_flag_filter(MILK_FILTER_KEYS),
        },
        {
            "text": "想喝低熱量、低咖啡因的飲品",
            "where": {
                "$and": [
                    {"calories_kcal": {"$lte": LOW_CALORIE_MAX_KCAL}},
                    {"caffeine_max_mg": {"$lte": LOW_CAFFEINE_MAX_MG}},
                ]
            },
        },
        {
            "text": "想喝有珍珠或椰果等配料，口感有嚼勁的飲料",
            "where": any_flag_filter(tuple(TOPPING_KEYWORDS)),
        },
        {
            "text": "想喝鮮奶調製、奶香濃郁的飲品",
            "where": {"milk_fresh": True},
        },
        {
            "text": "想喝不含奶、以茶香為主的清爽飲料",
            "where": {
                "$and": [
                    {"milk_none": True},
                    any_flag_filter(TEA_FILTER_KEYS),
                ]
            },
        },
        {
            "text": "想找咖啡因較低、晚上也適合的飲品",
            "where": {"caffeine_max_mg": {"$lte": LOW_CAFFEINE_MAX_MG}},
        },
    ]

    for query in queries:
        q = query["text"]
        print(f"\n查詢：{q}")
        query_args = {
            "query_texts": [q],
            "n_results": 3,
            "include": ["documents", "metadatas", "distances"],
        }
        if "where" in query:
            query_args["where"] = query["where"]
        results = collection.query(**query_args)

        if not results["documents"][0]:
            print("沒有符合篩選條件的飲品")
            continue

        for i, doc in enumerate(results["documents"][0]):
            meta = results["metadatas"][0][i]
            distance = results["distances"][0][i]
            print(f"{i + 1}. {meta.get('name')} | {meta.get('category')} | 距離={distance:.4f}")
            print(f"   {doc[:120]}...")


if __name__ == "__main__":
    main()
