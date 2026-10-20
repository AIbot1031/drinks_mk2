"""Reindex and compare existing local weights. No optimizer, network or user writes.

Run with the existing Mac inference Python. Public evidence contains counts and
checksums only; checkpoint samples and user/history identifiers stay local.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from prepare_roberta_release import ROOT, LocalRoBERTa, sha
from relgt_inference import RelgtRanker


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report_path=ROOT/'docs/training-runs/20261015T005748-roberta-wwm-contrastive.json'
    relgt_report=json.loads((ROOT/'docs/training-runs/20261013T155618-relgt-long-intent.json').read_text())
    old_runtime=Path.home()/'Library/Application Support/DrinksMk2RelGT'
    before=RelgtRanker(old_runtime/relgt_report['checkpoint'],relgt_report['checkpoint_sha256'],old_runtime)
    after=RelgtRanker(ROOT/relgt_report['checkpoint'],relgt_report['checkpoint_sha256'])
    sample=next(s for s in before.saved['samples'] if s['history'])
    # Trusted historical validation sample is used in memory only, never exported.
    job={'userCode':sample['user_code'],'at':sample['at'],
         'history':[{'drinkId':before.products[e['product']]['id'],'action':e['action'],'occurredAt':e['occurred_at']} for e in sample['history']],
         'candidateIds':sorted(before.lookup)[:128],'topK':100}
    a=before.rank({**job,'catalogVersion':before.catalog_version})
    b=after.rank({**job,'catalogVersion':after.catalog_version})
    assert a['scores']==b['scores'],'Old-product inference changed'
    novel=[d['id'] for d in after.products if d.get('sourceKind')=='nidin']
    assert novel
    state={k:v.clone() for k,v in after.model.state_dict().items()}
    full=after.rank({**job,'candidateIds':list(after.lookup),'catalogVersion':after.catalog_version})
    new_job={**job,'candidateIds':novel[:32],'history':[{**job['history'][-1],'drinkId':novel[0]}],
             'catalogVersion':after.catalog_version}
    new=after.rank(new_job);repeat=after.rank(new_job)
    assert new['scores']==repeat['scores'] and len(new['scores'])==len(new_job['candidateIds'])
    assert all(after.torch.equal(v,after.model.state_dict()[k]) for k,v in state.items())
    evidence={'checkedAt':datetime.now(ZoneInfo('Asia/Taipei')).isoformat(timespec='seconds'),
        'operation':'existing-weight catalog reindex and inference; no training',
        'catalogVersion':after.catalog_version,'catalogRows':len(after.lookup),'productCount':len(after.products),
        'optimizerSteps':0,'weightsChanged':False,'accuracyImprovementClaimed':False,
        'relgt':{'modelVersion':after.model_version,'weightsSha256':relgt_report['checkpoint_sha256'],
            'originalCandidateComparisonCount':len(job['candidateIds']),'originalScoresIdentical':True,
            'newProductCount':len(novel),'newCandidatesAndNewHistoryScored':len(new['scores']),
            'repeatable':True,'fullCatalogOutputs':len(full['scores']),'fullCatalogDurationMs':full['durationMs'],
            'missingRecipePolicy':'frozen categorical missing/OOV and numerical missing-value encoders',
            'coldStartPolicy':'new users/no history retain feature graph and instant preference overlay'}}
    print('RELGT_CATALOG_VERIFIED',flush=True)
    ranker=LocalRoBERTa(report_path)
    baseline=Path.home()/'Library/Application Support/DrinksMk2/training_artifacts'
    old_indexes=list(baseline.glob('roberta-wwm-index-'+ranker.report['data']['catalog_sha256'][:12]+'-*.npz'))
    assert len(old_indexes)==1
    with ranker.np.load(old_indexes[0],allow_pickle=False) as old:
        indices=[ranker.lookup[str(i)] for i in old['ids']]
        error=float(ranker.np.max(ranker.np.abs(old['vectors']-ranker.vectors[indices])))
    assert error<1e-4,(error,'Original index changed')
    semantic=ranker.rank({'query':'紅茶拿鐵','candidateIds':novel[:64],
                         'catalogVersion':ranker.catalog_version,'topK':10})
    assert len(semantic['scores'])==10
    assert sha(ranker.weights)==ranker.report['checkpoint_sha256']
    evidence['roberta']={'modelVersion':ranker.model_version,'weightsSha256':sha(ranker.weights),
        'indexShape':list(ranker.vectors.shape),'indexSha256':sha(ranker.index_path),
        'originalVectorMaxAbsoluteDifference':error,'newCandidatesScored':len(semantic['scores']),
        'catalogAndWeightsChecksumValidated':True}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(evidence,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
