"""Read-only loopback dashboard for our inference processes and safe action logs."""
import json
import ipaddress
import math
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from datetime import datetime,timezone
try:
    from .inference_audit import FIELDS,EVENTS
except ImportError:
    from inference_audit import FIELDS,EVENTS

PORT=8792
BASE=Path(__file__).resolve().parent
SERVICES=[('qwen','Qwen 對話理解','local.drinks-mk2.qwen','DrinksMk2LLM','qwen.log'),('macbert','MacBERT 語意排序','local.drinks-mk2.macbert','DrinksMk2','macbert.log'),('relgt','RelGT 個人化排序','local.drinks-mk2.relgt','DrinksMk2RelGT','relgt.log'),('relay','網站安全轉接','local.drinks-mk2.qwen-relay','DrinksMk2LLM','qwen-relay.log')]
lock=threading.Lock();cached=None;last_sample=0

def lan_config():
    """Use only the default interface's RFC1918 IPv4 address and subnet."""
    route=command(['/sbin/route','-n','get','default'])
    match=re.search(r'^\s*interface:\s*(\w+)\s*$',route,re.MULTILINE)
    if not match:return None
    address=command(['/usr/sbin/ipconfig','getifaddr',match[1]]).strip()
    mask=command(['/usr/sbin/ipconfig','getoption',match[1],'subnet_mask']).strip()
    try:
        ip=ipaddress.IPv4Address(address)
        private=any(ip in ipaddress.ip_network(n) for n in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'])
        network=ipaddress.IPv4Network(f'{address}/{mask}',strict=False)
        if private and network.prefixlen>=8:return address,network
    except ValueError:pass
    return None

def request_allowed(host,origin,client,lan=None):
    allowed={f'127.0.0.1:{PORT}',f'localhost:{PORT}'}
    if lan:allowed.add(f'{lan[0]}:{PORT}')
    try:
        peer=ipaddress.ip_address(client)
        local=peer.is_loopback
        if not local and (not lan or peer not in lan[1] or host!=f'{lan[0]}:{PORT}'):return False
    except ValueError:return False
    return host in allowed and (not origin or origin==f'http://{host}')

def command(args):
    try:return subprocess.run(args,capture_output=True,text=True,timeout=2).stdout
    except (OSError,subprocess.TimeoutExpired):return ''

def events(runtime,name):
    path=runtime/'logs'/name
    try:
        with path.open('rb') as f:
            f.seek(max(0,path.stat().st_size-262144));lines=f.read().decode('utf8',errors='replace').splitlines()[-250:]
    except OSError:return []
    result=[]
    for line in lines:
        try:
            v=json.loads(line)
            if v.get('kind')!='project-operation' or v.get('service') not in {'qwen','macbert','relgt','relay'} or v.get('event') not in EVENTS or not isinstance(v.get('pid'),int):continue
            stamp=datetime.fromisoformat(v['at'])
            if not stamp.tzinfo:continue
            item={k:v[k] for k in ['at','pid','service','event']}
            for k in FIELDS:
                value=v.get(k)
                if isinstance(value,(int,float)) and math.isfinite(value):item[k]=value
                elif k=='device' and value in ['mps','mlx','cpu']:item[k]=value
                elif k=='modelVersion' and isinstance(value,str) and re.fullmatch(r'(?:macbert-[a-f0-9]{16}|relgt-temporal-[a-f0-9]{16}|qwen(?:3-8b|3\.5-9b)-4bit-[a-f0-9]{12}(?:-intent-v[234567])?)',value):item[k]=value
            result.append(item)
        except (ValueError,TypeError,KeyError):continue
    return result

def process_stats(pid):
    parts=command(['/bin/ps','-o','pcpu=,rss=,etime=','-p',str(pid)]).split()
    if len(parts)<3:return {}
    try:return {'cpu':float(parts[0]),'rssMB':round(int(parts[1])/1024,1),'elapsed':parts[2]}
    except ValueError:return {}

def snapshot():
    global cached,last_sample
    with lock:
        if cached and time.monotonic()-last_sample<2:return cached
        rows=[];all_events=[]
        for service,title,label,folder,log in SERVICES:
            out=command(['/bin/launchctl','print',f'gui/{os.getuid()}/{label}']);match=re.search(r'\bpid = (\d+)',out)
            pid=int(match[1]) if match else None
            runtime=Path.home()/'Library/Application Support'/folder
            history=events(runtime,log);all_events.extend(history)
            own=[e for e in history if e['pid']==pid]
            memory=next((e for e in reversed(own) if 'gpuActiveMB' in e),{})
            rows.append({'service':service,'title':title,'running':bool(pid),'pid':pid,**(process_stats(pid) if pid else {}),'lastEvent':own[-1] if own else None,'gpuMemory':{k:v for k,v in memory.items() if k.startswith('gpu')},'gpuSampleAt':memory.get('at')})
        rows.append({'service':'monitor','title':'監控程式本身','running':True,'pid':os.getpid(),**process_stats(os.getpid()),'gpuMemory':{}})
        total=command(['/usr/sbin/sysctl','-n','hw.memsize']).strip()
        cached={'at':datetime.now(timezone.utc).isoformat(),'logicalCores':os.cpu_count(),'systemRAMGB':round(int(total)/1073741824,1) if total.isdigit() else None,'cpuTotal':round(sum(r.get('cpu',0) for r in rows),1),'rssTotalMB':round(sum(r.get('rssMB',0) for r in rows),1),'processes':rows,'events':sorted(all_events,key=lambda e:e['at'],reverse=True)[:40]}
        last_sample=time.monotonic();return cached

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        if not request_allowed(self.headers.get('Host'),self.headers.get('Origin'),self.client_address[0],getattr(self.server,'lan',None)):
            self.send_error(403);return
        path=self.path.split('?',1)[0]
        if path=='/':data=(BASE/'project-monitor.html').read_bytes();kind='text/html; charset=utf-8'
        elif path=='/api/status':data=json.dumps(snapshot(),ensure_ascii=False).encode();kind='application/json; charset=utf-8'
        else:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");self.end_headers();self.wfile.write(data)

if __name__=='__main__':
    local=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    lan=lan_config() if os.environ.get('DRINKS_MONITOR_LAN')=='1' else None
    if lan:
        try:
            remote=ThreadingHTTPServer((lan[0],PORT),Handler)
            remote.lan=lan
            threading.Thread(target=remote.serve_forever,daemon=True).start()
            print(f'Wi-Fi monitor: http://{lan[0]}:{PORT} (same subnet only)',flush=True)
        except OSError as error:print(f'LAN listener unavailable: {error}; localhost remains available',flush=True)
    elif os.environ.get('DRINKS_MONITOR_LAN')=='1':
        print('No private LAN address/subnet detected; localhost only',flush=True)
    print(f'Project monitor: http://127.0.0.1:{PORT}',flush=True)
    local.serve_forever()
