"""Fixed before/after deployment evaluation; never train or publish here."""
import argparse
import gc
import hashlib
import json
import math
import os
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
OUT=ROOT/'.wrangler/model-comparison'


def hashfile(p):return hashlib.sha256(p.read_bytes()).hexdigest()


def qwen():
    import mlx.core as mx
    from mlx_lm import load,generate
    from mlx_lm.sample_utils import make_sampler
    from scripts.qwen_agent import SYSTEM
    fixture=OUT/'qwen-fixtures.json';cases=json.loads(fixture.read_text())
    base=ROOT/'training_artifacts/qwen3-8b-4bit'
    results={'fixture_sha256':hashfile(fixture),'kind':'synthetic actual Worker-preprocessed contract; no consumer records',
        'base_source':json.loads((base/'source.json').read_text()),'versions':{}}
    for name,adapter in [('online',None),('candidate',ROOT/'training_artifacts/20261013T232109-qwen-intent-qlora/adapter')]:
        model,tokenizer=load(str(base),adapter_path=str(adapter) if adapter else None,trust_remote_code=False)
        model.eval();rows=[]
        for c in cases:
            system=SYSTEM
            if str(c['job']['state'].get('guard','')).startswith('未辨識條件：'):
                system+='\n本輪有尚未辨識的排除項目，必須 action=clarify。只問使用者具體要排除哪種配料，不能說已排除未知配料，不要推測奶茶。filters 保留 state.filters，不要新增任何未知配料。'
            prompt=tokenizer.apply_chat_template([{'role':'system','content':system},{'role':'user','content':json.dumps(c['job'],ensure_ascii=False)}],tokenize=False,add_generation_prompt=True,enable_thinking=False)
            raw=generate(model,tokenizer,prompt=prompt,max_tokens=320,sampler=make_sampler(temp=0),verbose=False)
            try:p=json.loads(raw[raw.index('{'):raw.rindex('}')+1])
            except (ValueError,TypeError):p=None
            rows.append({'id':c['id'],'group':c['group'],'prediction':p})
            print(f'Qwen {name} {c["id"]}',flush=True)
        results['versions'][name]={'adapter_sha256':hashfile(adapter/'adapters.safetensors') if adapter else None,'rows':rows}
        del model;gc.collect();mx.clear_cache()
    (OUT/'qwen-raw.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))


def macbert():
    import numpy as np
    import torch
    from scripts.macbert_agent import Ranker
    rows=json.loads((ROOT/'data/catalog.json').read_text())['drinks']
    # Labels come from actual catalogue fields, not from model outputs. Ranking
    # checks supplement contrastive loss but aren't consumer relevance judgements.
    specs=[('紅茶',{'tea':'紅茶'}),('清爽綠茶',{'tea':'綠茶'}),('烏龍茶',{'tea':'烏龍茶'}),
        ('紅茶加鮮奶',{'tea':'紅茶','milk':'鮮奶'}),('綠茶加鮮奶',{'tea':'綠茶','milk':'鮮奶'}),
        ('奶茶有珍珠',{'milkAny':True,'topping':'珍珠'}),('布丁奶茶',{'milkAny':True,'topping':'布丁'}),
        ('奶蓋茶',{'topping':'奶蓋'}),('仙草飲料',{'topping':'仙草'}),
        ('清心福全紅茶',{'brand':'清心福全','tea':'紅茶'}),('一沐日綠茶',{'brand':'一沐日','tea':'綠茶'}),
        ('春水堂珍珠奶茶',{'brand':'春水堂','milkAny':True,'topping':'珍珠'})]
    def relevant(d,f):
        return all((d['brand']==v if k=='brand' else v in d['tea'] if k=='tea' else v in d['milk'] and not d.get('milkConflict') if k=='milk' else v in d['toppings'] if k=='topping' else bool(d['milk']) and bool(d['tea']) and not d.get('milkConflict')) for k,v in f.items())
    groups={}
    for i,d in enumerate(rows):groups.setdefault((d['brand'],d['name']),[]).append(i)
    keys=list(groups)
    labels=[]
    for query,f in specs:
        rel=np.array([any(relevant(rows[i],f) for i in groups[k]) for k in keys])
        if not rel.any():raise ValueError('No relevant products for evaluation label')
        labels.append(rel)
    results={'kind':'synthetic query/catalog-field relevance proxy; no human consumer ratings',
        'catalog_sha256':hashfile(ROOT/'data/catalog.json'),'queries':specs,'versions':{}}
    for name,path in [('online',ROOT/'training_artifacts/20261013T143230-macbert-contrastive/model'),('candidate',ROOT/'training_artifacts/20261013T231557-macbert-contrastive/model')]:
        ranker=Ranker(path,'mps');emb=ranker.embed([q for q,_ in specs]);measure=[]
        for qi,(query,f) in enumerate(specs):
            score=ranker.vectors@emb[qi]
            # Match website grouping: each product's best-scoring variant.
            product_scores=[float(max(score[i] for i in groups[k])) for k in keys]
            order=sorted(range(len(keys)),key=lambda i:(-product_scores[i],keys[i]))[:10]
            rel=labels[qi];hits=[int(rel[i]) for i in order]
            dcg=sum(v/math.log2(i+2) for i,v in enumerate(hits))
            ideal=sum(1/math.log2(i+2) for i in range(min(10,int(rel.sum()))))
            measure.append({'query':query,'relevant_products':int(rel.sum()),'precision_at_10':sum(hits)/10,'recall_at_10':sum(hits)/int(rel.sum()),'ndcg_at_10':dcg/ideal,
                'top_products':[{'brand':keys[i][0],'name':keys[i][1],'relevant':bool(rel[i])} for i in order]})
        results['versions'][name]={'model_version':ranker.model_version,'weights_sha256':hashfile(path/'model.safetensors'),'cases':measure,
            'mean_precision_at_10':sum(m['precision_at_10'] for m in measure)/len(measure),'mean_ndcg_at_10':sum(m['ndcg_at_10'] for m in measure)/len(measure)}
        del ranker;gc.collect();torch.mps.empty_cache()
    results['per_query_regressions']=[a['query'] for a,b in zip(results['versions']['online']['cases'],results['versions']['candidate']['cases']) if b['ndcg_at_10']<a['ndcg_at_10']-1e-9]
    results['promotion_allowed']=not results['per_query_regressions']
    (OUT/'macbert.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))


def relgt():
    import torch
    paths=[('online',ROOT/'training_artifacts/20261013T155618-relgt-long-intent/model.pt'),('candidate',ROOT/'training_artifacts/20261013T231534-relgt-long-intent/model.pt')]
    snapshots=[]
    for name,path in paths:
        saved=torch.load(path,map_location='cpu',weights_only=False)
        keys={(s['user_code'],s['at'],s['action'],s['target']) for s in saved['samples']}
        snapshots.append((name,saved,keys,path))
    old=snapshots[0][2];new=snapshots[1][2]
    report={'kind':'independent temporal holdout availability audit; no fabricated targets',
        'versions':{name:{'weights_sha256':hashfile(path),'training_targets':len(keys),'training_users':len({s['user_code'] for s in saved['samples']}),'training_cutoff_ms':max(s['at'] for s in saved['samples']),'catalog_sha256':saved['catalog_sha256']} for name,saved,keys,path in snapshots},
        'new_targets_vs_online':len(new-old),'independent_targets_not_in_candidate_training':0,
        'promotion_allowed':False,'reason':'All 10 observed targets were used to train candidate. The 3 newer targets relative to online model are not independent candidate holdout; cannot claim new model improves future ranking.'}
    (OUT/'relgt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('model',choices=['qwen','macbert','relgt']);args=p.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    os.environ.update(HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false')
    globals()[args.model]()
