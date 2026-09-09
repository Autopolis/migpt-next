from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs
from pathlib import Path
import secrets, html, json, threading, os, tempfile
write_lock = threading.Lock()
root=Path(os.environ.get('MIGPT_DATA_DIR', Path(__file__).resolve().parent))
env=root/'.env'
port=int(os.environ.get('MIGPT_SETUP_PORT', '8765'))
origin=f'http://127.0.0.1:{port}'
nonce=secrets.token_urlsafe(24)
class H(BaseHTTPRequestHandler):
 def setup(self):
  super().setup()
  self.connection.settimeout(10)
 def log_message(self,*a):pass
 def saved_status(self):
  values={}
  for line in env.read_text().splitlines():
   if '=' in line and not line.lstrip().startswith('#'):
    key,value=line.split('=',1); values[key]=bool(value.strip().strip("'\""))
  names={'OPENAI_API_KEY':'模型 API 密钥','MI_USER_ID':'小米账号','MI_PASSWORD':'小米密码','MI_PASS_TOKEN':'小米 passToken','MI_DID':'音箱设备'}
  return '<ul>'+''.join('<li>'+name+'：'+('已保存' if values.get(key) else '待填写')+'</li>' for key,name in names.items())+'</ul>'
 def do_GET(self):
  if self.path!='/': self.send_error(404);return
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers()
  self.wfile.write(('''<!doctype html><meta charset="utf-8"><title>小爱本地配置</title><style>body{font:20px system-ui;max-width:650px;margin:60px auto}label{display:block;margin-top:25px}input{display:block;width:100%;padding:12px;font:inherit}button{margin-top:25px;padding:15px;font:inherit}</style><h1>小爱本地配置</h1><p>凭证已保存时不会回填到输入框。留空会保留原值，无需重复填写。</p>'''+self.saved_status()+'''<form method="post" action="/save"><input type="hidden" name="nonce" value="'''+nonce+'''"><label>模型服务 API Key<input type="password" name="OPENAI_API_KEY" autocomplete="off"></label><label>小米账号 ID<input type="text" name="MI_USER_ID" autocomplete="off"></label><label>小米账号密码<input type="password" name="MI_PASSWORD" autocomplete="off"></label><label>小米 passToken<input type="password" name="MI_PASS_TOKEN" autocomplete="off"></label><button type="submit">保存到本机</button></form>''').encode())
 def do_POST(self):
  with write_lock:
   self.save_credentials()
 def save_credentials(self):
  if self.path!='/save' or self.headers.get('Origin')!=origin:self.send_error(403);return
  try: n=int(self.headers.get('Content-Length','0'))
  except ValueError: self.send_error(400);return
  if n<0 or n>12000:self.send_error(413);return
  data=parse_qs(self.rfile.read(n).decode())
  if data.get('nonce')!=[nonce]:self.send_error(403);return
  lines=env.read_text().splitlines(); changed=[]
  for key in ['OPENAI_API_KEY','MI_USER_ID','MI_PASSWORD','MI_PASS_TOKEN']:
   value=data.get(key,[''])[0]
   if not value:continue
   if '\n' in value or '\r' in value:self.send_error(400);return
   # Node dotenv treats single-quoted contents literally, including backslashes.
   quote="'" if "'" not in value else ('"' if '"' not in value else '`')
   if quote in value:self.send_error(400);return
   replacement=key+'='+quote+value+quote
   lines=[replacement if line.startswith(key+'=') else line for line in lines]
   changed.append(key)
  destination=env.resolve()
  with tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, delete=False, encoding='utf-8') as f:
   f.write('\n'.join(lines)+'\n'); temporary=f.name
  os.chmod(temporary,0o600);os.replace(temporary,destination)
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers()
  self.wfile.write(('<meta charset="utf-8"><title>已保存</title><h1>已保存到本机</h1><p>'+html.escape(', '.join(changed))+'</p><a href="/">返回配置</a>').encode())
if __name__ == '__main__':
 if not env.exists():
  raise SystemExit('请先复制 .env.example 为 .env，或指定 MIGPT_DATA_DIR。')
 os.umask(0o077)
 server=ThreadingHTTPServer(('127.0.0.1',port),H)
 origin=f'http://127.0.0.1:{server.server_port}'
 print(origin,flush=True)
 server.serve_forever()
