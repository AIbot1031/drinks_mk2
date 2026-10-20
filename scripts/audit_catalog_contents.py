"""Audit every public catalog row; emit only public names, IDs and counts."""
import argparse,collections,datetime,json,pathlib
from build_nidin_directory import ROOT,ALIASES,norm
from import_nidin_recommendations import classification,NON_DRINK_NAME
from nidin_menu_policy import INFORMATION,MERCHANDISE

def invalid(row):
    category=row.get('sourceMenuCategory','');name=row['name']
    if INFORMATION.search(norm(category+name)):return 'information_not_orderable'
    if MERCHANDISE.search(norm(category+name)):return 'non_beverage_or_bundle'
    if NON_DRINK_NAME.search(name):return 'non_beverage'
    if row.get('sourceKind')=='nidin':
        reason=classification(category,{'name':name,'type':1})
        if reason!='beverage':return reason
    return None

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--before',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);args=p.parse_args()
    before=json.loads(args.before.read_text())['drinks'];after=json.loads((ROOT/'data/catalog.json').read_text())['drinks'];ids={r['id'] for r in after}
    originals=[r for r in before if not r.get('sourceKind')]
    assert [r for r in after if not r.get('sourceKind')]==originals
    invalid_after=[{'id':r['id'],'name':r['name'],'reason':invalid(r)} for r in after if invalid(r)]
    if invalid_after:raise ValueError('Non-beverage remains: '+str(invalid_after))
    excluded=[{'id':r['id'],'brand':r['brand'],'name':r['name'],'category':r.get('sourceMenuCategory'),'reason':invalid(r) or 'no_remaining_verified_branch_availability'} for r in before if r['id'] not in ids]
    allowed=set(json.loads((ROOT/'data/catalog.json').read_text())['brands']);availability=[]
    for path in (ROOT/'data/research/nidin').glob('*.json'):
        if path.name=='index.json':continue
        raw=json.loads(path.read_text())
        if ALIASES.get(raw.get('code'),raw.get('name')) not in allowed:continue
        availability.extend(s['menu'] for s in raw['stores'] if s.get('menu',{}).get('status')=='listed')
    report={'checkedAt':datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds'),
      'scope':'逐筆檢查原本41品牌全目錄的品名與分類；不把優惠分類中的真正飲料一併刪除。',
      'beforeRows':len(before),'afterRows':len(after),'originalRowsScannedAndPreserved':len(originals),'brandCount':len(allowed),
      'scannedBySource':dict(collections.Counter(r.get('sourceKind','original') for r in before)),
      'excludedRows':len(excluded),'excludedByReason':dict(collections.Counter(r['reason'] for r in excluded)),
      'remainingNonBeverageMatches':invalid_after,'excludedItems':excluded,
      'availabilityStores':len(availability),'availabilityVerified':sum(m.get('availability',{}).get('status')=='verified' for m in availability),
      'versionVerified':sum(m.get('versionVerification',{}).get('status')=='verified' for m in availability),
      'versionRefreshed':sum(m.get('versionVerification',{}).get('refreshed',False) for m in availability),
      'limits':'公開菜單及停賣快照，不保證即時庫存；排程無法確認時間時保守排除。研究原始資料保留作稽核，推薦目錄不含被排除項目。'}
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['excludedItems']},ensure_ascii=False))

if __name__=='__main__':main()
