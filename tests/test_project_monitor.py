import contextlib
import io
import json
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from scripts.project_monitor import Handler
from scripts.inference_audit import audit

class LocalMonitorTests(unittest.TestCase):
    def test_operational_logs_drop_prompt_credentials_and_account_fields(self):
        stream=io.StringIO()
        with contextlib.redirect_stdout(stream):
            audit('qwen','inference_done',durationMs=12.5,prompt='PRIVATE_PROMPT',key='PRIVATE_KEY',userId='PRIVATE_USER')
        output=stream.getvalue();self.assertNotIn('PRIVATE_',output);self.assertEqual(json.loads(output)['durationMs'],12.5)
    def test_unknown_host_origin_and_file_paths_are_rejected(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            base=f'http://127.0.0.1:{server.server_port}'
            def status(path,headers):
                request=urllib.request.Request(base+path,headers=headers)
                try:
                    with urllib.request.urlopen(request,timeout=3) as response:return response.status
                except urllib.error.HTTPError as error:return error.code
            self.assertEqual(status('/',{'Host':'127.0.0.1:8792'}),200)
            self.assertEqual(status('/api/status',{'Host':'unrelated.example'}),403)
            self.assertEqual(status('/api/status',{'Host':'127.0.0.1:8792','Origin':'https://unrelated.example'}),403)
            self.assertEqual(status('/.llm-key',{'Host':'127.0.0.1:8792'}),404)
        finally:server.shutdown();server.server_close();thread.join(timeout=2)
