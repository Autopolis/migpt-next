import { createConversationHandler } from './conversation.mjs';

export function createConfig(env = process.env) {
  return {
    debug: false,
    speaker: {
      userId: env.MI_USER_ID,
      ...(env.MI_PASSWORD ? { password: env.MI_PASSWORD } : {}),
      ...(env.MI_PASS_TOKEN ? { passToken: env.MI_PASS_TOKEN } : {}),
      did: env.MI_DID,
      timeout: 15000,
      heartbeat: 1000,
    },
    openai: {
      baseURL: env.OPENAI_BASE_URL?.replace(/\/+$/, ''),
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || 'gpt-5.6-luna',
      enableProxy: env.MIGPT_USE_PROXY === '1' || Boolean(env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY || env.https_proxy || env.http_proxy || env.all_proxy),
      extra: {
        clientOptions: { timeout: 10000, maxRetries: 0 },
        createParams: /^gpt-(5|6)/.test(env.OPENAI_MODEL || 'gpt-5.6-luna')
          ? {
              ...((env.OPENAI_REASONING_EFFORT || (env.OPENAI_MODEL || 'gpt-5.6-luna') === 'gpt-5.6-luna')
                ? { reasoning_effort: env.OPENAI_REASONING_EFFORT || 'none' } : {}),
              max_completion_tokens: 600,
            }
          : { max_tokens: 600 },
      },
    },
    prompt: {
      system: '你是家中的中文语音助手。回答自然、准确、简短，默认在180字以内。不要使用Markdown、表格、网址或不适合朗读的符号。不确定时明确说明。你没有智能家居控制工具，不要声称已执行设备控制。',
    },
    context: { historyMaxLength: 12 },
    callAIKeywords: [''],
  };
}

export function parseTTSCommand(value) {
  if (!value?.trim()) return null;
  if (!/^\d+,\d+$/.test(value.trim())) throw new Error('MI_TTS_COMMAND 应是两个正整数，例如 5,1');
  const command = value.trim().split(',').map(Number);
  if (command.some(n => n <= 0)) throw new Error('MI_TTS_COMMAND 必须为正整数');
  return command;
}

export async function speak(mina, miot, text, command) {
  if (command) return miot.doAction(command[0], command[1], text);
  return mina.play({ text });
}

export function createMessageHandler(command, options = {}) {
  return createConversationHandler(speak, command, options);
}
