"""Frozen authored intent examples, not medical claims or consumer interactions."""
import json
import re
from pathlib import Path
from training.qwen_robust_cases import semantic_metrics as base_metrics
VERSION = 'wellbeing-intent-v1'
SNAPSHOT = Path(__file__).with_name('qwen_wellbeing_snapshot.json')
def datasets():
    data = json.loads(SNAPSHOT.read_text())
    return data['train'], data['validation']
def semantic_metrics(rows):
    result = base_metrics(rows)
    new = [r for r in rows if r['case']['id'].startswith('wellbeing-')]
    if new:
        result['wellbeing_intent_rate'] = base_metrics(new)['intent_rate']
        result['wellbeing_no_therapeutic_claim_rate'] = sum(
            isinstance(r.get('prediction'), dict) and not re.search(
                r'治療|療效|助眠|抗憂鬱|保證|血清素|多巴胺',
                str(r['prediction'].get('assistantMessage', ''))) for r in new) / len(new)
    return result
