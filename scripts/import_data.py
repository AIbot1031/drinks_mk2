"""Import the current cup/region workbook without treating estimates as facts."""
import hashlib
import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'data' / '飲料資料庫.xlsx'
ROWS_SOURCE=ROOT/'data/飲料資料庫.rows.json'
SHEET = '飲料品項'
TEA = {'tea_black':'紅茶','tea_green':'綠茶','tea_oolong':'烏龍茶','tea_matcha':'抹茶','tea_herbal':'花草茶','tea_hojicha':'焙茶','tea_puer':'普洱茶','tea_grain':'穀物茶','tea_barley':'麥茶','tea_grain_blend':'混合穀物茶'}
MILK = {'milk_fresh':'鮮奶','milk_plant':'植物奶','milk_creamer':'奶精'}
TOPPINGS = {'珍珠':('珍珠','波霸'), '椰果':('椰果',), '布丁':('布丁',), '仙草':('仙草',), '燕麥':('燕麥',), '粉粿':('粉粿',), '芋圓':('芋圓',), '芋泥':('芋泥',), '奶蓋':('奶蓋','雲朵'), '冰淇淋':('冰淇淋',), '果肉':('果肉',), '茶凍':('茶凍',)}


def text(v):
    return '' if v is None else format(v,'.15g') if isinstance(v,float) else str(v).strip()


def number(v):
    try:
        n=float(v)
        return float(format(n,'.15g')) if math.isfinite(n) else None
    except (TypeError,ValueError):
        return None


def convert(row, source_row, occurrences):
    get=lambda k:row.get(k)
    name,brand=text(get('飲料名稱')),text(get('品牌'))
    if not name or not brand:
        raise ValueError(f'第 {source_row} 列缺少品牌或飲料名稱')
    volume=number(get('容量_ml'))
    capacity=str(int(volume)) if volume is not None and volume.is_integer() else text(get('容量_ml'))
    identity=[brand,text(get('商品_ID')),name,text(get('杯型')),text(get('適用地區／門市')),capacity]
    digest=hashlib.sha256(json.dumps(identity,ensure_ascii=False).encode()).hexdigest()[:16]
    occurrences[digest]+=1
    method=text(get('填值方式'))
    tea=[label for key,label in TEA.items() if number(get(key))==1]
    for label in ['青茶','金萱茶','蕎麥茶']:
        if label in text(get('茶種')) and label not in tea:tea.append(label)
    milk=[label for key,label in MILK.items() if number(get(key))==1]
    milk_clue=bool(re.search(r'鮮奶|生乳|拿鐵|那堤|奶茶|奶蓋|奶霜|奶油|奶精|乳酸|乳酪|優格|優酪|冰淇淋|牛奶|豆奶|燕麥奶|植物奶',name))
    milk_conflict=number(get('milk_none'))==1 and (bool(milk) or milk_clue or text(get('奶的種類')) not in ('無奶',''))
    topping_text=text(get('配料'))
    toppings=[label for label,terms in TOPPINGS.items() if any(t in topping_text for t in terms)]
    caf_min,caf_max=number(get('咖啡因下限_mg')),number(get('咖啡因上限_mg'))
    caf_estimated='咖啡因_mg估算' in method
    # Bounds only come from explicit public-bound columns, never the filled estimate.
    if caf_estimated:caf_min=caf_max=None
    price,calories=number(get('售價_元')),number(get('熱量_kcal'))
    if price is not None and price<0 or calories is not None and calories<0:
        raise ValueError(f'第 {source_row} 列有負數價格／熱量')
    return {'id':f'd_{digest}_{occurrences[digest]}','sourceRow':source_row,'sourceSheet':SHEET,
            'brand':brand,'category':text(get('杯型')),'name':name,
            'cupSize':text(get('杯型')),'volumeMl':number(get('容量_ml')),
            'region':text(get('適用地區／門市')),'productId':text(get('商品_ID')),
            'price':price,'priceText':text(price)+' 元' if price is not None else '未公布',
            'priceEstimated':'售價_元估算' in method,
            'calories':calories,'caloriesEstimated':'熱量_kcal估算' in method,
            'caffeineText':text(get('咖啡因_mg')),'caffeineEstimated':caf_estimated,
            'caffeineMin':caf_min,'caffeineMax':caf_max,
            'taste':text(get('官網描述')) or text(get('分類依據')),
            'notes':text(get('備註')),'tea':tea,'milk':milk,'toppings':toppings,
            'noMilk':number(get('milk_none'))==1 and not milk and not milk_conflict,
            'milkDescription':text(get('奶的種類')),'milkConflict':milk_conflict,
            'richness':number(get('濃郁度_0至1')),
            'status':text(get('資料狀態')),'fillMethod':method,
            'reviewStatus':text(get('校準狀態')),'sourceUrl':text(get('官網商品網址')),
            'allergensVerified':False}


