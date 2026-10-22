"""Allowlisted, aggregate-only dashboard summaries. Never export raw report bodies."""
import json,math,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
METRICS=set('json_rate schema_rate intent_rate action_filters_rate query_rate ambiguous_numeric_intent_rate comfort_no_sugar_intent_rate cross_turn_intent_rate focus_intent_rate hydration_intent_rate injection_intent_rate messy_text_intent_rate mood_noise_intent_rate negation_intent_rate no_intent_intent_rate no_invented_caffeine_intent_rate numeric_intent_rate regression_intent_rate release_intent_rate retention_intent_rate safety_intent_rate sleep_intent_rate wellbeing_intent_rate wellbeing_no_therapeutic_claim_rate validation_sampled_ce validation_sampled_mrr validation_sampled_hit_at_5 test_sampled_ce test_sampled_mrr test_sampled_hit_at_5 train_sampled_ce train_sampled_mrr train_sampled_hit_at_5 heldout_dropout_contrastive_loss catalog_proxy_precision_at_10 catalog_proxy_recall_at_10 catalog_proxy_ndcg_at_10 retrieval_query_median_ms retrieval_query_p95_ms retrieval_index_s json_valid_rate schema_valid_rate brand_exclusion_intent_exact_rate brand_release_intent_exact_rate topping_exclusion_intent_exact_rate topping_release_intent_exact_rate numeric_intent_exact_rate cross_turn_intent_exact_rate clarify_intent_exact_rate all_intent_exact_rate'.split())
def finite(v):return v if type(v) in (int,float) and math.isfinite(v) else None
def digest(v):return v if isinstance(v,str) and re.fullmatch('[a-f0-9]{40,64}',v) else None
def summarize(r):
 run=r.get('run_id','');match=re.fullmatch(r'20\d{6}T\d{6}-(relgt-long-intent|macbert-contrastive|roberta-wwm-contrastive|qwen-intent-qlora)',run)
 if not match:return None
 model={'relgt-long-intent':'RelGT','macbert-contrastive':'MacBERT','roberta-wwm-contrastive':'RoBERTa','qwen-intent-qlora':'Qwen'}[match[1]]
 comparison=r.get('before_after_comparison') or {};metrics=[]
 for m in comparison.get('metrics',[]):
  if m.get('name') not in METRICS:continue
  before,after=finite(m.get('before')),finite(m.get('after'))
  metrics.append(dict(name=m['name'],before=before,after=after,delta=after-before if before is not None and after is not None else None,direction=m['better_direction']))
 source=r.get('source') or {};protocol=(r.get('retrieval_evaluation') or {}).get('protocol') or r.get('retrieval_evaluation') or {};data=r.get('data') or {}
 base=r.get('base_model_version') or ((source.get('model')+'@'+source.get('revision','unknown')) if source.get('model') else 'official-RelGT-random-initialization')
 if not re.fullmatch(r'[-a-zA-Z0-9_./:@ ]{1,180}',base):base=None
 status=r.get('status','unknown')
 if not re.fullmatch('[a-z_]{1,100}',status):status='unknown'
 regressions=(r.get('retrieval_evaluation') or {}).get('regressions')
 return dict(runId=run,model=model,startedAt=r['started_at'],endedAt=r.get('ended_at'),status=status,steps=r.get('optimizer_steps'),published=r.get('published') is True,weightsChanged=r.get('weights_changed') if type(r.get('weights_changed')) is bool else None,reloadError=finite(r.get('checkpoint_reload_max_error')),baseVersion=base,candidateHash=digest(r.get('checkpoint_sha256')),catalogHash=digest(r.get('catalog_sha256') or data.get('catalog_sha256')),dataHash=digest(r.get('snapshot_sha256') or comparison.get('data_snapshot_sha256')),queryHash=digest(protocol.get('fixture_sha256')),labelHash=digest(protocol.get('label_rule_sha256')),scope=('temporal-holdout' if (r.get('split_rows') or {}).get('validation',0)>0 else 'training-only') if model=='RelGT' else 'catalog-proxy' if model in ('MacBERT','RoBERTa') and protocol else 'synthetic-intent' if model=='Qwen' else 'not-evaluated',regressionCount=len(regressions) if isinstance(regressions,list) else None,metrics=metrics)
def main():
 rows=[]
 for p in sorted((ROOT/'docs/training-runs').glob('*.json'),reverse=True):
  row=summarize(json.loads(p.read_text()))
  if row:rows.append(row)
 print(json.dumps(rows[:120],ensure_ascii=False,allow_nan=False))
if __name__=='__main__':main()
