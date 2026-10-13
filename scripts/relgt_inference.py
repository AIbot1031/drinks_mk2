"""Read-only inference for the trusted, locally trained temporal RelGT checkpoint."""
from __future__ import annotations
import hashlib
import json
import math
import re
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def features(d):
    return {'product':json.dumps([d['brand'],d['name']],ensure_ascii=False),'brand':d['brand'],
            'tea':'|'.join(d['tea']) or 'NONE','milk':'|'.join(d['milk']) or 'NONE',
            'toppings':'|'.join(d['toppings']) or 'NONE','richness':float(d['richness'] or 0),
            'no_milk':float(d['noMilk'])}

class RelgtRanker:
    def __init__(self,checkpoint:Path,expected_hash:str,root:Path=ROOT):
        import torch
        import pandas as pd
        import torch_frame
        from torch_frame.data import Dataset
        from torch_frame.data.stats import StatType
        sys.path.insert(0,str(root/'training/vendor/relgt'))
        from model import RelGT
        digest=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
        if digest!=expected_hash:raise ValueError('Checkpoint checksum mismatch')
        # Pickle is permitted only after checking the trusted local manifest hash.
        saved=torch.load(checkpoint,weights_only=False,map_location='cpu')
        if saved.get('schema')!='relgt-temporal-intent-v1':raise ValueError('Wrong checkpoint task')
        raw=(root/'data/catalog.json').read_bytes()
        self.catalog_version=hashlib.sha256(raw).hexdigest()
        rows=json.loads(raw)['drinks']
        self.training_catalog_version=saved['catalog_sha256']
        if saved['catalog_sha256']!=self.catalog_version:
            manifest=json.loads((root/'data/catalog-update.json').read_text())
            if manifest.get('catalogVersion')!=self.catalog_version or saved['catalog_sha256'] not in manifest.get('compatibleCatalogVersions',[]):raise ValueError('Catalog mismatch')
        self.model_version='relgt-temporal-'+digest[:16]
        self.torch=torch;self.pd=pd;self.tf=torch_frame;self.Dataset=Dataset
        self.saved=saved;self.config=saved['config'];self.products=saved['products']
        grouped={}
        for d in sorted(rows,key=lambda d:d['id']):grouped.setdefault((d['brand'],d['name']),d)
        if set(grouped)!={(d['brand'],d['name']) for d in self.products}:raise ValueError('Product identity mismatch')
        current=[grouped[(d['brand'],d['name'])] for d in self.products]
        if any(a['id']!=b['id'] for a,b in zip(self.products,current)):raise ValueError('Product representative mismatch')
        self.products=current # Current features, frozen training vocabulary and weights.
        self.known_users=set(self.config['col_stats_dict']['user']['user'][StatType.COUNT][0])
        intents=self.config['col_stats_dict']['user']['intent'][StatType.COUNT][0]
        if 'like' not in intents:raise ValueError('Checkpoint lacks like intent')
        indexes={(d['brand'],d['name']):i for i,d in enumerate(self.products)}
        self.lookup={d['id']:indexes[(d['brand'],d['name'])] for d in rows}
        self.candidate_frame=self.frame('candidate',[features(d) for d in self.products])
        self.padding_frame=self.frame('padding',[{'is_padding':1.0}])
        torch.set_num_threads(4)
        self.model=RelGT(**self.config);self.model.load_state_dict(saved['state']);self.model.eval()

    def frame(self,name,rows):
        numeric={'richness','no_milk','past_events','history_span_days','is_padding'}
        df=self.pd.DataFrame(rows)
        ds=self.Dataset(df,col_to_stype={c:self.tf.numerical if c in numeric else self.tf.categorical for c in df.columns})
        ds.materialize(col_stats=self.config['col_stats_dict'][name])
        frame=ds.tensor_frame
        if frame.col_names_dict!=self.config['col_names_dict'][name]:raise ValueError('Feature order mismatch')
        return frame

    def forward(self,products,user_code,at,history):
        torch=self.torch;k=self.config['sample_node_len'];types_map=self.config['node_type_map']
        single=len(products)==1
        if single:products=products*2 # Upstream readout squeezes the batch axis.
        count=len(products)
        span=math.log1p((at-history[0]['occurredAt'])/86400000) if history else 0.0
        user=self.frame('user',[{'user':user_code,'intent':'like','past_events':float(len(history)),'history_span_days':span}])
        frames={'candidate':self.candidate_frame,'user':user,'padding':self.padding_frame}
        if history:frames['history']=self.frame('history',[{**features(self.products[self.lookup[e['drinkId']]]),'action':e['action']} for e in history])
        grouped_indexes={name:[] for name in types_map};frame_indexes={name:[] for name in types_map}
        types=[];hops=[];times=[];edges=[]
        for bi,product in enumerate(products):
            tokens=[('candidate',product,0,0),('user',0,1,0)]
            tokens += [('history',hi,2,(at-e['occurredAt'])/1000) for hi,e in enumerate(history)]
            tokens += [('padding',0,2,-1)]*(k-len(tokens))
            types.append([types_map[n] for n,_,_,_ in tokens]);hops.append([h for _,_,h,_ in tokens]);times.append([t for _,_,_,t in tokens])
            for j,(name,index,_,_) in enumerate(tokens):grouped_indexes[name].append(bi*k+j);frame_indexes[name].append(index)
            edges.extend([(bi*k,bi*k+1),(bi*k+1,bi*k)])
            for j in range(2,2+len(history)):edges.extend([(bi*k+1,bi*k+j),(bi*k+j,bi*k+1)])
        grouped={'grouped_tfs':{types_map[n]:frames[n][ix] for n,ix in frame_indexes.items() if ix},
                 'grouped_indices':{types_map[n]:ix for n,ix in grouped_indexes.items() if ix},
                 'flat_batch_idx':[i for i in range(count) for _ in range(k)],'flat_nbr_idx':list(range(k))*count}
        values=self.model(torch.tensor(types),torch.tensor(products),torch.tensor(hops),torch.tensor(times),
                          grouped,torch.tensor(edges).t().contiguous(),torch.arange(count).repeat_interleave(k)).reshape(-1)
        return values[:1] if single else values

    def rank(self,job):
        start=time.perf_counter()
        if job.get('catalogVersion')!=self.catalog_version:raise ValueError('Catalog mismatch')
        user=job.get('userCode');at=job.get('at');ids=job.get('candidateIds');history=job.get('history');top=job.get('topK')
        if not isinstance(user,str) or not re.fullmatch(r'u_[a-f0-9]{64}',user):raise ValueError('Anonymous user required')
        if type(at) is not int or at<0 or type(top) is not int or not 1<=top<=100:raise ValueError('Invalid request')
        if not isinstance(ids,list) or not 1<=len(ids)<=10000 or len(ids)!=len(set(ids)) or any(i not in self.lookup for i in ids):raise ValueError('Invalid candidates')
        if not isinstance(history,list) or len(history)>self.config['sample_node_len']-2:raise ValueError('Invalid history')
        last=-1
        for e in history:
            if not isinstance(e,dict) or e.get('drinkId') not in self.lookup or e.get('action') not in {'like','dislike','unlike','undislike'} or type(e.get('occurredAt')) is not int or not last<=e['occurredAt']<at:raise ValueError('History must be strictly past-only')
            last=e['occurredAt']
        metadata={'modelVersion':self.model_version,'catalogVersion':self.catalog_version,'durationMs':0,'historyCount':len(history)}
        if user not in self.known_users:return {**metadata,'fallbackReason':'new_user','scores':[]}
        if not history:return {**metadata,'fallbackReason':'no_history','scores':[]}
        products=sorted({self.lookup[i] for i in ids});scores={}
        # Upstream GNN positional encoding samples noise even in eval mode.
        # Restore RNG after a fixed inference seed; never mutate model weights.
        with self.torch.random.fork_rng(devices=[]),self.torch.inference_mode():
            self.torch.manual_seed(self.saved['parameters']['seed']+1)
            for offset in range(0,len(products),64):
                batch=products[offset:offset+64]
                values=self.forward(batch,user,at,history)
                if not self.torch.isfinite(values).all():raise ValueError('Nonfinite model output')
                scores.update(zip(batch,map(float,values)))
        ranked=sorted(ids,key=lambda i:(-scores[self.lookup[i]],i))[:top]
        return {**metadata,'durationMs':round((time.perf_counter()-start)*1000,3),
                'scores':[{'id':i,'score':scores[self.lookup[i]]} for i in ranked]}
