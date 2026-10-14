"""Compare two frozen bases on identical synthetic Worker fixtures; no training."""
import argparse
import ast
import gc
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.qwen_agent import SYSTEM
from scripts.qwen_model import default_model_path,model_version
from scripts.qwen_output import normalize_optional_caps

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--online',type=Path,default=ROOT/'training_artifacts/qwen3-8b-4bit')
    parser.add_argument('--candidate',type=Path,default=default_model_path(ROOT))
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--online-agent',type=Path,help='Read the currently deployed SYSTEM literal without executing its code')
    parser.add_argument('--online-version',help='Actual currently deployed model and prompt version')
    parser.add_argument('--online-results',type=Path,help='Reuse a verified baseline with identical fixtures, prompt, version and weight hashes')
    parser.add_argument('--candidate-results',type=Path,help='Reuse identical frozen raw generations only for a format codec comparison')
    args=parser.parse_args()
    output=args.output/'qwen-raw.json'
    if output.exists():raise FileExistsError('Preserve previous comparison; choose another output directory')
    os.environ.update(HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
    import mlx.core as mx
    import numpy as np
    from mlx_lm import load,generate
    from mlx_lm.sample_utils import make_sampler
    fixture=args.output/'qwen-fixtures.json'
    cases=json.loads(fixture.read_text())
    results={'started_at':datetime.now(ZoneInfo('Asia/Taipei')).isoformat(timespec='seconds'),
        'fixture_sha256':sha(fixture),'system_sha256':hashlib.sha256(SYSTEM.encode()).hexdigest(),
        'catalog_sha256':sha(ROOT/'data/catalog.json'),
        'kind':'independently authored synthetic Worker-preprocessed contract; no consumer records',
        'optimizer_steps':0,'thinking':False,'temperature':0,'max_tokens':320,'versions':{}}
    online_system=SYSTEM
    if args.online_agent:
        tree=ast.parse(args.online_agent.read_text())
        assignments=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SYSTEM' for t in n.targets)]
        if len(assignments)!=1:raise ValueError('Expected one deployed SYSTEM literal')
        online_system=ast.literal_eval(assignments[0].value)
        for n in tree.body:
            if isinstance(n,ast.AugAssign) and isinstance(n.target,ast.Name) and n.target.id=='SYSTEM':online_system+=ast.literal_eval(n.value)
    for name,path in [('online',args.online),('candidate',args.candidate)]:
        version=args.online_version if name=='online' and args.online_version else model_version(path)
        selected_system=online_system if name=='online' else SYSTEM
        if name=='online' and args.online_results:
            prior=json.loads(args.online_results.read_text());previous=prior['versions']['online']
            if prior['fixture_sha256']!=results['fixture_sha256'] or previous['system_sha256']!=hashlib.sha256(selected_system.encode()).hexdigest() or previous['model_version']!=version:
                raise ValueError('Cached online comparison differs')
            if previous['weights_sha256']!={p.name:sha(p) for p in sorted(path.glob('*.safetensors'))}:
                raise ValueError('Cached online weights differ')
            results['online_reused_from']=str(args.online_results)
            results['versions'][name]=previous
            print('VERIFIED_BASELINE_REUSED='+version,flush=True)
            continue
        if name=='candidate' and args.candidate_results:
            prior=json.loads(args.candidate_results.read_text());previous=prior['versions']['candidate']
            if prior['fixture_sha256']!=results['fixture_sha256'] or previous['system_sha256']!=hashlib.sha256(selected_system.encode()).hexdigest():
                raise ValueError('Cached candidate prompt/fixtures differ')
            if previous['weights_sha256']!={p.name:sha(p) for p in sorted(path.glob('*.safetensors'))}:
                raise ValueError('Cached candidate weights differ')
            previous['raw_generation_model_version']=previous['model_version'];previous['model_version']=version
            for row in previous['rows']:
                row['parser_prediction']=normalize_optional_caps(row['prediction']) if isinstance(row['prediction'],dict) else None
            results['candidate_raw_reused_from']=str(args.candidate_results)
            results['versions'][name]=previous
            print('VERIFIED_RAW_GENERATIONS_REUSED='+version,flush=True)
            continue
        print('LOADING='+version,flush=True)
        start=time.perf_counter()
        model,tokenizer=load(str(path),trust_remote_code=False)
        model.eval();rows=[];first_prompt=None
        for c in cases:
            system=selected_system
            if str(c['job']['state'].get('guard','')).startswith('未辨識條件：'):
                system+='\n本輪有尚未辨識的排除項目，必須 action=clarify。只問使用者具體要排除哪種配料，不能說已排除未知配料，不要推測奶茶。filters 保留 state.filters，不要新增任何未知配料。'
            payload={k:c['job'].get(k) for k in ['message','state','brands','tea','toppings','catalogFeatures','history','preferenceProfile']}
            prompt=tokenizer.apply_chat_template([{'role':'system','content':system},{'role':'user','content':json.dumps(payload,ensure_ascii=False)}],tokenize=False,add_generation_prompt=True,enable_thinking=False)
            if first_prompt is None:first_prompt=prompt
            before=time.perf_counter();prediction=None;error=None
            try:
                raw=generate(model,tokenizer,prompt=prompt,max_tokens=320,sampler=make_sampler(temp=0),verbose=False)
                raw=re.sub(r'<think>.*?</think>','',raw,flags=re.S).strip()
                prediction=json.loads(raw[raw.index('{'):raw.rindex('}')+1])
                if not isinstance(prediction,dict):raise ValueError('Not an object')
            except (ValueError,TypeError) as exc:error=type(exc).__name__
            rows.append({'id':c['id'],'group':c['group'],'prediction':prediction,'parser_prediction':normalize_optional_caps(prediction) if isinstance(prediction,dict) else None,'error_type':error,
                'duration_ms':round((time.perf_counter()-before)*1000,3)})
            print(name+' '+c['id']+' '+('JSON_OK' if not error else error),flush=True)
        # Compare frozen weights after unload/reload on exactly the same tokens.
        tokens=mx.array([tokenizer.encode(first_prompt,add_special_tokens=False)[-128:]])
        reference=np.array(model(tokens)[:,-1,:].astype(mx.float32))
        memory={'active_mb':round(mx.get_active_memory()/1048576,1),'peak_mb':round(mx.get_peak_memory()/1048576,1)}
        del model;gc.collect();mx.clear_cache()
        model,_=load(str(path),trust_remote_code=False);model.eval()
        reloaded=np.array(model(tokens)[:,-1,:].astype(mx.float32))
        reload_error=float(np.max(np.abs(reference-reloaded)))
        results['versions'][name]={'model_version':version,'source':json.loads((path/'source.json').read_text()),
            'system_sha256':hashlib.sha256(selected_system.encode()).hexdigest(),
            'weights_sha256':{p.name:sha(p) for p in sorted(path.glob('*.safetensors'))},
            'checkpoint_reload_max_error':reload_error,'checkpoint_reload_verified':reload_error==0,
            'elapsed_seconds':round(time.perf_counter()-start,3),'gpu_memory':memory,'rows':rows}
        output.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
        del model;gc.collect();mx.clear_cache()
        if reload_error!=0:raise RuntimeError('Frozen base reload differs')
    results['ended_at']=datetime.now(ZoneInfo('Asia/Taipei')).isoformat(timespec='seconds')
    output.write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
    print('COMPARISON='+str(output),flush=True)

if __name__=='__main__':main()
