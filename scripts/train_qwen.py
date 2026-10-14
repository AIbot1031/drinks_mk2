"""Actual local QLoRA intent experiment; synthetic authored data, no publication."""
import argparse
import hashlib
import fcntl
import importlib.metadata
import json
import os
import platform
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from training.qwen_intent_cases import datasets,semantic_metrics,VERSION
from scripts.qwen_agent import SYSTEM
from scripts.qwen_model import default_model_path,model_version
TZ=ZoneInfo('Asia/Taipei')


def stamp(): return datetime.now(TZ).isoformat(timespec='seconds')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()


def run(args,report,out):
    import mlx.core as mx
    import mlx.optimizers as optim
    import numpy as np
    from mlx.utils import tree_flatten
    from mlx_lm import load,generate
    from mlx_lm.sample_utils import make_sampler
    from mlx_lm.tuner.utils import linear_to_lora_layers,load_adapters
    from mlx_lm.tuner.trainer import train,TrainingArgs
    from mlx_lm.tuner.callbacks import TrainingCallback

    mx.random.seed(args.seed)
    np.random.seed(args.seed)
    if args.dataset=='robust':
        from training.qwen_robust_cases import datasets as selected_datasets, semantic_metrics as selected_metrics, VERSION as selected_version, SNAPSHOT
        train_cases,valid_cases=selected_datasets();metric_fn=selected_metrics
        snapshot=json.loads(SNAPSHOT.read_text())
        if snapshot['catalogSha256']!=sha(ROOT/'data/catalog.json'):raise ValueError('Robust data catalog differs')
    else:
        train_cases,valid_cases=datasets();metric_fn=semantic_metrics;selected_version=VERSION;snapshot={}
    report['data']={'source':'manually authored synthetic intent scenarios; no consumer data',
        'version':selected_version,'train':len(train_cases),'validation':len(valid_cases),
        'split':snapshot.get('split','fixed simple single-edit training; separate composed heldout scenarios'),
        'limitations':'small authored holdout, shared task vocabulary; not real-user distribution or external benchmark',
        'sha256':hashlib.sha256(json.dumps([train_cases,valid_cases],ensure_ascii=False,sort_keys=True).encode()).hexdigest()}
    report['snapshot_sha256']=report['data']['sha256']
    (out/'dataset-snapshot.json').write_text(json.dumps({'version':selected_version,'train':train_cases,'validation':valid_cases},ensure_ascii=False,indent=2))
    report['data']['group_counts']={split:{g:sum(c['group']==g for c in cases) for g in sorted({c['group'] for c in cases})} for split,cases in [('train',train_cases),('validation',valid_cases)]}
    report['data']['limitations_detail']=snapshot.get('limitations',[])
    report['catalog_sha256']=sha(ROOT/'data/catalog.json')
    report['source']=json.loads((args.model/'source.json').read_text())
    report['base_model_version']=model_version(args.model)
    report['system_sha256']=hashlib.sha256(SYSTEM.encode()).hexdigest()
    report['environment']={'python':platform.python_version(),'device':'mlx-metal','packages':{k:importlib.metadata.version(k) for k in ['mlx','mlx-lm','transformers']}}
    report['environment']['hardware']=mx.device_info()
    mx.set_cache_limit(512*1024*1024)
    report['base_weight_sha256']={p.name:sha(p) for p in sorted(args.model.glob('*.safetensors'))}
    model,tokenizer=load(str(args.model),trust_remote_code=False)
    def prompt(c):
        guard=str(c['input'].get('state',{}).get('guard',''))
        system=SYSTEM+('\n本輪有尚未辨識的排除項目，必須 action=clarify。只問使用者具體要排除哪種配料，不能說已排除未知配料，不要推測奶茶。filters 保留 state.filters，不要新增任何未知配料。' if guard.startswith('未辨識條件：') else '')
        return tokenizer.apply_chat_template([{'role':'system','content':system},
            {'role':'user','content':json.dumps(c['input'],ensure_ascii=False)}],
            tokenize=False,add_generation_prompt=True,enable_thinking=False)
    def evaluate(label):
        model.eval();rows=[]
        for i,c in enumerate(valid_cases):
            text=generate(model,tokenizer,prompt=prompt(c),max_tokens=args.max_tokens,sampler=make_sampler(temp=0),verbose=False)
            text=re.sub(r'<think>.*?</think>','',text,flags=re.S).strip()
            try: value=json.loads(text[text.index('{'):text.rindex('}')+1])
            except (ValueError,TypeError):value=None
            rows.append({'case':c,'prediction':value})
            (out/(label+'-evaluation.json')).write_text(json.dumps(rows,ensure_ascii=False,indent=2))
            print(f'{label} case {i+1}/{len(valid_cases)}',flush=True)
        return rows,metric_fn(rows)
    if args.baseline_results:
        old_report=json.loads((ROOT/'docs/training-runs'/(args.baseline_results.parent.name+'.json')).read_text())
        before_rows=json.loads(args.baseline_results.read_text())
        if [r['case'] for r in before_rows]!=valid_cases or old_report.get('system_sha256')!=report['system_sha256'] or old_report.get('base_weight_sha256')!=report['base_weight_sha256'] or old_report['parameters'].get('max_tokens')!=args.max_tokens:raise ValueError('Cached baseline differs from current evaluation')
        before=metric_fn(before_rows)
        report['baseline_reused_from']=str(args.baseline_results.relative_to(ROOT))
        (out/'before-evaluation.json').write_text(json.dumps(before_rows,ensure_ascii=False,indent=2))
        print('VERIFIED_BASELINE_REUSED='+str(len(before_rows)),flush=True)
    else:before_rows,before=evaluate('before')
    report['intent_before']=before
    class Tokens:
        def __init__(self,cases):
            self.rows=[]
            for c in cases:
                prefix=tokenizer.encode(prompt(c),add_special_tokens=False)
                completion=tokenizer.encode(json.dumps(c['expected'],ensure_ascii=False)+'<|im_end|>',add_special_tokens=False)
                row=prefix+completion
                if len(row)>args.max_seq_length:raise ValueError('Refuse truncating semantic target')
                self.rows.append((row,len(prefix)))
        def __len__(self):return len(self.rows)
        def __getitem__(self,i):return self.rows[i]
    train_data=Tokens(train_cases);valid_data=Tokens(valid_cases)
    report['tokenization']={'max_train_tokens':max(len(r[0]) for r in train_data.rows),'max_validation_tokens':max(len(r[0]) for r in valid_data.rows),'prompt_loss_masked':True,'truncated_rows':0}
    model.freeze()
    params={'rank':args.rank,'scale':8.0,'dropout':0.0}
    linear_to_lora_layers(model,args.num_layers,params)
    mx.eval(model.trainable_parameters())
    initial={k:np.array(v) for k,v in tree_flatten(model.trainable_parameters())}
    adapter=out/'adapter';adapter.mkdir(mode=0o700)
    (adapter/'adapter_config.json').write_text(json.dumps({'fine_tune_type':'lora','num_layers':args.num_layers,'lora_parameters':params}))
    report['trainable_parameters']=sum(v.size for v in initial.values())
    loss_fn=None
    if args.completion_loss:
        from training.qwen_completion_loss import completion_loss
        from mlx_lm.tuner.trainer import default_loss
        if args.num_layers!=1 or model.layers[-1].is_linear:raise ValueError('Memory-safe mode requires final full-attention block only')
        if any(len(row)-offset+31>512 for data in [train_data,valid_data] for row,offset in data.rows):raise ValueError('Completion window would omit labels')
        loss_fn=lambda m,b,l:completion_loss(m,b,l,num_layers=args.num_layers)
        row,offset=valid_data.rows[0];batch=mx.array([row]);lengths=mx.array([[offset,len(row)]])
        model.eval();ref,count_ref=default_loss(model,batch,lengths);mx.eval(ref,count_ref)
        value,count=loss_fn(model,batch,lengths);mx.eval(value,count)
        error=abs(float(ref)-float(value))
        if error>1e-5 or int(count_ref)!=int(count):raise RuntimeError('Completion-only loss differs from original masked CE')
        report['loss_equivalence']={'absolute_error':error,'masked_tokens':int(count),'reference_tokens':int(count_ref),'window':512,'full_context_preserved':True,'frozen_deltanet_uses_inference_kernel':True}
        print('LOSS_EQUIVALENCE='+str(error)+' TOKENS='+str(int(count)),flush=True)
    class Callback(TrainingCallback):
        def on_train_loss_report(self,info):
            report['optimizer_steps']=info['iteration'];report.setdefault('history',[]).append(info)
        def on_val_loss_report(self,info): report.setdefault('validation_loss_history',[]).append(info)
    report['weights_changed']=None
    train(model,optim.Adam(learning_rate=args.learning_rate),train_data,valid_data,
        args=TrainingArgs(batch_size=1,iters=args.iters,val_batches=args.val_batches,steps_per_report=1,
            steps_per_eval=args.iters,steps_per_save=min(args.iters,25),
            max_seq_length=args.max_seq_length,grad_checkpoint=True,
            adapter_file=str(adapter/'adapters.safetensors')),training_callback=Callback(),**({'loss':loss_fn} if loss_fn else {}))
    report['weights_changed']=any(not np.array_equal(initial[k],np.array(v)) for k,v in tree_flatten(model.trainable_parameters()))
    if not report['weights_changed']:raise RuntimeError('Adapter unchanged')
    report['checkpoint']=str(adapter.relative_to(ROOT))
    report['checkpoint_sha256']=sha(adapter/'adapters.safetensors')
    report['candidate_model_version']=report['base_model_version']+'-qlora-'+report['checkpoint_sha256'][:12]
    after_rows,after=evaluate('after')
    report['intent_after']=after
    # Verify saved adapter yields identical logits on a fixed heldout prefix.
    tokens=mx.array([tokenizer.encode(prompt(valid_cases[0]),add_special_tokens=False)])
    model.eval();reference=np.array(model(tokens)[:,-1,:].astype(mx.float32));del model
    mx.clear_cache()
    model,_=load(str(args.model),adapter_path=str(adapter),trust_remote_code=False)
    model.eval();reloaded=np.array(model(tokens)[:,-1,:].astype(mx.float32))
    report['checkpoint_reload_max_error']=float(np.max(np.abs(reference-reloaded)))
    if report['checkpoint_reload_max_error']>1e-4:raise RuntimeError('Adapter reload logits mismatch')
    report['checkpoint_reload_verified']=True
    report['checkpoint']=str(adapter.relative_to(ROOT))
    report['checkpoint_sha256']=sha(adapter/'adapters.safetensors')
    report['base_weights_unchanged']=all(sha(args.model/name)==value for name,value in report['base_weight_sha256'].items())
    if not report['base_weights_unchanged']:raise RuntimeError('Frozen base weights changed')
    report['gpu_peak_memory_mb']=round(mx.get_peak_memory()/1048576,1)
    (out/'synthetic-evaluation.json').write_text(json.dumps({'before':before_rows,'after':after_rows},ensure_ascii=False,indent=2))
    report['status']='trained_synthetic_intent_not_published'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model',type=Path,default=default_model_path(ROOT))
    p.add_argument('--iters',type=int,default=10)
    p.add_argument('--num-layers',type=int,default=4)
    p.add_argument('--learning-rate',type=float,default=1e-4)
    p.add_argument('--max-seq-length',type=int,default=2048)
    p.add_argument('--seed',type=int,default=42)
    p.add_argument('--rank',type=int,default=4)
    p.add_argument('--dataset',choices=['legacy','robust'],default='legacy')
    p.add_argument('--max-tokens',type=int,default=320)
    p.add_argument('--trigger',default='manual / scheduled authorized training')
    p.add_argument('--baseline-results',type=Path)
    p.add_argument('--completion-loss',action='store_true')
    p.add_argument('--val-batches',type=int,default=-1)
    args=p.parse_args()
    args.model=args.model.resolve()
    if args.baseline_results:args.baseline_results=args.baseline_results.resolve()
    if min(args.iters,args.num_layers,args.max_seq_length,args.rank,args.max_tokens)<1 or args.learning_rate<=0:p.error('Positive settings required')
    os.environ.update(HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false')
    run_id=datetime.now(TZ).strftime('%Y%m%dT%H%M%S')+'-qwen-intent-qlora'
    out=ROOT/'training_artifacts'/run_id;out.mkdir(mode=0o700)
    start=time.perf_counter()
    report={'run_id':run_id,'started_at':stamp(),'status':'running','trigger':args.trigger,
        'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)),
        'script_sha256':sha(Path(__file__)),'parameters':{**vars(args),'model':str(args.model.relative_to(ROOT)),'baseline_results':str(args.baseline_results.relative_to(ROOT)) if args.baseline_results else None},
        'optimizer_steps':0,'weights_changed':False,'published':False,'updated_users':0,
        'changes':['human-authored robust scenarios when selected; legacy data preserved','Worker-preprocessed inputs for robust dataset','same frozen heldout before/after evaluation','prompt masking; frozen quantized base; train adapter only'],
        'limitations':['small synthetic holdout is not proof of real-user quality','no resume or automatic publication','online model remains unchanged; no adapter installed']}
    failure=None
    lock_dir=ROOT/'internal_exports';lock_dir.mkdir(mode=0o700,exist_ok=True)
    lock=(lock_dir/'.qwen-training.lock').open('a')
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        run(args,report,out)
    except Exception as exc:
        failure=exc;report['status']='failed';report['error_type']=type(exc).__name__
        report['reason']='Local QLoRA/evaluation/checkpoint pipeline failed; see protected local execution diagnostics'
        print('Qwen training failed: '+type(exc).__name__,file=sys.stderr)
    finally:
        report['ended_at']=stamp();report['duration_seconds']=round(time.perf_counter()-start,3)
        before=report.get('intent_before',{});after=report.get('intent_after',{})
        report['before_after_comparison']={'status':report['status'],'published':False,'updated_users':0,
            'model_before':report.get('base_model_version'),'model_after':report.get('candidate_model_version'),
            'evaluation':'same frozen holdout, production prompt and max_tokens; greedy temperature 0; raw JSON action/query/filters',
            'weights_changed':report['weights_changed'],'checkpoint_after':report.get('checkpoint'),
            'data_snapshot_sha256':report.get('snapshot_sha256'),'metrics':[{'name':k,'before':v,
                'after':after.get(k),'delta_after_minus_before':after[k]-v if isinstance(after.get(k),(int,float)) else None,
                'better_direction':'higher'} for k,v in before.items()]}
        from training.run_reports import comparison_markdown
        folder=ROOT/'docs/training-runs';folder.mkdir(exist_ok=True)
        (folder/(run_id+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        (folder/(run_id+'.md')).write_text('# Qwen 飲料意圖 QLoRA 訓練報告\n\n資料是助理人工編寫的合成任務例句，沒有冒充真實用戶對話。固定獨立情境作前後比較；合成驗證不足證明真實推薦改善，本次未發布。\n\n'+comparison_markdown(report)+'\n```json\n'+json.dumps(report,ensure_ascii=False,indent=2)+'\n```\n')
        with (ROOT/'daily.txt').open('a') as f:f.write(f"\n[{report['ended_at']}｜Qwen 實際 QLoRA 訓練]\n- 狀態：{report['status']}；實際 optimizer 步數：{report['optimizer_steps']}；耗時：{report['duration_seconds']} 秒。\n- 以人工合成意圖資料訓練，沒有使用真實用戶對話；固定驗證集前後比較與完整報告：docs/training-runs/{run_id}.md／JSON。\n- 未發布、未更新線上權重；基礎模型／adapter 保存與載入結果見報告，不以訓練 loss 宣稱推薦改善。\n")
        print('REPORT='+str(folder/(run_id+'.md')),flush=True)
        lock.close()
    if failure:raise failure


if __name__=='__main__':main()
