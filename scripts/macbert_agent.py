"""Always-on MacBERT rank agent; outbound authenticated WSS, no inbound port."""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
import re
import time
from pathlib import Path


try:
    from .inference_audit import audit
except ImportError:
    from inference_audit import audit

ROOT=Path(__file__).resolve().parents[1]


class Ranker:
    def __init__(self,model_path,device):
        audit('macbert','loading')
        import numpy as np
        import torch
        from transformers import AutoModel,AutoTokenizer
        self.np=np;self.torch=torch
        if device=='mps' and not torch.backends.mps.is_available():raise RuntimeError('MPS unavailable')
        torch.set_num_threads(4)
        self.device=device;self.model_path=model_path
        self.model=AutoModel.from_pretrained(model_path,use_safetensors=True,attn_implementation='eager').to(device).eval()
        self.tokenizer=AutoTokenizer.from_pretrained(model_path)
        raw=(ROOT/'data/catalog.json').read_bytes()
        self.catalog_version=hashlib.sha256(raw).hexdigest()
        weights_hash=hashlib.sha256((model_path/'model.safetensors').read_bytes()).hexdigest()
        self.model_version='macbert-'+weights_hash[:16]
        rows=json.loads(raw)['drinks'];self.ids=[d['id'] for d in rows];self.lookup={id:i for i,id in enumerate(self.ids)}
        cache=ROOT/'training_artifacts'/('macbert-index-'+self.catalog_version[:12]+'-'+weights_hash[:12]+'.npz')
        if cache.exists():
            data=np.load(cache,allow_pickle=False)
            if list(data['ids'])!=self.ids:raise RuntimeError('Index IDs mismatch')
            self.vectors=data['vectors']
        else:
            texts=[]
            for d in rows:
                milk=[] if d.get('milkConflict') else d['milk']
                text='。'.join([d['brand'],d['name'],'茶種：'+'、'.join(d['tea']),
                    '奶類：'+'、'.join(milk),'配料：'+'、'.join(d['toppings']),d['taste'][:120]])
                texts.append(re.sub(r'https?://\S+|\d+(?:\.\d+)?','',text))
            batches=[]
            for start in range(0,len(texts),64):
                batches.append(self.embed(texts[start:start+64]))
                if start%640==0:print(f'INDEX_PROGRESS={min(start+64,len(texts))}/{len(texts)}',flush=True)
            self.vectors=np.concatenate(batches)
            np.savez_compressed(cache,ids=np.array(self.ids),vectors=self.vectors)
        if self.vectors.shape!=(len(rows),768) or not np.isfinite(self.vectors).all():raise RuntimeError('Invalid vectors')
        audit('macbert','ready',modelVersion=self.model_version,device=device,**self.memory())
        print(f'MODEL_READY={self.model_version} VECTORS={len(rows)} DEVICE={device}',flush=True)

    def memory(self):
        try:
            if self.device=='mps':return {'gpuActiveMB':round(self.torch.mps.current_allocated_memory()/1048576,1),'gpuDriverMB':round(self.torch.mps.driver_allocated_memory()/1048576,1)}
        except Exception:pass
        return {}

    def embed(self,texts):
        torch=self.torch
        encoded=self.tokenizer(texts,padding=True,truncation=True,max_length=64,return_tensors='pt').to(self.device)
        with torch.no_grad():
            hidden=self.model(**encoded).last_hidden_state
            mask=encoded['attention_mask'].clone()
            mask[encoded['input_ids']==self.tokenizer.cls_token_id]=0
            mask[encoded['input_ids']==self.tokenizer.sep_token_id]=0
            mask=mask.unsqueeze(-1)
            vectors=torch.nn.functional.normalize((hidden*mask).sum(1)/mask.sum(1).clamp(min=1),dim=-1)
        return vectors.cpu().numpy()

    def rank(self,job):
        start=time.perf_counter()
        if job.get('catalogVersion')!=self.catalog_version:raise ValueError('Catalog mismatch')
        query=job.get('query');ids=job.get('candidateIds');k=job.get('topK')
        if not isinstance(query,str) or len(query)>300 or not isinstance(ids,list) or len(ids)>10000 or type(k) is not int or not 1<=k<=100:raise ValueError('Invalid rank request')
        if not ids or len(ids)!=len(set(ids)) or any(id not in self.lookup for id in ids):raise ValueError('Invalid candidates')
        audit('macbert','inference_started',candidateCount=len(ids))
        indexes=[self.lookup[id] for id in ids]
        scores=self.vectors[indexes]@self.embed([query])[0] if query.strip() else self.np.zeros(len(ids))
        order=sorted(range(len(ids)),key=lambda i:(-float(scores[i]),ids[i]))[:k]
        duration=round((time.perf_counter()-start)*1000,3)
        audit('macbert','inference_done',durationMs=duration,candidateCount=len(ids),outputCount=len(order),**self.memory())
        return {'scores':[{'id':ids[i],'score':float(scores[i])} for i in order],
                'modelVersion':self.model_version,'catalogVersion':self.catalog_version,
                'durationMs':duration}


