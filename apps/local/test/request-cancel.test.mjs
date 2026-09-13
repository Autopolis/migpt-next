import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { OpenAI } from '@mi-gpt/openai';
import { createMessageHandler, createConfig } from '../config.mjs';

test('deadline aborts the actual SDK HTTP request without playback or retry', { timeout: 5000 }, async t => {
  let requests = 0;
  let disconnected;
  const closed = new Promise(resolve => { disconnected = resolve; });
  const server = createServer((req, res) => {
    requests++;
    req.resume();
    res.on('close', disconnected);
    // Deliberately never send a response, like a stalled model router.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { OpenAI.dispose(); server.closeAllConnections(); server.close(); });
  const config = createConfig({});
  assert.equal(config.openai.extra.clientOptions.timeout, 10000);
  assert.equal(config.openai.extra.clientOptions.maxRetries, 0);
  OpenAI.init({ ...config.openai, baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-test-only', enableProxy: false });
  const msg = { id: 'cancel-http', text: 'test', timestamp: Date.now() };
  let spoken = 0;
  const engine = {
    config, status: 'running', lastMsg: msg,
    MiNA: { pause: async () => true, play: async () => { spoken++; return true; } },
    askAI: async () => ({ text: await OpenAI.chat({ requestId: msg.id, createParams: { messages: [{ role: 'user', content: 'test' }], stream: false } }) }),
  };
  await createMessageHandler(null, { replyTimeoutMs: 300, cancelRequest: id => OpenAI.cancel(id) })(engine, msg);
  await closed;
  assert.equal(requests, 1);
  assert.equal(spoken, 0);
});
