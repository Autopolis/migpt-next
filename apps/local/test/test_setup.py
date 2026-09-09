import hashlib
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request

class SetupTest(unittest.TestCase):
    def test_idle_socket_and_secret_preserving_save(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / '.env'
            env_file.write_text("OPENAI_API_KEY='test-only-private-key'\nMI_USER_ID=12345\nMI_PASSWORD=\nMI_PASS_TOKEN=\nMI_DID=\n")
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve().parents[1] / 'setup.py')], env={**os.environ, 'MIGPT_DATA_DIR': directory, 'MIGPT_SETUP_PORT': '0'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                url = process.stdout.readline().strip()
                self.assertTrue(url.startswith('http://127.0.0.1:'))
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                port = urllib.parse.urlsplit(url).port
                with socket.create_connection(('127.0.0.1', port), timeout=2):
                    with opener.open(url+'/', timeout=2) as response:
                        page = response.read().decode()
                        self.assertEqual(response.status, 200)
                self.assertIn('模型 API 密钥：已保存', page)
                self.assertNotIn('test-only-private-key', page)
                nonce = re.search('name="nonce" value="([^"]+)"', page).group(1)
                before = hashlib.sha256(env_file.read_bytes()).digest()
                request = urllib.request.Request(url+'/save', data=urllib.parse.urlencode({'nonce':nonce,'MI_PASS_TOKEN':'test-token'}).encode(), headers={'Origin':'https://external.invalid'})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    opener.open(request, timeout=2)
                self.assertEqual(error.exception.code,403)
                self.assertEqual(before,hashlib.sha256(env_file.read_bytes()).digest())
                request = urllib.request.Request(url+'/save', data=urllib.parse.urlencode({'nonce':nonce,'MI_PASS_TOKEN':'test-token','OPENAI_API_KEY':''}).encode(), headers={'Origin':url})
                with opener.open(request,timeout=2) as response:
                    self.assertEqual(response.status,200)
                    self.assertNotIn('test-token',response.read().decode())
                self.assertIn("OPENAI_API_KEY='test-only-private-key'",env_file.read_text())
                self.assertIn("MI_PASS_TOKEN='test-token'",env_file.read_text())
                self.assertEqual(env_file.stat().st_mode & 0o777,0o600)
            finally:
                process.terminate()
                process.communicate(timeout=3)

if __name__ == '__main__':
    unittest.main()
