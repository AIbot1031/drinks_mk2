"""Restricted operational telemetry: never accepts prompt text, IDs or secrets."""
import json
import os
from datetime import datetime,timezone

FIELDS={'durationMs','gpuActiveMB','gpuCacheMB','gpuPeakMB','gpuDriverMB','candidateCount','outputCount','activeConnections','device','modelVersion'}
EVENTS={'loading','ready','connected','reconnecting','warmup_started','warmup_done','inference_started','inference_done','inference_failed','relay_started','relay_closed'}
def audit(service,event,**metrics):
    if service not in {'qwen','macbert','relgt','relay'} or event not in EVENTS:return
    safe={k:v for k,v in metrics.items() if k in FIELDS and (isinstance(v,(int,float)) or (k in {'device','modelVersion'} and isinstance(v,str) and len(v)<100))}
    print(json.dumps({'kind':'project-operation','at':datetime.now(timezone.utc).isoformat(),'pid':os.getpid(),'service':service,'event':event,**safe},ensure_ascii=False),flush=True)
