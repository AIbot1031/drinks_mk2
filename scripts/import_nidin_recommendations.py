"""Append publicly listed beverage items, preserving the original catalog rows.

No recipe/nutrient inference. Menu base prices are retained as quotations, not
complete cup prices. Unclassified items are audited instead of recommended.
"""
import collections
import hashlib
import json
import math
import pathlib
import re
from build_nidin_directory import ALIASES, norm, region

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/research/nidin'
DRINK = re.compile(r'茶|咖啡|奶|拿鐵|美式|卡布|摩卡|瑪奇朵|可可|果汁|冰沙|鮮榨|檸檬|綠豆沙|酸梅湯|冬瓜|氣泡|沙瓦|蘇打|汽水|冷萃|歐蕾|紅玉|阿薩姆|伯爵|金萱|仙草蜜|楊桃汁|椰子水|多多|豆漿|乳酸|latte|espresso|americano|mocha|cocoa|soda|smoothie|juice|飲品|飲料', re.I)
NON_DRINK_CATEGORY = re.compile(r'餐食|餐點|正餐|早餐|早午餐|甜點|西點|糕點|麵包|吐司|厚片|貝果|點心|三明治|鬆餅|蛋糕|餅乾|零食|濾掛|咖啡豆|周邊|週邊|購物袋|塑膠袋|加料|配料|加購|購物|器具|茶包|甜甜圈|下午茶')
NON_DRINK_NAME = re.compile(r'塑膠袋|購物袋|環保袋|紙袋|吸管|保溫杯|咖啡豆|濾掛|掛耳|茶包|濃縮液|禮盒|套餐|組合|任選|買.+送|雙杯|兩杯|三杯|\d+\s*杯|\d+\s*(?:克|磅|入|顆)|加料|加購|折扣|折價|蛋糕|麵包|貝果|可頌|厚片|吐司|三明治|飯|麵|薯條|炸雞|地瓜球|雞蛋糕|鬆餅|司康|曲奇|甜甜圈|布朗尼|蛋塔|蛋撻|泡芙|馬卡龍|豬血湯|沙拉|披薩|薯餅|香腸')


def classification(category, product):
    if product.get('type') != 1:
        return 'bundle_or_nonstandard'
    if NON_DRINK_CATEGORY.search(category) or NON_DRINK_NAME.search(product['name']):
        return 'non_beverage'
    if DRINK.search(product['name']) or DRINK.search(category):
        return 'beverage'
    return 'classification_pending'


