"""Public menu membership is insufficient: apply branch stop-sale relations.

Scheduled products are kept out conservatively until their applicable times can
be established. Optional topping outages do not remove an unrelated drink.
"""
import re,json,pathlib
POLICY=json.loads((pathlib.Path(__file__).resolve().parents[1]/'data/non-beverage-policy.json').read_text())
INFORMATION = re.compile(POLICY['information'],re.I)
MERCHANDISE = re.compile(POLICY['merchandise'],re.I)

def _relations(value, denied):
    if not isinstance(value, dict):
        if value == []: return
        raise ValueError('Unknown availability relation')
    categories=value.get('category_list', [])
    if not isinstance(categories,list):raise ValueError('Unknown disabled categories')
    denied['categories'].update(str(i) for i in categories)
    for kind in ['product_list','package_list']:
        section=value.get(kind,{})
        if section==[]:continue
        if not isinstance(section,dict):raise ValueError('Unknown disabled product section')
        relation=section.get('category',{})
        if relation==[]:continue
        if not isinstance(relation,dict):raise ValueError('Unknown disabled product map')
        for cid,rows in relation.items():
            if not isinstance(rows,list):raise ValueError('Unknown disabled product rows')
            for row in rows:
                if not isinstance(row,dict) or 'product_id' not in row:raise ValueError('Unknown disabled product')
                denied['products'].setdefault(str(cid),set()).add(str(row['product_id']))

def availability_snapshot(raw, checked_at, url, checksum):
    if raw.get('status')!=200:raise ValueError('Availability response failed')
    denied={'categories':set(),'products':{}}
    _relations(raw,denied)
    schedule=raw.get('schedule_info',{})
    if not isinstance(schedule,dict):raise ValueError('Unknown schedule')
    _relations(schedule.get('relation',{}),denied)
    _relations(raw.get('today_schedule_info',{}),denied)
    return {'status':'verified','checkedAt':checked_at,'sourceUrl':url,'sha256':checksum,
      'excludedCategoryIds':sorted(denied['categories']),
      'excludedProductIdsByCategory':{k:sorted(v) for k,v in sorted(denied['products'].items())},
      'policy':'排除門市停賣與有排程限制的品項；排程不推測適用時段，非即時庫存保證。'}

def product_available(menu,category,product):
    snapshot=menu.get('availability',{})
    if snapshot.get('status')!='verified':return False
    cid=str(category.get('product_id'));pid=str(product.get('product_id'))
    return (cid not in snapshot['excludedCategoryIds'] and
            pid not in snapshot['excludedProductIdsByCategory'].get(cid,[]))
