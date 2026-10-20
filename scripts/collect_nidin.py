"""Collect public Nidin business listings; no login, location, or order API.

Only advertised beverage/coffee brands are included. Cache permits resuming;
failed/empty listings are explicitly pending, never inferred closed/not sold.
"""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://loctw-service-api.nidin.shop/shopper/v2'
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/research/nidin'
CACHE = pathlib.Path('/tmp/drinks-nidin-public-cache')


def now():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds')


def get(path):
    key = hashlib.sha256(path.encode()).hexdigest()
    file = CACHE / (key + '.json')
    if file.exists():
        cached = json.loads(file.read_text())
        age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(cached['checkedAt'])
        if datetime.timedelta(0) <= age < datetime.timedelta(hours=24):
            return cached
    for attempt in range(3):
        try:
            with urllib.request.urlopen(BASE + path, timeout=30) as response:
                data = json.load(response)
            if data.get('status') != 200:
                raise ValueError('public API status ' + str(data.get('status')))
            record = {'checkedAt': now(), 'data': data}
            file.write_text(json.dumps(record, ensure_ascii=False))
            time.sleep(.15)
            return record
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise RuntimeError('rate limit: stop collection') from error
            if error.code < 500:
                raise
        except (OSError, ValueError):
            if attempt == 2:
                raise
        time.sleep(1 + attempt)
    raise RuntimeError('public API unavailable')


def menu(store_id):
    record = get('/store/' + str(store_id) + '/onShelfMenu')
    raw = record['data']['menu']
    def rows(key, fields):
        section = raw.get(key, {})
        schema = section.get('schema', {})
        return [{k: row[schema[k]] for k in fields if k in schema and schema[k] < len(row)}
                for row in section.get('data', {}).values()]
    # Names/prices/structure only: omit prose, images and vendor identifiers.
    categories = rows('category_list_json', ['product_id', 'name', 'is_enable', 'is_visible', 'category_list', 'product_list'])
    products = rows('product_list_json', ['product_id', 'name', 'price', 'price_type', 'type', 'sub_type', 'is_enable', 'is_visible', 'product_list'])
    from nidin_menu_policy import availability_snapshot
    availability_url=BASE+'/store/'+str(store_id)+'/disableItemsRelationNew'
    try:
        state=get('/store/'+str(store_id)+'/disableItemsRelationNew')
        availability=availability_snapshot(state['data'],state['checkedAt'],availability_url,
          hashlib.sha256(json.dumps(state['data'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    except (OSError,ValueError,KeyError,RuntimeError):
        availability={'status':'pending','sourceUrl':availability_url,'reason':'門市停賣資料未確認，不推測可供應。'}
    return {'status': 'listed' if categories else 'pending', 'checkedAt': record['checkedAt'],'availability':availability,
            'sourceUrl': 'https://order.nidin.shop/menu/' + str(store_id),
            'version': raw.get('meta', {}), 'categories': categories, 'products': products,
            'note': '平台公開菜單快照；價格可能是起價或選項價格，不代表即時庫存。'}


def collect_brand(brand):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', brand['brand_code']):
        raise ValueError('invalid public brand code')
    result = {'id': brand['id'], 'code': brand['brand_code'], 'name': brand['name'],
              'aliases': brand.get('name_alias', []),
              'tags': [tag['name'] for tag in brand.get('meal_tag_info', [])],
              'sourceUrl': 'https://order.nidin.shop/brand/' + brand['brand_code'],
              'status': 'pending', 'stores': [], 'errors': []}
    seen = set()
    try:
        page = 1
        while True:
            record = get('/store/listByDefault?' + urllib.parse.urlencode({'page': page, 'count': 10, 'brand_code': brand['brand_code']}))
            data = record['data']
            result['checkedAt'] = record['checkedAt']
            result['expectedStoreCount'] = data['meta']['total_amount']
            for raw in data['list']:
                # Platform parent brands (50嵐) aggregate regional brand codes.
                # Accept only its exact advertised brand name/aliases, retain
                # the branch's own code instead of merging unrelated brands.
                if (raw['brand_code'] != brand['brand_code'] and raw['brand_name'] not in [brand['name'], *brand.get('name_alias', [])]) or raw['id'] in seen:
                    raise ValueError('brand mismatch or duplicate pagination')
                seen.add(raw['id'])
                store = {k: raw.get(k) for k in ['id', 'name', 'address', 'tel', 'latitude', 'longitude', 'start_time', 'end_time', 'opening_time_remark', 'is_open', 'is_close', 'is_off_day']}
                store['sourceUrl'] = 'https://order.nidin.shop/menu/' + str(raw['id'])
                store['platformBrandCode'] = raw['brand_code']
                store['platformBrandName'] = raw['brand_name']
                store['checkedAt'] = record['checkedAt']
                result['stores'].append(store)
            if len(seen) >= result['expectedStoreCount']:
                break
            if not data['list']:
                raise ValueError('incomplete pagination')
            page += 1
        result['status'] = 'listed' if seen else 'pending'
    except Exception as error:
        if isinstance(error, RuntimeError) and 'rate limit' in str(error):
            raise
        result['errors'].append({'stage': 'stores', 'error': type(error).__name__})
    for store in result['stores']:
        try:
            store['menu'] = menu(store['id'])
        except Exception as error:
            if isinstance(error, RuntimeError) and 'rate limit' in str(error):
                raise
            store['menu'] = {'status': 'pending', 'sourceUrl': store['sourceUrl'], 'checkedAt': now()}
            result['errors'].append({'stage': 'menu', 'storeId': store['id'], 'error': type(error).__name__})
    (OUT / (brand['brand_code'] + '.json')).write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(result['name'], len(seen), 'stores;', len(result['errors']), 'pending errors', flush=True)
    return {k: v for k, v in result.items() if k != 'stores'}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    record = get('/brands')
    all_brands = record['data']['brands']
    # The platform leaves 敘方 untagged; its public branch menu explicitly has
    # tea, fresh milk, milk tea and milk foam categories (27610).
    brands = [b for b in all_brands if b['brand_code'] == 'syufang' or any(t['name'] in ('飲料', '咖啡') for t in b.get('meal_tag_info', []))]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(collect_brand, brands))
    index = {'checkedAt': record['checkedAt'], 'sourceUrl': 'https://order.nidin.shop/brands/',
             'platformBrandCount': len(all_brands), 'beverageBrandCount': len(brands),
             'scope': '你訂公開品牌專區標記飲料或咖啡的全台門市，另含逐店菜單確認為茶飲的未標記品牌敘方；包含複合餐飲。不代表全台所有實體品牌或門市。其他分類品牌保留名稱待後續核對，不推測其是否有兼售飲料。',
             'classificationEvidence': [{'code':'syufang','classification':'飲料','sourceUrl':'https://order.nidin.shop/menu/27610','evidence':'基本茶、鮮奶、奶蓋及奶茶系列分類'}],
             'unclassifiedBrands': [{'code': b['brand_code'], 'name': b['name'], 'tags': [t['name'] for t in b.get('meal_tag_info', [])]} for b in all_brands if b not in brands],
             'brands': results}
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
