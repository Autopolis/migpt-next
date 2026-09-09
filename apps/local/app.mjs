import { existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createConfig, createMessageHandler, parseTTSCommand, speak } from './config.mjs';

process.chdir(process.env.MIGPT_DATA_DIR || dirname(fileURLToPath(import.meta.url)));
process.umask(0o077);
if (existsSync('.env')) { chmodSync('.env', 0o600); loadEnvFile('.env'); }
if (existsSync('.mi.json')) chmodSync('.mi.json', 0o600);

// 上游出错时会打印含认证信息的 HTTP 对象，禁止输出这些对象。
const sensitive = ['MI_PASSWORD', 'MI_PASS_TOKEN', 'OPENAI_API_KEY'].map(k => process.env[k]).filter(Boolean);
function safeText(value) {
  if (typeof value !== 'string') return '[详细响应已隐藏，避免泄露凭证]';
  let text = value;
  for (const secret of sensitive) text = text.split(secret).join('[REDACTED]');
  return text;
}
for (const method of ['log', 'error', 'warn', 'debug']) {
  const original = console[method].bind(console);
  console[method] = (...args) => original(...args.map(safeText));
}

const config = createConfig();
const mode = process.argv[2] || 'check';
function needAI() {
  if (!config.openai.apiKey || !config.openai.baseURL) throw new Error('尚未配置模型服务密钥及接口地址。');
  const url = new URL(config.openai.baseURL);
  if (url.protocol !== 'https:') throw new Error('模型接口必须使用 HTTPS。');
}
function needXiaomi(device = true) {
  if (!config.speaker.userId || (!config.speaker.password && !config.speaker.passToken)) {
    throw new Error('尚未配置小米数字 ID 和密码或 passToken。');
  }
  if (device && !config.speaker.did) throw new Error('尚未确认音箱设备 ID；先运行 devices。');
}
async function getSpeaker(device = true) {
  needXiaomi(device);
  const { getMiNA } = await import('@mi-gpt/miot');
  const mina = await getMiNA({ ...config.speaker, did: device ? config.speaker.did : '', debug: false });
  if (!mina) throw new Error('小米登录未成功；如有额外认证，请完成认证后再继续。');
  return mina;
}
async function main() {
  if (mode === 'check') {
    console.log(`Node: ${process.version}; 模型: ${config.openai.model}; 代理: ${process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '未配置'}`);
    console.log(`AI 密钥: ${config.openai.apiKey ? '已填写' : '待填写'}; 小米凭证: ${config.speaker.userId && (config.speaker.password || config.speaker.passToken) ? '已填写' : '待填写'}; 设备 ID: ${config.speaker.did ? '已填写' : '待确认'}`);
    parseTTSCommand(process.env.MI_TTS_COMMAND);
    await import('@mi-gpt/next');
    await import('@mi-gpt/miot');
    console.log('依赖加载正常。本检查不代表设备和模型已连通。');
  } else if (mode === 'devices') {
    const mina = await getSpeaker(false);
    const devices = await mina.getDevices();
    if (!Array.isArray(devices)) throw new Error('未获得设备列表。');
    console.log(JSON.stringify(devices.map(d => ({ name: d.name, hardware: d.hardware, miotDID: d.miotDID, model: d.model })), null, 2));
  } else if (mode === 'probe') {
    const mina = await getSpeaker();
    const device = mina.account.device;
    console.log(JSON.stringify({ name: device.name, hardware: device.hardware, miotDID: device.miotDID }, null, 2));
    const records = await mina.getConversations({ limit: 1 });
    console.log(`对话记录接口: ${records && Array.isArray(records.records) ? '可读取' : '未通过'}`);
    const status = await mina.getStatus();
    console.log(`播放状态接口: ${status?.status || '不支持或查询失败'}`);
    if (!records || !Array.isArray(records.records)) process.exitCode = 1;
  } else if (mode === 'test-ai') {
    needAI();
    const { OpenAI } = await import('@mi-gpt/openai');
    OpenAI.init(config.openai);
    const text = await OpenAI.chat({ createParams: { messages: [{ role: 'user', content: '请用一句中文说明你已经准备好回答问题。' }], stream: false } });
    OpenAI.dispose();
    if (!text) throw new Error('模型接口没有返回可朗读的文本。');
    console.log(`模型接口测试成功：${text}`);
  } else if (mode === 'test-tts') {
    const mina = await getSpeaker();
    const command = parseTTSCommand(process.env.MI_TTS_COMMAND);
    let miot;
    if (command) {
      const { getMIoT } = await import('@mi-gpt/miot');
      miot = await getMIoT(config.speaker);
      if (!miot) throw new Error('MIoT 登录失败。');
    }
    if (!await speak(mina, miot, '小爱音箱连接测试，请确认你听到了这句话。', command)) throw new Error('设备未接受播报请求。');
    console.log('设备已接受播报请求；是否实际出声仍需现场确认。');
  } else if (mode === 'start') {
    needAI(); needXiaomi();
    const { MiGPT } = await import('@mi-gpt/next');
    const { ChatBot } = await import('@mi-gpt/chat');
    config.onMessage = createMessageHandler(parseTTSCommand(process.env.MI_TTS_COMMAND), {
      continuous: process.env.MI_CONTINUOUS_DIALOGUE === '1',
      resetContext: () => { ChatBot.history = []; },
    });
    process.on('SIGINT', async () => { await MiGPT.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await MiGPT.stop(); process.exit(0); });
    console.log('直接提问，无需“请问”。支持“开启连续对话”“结束连续对话”“切回小爱”“开启智能对话”。');
    await MiGPT.start(config);
  } else throw new Error(`未知命令：${mode}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
