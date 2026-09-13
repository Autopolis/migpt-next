import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationHandler } from '../conversation.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function completesWithin(promise, ms = 250) {
  const result = await Promise.race([
    promise.then(() => 'completed'),
    delay(ms).then(() => 'timed out'),
  ]);
  assert.equal(result, 'completed', `handler did not return within ${ms} ms`);
}

function setup({ now = () => 20_000, pause, askAI, continuous = false, replyTimeoutMs = 10_000 } = {}) {
  const calls = [];
  const cancelled = [];
  const msg = { id: 'message-1', timestamp: 20_000, text: '解释一下彩虹' };
  const engine = {
    status: 'running',
    lastMsg: msg,
    config: { openai: { model: 'test-model' } },
    MiNA: {
      account: { device: { hardware: 'LX01' } },
      pause: pause || (async () => { calls.push('pause'); return true; }),
      getConversations: async () => ({ records: [{ time: msg.timestamp }] }),
    },
    MiOT: { doAction: async () => { calls.push('wake'); return true; } },
    askAI: askAI || (async () => { calls.push('ask'); return { text: '彩虹' }; }),
  };
  const speak = async () => { calls.push('speak'); return true; };
  const handler = createConversationHandler(speak, null, {
    now,
    continuous,
    replyTimeoutMs,
    cancelRequest: id => cancelled.push(id),
    waitForEnd: async () => { calls.push('wait'); return true; },
  });
  return { calls, cancelled, engine, handler, msg };
}

test('returns a normal answer before the reply deadline', async () => {
  const { calls, cancelled, engine, handler, msg } = setup({ now: () => 20_000 });

  await handler(engine, msg);

  assert.deepEqual(calls, ['pause', 'ask', 'speak']);
  assert.deepEqual(cancelled, []);
});

test('drops a response whose message timestamp is already ten seconds old', async () => {
  const { calls, cancelled, engine, handler, msg } = setup({ now: () => 30_000 });

  await handler(engine, msg);

  assert.deepEqual(calls, []);
  assert.deepEqual(cancelled, ['message-1']);
});

test('releases a hung request at its deadline and ignores a late resolution', async () => {
  const answer = deferred();
  const { calls, cancelled, engine, handler, msg } = setup({
    continuous: true,
    replyTimeoutMs: 25,
    askAI: async () => {
      calls.push('ask');
      return answer.promise;
    },
  });

  await completesWithin(handler(engine, msg));
  assert.deepEqual(calls, ['pause', 'ask']);
  assert.deepEqual(cancelled, ['message-1']);

  answer.resolve({ text: '太晚了' });
  await delay(0);
  assert.deepEqual(calls, ['pause', 'ask']);
});

test('ignores a late request rejection after the deadline', async () => {
  const answer = deferred();
  const { calls, cancelled, engine, handler, msg } = setup({
    replyTimeoutMs: 25,
    askAI: async () => {
      calls.push('ask');
      return answer.promise;
    },
  });

  await completesWithin(handler(engine, msg));
  answer.reject(new Error('late failure'));
  await delay(0);

  assert.deepEqual(calls, ['pause', 'ask']);
  assert.deepEqual(cancelled, ['message-1']);
});

test('does not start AI after a slow native pause consumes the deadline', async () => {
  const pause = deferred();
  const { calls, cancelled, engine, handler, msg } = setup({
    replyTimeoutMs: 25,
    pause: async () => {
      calls.push('pause');
      return pause.promise;
    },
    askAI: async () => {
      calls.push('ask');
      return { text: '不应请求' };
    },
  });

  await completesWithin(handler(engine, msg));
  assert.deepEqual(calls, ['pause']);
  assert.deepEqual(cancelled, ['message-1']);

  pause.resolve(true);
  await delay(0);
  assert.deepEqual(calls, ['pause']);
});

for (const elapsed of [9999, 10000, 10001]) {
  test(`checks response age at ${elapsed} ms even before the timer callback runs`, async () => {
    let clock = 20_000;
    const { calls, cancelled, engine, handler, msg } = setup({
      now: () => clock,
      continuous: true,
      askAI: async () => { clock += elapsed; return { text: 'answer' }; },
    });
    await handler(engine, msg);
    assert.equal(calls.includes('speak'), elapsed < 10000);
    assert.equal(calls.includes('wake'), elapsed < 10000);
    assert.deepEqual(cancelled, elapsed < 10000 ? [] : [msg.id]);
  });
}
