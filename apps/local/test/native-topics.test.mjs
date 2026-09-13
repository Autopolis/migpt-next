import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationHandler } from '../conversation.mjs';

function fixture() {
  const calls = [];
  const engine = {
    status: 'running', config: { openai: {} },
    MiNA: { account: { device: { hardware: 'LX01' } }, pause: async () => { calls.push('pause'); return true; } },
    askAI: async () => { calls.push('ai'); return { text: 'answer' }; },
  };
  const handler = createConversationHandler(async () => { calls.push('speak'); return true; }, null, {
    continuous: true,
    waitForEnd: async () => { calls.push('wake-check'); return true; },
  });
  const send = text => {
    const msg = { text, id: text, timestamp: Date.now() };
    engine.lastMsg = msg;
    return handler(engine, msg);
  };
  return { calls, engine, send };
}

test('frequent native topics bypass GPT without pausing or rearming the speaker', async () => {
  const { calls, send } = fixture();
  for (const text of [
    '小爱同学，天气怎么样？', '北京周末天气', '为什么天气这么热',
    '我有哪些闹钟', '帮我把闹钟关了', '怎么设置闹钟',
    '把空调调到二十六度', '空调开了吗', '空调为什么不制冷',
    '几点了', '请问现在几点', '纽约现在几点',
  ]) {
    assert.deepEqual(await send(text), { handled: true });
    assert.deepEqual(calls, [], text);
  }
});

test('a native topic prevents the pending GPT answer from playing afterward', async () => {
  const { calls, engine, send } = fixture();
  let resolveAnswer;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  engine.askAI = () => {
    calls.push('ai');
    started();
    return new Promise(resolve => { resolveAnswer = resolve; });
  };
  const pending = send('讲个故事');
  await waiting;
  await send('天气怎么样');
  resolveAnswer({ text: 'late answer' });
  await pending;
  assert.deepEqual(calls, ['pause', 'ai']);
});
