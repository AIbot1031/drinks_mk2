"""Train official RelGT on strictly chronological real consumer events."""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import random
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from training.intent_data import prepare
from training.run_reports import add_comparison,comparison_markdown
TZ=ZoneInfo('Asia/Taipei')
UPSTREAM='19e423ca3e7cac761130aba790857f2dc3a46ef7'


def train(products,samples,split,args,report,out):
    import numpy as np
    import pandas as pd
    import torch
    import torch_frame
    from torch_frame.data import Dataset
    sys.path.insert(0,str(ROOT/'training/vendor/relgt'))
    from model import RelGT
    torch.set_num_threads(4)
    torch.manual_seed(args.seed);random.seed(args.seed);np.random.seed(args.seed)
    # Each observation is a candidate root with user and past-event neighbors.
    names=['candidate','user','history','padding']
    node_types={name:i for i,name in enumerate(names)}
    tables={name:[] for name in names}
    roots=[];sample_roots=[];fit_rows={name:set() for name in names}
    def features(d):
        return {'product':json.dumps([d['brand'],d['name']],ensure_ascii=False),
                'brand':d['brand'],'tea':'|'.join(d['tea']) or 'NONE',
                'milk':'|'.join(d['milk']) or 'NONE','toppings':'|'.join(d['toppings']) or 'NONE',
                'richness':float(d['richness'] or 0),'no_milk':float(d['noMilk'])}
    tables['padding']=[{'is_padding':1.0}]
    fit_rows['padding'].add(0)
    for si,s in enumerate(samples):
        group=[]
        for product in s['candidates']:
            candidate=len(tables['candidate']);tables['candidate'].append(features(products[product]))
            user=len(tables['user']);tables['user'].append({'user':s['user_code'],'intent':s['action'],
                'past_events':float(len(s['history'])),
                'history_span_days':math.log1p((s['at']-s['history'][0]['occurred_at'])/86400000) if s['history'] else 0.0})
            history=[]
            for e in s['history']:
                hi=len(tables['history'])
                tables['history'].append({**features(products[e['product']]),'action':e['action']})
                history.append((hi,(s['at']-e['occurred_at'])/1000))
                if si in split['train']:fit_rows['history'].add(hi)
            if si in split['train']:
                fit_rows['candidate'].add(candidate);fit_rows['user'].add(user)
            group.append(len(roots));roots.append({'candidate':candidate,'user':user,'history':history,'product':product})
        sample_roots.append(group)
    if not tables['history']:
        # Feature vocabulary placeholder, never an event or training target.
        tables['history']=[{**features(products[0]),'action':'NO_HISTORY'}]
        fit_rows['history'].add(0)
    frames={};cols={};stats={}
    numeric={'richness','no_milk','past_events','history_span_days','is_padding'}
    for name,rows in tables.items():
        df=pd.DataFrame(rows)
        indexes=sorted(fit_rows[name])
        if not indexes:indexes=[0] # No observed history: placeholder metadata only.
        types={c:torch_frame.numerical if c in numeric else torch_frame.categorical for c in df.columns}
        ds=Dataset(df.iloc[indexes].reset_index(drop=True),col_to_stype=types).materialize()
        frames[name]=ds.convert_to_tensor_frame(df);cols[name]=ds.tensor_frame.col_names_dict;stats[name]=ds.col_stats
    k=2+args.history_size
    config=dict(num_nodes=len(products),max_neighbor_hop=2,node_type_map=node_types,
                col_names_dict=cols,col_stats_dict=stats,local_num_layers=1,channels=32,
                out_channels=1,global_dim=32,heads=4,conv_type='full',gnn_pe_dim=0,
                num_centroids=8,sample_node_len=k,ff_dropout=0.0,attn_dropout=0.0)
    model=RelGT(**config)
    initial=[p.detach().clone() for p in model.parameters()]
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.learning_rate,weight_decay=.01)
    report['environment']={'python':platform.python_version(),'device':'cpu',
        'chip':subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip(),
        'packages':{n:importlib.metadata.version(n) for n in ['torch','torch-geometric','pytorch-frame']}}
    report['parameters']={**vars(args),'snapshot':str(args.snapshot.relative_to(ROOT)) if args.snapshot.is_relative_to(ROOT) else 'protected external snapshot',
        'loss':'sampled next observed-action cross entropy; distractors are NOT dislike labels',
        'trainable_parameters':sum(p.numel() for p in model.parameters()),'channels':32,'heads':4,'centroids':8,
        'starting_checkpoint':None,'initialization':'new temporal task, random official architecture weights'}

    def forward(ids):
        root_ids=[ri for si in ids for ri in sample_roots[si]]
        grouped_indexes={t:[] for t in node_types.values()};frame_indexes={name:[] for name in names}
        types=[];hops=[];times=[];node_ids=[];edges=[]
        for bi,ri in enumerate(root_ids):
            root=roots[ri]
            tokens=[('candidate',root['candidate'],0,0),('user',root['user'],1,0)]
            tokens += [('history',hi,2,age) for hi,age in root['history']]
            tokens += [('padding',0,2,-1)]*(k-len(tokens))
            types.append([node_types[t] for t,_,_,_ in tokens]);hops.append([h for _,_,h,_ in tokens]);times.append([tm for _,_,_,tm in tokens]);node_ids.append(root['product'])
            for j,(name,index,_,_) in enumerate(tokens):
                grouped_indexes[node_types[name]].append(bi*k+j);frame_indexes[name].append(index)
            edges.extend([(bi*k,bi*k+1),(bi*k+1,bi*k)])
            for j in range(2,2+len(root['history'])):edges.extend([(bi*k+1,bi*k+j),(bi*k+j,bi*k+1)])
        b=len(root_ids)
        grouped={'grouped_tfs':{node_types[n]:frames[n][ix] for n,ix in frame_indexes.items() if ix},
                 'grouped_indices':{t:ix for t,ix in grouped_indexes.items() if ix},
                 'flat_batch_idx':[i for i in range(b) for _ in range(k)],'flat_nbr_idx':list(range(k))*b}
        logits=model(torch.tensor(types),torch.tensor(node_ids),torch.tensor(hops),torch.tensor(times),
                     grouped,torch.tensor(edges).t().contiguous(),torch.arange(b).repeat_interleave(k)).reshape(-1)
        return torch.split(logits,[len(sample_roots[i]) for i in ids])

    def evaluate(ids):
        if not ids:return None
        model.eval();ce=[];rr=[];hits=[]
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(args.seed+1)
            with torch.no_grad():
                for start in range(0,len(ids),args.batch_size):
                    for scores in forward(ids[start:start+args.batch_size]):
                        ce.append(float(torch.nn.functional.cross_entropy(scores.unsqueeze(0),torch.tensor([0]))))
                        rank=1+int((scores[1:]>=scores[0]).sum())
                        rr.append(1/rank);hits.append(float(rank<=min(5,len(scores))))
        return {'sampled_ce':sum(ce)/len(ce),'sampled_mrr':sum(rr)/len(rr),'sampled_hit_at_5':sum(hits)/len(hits),'rows':len(ids)}
    report['before_training']={name:evaluate(ids) for name,ids in split.items()}
    report['optimizer_steps']=0;report['history']=[]
    for epoch in range(1,args.epochs+1):
        model.train();order=split['train'].copy();random.shuffle(order);losses=[]
        for start in range(0,len(order),args.batch_size):
            optimizer.zero_grad(set_to_none=True)
            scores=forward(order[start:start+args.batch_size])
            loss=torch.stack([torch.nn.functional.cross_entropy(s.unsqueeze(0),torch.tensor([0])) for s in scores]).mean()
            if not torch.isfinite(loss):raise RuntimeError('Non-finite loss')
            loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1.0);optimizer.step()
            report['optimizer_steps']+=1;losses.append(float(loss.detach()))
        report['history'].append({'epoch':epoch,'training_ce':sum(losses)/len(losses)})
        print(f"epoch={epoch} steps={report['optimizer_steps']} ce={report['history'][-1]['training_ce']:.6f}",flush=True)
    report['after_training']={name:evaluate(ids) for name,ids in split.items()}
    report['weights_changed']=any(not torch.equal(a,p.detach()) for a,p in zip(initial,model.parameters()))
    if not report['weights_changed']:raise RuntimeError('No parameter update occurred')
    model.eval()
    with torch.random.fork_rng(devices=[]),torch.no_grad():
        torch.manual_seed(args.seed+1);reference=[s.clone() for s in forward(split['train'][:1])]
    checkpoint=out/'model.pt'
    torch.save({'schema':'relgt-temporal-intent-v1','state':model.state_dict(),'optimizer':optimizer.state_dict(),
        'config':config,'feature_tables':tables,'roots':roots,'sample_roots':sample_roots,'split':split,
        'products':products,'samples':samples,'snapshot_sha256':report['snapshot_sha256'],
        'catalog_sha256':report['catalog_sha256'],'parameters':report['parameters'],
        'epoch':args.epochs,'torch_rng':torch.get_rng_state(),'python_rng':random.getstate()},checkpoint)
    saved=torch.load(checkpoint,weights_only=False) # Trusted checkpoint generated locally in this run.
    fresh=RelGT(**saved['config']);fresh.load_state_dict(saved['state']);model=fresh.eval()
    with torch.random.fork_rng(devices=[]),torch.no_grad():
        torch.manual_seed(args.seed+1);reloaded=forward(split['train'][:1])
    report['checkpoint_reload_max_error']=max(float((a-b).abs().max()) for a,b in zip(reference,reloaded))
    if report['checkpoint_reload_max_error']>1e-6:raise RuntimeError('Checkpoint reload mismatch')
    report['checkpoint']=str(checkpoint.relative_to(ROOT))
    report['checkpoint_sha256']=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    report['checkpoint_reload_verified']=True
    report['status']='trained_chronological_holdout' if split['validation'] else 'trained_unvalidated_small_temporal_data'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot',type=Path,required=True)
    p.add_argument('--epochs',type=int,default=10)
    p.add_argument('--batch-size',type=int,default=8)
    p.add_argument('--history-size',type=int,default=8)
    p.add_argument('--distractors',type=int,default=15)
    p.add_argument('--learning-rate',type=float,default=0.0001)
    p.add_argument('--seed',type=int,default=42)
    args=p.parse_args();args.snapshot=args.snapshot.resolve()
    if min(args.epochs,args.batch_size,args.history_size,args.distractors)<1 or args.learning_rate<=0:p.error('Positive settings required')
    started=time.perf_counter();at=datetime.now(TZ)
    run_id=at.strftime('%Y%m%dT%H%M%S')+'-relgt-long-intent'
    out=ROOT/'training_artifacts'/run_id;out.mkdir(parents=True,exist_ok=False)
    report={'run_id':run_id,'started_at':at.isoformat(timespec='seconds'),'status':'running',
        'task':'self-supervised next observed preference action given strictly past user events',
        'trigger':'explicit user training instruction','upstream_commit':UPSTREAM,
        'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)),
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'optimizer_steps':0,'published':False,'updated_users':0,
        'changes':['first real temporal intent training adapter','strict past-only event graph',
                   'next-action sampled ranking target, no price target','small real samples train without a quality gate'],
        'limitations':['same-day data cannot establish long-term intent quality',
            'unobserved distractors are not dislikes and may be future positives',
            'sampled metrics are not full-catalog ranking quality',
            'explicit padding tokens participate in upstream attention',
            'current catalog metadata assumed available, no historic catalog reconstruction',
            'no automatic production deployment, nightly schedule or resume CLI']}
    try:
        raw=args.snapshot.read_bytes();snapshot=json.loads(raw)
        catalog=(ROOT/'data/catalog.json').read_bytes()
        report['snapshot_sha256']=hashlib.sha256(raw).hexdigest();report['catalog_sha256']=hashlib.sha256(catalog).hexdigest()
        if snapshot.get('catalog_sha256')!=report['catalog_sha256']:raise ValueError('Catalog snapshot mismatch')
        report['data_cutoff_ms']=snapshot['cutoff_ms']
        products,samples,split,counts,method=prepare(snapshot,json.loads(catalog)['drinks'],args.history_size,args.distractors,args.seed)
        report['data']=counts;report['split_method']=method;report['split_rows']={k:len(v) for k,v in split.items()}
        if samples:train(products,samples,split,args,report,out)
        else:
            report['status']='skipped_no_valid_real_targets'
            report['reason']='No real valid like/dislike targets after cleaning; no invented training data'
    except Exception as exc:
        report['status']='failed';report['error_type']=type(exc).__name__
        print('Training failed: '+type(exc).__name__,file=sys.stderr)
        raise
    finally:
        report['ended_at']=datetime.now(TZ).isoformat(timespec='seconds');report['duration_seconds']=round(time.perf_counter()-started,3)
        add_comparison(report)
        folder=ROOT/'docs/training-runs';folder.mkdir(exist_ok=True)
        body=json.dumps(report,ensure_ascii=False,indent=2)+'\n'
        (folder/(run_id+'.json')).write_text(body)
        (folder/(run_id+'.md')).write_text('# RelGT 真實時間事件初次意圖訓練\n\n'
            '使用者要求立即實際訓練；本次使用真實匿名事件，根據先前互動預測下一個收藏／不喜歡目標。'
            '不訓練價格、不創造不喜歡標籤；對照候選只作排序比較。少量單日資料可訓練，但不能證明跨日長期效果。\n\n'
            +comparison_markdown(report)+'\n## 實際執行與更新內容\n\n```json\n'+body+'```\n')
        with (ROOT/'daily.txt').open('a') as f:f.write(f"\n[{report['ended_at']}｜RelGT 真實時間事件訓練]\n- 狀態：{report['status']}；optimizer 步數 {report['optimizer_steps']}；耗時 {report['duration_seconds']} 秒。\n- 資料彙總：{json.dumps(report.get('data',{}),ensure_ascii=False)}。\n- 前後比較與更新報告：docs/training-runs/{run_id}.md／JSON。\n- 無價格目標；未發布模型／更新用戶榜單／啟用排程，沒有將原始事件或用戶代碼放到 GitHub。\n")
        print('REPORT='+str(folder/(run_id+'.md')),flush=True)


if __name__=='__main__':main()
