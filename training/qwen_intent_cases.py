"""Manually authored synthetic cases, never actual consumer conversations.

Training uses single edits; heldout cases use separate composed scenarios.
No heldout scenario is used as a training target or paraphrased augmentation.
"""
import json

VERSION = 'intent-cases-v1'
BRANDS = ['春水堂', '一沐日', '清心福全', '五十嵐']
TOPPINGS = ['珍珠', '奶蓋', '布丁', '仙草']
TEA = ['紅茶', '綠茶', '烏龍茶']


def case(key, group, message, query, filters, state_query='', state_filters=None,
         action='recommend'):
    return {'id': key, 'group': group, 'input': {'message': message,
        'state': {'query': state_query, 'filters': state_filters or {}},
        'brands': BRANDS, 'tea': TEA, 'toppings': TOPPINGS,
        'history': [], 'preferenceProfile': {}, 'catalogFeatures': {}},
        'expected': {'action': action, 'query': query, 'filters': filters,
            'assistantMessage': '你想喝哪種口味？' if action == 'clarify' else '好，我依照條件幫你找飲料。'}}


def datasets():
    train = [
        case('t01','brand','跳過清心福全','奶茶',{'excludedBrands':['清心福全']},'奶茶'),
        case('t02','brand','一沐日的先別推薦','綠茶',{'excludedBrands':['一沐日']},'綠茶'),
        case('t03','brand','我不想選五十嵐','紅茶',{'excludedBrands':['五十嵐']},'紅茶'),
        case('t04','brand','只找清心福全','奶茶',{'brand':'清心福全'},'奶茶'),
        case('t05','release','解除清心福全排除','奶茶',{},'奶茶',{'excludedBrands':['清心福全']}),
        case('t06','release','移除一沐日的排除條件','綠茶',{},'綠茶',{'excludedBrands':['一沐日']}),
        case('t07','topping','把奶蓋排除','奶茶',{'excludedToppings':['奶蓋']},'奶茶'),
        case('t08','topping','布丁不要加','紅茶',{'excludedToppings':['布丁']},'紅茶'),
        case('t09','topping','仙草先跳過','奶茶',{'excludedToppings':['仙草']},'奶茶'),
        case('t10','release','取消奶蓋的排除','奶茶',{},'奶茶',{'excludedToppings':['奶蓋']}),
        case('t11','release','解除布丁排除','綠茶',{},'綠茶',{'excludedToppings':['布丁']}),
        case('t12','price','上限是七十元','奶茶',{'maxPrice':70},'奶茶'),
        case('t13','price','預算五十五元內','紅茶',{'maxPrice':55},'紅茶'),
        case('t14','price','最多花九十元','綠茶',{'maxPrice':90},'綠茶'),
        case('t15','nutrient','熱量不超過三百卡','奶茶',{'maxCalories':300},'奶茶'),
        case('t16','nutrient','咖啡因最多一百毫克','紅茶',{'maxCaffeine':100},'紅茶'),
        case('t17','tea','我要綠茶','綠茶',{'tea':'綠茶'}),
        case('t18','tea','想喝烏龍茶','烏龍茶',{'tea':'烏龍茶'}),
        case('t19','milk','幫我找鮮奶茶','鮮奶茶',{'milk':'fresh','milkTea':True}),
        case('t20','milk','改成無奶飲料','無奶飲料',{'milk':'none','milkTea':False},'奶茶',{'milkTea':True}),
        case('t21','batch','再給我其他選項','綠茶',{'maxPrice':55},'綠茶',{'maxPrice':55}),
        case('t22','batch','下一輪飲料','烏龍茶',{'excludedBrands':['五十嵐']},'烏龍茶',{'excludedBrands':['五十嵐']}),
        case('t23','clarify','幫我挑點喝的','',{},action='clarify'),
        case('t24','clarify','今天不知道喝啥','',{},action='clarify'),
    ]
    valid = [
        case('v01','brand_exclusion','春水堂我不喜歡，找八十元以下奶茶','奶茶',{'milkTea':True,'maxPrice':80,'excludedBrands':['春水堂']}),
        case('v02','brand_release','春水堂現在能接受，但預算和布丁限制留著','奶茶',{'maxPrice':80,'excludedToppings':['布丁']},'奶茶',{'maxPrice':80,'excludedToppings':['布丁'],'excludedBrands':['春水堂']}),
        case('v03','topping_exclusion','喝烏龍茶，別加珍珠也別加奶蓋','烏龍茶',{'tea':'烏龍茶','excludedToppings':['珍珠','奶蓋']}),
        case('v04','topping_release','珍珠限制拿掉，仍然不加仙草','奶茶',{'milkTea':True,'excludedToppings':['仙草']},'奶茶',{'milkTea':True,'excludedToppings':['珍珠','仙草']}),
        case('v05','numeric','紅茶一杯，四十五元以下，熱量二百卡內','紅茶',{'tea':'紅茶','maxPrice':45,'maxCalories':200}),
        case('v06','numeric','要綠茶，咖啡因八十毫克內，最多六十五元','綠茶',{'tea':'綠茶','maxCaffeine':80,'maxPrice':65}),
        case('v07','cross_turn','改成鮮奶，其他限制照舊','奶茶',{'milkTea':True,'milk':'fresh','maxPrice':75,'excludedBrands':['五十嵐']},'奶茶',{'milkTea':True,'maxPrice':75,'excludedBrands':['五十嵐']}),
        case('v08','cross_turn','飲料換一批就好，不改條件','綠茶',{'tea':'綠茶','maxPrice':60,'excludedToppings':['珍珠']},'綠茶',{'tea':'綠茶','maxPrice':60,'excludedToppings':['珍珠']}),
        case('v09','clarify','替我決定一杯吧','',{},action='clarify'),
        case('v10','cross_turn','只改預算到四十元，還是不要春水堂','紅茶',{'tea':'紅茶','maxPrice':40,'excludedBrands':['春水堂']},'紅茶',{'tea':'紅茶','maxPrice':80,'excludedBrands':['春水堂']}),
    ]
    assert len({c['input']['message'] for c in train + valid}) == len(train + valid)
    for c in train + valid:
        assert set(c['expected']) == {'action','query','filters','assistantMessage'}
        assert all(b in BRANDS for b in c['expected']['filters'].get('excludedBrands', []))
        assert all(t in TOPPINGS for t in c['expected']['filters'].get('excludedToppings', []))
    return train, valid


