"""Map audited Nidin brand identities onto the existing recommendation catalog.

All catalog brands may have pending fields; only known addresses set geography.
Only exact normalized product names may become branch menu evidence.
"""
import datetime
import hashlib
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/research/nidin'
ALIASES = {
 '50lantea':'50嵐','comebuytea':'COMEBUY','cocotea':'CoCo都可','mrwish':'Mr.Wish',
 'teasoriginal':'Tea’s原味','itsotea':'一手私藏世界紅茶','shangyulin':'上宇林',
 'wootea':'五桐號','taotaotea':'先喝道','dinggo':'叮哥茶飲','teafect1':'台茶一號',
 'dayungs':'大苑子','oklatea':'好了啦紅茶冰','dejeng':'得正','19teahouse':'拾汣茶屋',
 'chatime':'日出茶太','chanung':'水巷茶弄','chingshin':'清心福全','unocha':'烏弄原茶',
 'toptiertea':'特好喝','whitealley':'白巷子','bigbigblacktea':'紅茶洋行',
 'liketea':'老賴茶棧','teamagichand':'茶之魔手','tptea2005':'茶湯會',
 'wanpoteashop':'萬波島嶼紅茶','lanshan':'藍衫茶所','milkshoptea':'迷客夏',
 'hechalou':'鶴茶樓','guijigroup':'龜記',
}
CITIES = ['臺北市','新北市','桃園市','臺中市','臺南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣']


def norm(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value)).replace('臺', '台').lower()


def region(address):
    address = norm(address).replace('鎭', '鎮')
    address = re.sub(r'^\d{3,6}', '', address)
    for city in CITIES:
        if address.startswith(norm(city)):
            tail = address[len(norm(city)):]
            match = re.match(r'^(.{1,6}?[區鄉鎮市])', tail)
            if match:
                return city, match[1]
    return None


def listed_names(menu):
    from nidin_menu_policy import product_available
    from import_nidin_recommendations import classification
    # Top-level references in visible categories only. Hidden legal text,
    # add-ons and disabled products cannot create evidence of a sold drink.
    products={str(p.get('product_id')):p for p in menu.get('products',[])}
    names=set()
    for cat in menu.get('categories',[]):
        if not cat.get('is_enable') or not cat.get('is_visible'):continue
        for pid in cat.get('product_list',[]):
            p=products.get(str(pid))
            if p and p.get('is_enable') and p.get('is_visible') and product_available(menu,cat,p) and classification(cat['name'],p)=='beverage':names.add(norm(p['name']))
    return names


