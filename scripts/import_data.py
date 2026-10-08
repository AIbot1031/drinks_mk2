"""Read the original workbook; produce a typed, traceable website catalogue."""
import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "飲料推薦系統_整理版.xlsx"
TEA = {"tea_black": "紅茶", "tea_green": "綠茶", "tea_qing": "青茶", "tea_oolong": "烏龍茶", "tea_jinxuan": "金萱茶", "tea_puer": "普洱茶", "tea_buckwheat": "蕎麥茶", "tea_other": "其他茶種"}
MILK = {"milk_fresh": "鮮奶", "milk_plant": "植物奶", "milk_creamer": "奶精"}
TOPPINGS = {"珍珠": ("珍珠", "波霸", "珍波椰"), "椰果": ("椰果", "珍波椰"), "布丁": ("布丁",), "仙草": ("仙草",), "燕麥": ("燕麥",), "粉粿": ("粉粿",)}


def text(value):
    return "" if value is None else str(value).strip()


def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None


def bounds(value):
    s = text(value).replace(",", "")
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", s)]
    if not nums:
        return None, None
    if s.startswith((">", "≥")) or "以上" in s:
        return nums[0], None
    if s.startswith(("<", "≤")) or "低於" in s:
        return 0, nums[0]
    return min(nums), max(nums)


def main():
    wb = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    sheet = wb["綜合飲料特徵"]
    iterator = sheet.iter_rows(values_only=True)
    headers = next(iterator)
    positions = {h: i for i, h in enumerate(headers) if h}
    drinks, occurrences = [], Counter()
    for row_number, row in enumerate(iterator, start=2):
        def value(key):
            i = positions.get(key)
            return row[i] if i is not None and i < len(row) else None

        name, brand = text(value("品項")), text(value("品牌"))
        if not name:
            continue
        signature = json.dumps([brand, text(value("分類")), name, text(value("價格原文")), text(value("備註"))], ensure_ascii=False)
        digest = hashlib.sha256(signature.encode()).hexdigest()[:16]
        occurrences[digest] += 1
        caffeine_min, caffeine_max = bounds(value("咖啡因_mg"))
        notes = text(value("備註"))
        tea = [label for key, label in TEA.items() if text(value(key)) == "有"]
        milk = [label for key, label in MILK.items() if text(value(key)) == "有"]
        toppings = [label for label, terms in TOPPINGS.items() if any(t in name for t in terms)]
        drinks.append({
            "id": f"d_{digest}_{occurrences[digest]}", "sourceRow": row_number,
            "brand": brand, "category": text(value("分類")), "name": name,
            "price": number(value("價格_元")), "priceText": text(value("價格原文")),
            "calories": number(value("熱量_kcal")), "caffeineText": text(value("咖啡因_mg")),
            "caffeineMin": caffeine_min, "caffeineMax": caffeine_max,
            "taste": text(value("推論依據")), "notes": notes,
            "tea": tea, "milk": milk, "toppings": toppings,
            "noMilk": text(value("milk_none")) == "有" and not milk,
            "richness": number(value("richness_score")), "status": text(value("資料狀態")),
            "allergensVerified": False,
        })
    wb.close()
    result = {
        "source": SOURCE.name, "sheet": "綜合飲料特徵", "total": len(drinks),
        "brands": dict(sorted(Counter(d["brand"] for d in drinks).items())),
        "missing": {"calories": sum(d["calories"] is None for d in drinks), "caffeine": sum(not d["caffeineText"] for d in drinks), "caffeineUpperBound": sum(d["caffeineMax"] is None for d in drinks)},
        "drinks": drinks,
    }
    (ROOT / "data" / "catalog.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"已匯入 {len(drinks)} 筆飲料、{len(result['brands'])} 個品牌；原始 Excel 未修改。")


if __name__ == "__main__":
    main()
