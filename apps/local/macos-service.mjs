import { cpSync, existsSync, mkdirSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const label = 'local.autopolis.migpt';
const source = dirname(fileURLToPath(import.meta.url));
const runtime = join(homedir(), 'Library', 'Application Support', 'MiGPT-Next');
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const target = `gui/${process.getuid?.()}/${label}`;
const escapeXML = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function renderPlist(node, directory) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escapeXML(node)}</string><string>${escapeXML(join(directory, 'app.mjs'))}</string><string>start</string></array>
<key>WorkingDirectory</key><string>${escapeXML(directory)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>60</integer>
<key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${escapeXML(join(directory, 'logs/service.log'))}</string>
<key>StandardErrorPath</key><string>${escapeXML(join(directory, 'logs/error.log'))}</string>
</dict></plist>\n`;
}
function launch(args, optional = false) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (!optional && result.status !== 0) throw new Error(result.stderr.trim() || 'launchctl 操作失败');
  return result;
}
function installed() { return launch(['print', target], true).status === 0; }
function main() {
  if (process.platform !== 'darwin') throw new Error('此服务管理器仅支持 macOS。其他平台请前台运行 npm start。');
  process.umask(0o077);
  const command = process.argv[2] || 'status';
  if (command === 'install') {
    if (!existsSync(join(source, '.env'))) throw new Error('请先配置 .env 并完成设备和模型测试。');
    if (!existsSync(join(source, 'node_modules'))) throw new Error('请先在 apps/local 中运行 npm ci。');
    if (installed()) launch(['bootout', target]);
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    for (const name of ['app.mjs', 'config.mjs', 'conversation.mjs', 'setup.py', 'package.json', 'package-lock.json', '.env.example', 'node_modules']) {
      cpSync(join(source, name), join(runtime, name), { recursive: true });
    }
    for (const name of ['.env', '.mi.json']) {
      if (!existsSync(join(runtime, name)) && existsSync(join(source, name))) cpSync(join(source, name), join(runtime, name));
      if (existsSync(join(runtime, name))) chmodSync(join(runtime, name), 0o600);
    }
    mkdirSync(join(runtime, 'logs'), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, renderPlist(process.execPath, runtime), { mode: 0o600 });
    launch(['bootstrap', `gui/${process.getuid()}`, plistPath]);
    console.log('后台服务已安装。运行数据位于：' + runtime);
    console.log('更新安装会保留已有凭证；修改运行配置请用 npm run service -- configure。');
  } else if (command === 'start') {
    if (installed()) launch(['kickstart', target]);
    else launch(['bootstrap', `gui/${process.getuid()}`, plistPath]);
  } else if (command === 'restart') {
    launch(['kickstart', '-k', target]);
  } else if (command === 'stop' || command === 'uninstall') {
    if (installed()) launch(['bootout', target]);
    if (command === 'uninstall' && existsSync(plistPath)) unlinkSync(plistPath);
    console.log('后台服务已停止；运行数据和凭证保留。');
  } else if (command === 'configure') {
    if (!existsSync(join(runtime, '.env'))) throw new Error('尚未安装后台服务。');
    const result = spawnSync('python3', [join(runtime, 'setup.py')], { stdio: 'inherit', env: { ...process.env, MIGPT_DATA_DIR: runtime } });
    process.exitCode = result.status || 0;
  } else if (command === 'status') {
    const result = launch(['print', target], true);
    if (result.status) console.log('后台服务未加载。');
    else console.log(result.stdout.split('\n').filter(line => /state =|pid =|last exit code/.test(line)).join('\n'));
  } else throw new Error('可用命令：install / start / stop / restart / status / configure / uninstall');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