def main():
    catalog = json.loads((ROOT / 'data/catalog.json').read_text())
    originals = json.loads((ROOT / 'data/huwei-brand-research.json').read_text())['stores'] + [json.loads((ROOT / 'data/coco-huwei-store.json').read_text())]
    source_index = json.loads((SOURCE / 'index.json').read_text())
    audit_path=ROOT/'data/research/branch-menu-audit.json'
    audit=json.loads(audit_path.read_text())['entries'] if audit_path.exists() else []
    stores, seen, pending, all_regions = [], set(), [], set()
    def add(store):
        place = region(store['address'])
        if not place:
            pending.append({'brand':store['brand'],'name':store['name'],'reason':'地址無法精確核對縣市及鄉鎮市區','sourceUrl':store['sourceUrl']})
            return
        identity = [norm(store[k]) for k in ['brand','name','address']]
        # JS storeIdentity normalizes NFKC, whitespace, 臺/台 and case.
        key = json.dumps(identity, ensure_ascii=False, separators=(',', ':'))
        if key in seen:
            if store.get('menuNames'):
                previous=next(s for s in stores if [norm(s[k]) for k in ['brand','name','address']]==identity)
                for field in ['menuNames','menuSourceUrl','menuScope','menuNote','checkedAt']:
                    previous[field]=store[field]
            return
        seen.add(key)
        stores.append({**store,'id':'s_'+hashlib.sha256(key.encode()).hexdigest()[:32],'city':place[0],'district':place[1]})
    for s in originals:
        refresh=next((r for r in audit if all(norm(r[k])==norm(s[k]) for k in ['brand','name','address'])),None)
        if refresh:
            s={**s,'menuNote':refresh['evidence'],'menuScope':refresh['menuScope']}
            if refresh['status']=='listed':
                known={norm(d['name']):d['name'] for d in catalog['drinks'] if d['brand']==s['brand']}
                s.update(menuNames=sorted({known[norm(i['name'])] for i in refresh['menuItems'] if norm(i['name']) in known}),menuSourceUrl=refresh['menuSourceUrl'],checkedAt=refresh['checkedAt'])
        add({k:s[k] for k in ['brand','name','address','sourceUrl','checkedAt','phone','menuScope','menuSourceUrl','menuNames','menuNote','soldOutNames','unconfirmedNames','unconfirmedReason'] if k in s})
    brand_summary = []
    for b in source_index['brands']:
        raw = json.loads((SOURCE / (b['code'] + '.json')).read_text())
        all_regions.update(place for s in raw['stores'] if (place := region(s.get('address') or '')))
        mapped = ALIASES.get(b['code'],raw['name'])
        if mapped not in catalog['brands']:
            mapped = None
        if mapped and mapped not in catalog['brands']:
            raise ValueError('unknown catalog brand mapping')
        brand_summary.append({'name':raw['name'],'code':b['code'],'tags':raw['tags'],'sourceUrl':raw['sourceUrl'],
          'status':raw['status'],'storeCount':len(raw['stores']),'expectedStoreCount':raw.get('expectedStoreCount'),
          'menuCount':sum(s.get('menu',{}).get('status')=='listed' for s in raw['stores']),
          'pendingCount':len(raw['errors']),'catalogBrand':mapped})
        if not mapped:
            continue
        names = {d['name'] for d in catalog['drinks'] if d['brand']==mapped}
        for s in raw['stores']:
            if not s.get('address') or not s.get('name') or len(s['name'])>80 or len(s['address'])>160 or re.search(r'[\x00-\x1f\x7f]',s['name']+s['address']):
                pending.append({'brand':mapped,'name':s.get('name'),'reason':'門市名稱或地址缺漏／超出格式','sourceUrl':s['sourceUrl']})
                continue
            menu = s.get('menu', {})
            matched = listed_names(menu)
            menu_names=sorted(n for n in names if norm(n) in matched)
            add({'brand':mapped,'name':s['name'],'address':s['address'],'phone':s.get('tel') or '',
                 'sourceUrl':s['sourceUrl'],'checkedAt':menu.get('checkedAt',s['checkedAt']),
                 'menuSourceUrl':s['sourceUrl'],'menuScope':'branch' if menu.get('status')=='listed' and menu_names else 'pending',
                 'menuNames':menu_names,
                 'menuNote':'你訂公開菜單與門市停賣快照已交叉篩選；排除停賣、限制排程及非飲料項目；價格、杯型與即時供應仍以門市為準。' if menu_names else '本次沒有可核對且通過停賣篩選的飲料，不推測可供應；維持待確認。'})
    regions = sorted(all_regions | {(s['city'],s['district']) for s in stores})
    output = {'checkedAt':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds'),
      'sourceUrl':source_index['sourceUrl'],'regions':[{'city':c,'district':d} for c,d in regions],
      'brandMappings':{b['code']:b['catalogBrand'] for b in brand_summary},'pending':pending,'stores':stores}
    (ROOT / 'data/nidin-directory.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',', ':'))+'\n')
    summary = {'checkedAt':output['checkedAt'],'scope':source_index['scope'],'platformBrandCount':source_index['platformBrandCount'],
      'beverageBrandCount':len(brand_summary),'storeCount':sum(b['storeCount'] for b in brand_summary),
      'menuCount':sum(b['menuCount'] for b in brand_summary),'pendingCount':sum(b['pendingCount'] for b in brand_summary),
      'pendingBrandCount':sum(b['status']=='pending' for b in brand_summary),
      'recommendationStoreCount':len(stores),'regionCount':len(regions),'brands':brand_summary}
    (ROOT / 'public/nidin-research.json').write_text(json.dumps(summary,ensure_ascii=False,separators=(',', ':'))+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='brands'},ensure_ascii=False))


if __name__ == '__main__':
    main()
