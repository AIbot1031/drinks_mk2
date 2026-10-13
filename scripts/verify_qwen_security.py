"""Verify Qwen isolation using disposable probes; never reads real private documents."""
import json
import subprocess
import tempfile
import ssl
import socket
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
runtime=Path.home()/'Library/Application Support/DrinksMk2LLM'
with tempfile.TemporaryDirectory(prefix='.qwen-security-',dir=ROOT) as folder:
    marker=Path(folder)/'probe.txt';marker.write_text('synthetic probe')
    code=f'''from pathlib import Path
import socket,subprocess,json
checks={{}}
try:Path({str(marker)!r}).read_text();checks['private_read_denied']=False
except PermissionError:checks['private_read_denied']=True
try:Path({str(runtime/'scripts/.security-write-probe')!r}).write_text('probe');checks['program_write_denied']=False
except PermissionError:checks['program_write_denied']=True
try:subprocess.run(['/bin/sh','-c','true']);checks['shell_denied']=False
except PermissionError:checks['shell_denied']=True
s=socket.socket();s.settimeout(3)
try:s.connect(('1.1.1.1',443));checks['direct_egress_denied']=False
except PermissionError:checks['direct_egress_denied']=True
except OSError:checks['direct_egress_denied']=False
s.close();s=socket.socket()
try:s.bind(('127.0.0.1',0));s.listen();checks['listener_denied']=False
except PermissionError:checks['listener_denied']=True
s.close();print(json.dumps(checks));assert all(checks.values())
'''
    result=subprocess.run(['/usr/bin/sandbox-exec','-f',str(runtime/'qwen.sb'),str(runtime/'.venv-llm/bin/python'),'-c',code],cwd=runtime,capture_output=True,text=True)
    print(result.stdout.strip());(runtime/'scripts/.security-write-probe').unlink(missing_ok=True)
    if result.returncode:raise RuntimeError('Qwen isolation probe failed')
try:
    with socket.create_connection(('127.0.0.1',52791),timeout=5) as sock:
        with ssl.create_default_context().wrap_socket(sock,server_hostname='example.com'):
            raise RuntimeError('Relay accepted an unapproved hostname')
except (ssl.SSLError,ConnectionResetError):print('unapproved_tls_hostname_denied=True')
