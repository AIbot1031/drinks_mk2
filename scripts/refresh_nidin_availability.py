"""Refresh public stop-sale relations only for the original 41 catalog brands."""
import argparse,concurrent.futures,datetime,hashlib,json,pathlib,subprocess,time
from build_nidin_directory import ROOT,ALIASES
from nidin_menu_policy import availability_snapshot

def fetch(store_id):
    url=f'https://loctw-service-api.nidin.shop/shopper/v2/store/{store_id}/disableItemsRelationNew'
    at=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds')
    r=subprocess.run(['curl','--fail','--silent','--show-error','--max-time','25',url],capture_output=True)
    try:
        if r.returncode:raise ValueError('HTTP or network error')
        result=availability_snapshot(json.loads(r.stdout),at,url,hashlib.sha256(r.stdout).hexdigest())
    except (ValueError,KeyError,TypeError):
        result={'status':'pending','checkedAt':at,'sourceUrl':url,'reason':'門市停賣資料無法確認，不以原始菜單推測可供應。'}
    time.sleep(.1)
    return store_id,result

def verify_version(store):
    sid=store['id'];url=f'https://loctw-service-api.nidin.shop/shopper/v2/store/{sid}/onShelfMenuVer'
    at=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds')
    result={'checkedAt':at,'sourceUrl':url,'status':'pending'};updated=None
    try:
        r=subprocess.run(['curl','--fail','--silent','--show-error','--max-time','25',url],capture_output=True)
        if r.returncode:raise ValueError('Version unavailable')
        current=json.loads(r.stdout)
        if current.get('status')!=200:raise ValueError('Version invalid')
        old=store['menu']['version']
        if current['menu_id']!=old['menu_id'] or current['version']['stamp']!=old['version']['stamp']:
            from collect_nidin import CACHE,menu
            # Invalidate only our public-data cache entry for the changed menu.
            (CACHE/(hashlib.sha256(('/store/'+str(sid)+'/onShelfMenu').encode()).hexdigest()+'.json')).unlink(missing_ok=True)
            updated=menu(sid)
            if updated['version']['menu_id']!=current['menu_id'] or updated['version']['version']['stamp']!=current['version']['stamp']:raise ValueError('Menu changed while reading')
        result.update(status='verified',menuId=current['menu_id'],stamp=current['version']['stamp'],sha256=hashlib.sha256(r.stdout).hexdigest(),refreshed=updated is not None)
    except (ValueError,KeyError,TypeError,OSError):
        result['reason']='菜單版本無法與公開門市核對，不推測有效。'
    time.sleep(.1)
    return sid,result,updated

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--verify-versions',action='store_true');args=parser.parse_args()
    allowed=set(json.loads((ROOT/'data/catalog.json').read_text())['brands'])
    files=[]
    for path in sorted((ROOT/'data/research/nidin').glob('*.json')):
        if path.name=='index.json':continue
        raw=json.loads(path.read_text())
        if ALIASES.get(raw.get('code'),raw.get('name')) in allowed:files.append((path,raw))
    ids=sorted({s['id'] for _,raw in files for s in raw['stores'] if s.get('menu',{}).get('status')=='listed'})
    if args.verify_versions:
        stores={s['id']:s for _,raw in files for s in raw['stores'] if s['id'] in ids};versions={}
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for sid,record,updated in pool.map(verify_version,stores.values()):
                versions[sid]=record
                if updated is not None and record['status']=='verified':stores[sid]['menu']=updated
                if len(versions)%100==0:print('Verified menu versions:',len(versions),'/',len(ids),flush=True)
        for path,raw in files:
            for store in raw['stores']:
                if store['id'] in versions:
                    record=versions[store['id']];store['menu']['versionVerification']=record
                    if record['status']!='verified':store['menu']['availability']['status']='pending'
            path.write_text(json.dumps(raw,ensure_ascii=False,separators=(',',':'))+'\n')
        print('Menu versions:',len(versions),'refreshed:',sum(r.get('refreshed',False) for r in versions.values()),'pending:',sum(r['status']!='verified' for r in versions.values()),flush=True)
        return
    results={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for sid,record in pool.map(fetch,ids):
            results[sid]=record
            if len(results)%100==0:print('Checked public stores:',len(results),'/',len(ids),flush=True)
    for path,raw in files:
        for store in raw['stores']:
            if store['id'] in results:store['menu']['availability']=results[store['id']]
        path.write_text(json.dumps(raw,ensure_ascii=False,separators=(',',':'))+'\n')
    print('Availability verified:',sum(r['status']=='verified' for r in results.values()),'pending:',sum(r['status']=='pending' for r in results.values()),flush=True)

if __name__=='__main__':main()
