"""Stage/activate/rollback catalog-only updates in the two existing Mac slots.

Never copies keys, changes LaunchAgent arguments, installs services or trains.
Existing weights and dependency environments remain untouched.
"""
import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from prepare_roberta_release import ROOT, sha

STATE=ROOT/('.wrangler/catalog-service-refresh-'+sha(ROOT/'data/catalog.json')[:12]+'.json')
SLOTS={'macbert':('DrinksMk2',['scripts/prepare_roberta_release.py','scripts/macbert_agent.py','scripts/inference_audit.py']),
       'relgt':('DrinksMk2RelGT',['scripts/relgt_inference.py','scripts/relgt_agent.py','scripts/inference_audit.py'])}


def restart(slot):
    label='local.drinks-mk2.'+slot
    plist=Path.home()/'Library/LaunchAgents'/(label+'.plist')
    subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{label}'],capture_output=True)
    for _ in range(5):
        result=subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],capture_output=True)
        if result.returncode==0:return
        time.sleep(1)
    raise RuntimeError('Existing inference slot could not restart: '+slot)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=['stage','activate','rollback'])
    p.add_argument('--evidence',type=Path,default=ROOT/'docs/model-validation/3.1.20目錄接回既有模型.json')
    args=p.parse_args()
    if args.mode=='stage':
        if STATE.exists():raise ValueError('Existing state: inspect before restaging')
        evidence=json.loads(args.evidence.read_text())
        version=sha(ROOT/'data/catalog.json')
        if evidence['catalogVersion']!=version or evidence['weightsChanged'] or evidence['optimizerSteps']!=0:raise ValueError('Unverified catalog')
        folder=ROOT/'.wrangler/catalog-refresh'/version
        operations=[]
        for slot,(directory,files) in SLOTS.items():
            runtime=Path.home()/'Library/Application Support'/directory
            if not (runtime/'.venv-training/bin/python').exists():raise ValueError('Existing runtime missing')
            files=files+['data/catalog.json','data/catalog-update.json']
            if slot=='macbert':
                report=json.loads((ROOT/'docs/training-runs/20261015T005748-roberta-wwm-contrastive.json').read_text())
                if sha(runtime/report['checkpoint'])!=evidence['roberta']['weightsSha256']:raise ValueError('Runtime weights differ')
                index='training_artifacts/roberta-wwm-index-'+version[:12]+'-'+report['checkpoint_sha256'][:12]+'.npz'
                if sha(ROOT/index)!=evidence['roberta']['indexSha256']:raise ValueError('Unverified index')
                files.append(index)
            else:
                report=json.loads((ROOT/'docs/training-runs/20261013T155618-relgt-long-intent.json').read_text())
                if sha(runtime/report['checkpoint'])!=evidence['relgt']['weightsSha256']:raise ValueError('Runtime weights differ')
            for file in files:
                source=ROOT/file;target=runtime/file
                staged=folder/slot/'staged'/file;backup=folder/slot/'backup'/file
                staged.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,staged)
                existed=target.exists()
                if existed:
                    backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,backup)
                operations.append({'slot':slot,'target':str(target),'staged':str(staged),'backup':str(backup),'existed':existed,'sha256':sha(staged)})
        STATE.parent.mkdir(parents=True,exist_ok=True)
        STATE.write_text(json.dumps({'catalogVersion':version,'status':'staged','operations':operations},indent=2)+'\n')
        print('STAGED existing model slots; credentials and weights untouched');return
    state=json.loads(STATE.read_text())
    if args.mode=='activate':
        if state['status'] not in ['staged','activation_or_rollback_failed']:raise ValueError('State must be staged or safely retried after failure')
        for op in state['operations']:
            if sha(op['staged'])!=op['sha256']:raise ValueError('Staged file changed')
    try:
        for op in state['operations']:
            target=Path(op['target'])
            source=Path(op['staged'] if args.mode=='activate' else op['backup'])
            if args.mode=='rollback' and not op['existed']:
                target.unlink(missing_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            temporary=target.with_name(target.name+'.catalog-refresh-tmp')
            shutil.copy2(source,temporary);temporary.replace(target)
        for slot in SLOTS:restart(slot)
        state['status']='activated' if args.mode=='activate' else 'rolled_back'
    except Exception:
        state['status']='activation_or_rollback_failed'
        raise
    finally:
        STATE.write_text(json.dumps(state,indent=2)+'\n')
    print('STATUS='+state['status'])


if __name__=='__main__':main()
