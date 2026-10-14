"""Actual local QLoRA intent experiment; synthetic authored data, no publication."""
import argparse
import hashlib
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
    train_cases,valid_cases=datasets()
    report['data']={'source':'manually authored synthetic intent scenarios; no consumer data',
        'version':VERSION,'train':len(train_cases),'validation':len(valid_cases),
        'split':'fixed simple single-edit training; separate composed heldout scenarios',
        'limitations':'small authored holdout, shared task vocabulary; not real-user distribution or external benchmark',
        'sha256':hashlib.sha256(json.dumps([train_cases,valid_cases],ensure_ascii=False,sort_keys=True).encode()).hexdigest()}
    report['snapshot_sha256']=report['data']['sha256']
    report['catalog_sha256']=sha(ROOT/'data/catalog.json')
    report['source']=json.loads((args.model/'source.json').read_text())
    report['base_model_version']=model_version(args.model)
    report['system_sha256']=hashlib.sha256(SYSTEM.encode()).hexdigest()
    report['environment']={'python':platform.python_version(),'device':'mlx-metal','packages':{k:importlib.metadata.version(k) for k in ['mlx','mlx-lm','transformers']}}
    report['base_weight_sha256']={p.name:sha(p) for p in sorted(args.model.glob('*.safetensors'))}
    model,tokenizer=load(str(args.model),trust_remote_code=False)
    def prompt(c):
        return tokenizer.apply_chat_template([{'role':'system','content':SYSTEM},
            {'role':'user','content':json.dumps(c['input'],ensure_ascii=False)}],
            tokenize=False,add_generation_prompt=True,enable_thinking=False)
    def evaluate(label):
        model.eval();rows=[]
        for i,c in enumerate(valid_cases):
            text=generate(model,tokenizer,prompt=prompt(c),max_tokens=240,sampler=make_sampler(temp=0),verbose=False)
            text=re.sub(r'<think>.*?</think>','',text,flags=re.S).strip()
            try: value=json.loads(text[text.index('{'):text.rindex('}')+1])
            except (ValueError,TypeError):value=None
            rows.append({'case':c,'prediction':value})
            print(f'{label} case {i+1}/{len(valid_cases)}',flush=True)
        return rows,semantic_metrics(rows)
    before_rows,before=evaluate('before')
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
    model.freeze()
    params={'rank':4,'scale':8.0,'dropout':0.0}
    linear_to_lora_layers(model,args.num_layers,params)
    mx.eval(model.trainable_parameters())
    initial={k:np.array(v) for k,v in tree_flatten(model.trainable_parameters())}
    adapter=out/'adapter';adapter.mkdir(mode=0o700)
    (adapter/'adapter_config.json').write_text(json.dumps({'fine_tune_type':'lora','num_layers':args.num_layers,'lora_parameters':params}))
    report['trainable_parameters']=sum(v.size for v in initial.values())
    class Callback(TrainingCallback):
        def on_train_loss_report(self,info):
            report['optimizer_steps']=info['iteration'];report.setdefault('history',[]).append(info)
        def on_val_loss_report(self,info): report.setdefault('validation_loss_history',[]).append(info)
    train(model,optim.Adam(learning_rate=args.learning_rate),train_data,valid_data,
        args=TrainingArgs(batch_size=1,iters=args.iters,val_batches=-1,steps_per_report=1,
            steps_per_eval=args.iters,steps_per_save=args.iters,
            max_seq_length=args.max_seq_length,grad_checkpoint=True,
            adapter_file=str(adapter/'adapters.safetensors')),training_callback=Callback())
    report['weights_changed']=any(not np.array_equal(initial[k],np.array(v)) for k,v in tree_flatten(model.trainable_parameters()))
    if not report['weights_changed']:raise RuntimeError('Adapter unchanged')
    report['checkpoint']=str(adapter.relative_to(ROOT))
    report['checkpoint_sha256']=sha(adapter/'adapters.safetensors')
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
    args=p.parse_args()
    if min(args.iters,args.num_layers,args.max_seq_length)<1 or args.learning_rate<=0:p.error('Positive settings required')
    os.environ.update(HF_HUB_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',TOKENIZERS_PARALLELISM='false')
    run_id=datetime.now(TZ).strftime('%Y%m%dT%H%M%S')+'-qwen-intent-qlora'
    out=ROOT/'training_artifacts'/run_id;out.mkdir(mode=0o700)
    start=time.perf_counter()
    report={'run_id':run_id,'started_at':stamp(),'status':'running','trigger':'manual schedule trial / authorized recurring training',
        'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)),
        'script_sha256':sha(Path(__file__)),'parameters':{**vars(args),'model':str(args.model.relative_to(ROOT))},
        'optimizer_steps':0,'weights_changed':False,'published':False,'updated_users':0,
        'changes':['new actual MLX QLoRA trainer','manually authored synthetic intent dataset','fixed heldout semantic before/after evaluation'],
        'limitations':['small synthetic holdout is not proof of real-user quality','no resume or automatic publication','online model remains unchanged; no adapter installed']}
    failure=None
    try:run(args,report,out)
    except Exception as exc:
        failure=exc;report['status']='failed';report['error_type']=type(exc).__name__
        report['reason']='Local QLoRA/evaluation/checkpoint pipeline failed; see protected local execution diagnostics'
        print('Qwen training failed: '+type(exc).__name__,file=sys.stderr)
    finally:
        report['ended_at']=stamp();report['duration_seconds']=round(time.perf_counter()-start,3)
        before=report.get('intent_before',{});after=report.get('intent_after',{})
        report['before_after_comparison']={'status':report['status'],'published':False,'updated_users':0,
            'weights_changed':report['weights_changed'],'checkpoint_after':report.get('checkpoint'),
            'data_snapshot_sha256':report.get('snapshot_sha256'),'metrics':[{'name':k,'before':v,
                'after':after.get(k),'delta_after_minus_before':after[k]-v if isinstance(after.get(k),(int,float)) else None,
                'better_direction':'higher'} for k,v in before.items()]}
        from training.run_reports import comparison_markdown
        folder=ROOT/'docs/training-runs';folder.mkdir(exist_ok=True)
        (folder/(run_id+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        (folder/(run_id+'.md')).write_text('# Qwen 飲料意圖 QLoRA 訓練報告\n\n資料是本次人工編寫的合成任務例句，沒有冒充真實用戶對話。固定獨立組合情境作前後比較；小样本不足證明線上改善，本次未發布。\n\n'+comparison_markdown(report)+'\n```json\n'+json.dumps(report,ensure_ascii=False,indent=2)+'\n```\n')
        with (ROOT/'daily.txt').open('a') as f:f.write(f"\n[{report['ended_at']}｜Qwen 實際 QLoRA 訓練]\n- 狀態：{report['status']}；實際 optimizer 步數：{report['optimizer_steps']}；耗時：{report['duration_seconds']} 秒。\n- 以人工合成意圖資料訓練，沒有使用真實用戶對話；固定驗證集前後比較與完整報告：docs/training-runs/{run_id}.md／JSON。\n- 未發布、未更新線上權重；基礎模型／adapter 保存與載入結果見報告，不以訓練 loss 宣稱推薦改善。\n")
        print('REPORT='+str(folder/(run_id+'.md')),flush=True)
    if failure:raise failure


if __name__=='__main__':main()