def main():
    path = ROOT / 'data/catalog.json'
    previous_bytes = path.read_bytes()
    previous = json.loads(previous_bytes)
    # Idempotent: a rerun starts from the unchanged original records.
    base = [d for d in previous['drinks'] if d.get('sourceKind') not in {'nidin','official-menu'}]
    allowed_brands = {d['brand'] for d in base}
    original_names = {(d['brand'], norm(d['name'])):d['name'] for d in base}
    source_index = json.loads((SOURCE / 'index.json').read_text())
    groups, brand_state, pending, excluded = {}, {}, {}, collections.Counter()
    for info in source_index['brands']:
        raw = json.loads((SOURCE / (info['code'] + '.json')).read_text())
        brand = ALIASES.get(raw['code'], raw['name'])
        if brand not in allowed_brands:
            excluded['brand_outside_original_catalog'] += 1
            continue
        state = brand_state.setdefault(brand, {'sourceCode':raw['code'],'sourceUrl':raw['sourceUrl'],'status':'pending','importedVariants':0,'pendingItems':0,'menuReadFailures':len(raw['errors'])})
        for store in raw['stores']:
            menu = store.get('menu', {})
            products = {str(p['product_id']):p for p in menu.get('products', [])}
            place = region(store.get('address') or '')
            for category in menu.get('categories', []):
                if not category.get('is_enable') or not category.get('is_visible'):
                    continue
                for pid in category.get('product_list', []):
                    p = products.get(str(pid))
                    if not p or not p.get('is_enable') or not p.get('is_visible'):
                        continue
                    name = p.get('name', '').strip()
                    if not name or len(name)>160 or re.search(r'[\x00-\x1f\x7f]', name):
                        excluded['invalid_name'] += 1
                        continue
                    kind = classification(category['name'], p)
                    if kind != 'beverage':
                        excluded[kind] += 1
                        if kind == 'classification_pending':
                            pending[(brand, name)] = {'brand':brand,'name':name,'category':category['name'],'status':'飲料分類待確認','sourceUrl':store['sourceUrl']}
                        continue
                    # Match existing names without discarding store-specific evidence.
                    name = original_names.get((brand,norm(name)),name)
                    price = p.get('price')
                    if isinstance(price,bool) or not isinstance(price,(int,float)) or not math.isfinite(price) or price<=0:
                        price = None
                    key = (raw['code'],norm(name),price)
                    row = groups.get(key)
                    if not row:
                        identity = json.dumps(key,ensure_ascii=False,separators=(',',':'))
                        row = groups[key] = {
                            'id':'n_'+hashlib.sha256(identity.encode()).hexdigest()[:24],
                            'sourceKind':'nidin','sourceRow':0,'sourceSheet':'你訂公開門市菜單',
                            'brand':brand,'name':name,'category':'杯型待確認','cupSize':'杯型待確認','volumeMl':None,
                            'price':None,'listedPrice':price,'priceText':f'{price:g} 元起（完整售價待確認）' if price is not None else '待確認',
                            'priceEstimated':False,'calories':None,'caloriesEstimated':False,
                            'caffeineText':'','caffeineMin':None,'caffeineMax':None,'caffeineEstimated':False,
                            'taste':'','notes':'菜單列有此品項；基本價不等於完整售價。杯型、必要選項、營養、成分、過敏原及供應待確認。',
                            'tea':[],'milk':[],'toppings':[],'noMilk':False,'richness':None,'allergensVerified':False,
                            'pendingFields':['完整售價','杯型','容量','熱量','咖啡因','茶種','奶類','配料','成分','供應'],
                            'status':'菜單品項已收錄，其餘資料待確認','reviewStatus':'待確認','fillMethod':'公開菜單名稱與基本價格，未知資料保持空值',
                            'sourceUrl':store['sourceUrl'],'sourceBrandUrl':raw['sourceUrl'],
                            'sourceMenuCategory':category['name'],'sourceCheckedAt':menu.get('checkedAt',store['checkedAt']),
                            'regionKeys':set(),'sourceStoreIds':set(),
                        }
                    row['sourceStoreIds'].add(str(store['id']))
                    if place:
                        row['regionKeys'].add('|'.join(place))
        if not raw['stores']:
            state['reason']='平台未取得門市及飲料菜單，待確認'
    imported = []
    for row in groups.values():
        row['regionKeys'] = sorted(row['regionKeys'])
        row['sourceStoreIds'] = sorted(row['sourceStoreIds'])
        imported.append(row)
        brand_state[row['brand']]['importedVariants'] += 1
    imported.sort(key=lambda d:(d['brand'],d['name'],d['id']))
    for brand, state in brand_state.items():
        state['pendingItems'] = sum(b==brand for b,_ in pending)
        state['status'] = 'listed' if state['importedVariants'] or any(d['brand']==brand for d in base) else 'pending'
    official = []
    audit_path = ROOT/'data/research/branch-menu-audit.json'
    if audit_path.exists():
        official_groups = {}
        for store in json.loads(audit_path.read_text())['entries']:
            if store['brand'] not in allowed_brands:
                raise ValueError('Supplement cannot introduce a new brand')
            if store['status']!='listed' or store['menuScope']!='branch':
                continue
            identity=json.dumps([norm(store[k]) for k in ['brand','name','address']],ensure_ascii=False,separators=(',',':'))
            store_id='s_'+hashlib.sha256(identity.encode()).hexdigest()[:32]
            place=region(store['address'])
            if not place:raise ValueError('Verified menu requires a known region')
            for item in store['menuItems']:
                name=original_names.get((store['brand'],norm(item['name'])),item['name'])
                if NON_DRINK_NAME.search(name):continue
                price=item.get('listedPrice')
                key=(store['brand'],norm(name),price)
                if key not in official_groups:
                    template=next(iter(groups.values()))
                    signature=json.dumps(key,ensure_ascii=False,separators=(',',':'))
                    official_groups[key]={**template,'id':'o_'+hashlib.sha256(signature.encode()).hexdigest()[:24],
                        'sourceKind':'official-menu','sourceSheet':'官方逐店菜單','brand':store['brand'],'name':name,
                        'listedPrice':price,'priceText':f'{price:g} 元起（完整售價待確認）' if price is not None else '待確認',
                        'sourceUrl':store['menuSourceUrl'],'sourceBrandUrl':store['sourceUrl'],
                        'sourceMenuCategory':item.get('category','門市飲品'),'sourceCheckedAt':store['checkedAt'],
                        'regionKeys':set(),'sourceStoreIds':set()}
                official_groups[key]['regionKeys'].add('|'.join(place))
                official_groups[key]['sourceStoreIds'].add(store_id)
        for row in official_groups.values():
            row['regionKeys']=sorted(row['regionKeys']);row['sourceStoreIds']=sorted(row['sourceStoreIds']);official.append(row)
        official.sort(key=lambda d:(d['brand'],d['name'],d['id']))
    drinks = base + imported + official
    brands = {brand:0 for brand in sorted(set(brand_state)|{d['brand'] for d in base})}
    brands.update(collections.Counter(d['brand'] for d in drinks))
    result = {**previous,'source':'原飲料目錄＋你訂與官方逐店菜單快照','total':len(drinks),'brands':brands,
              'missing':{'calories':sum(d['calories'] is None or d.get('caloriesEstimated',False) for d in drinks),
                         'caffeine':sum(not d['caffeineText'] or d.get('caffeineEstimated',False) for d in drinks),
                         'caffeineUpperBound':sum(d['caffeineMax'] is None for d in drinks)},
              'brandStatus':brand_state,'drinks':drinks}
    encoded=(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n').encode()
    path.write_bytes(encoded)
    version=hashlib.sha256(encoded).hexdigest()
    old_manifest=json.loads((ROOT/'data/catalog-update.json').read_text())
    old_version=hashlib.sha256(previous_bytes).hexdigest()
    # Original IDs and records are byte-for-byte equal as decoded JSON. Old
    # interactions remain valid; model indexes are separately version-checked.
    compatible=sorted(set([old_version,*old_manifest.get('compatibleCatalogVersions',[])])-{version})
    manifest={'catalogVersion':version,'compatibleCatalogVersions':compatible,'source':result['source'],
              'baseRows':len(base),'rows':len(drinks),'brands':len(brands),'nidinRows':len(imported),'officialMenuRows':len(official)}
    (ROOT/'data/catalog-update.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'worker/catalog-version.ts').write_text('// Generated catalog identity; previous interactions retain unchanged drink IDs.\n'+f'export const catalogVersion={json.dumps(version)};\nexport const compatibleCatalogVersions={json.dumps(compatible)};\n')
    report={'sourceCheckedAt':source_index['checkedAt'],'baseRowsPreserved':len(base),'importedVariants':len(imported),
            'importedProducts':len({(d['brand'],d['name']) for d in imported}),'brandCount':len(brands),
            'recommendableBrandCount':sum(n>0 for n in brands.values()),
            'totalProducts':len({(d['brand'],d['name']) for d in drinks}),
            'overlappingOriginalProducts':len({(d['brand'],norm(d['name'])) for d in imported}&set(original_names)),
            'brands':brand_state,
            'excludedOccurrences':dict(excluded),'classificationPending':list(pending.values()),
            'pricePolicy':'保留菜單基本價，完整售價未知時不通過預算上限；未補造營養、杯型或成分。'}
    (ROOT/'data/nidin-import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('brands','classificationPending')},ensure_ascii=False))


if __name__=='__main__':
    main()
