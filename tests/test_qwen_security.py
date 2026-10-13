import ssl
import unittest
from scripts.qwen_relay import HOST,requested_host

class RelayDestinationTests(unittest.TestCase):
    def client_hello(self,host):
        output=ssl.MemoryBIO()
        client=ssl.create_default_context().wrap_bio(ssl.MemoryBIO(),output,server_hostname=host)
        try:client.do_handshake()
        except ssl.SSLWantReadError:pass
        return output.read()
    def test_real_openssl_hello_identifies_our_worker(self):
        self.assertEqual(requested_host(self.client_hello(HOST)),HOST)
    def test_other_host_is_not_approved(self):
        self.assertNotEqual(requested_host(self.client_hello('example.com')),HOST)
    def test_malformed_or_incomplete_handshakes_fail_closed(self):
        hello=self.client_hello(HOST)
        for record in [b'',b'GET / HTTP/1.1',hello[:20],hello[:-1]]:
            self.assertIsNone(requested_host(record))
