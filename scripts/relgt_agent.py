"""Outbound-only RelGT inference service; does not train or log user histories."""
import argparse
import asyncio
import json
from pathlib import Path
from relgt_inference import RelgtRanker,ROOT
from inference_audit import audit

async def serve(args):
    key=args.key_file.read_text().strip()
    audit('relgt','loading')
    ranker=await asyncio.to_thread(RelgtRanker,args.checkpoint,args.checkpoint_hash)
    audit('relgt','ready',modelVersion=ranker.model_version,device='cpu')
    print('RELGT_CATALOG_READY='+ranker.catalog_version,flush=True)
    url=args.worker.rstrip('/').replace('https://','wss://').replace('http://','ws://')+'/api/semantic/connect?role=relgt'
    from websockets.asyncio.client import connect
    delay=1
    while True:
        try:
            async with connect(url,additional_headers={'Authorization':'Bearer '+key},max_size=1024*1024,ping_interval=30,ping_timeout=30,open_timeout=20) as socket:
                await socket.send(json.dumps({'type':'ready','modelVersion':ranker.model_version,'catalogVersion':ranker.catalog_version,'device':'cpu'}))
                audit('relgt','connected');delay=1
                async for message in socket:
                    job=json.loads(message)
                    if job.get('type')!='relgt-rank':continue
                    try:
                        audit('relgt','inference_started',candidateCount=len(job.get('candidateIds',[])))
                        result=await asyncio.to_thread(ranker.rank,job)
                        audit('relgt','inference_done',durationMs=result['durationMs'],outputCount=len(result['scores']))
                        await socket.send(json.dumps({'type':'result','id':job['id'],'result':result}))
                    except Exception:
                        audit('relgt','inference_failed')
                        await socket.send(json.dumps({'type':'error','id':job.get('id')}))
        except Exception as exc:
            audit('relgt','reconnecting');print('RECONNECT='+type(exc).__name__,flush=True)
            await asyncio.sleep(delay);delay=min(30,delay*2)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint',type=Path,default=ROOT/'training_artifacts/20261013T155618-relgt-long-intent/model.pt')
    p.add_argument('--checkpoint-hash',required=True)
    p.add_argument('--key-file',type=Path,default=ROOT/'.relgt-key')
    p.add_argument('--worker',default='https://drinks-mk2.rtx941031.workers.dev')
    asyncio.run(serve(p.parse_args()))