async def serve(args):
    from websockets.asyncio.client import connect
    key=args.key_file.read_text().strip()
    if not re.fullmatch(r'[a-f0-9]{64}',key):raise ValueError('Invalid service key')
    if args.candidate_report:
        try:
            from .prepare_roberta_release import LocalRoBERTa
        except ImportError:
            from prepare_roberta_release import LocalRoBERTa
        audit('macbert','loading')
        ranker=await asyncio.to_thread(LocalRoBERTa,args.candidate_report,args.device)
        audit('macbert','ready',modelVersion=ranker.model_version,device=args.device,**ranker.memory())
    else:
        ranker=await asyncio.to_thread(Ranker,args.model,args.device)
    url=args.worker.rstrip('/').replace('https://','wss://').replace('http://','ws://')+'/api/semantic/connect'
    delay=1
    while True:
        try:
            async with connect(url,additional_headers={'Authorization':'Bearer '+key},max_size=1024*1024,
                               ping_interval=30,ping_timeout=30,open_timeout=20) as socket:
                await socket.send(json.dumps({'type':'ready','modelVersion':ranker.model_version,
                    'catalogVersion':ranker.catalog_version,'device':args.device}))
                audit('macbert','connected');print('CLOUD_CONNECTED',flush=True);delay=1
                async for message in socket:
                    job=json.loads(message)
                    if job.get('type')!='rank':continue
                    try:
                        if args.candidate_report:audit('macbert','inference_started',modelVersion=ranker.model_version,candidateCount=len(job.get('candidateIds',[])))
                        result=await asyncio.to_thread(ranker.rank,job)
                        if args.candidate_report:audit('macbert','inference_done',modelVersion=ranker.model_version,durationMs=result['durationMs'],outputCount=len(result['scores']),**ranker.memory())
                        await socket.send(json.dumps({'type':'result','id':job['id'],'result':result}))
                    except Exception:
                        audit('macbert','inference_failed')
                        await socket.send(json.dumps({'type':'error','id':job.get('id')}))
        except Exception as exc:
            audit('macbert','reconnecting')
            print('RECONNECT='+type(exc).__name__,flush=True)
            await asyncio.sleep(delay);delay=min(30,delay*2)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate-report',type=Path,help='Verified local RoBERTa training report; otherwise use MacBERT')
    p.add_argument('--model',type=Path,default=ROOT/'training_artifacts/20261013T143230-macbert-contrastive/model')
    p.add_argument('--worker',default='https://drinks-mk2.rtx941031.workers.dev')
    p.add_argument('--key-file',type=Path,default=ROOT/'.semantic-key')
    p.add_argument('--device',choices=['mps','cpu'],default='mps')
    asyncio.run(serve(p.parse_args()))


if __name__=='__main__':main()