def semantic_metrics(rows):
    def schema(r):
        if not isinstance(r, dict) or set(r) != {'action','query','filters','assistantMessage'}:
            return False
        f = r.get('filters')
        if r['action'] not in ['recommend','clarify'] or not isinstance(r['query'],str) or not isinstance(r['assistantMessage'],str) or not isinstance(f,dict):
            return False
        allowed = {'brand','excludedBrands','excludedToppings','milkTea','milk','tea','topping','maxPrice','maxCalories','maxCaffeine'}
        if set(f)-allowed: return False
        for k,v in f.items():
            if k.startswith('max') and (type(v) not in [int,float] or v < 0): return False
            if k == 'milkTea' and type(v) is not bool: return False
            if k == 'milk' and v not in ['any','none','fresh','plant']: return False
            if k in ['brand','tea','topping'] and v not in {'brand':BRANDS,'tea':TEA,'topping':TOPPINGS}[k]: return False
            if k in ['excludedBrands','excludedToppings'] and (not isinstance(v,list) or any(x not in (BRANDS if k=='excludedBrands' else TOPPINGS) for x in v)): return False
        return True
    def norm(f):
        return {k:sorted(v) if isinstance(v,list) else v for k,v in f.items()}
    total = len(rows)
    out = {'json_valid_rate':sum(isinstance(r.get('prediction'),dict) for r in rows)/total,
        'schema_valid_rate':sum(schema(r.get('prediction')) for r in rows)/total}
    for group in ['brand_exclusion','brand_release','topping_exclusion','topping_release','numeric','cross_turn','clarify','all']:
        subset = [r for r in rows if group=='all' or r['case']['group']==group]
        hits = 0
        for r in subset:
            p = r.get('prediction') or {}; e = r['case']['expected']
            hits += schema(p) and p['action']==e['action'] and p['query']==e['query'] and norm(p['filters'])==norm(e['filters'])
        out[group+'_intent_exact_rate'] = hits/len(subset) if subset else None
    return out
