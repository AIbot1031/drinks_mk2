"""Strictly past-only temporal samples; no price targets or fabricated dislikes."""
from __future__ import annotations
import hashlib
import random
import re
from collections import defaultdict


def prepare(snapshot, catalog, history_size=8, distractors=15, seed=42):
    if snapshot.get('schema') != 1 or snapshot.get('kind') != 'timestamped-consumer-interactions':
        raise ValueError('Expected timestamped interaction snapshot')
    cutoff=snapshot.get('cutoff_ms')
    if type(cutoff) is not int or cutoff < 0 or history_size < 1 or distractors < 1:
        raise ValueError('Invalid cutoff/history/candidates')
    by_id={d['id']:d for d in catalog}
    grouped={}
    for d in sorted(catalog,key=lambda d:d['id']):
        grouped.setdefault((d['brand'],d['name']),d)
    products=list(grouped.values())
    product_index={(d['brand'],d['name']):i for i,d in enumerate(products)}
    events=defaultdict(list)
    seen=set()
    counts={'source_events':len(snapshot.get('events',[])), 'invalid_ids':0, 'duplicate_events':0,
            'after_cutoff':0, 'duplicate_targets':0, 'users':0, 'like_targets':0, 'dislike_targets':0}
    for e in snapshot.get('events',[]):
        if not isinstance(e.get('user_code'),str) or not re.fullmatch(r'u_[a-f0-9]{64}',e['user_code']):
            raise ValueError('Only pseudonymous user codes allowed')
        if not isinstance(e.get('id'),str) or e.get('action') not in {'like','dislike','unlike','undislike'} or type(e.get('occurred_at')) is not int:
            raise ValueError('Invalid interaction')
        if e['id'] in seen:
            counts['duplicate_events']+=1;continue
        seen.add(e['id'])
        if e['occurred_at']>cutoff:
            counts['after_cutoff']+=1;continue
        if e.get('drink_id') not in by_id:
            counts['invalid_ids']+=1;continue
        d=by_id[e['drink_id']]
        events[e['user_code']].append({**e,'product':product_index[(d['brand'],d['name'])]})
    samples=[]
    for user,items in sorted(events.items()):
        items.sort(key=lambda e:(e['occurred_at'],e['id']))
        groups=defaultdict(list)
        for e in items:groups[e['occurred_at']].append(e)
        past=[]
        active={'like':set(),'dislike':set()}
        for at,current in sorted(groups.items()):
            # All simultaneous operations see the same pre-request history.
            targets={}
            for e in current:
                if e['action'] in active:
                    key=(e['action'],e['product'])
                    if key in targets:counts['duplicate_targets']+=1
                    targets[key]=e
            for (action,target),e in sorted(targets.items()):
                excluded=active[action]|{p for a,p in targets if a==action}|{target}
                pool=[i for i in range(len(products)) if i not in excluded]
                if not pool:continue
                rng=random.Random(int(hashlib.sha256((str(seed)+e['id']).encode()).hexdigest()[:16],16))
                others=rng.sample(pool,min(distractors,len(pool)))
                samples.append({'user_code':user,'at':at,'action':action,'target':target,
                                'history':past[-history_size:].copy(), 'candidates':[target]+others})
                counts[action+'_targets']+=1
            for e in current:
                product=e['product']
                if e['action']=='like':active['like'].add(product);active['dislike'].discard(product)
                elif e['action']=='dislike':active['dislike'].add(product);active['like'].discard(product)
                elif e['action']=='unlike':active['like'].discard(product)
                else:active['dislike'].discard(product)
            past+=current
    samples.sort(key=lambda s:(s['at'],s['user_code'],s['action'],s['target']))
    counts['users']=len({s['user_code'] for s in samples})
    counts['valid_events']=sum(map(len,events.values()))
    counts['samples']=len(samples)
    counts['with_history']=sum(bool(s['history']) for s in samples)
    counts['cold_start_samples']=len(samples)-counts['with_history']
    counts['multi_day_users']=sum(len({(e['occurred_at']+28800000)//86400000 for e in v})>1 for v in events.values())
    times=sorted({s['at'] for s in samples})
    split={'train':list(range(len(samples))),'validation':[],'test':[]}
    method='small real data: train every target, no heldout quality claims'
    if len(samples)>=30 and len(times)>=3:
        train_end=times[max(0,int(len(times)*.8)-1)]
        validation_end=times[max(1,int(len(times)*.9)-1)]
        candidate={k:[] for k in split}
        for i,s in enumerate(samples):candidate['train' if s['at']<=train_end else 'validation' if s['at']<=validation_end else 'test'].append(i)
        if all(candidate.values()):split=candidate;method='global timestamp-group chronological 80/10/10; history strictly before each target'
    return products,samples,split,counts,method