def main():
    global SHEET
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--rows-json',type=Path,default=ROWS_SOURCE if ROWS_SOURCE.exists() else None)
    p.add_argument('--previous-catalog',type=Path,default=ROOT/'data/catalog.json')
    args=p.parse_args()
    previous_raw=args.previous_catalog.read_bytes() if args.previous_catalog.exists() else None
    if args.rows_json:
        raw=json.loads(args.rows_json.read_text())
        if raw.get('schema')!=1:raise ValueError('Invalid extracted Numbers schema')
        headers=raw['headers'];it=iter(raw['rows']);SHEET=raw['sheet'];source=raw['source']
    else:
        import openpyxl
        wb=openpyxl.load_workbook(SOURCE,read_only=True,data_only=True)
        if SHEET not in wb.sheetnames:raise ValueError(f'缺少工作表 {SHEET}')
        it=wb[SHEET].iter_rows(values_only=True);headers=next(it);source=SOURCE.name
    required={'品牌','飲料名稱','杯型','售價_元','熱量_kcal','咖啡因_mg','商品_ID','填值方式','咖啡因下限_mg','咖啡因上限_mg'}
    if required-set(headers):raise ValueError(f'缺少必要欄位：{required-set(headers)}')
    drinks=[];occurrences=Counter()
    for n,r in enumerate(it,2):
        if any(v is not None for v in r):drinks.append(convert(dict(zip(headers,r)),n,occurrences))
    if not args.rows_json:wb.close()
    if not drinks:raise ValueError('資料庫不可為空')
    result={'source':source,'sheet':SHEET,'total':len(drinks),
            'brands':dict(sorted(Counter(d['brand'] for d in drinks).items())),
            'missing':{'calories':sum(d['calories'] is None or d['caloriesEstimated'] for d in drinks),
                       'caffeine':sum(not d['caffeineText'] or d['caffeineEstimated'] for d in drinks),
                       'caffeineUpperBound':sum(d['caffeineMax'] is None for d in drinks)},
            'estimates':{k:sum(d[k+'Estimated'] for d in drinks) for k in ['price','calories','caffeine']},
            'drinks':drinks}
    (ROOT/'data/catalog.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    version=hashlib.sha256((ROOT/'data/catalog.json').read_bytes()).hexdigest()
    compatible=[]
    manifest=ROOT/'data/catalog-update.json'
    if previous_raw:
        old=json.loads(previous_raw);old_version=hashlib.sha256(previous_raw).hexdigest()
        if {d['id'] for d in old['drinks']}=={d['id'] for d in drinks}:
            compatible=[old_version]
            if manifest.exists():
                prior_manifest=json.loads(manifest.read_text())
                if prior_manifest.get('catalogVersion')==old_version:compatible+=prior_manifest.get('compatibleCatalogVersions',[])
    compatible=sorted(set(compatible)-{version})
    manifest.write_text(json.dumps({'catalogVersion':version,'compatibleCatalogVersions':compatible,'source':source,
        'sourceSha256':raw.get('sourceSha256') if args.rows_json else hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'rows':len(drinks),'brands':len(result['brands'])},ensure_ascii=False,indent=2)+'\n')
    (ROOT/'worker/catalog-version.ts').write_text('// Generated by scripts/import_data.py; histories are compatible only when drink IDs are unchanged.\n'
        +f'export const catalogVersion={json.dumps(version)};\nexport const compatibleCatalogVersions={json.dumps(compatible)};\n')
    print(json.dumps({k:v for k,v in result.items() if k!='drinks'},ensure_ascii=False))

if __name__=='__main__':main()
