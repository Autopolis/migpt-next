const handled = { handled: true };
const normalize = text => text.replace(/[\s，。！？、,.!?]/gu, '').replace(/^小爱同学/, '');
const startContinuous = new Set(['打开连续对话', '开始连续对话', '开启连续对话', '进入连续对话', '打开持续对话', '开始持续对话', '开启持续对话']);
const endContinuous = new Set(['结束连续对话', '关闭连续对话', '退出连续对话', '结束持续对话', '关闭持续对话', '退出持续对话']);
const startAI = new Set(['开启智能对话', '开始智能对话', '切换到智能对话']);
const endAI = new Set(['退出智能对话', '关闭智能对话', '切回小爱', '切换回小爱']);
const finish = new Set(['别说了', '停下', '停止', '闭嘴', '不用了', '不聊了', '再见', '结束对话']);

export function isNativeCommand(text) {
  if (/为什么|怎么|如何|是什么意思|介绍一下|解释一下/.test(text)) return false;
  return /^(播放|放一首|来一首|暂停|继续播放|停止播放|上一首|下一首|换一首|音量|把音量|声音大|声音小|调大音量|调小音量|静音|取消静音|打开.*(?:灯|空调|电视|窗帘)|关闭.*(?:灯|空调|电视|窗帘)|(?:设置|设个|添加|取消|关闭|删除).*闹钟|(?:设置|设个|开始|取消).*计时|(?:今天|明天|后天|现在).*(?:天气|气温)|现在几点)/.test(text);
}

export async function waitForSpeechEnd(mina, isCurrent, options = {}) {
  const now = options.now || Date.now;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const started = now();
  let observedPlaying = false;
  let idleSamples = 0;
  while (isCurrent() && now() - started < (options.timeoutMs ?? 90000)) {
    await sleep(options.pollMs ?? 400);
    if (!isCurrent()) return false;
    let status;
    try { status = (await mina.getStatus())?.status; } catch { status = 'unknown'; }
    if (!isCurrent()) return false;
    if (status === 'playing') { observedPlaying = true; idleSamples = 0; }
    else if (status === 'idle' || status === 'stopped' || status === 'paused') {
      idleSamples++;
      if (observedPlaying && idleSamples >= 2) return true;
      // 没有观察到播放过程时，不猜测结束时间，避免把尚未开始的播报打断。
      if (!observedPlaying && now() - started >= 3000) return false;
    } else { idleSamples = 0; }
  }
  return false;
}

export function createConversationHandler(speak, command, options = {}) {
  const state = { enabled: true, continuous: options.continuous ?? false, generation: 0, lastQuestionAt: 0 };
  const now = options.now || Date.now;
  const resetContext = options.resetContext || (() => {});
  const waitForEnd = options.waitForEnd || waitForSpeechEnd;
  return async (engine, msg) => {
    const started = now();
    const generation = ++state.generation;
    const current = () => generation === state.generation && engine.status === 'running' && engine.lastMsg?.id === msg.id;
    const plain = normalize(msg.text || '');
    if (!plain) return handled;

    let acknowledgement;
    if (startContinuous.has(plain)) {
      state.enabled = true; state.continuous = true;
      acknowledgement = '连续对话已开启，我回答完后，你可以直接接着说。';
    } else if (endContinuous.has(plain)) {
      state.continuous = false; resetContext();
      acknowledgement = '连续对话已结束，下次叫小爱同学就可以继续问我。';
    } else if (startAI.has(plain)) {
      state.enabled = true; resetContext();
      acknowledgement = '智能对话已开启，直接问我就可以，不用说请问。';
    } else if (endAI.has(plain)) {
      state.enabled = false; state.continuous = false; resetContext();
      acknowledgement = '已切回小爱。';
    } else if (finish.has(plain)) {
      state.continuous = false; resetContext();
      try { await engine.MiNA.pause(); } catch {}
      return handled;
    } else if (!state.enabled || isNativeCommand(plain)) {
      return handled;
    }

    // Include time spent waiting for Xiaomi's conversation record.
    const messageTime = Number.isFinite(msg.timestamp) && msg.timestamp > 0
      ? Math.min(started, msg.timestamp) : started;
    const deadline = messageTime + (options.replyTimeoutMs ?? 10000);
    let expired = false;
    const expire = () => {
      if (expired) return;
      expired = true;
      try { options.cancelRequest?.(msg.id); } catch {}
      console.log('回答超过等待时限，已取消请求并丢弃结果。');
    };
    const canReply = () => {
      if (now() >= deadline) expire();
      return !expired && current();
    };
    if (!canReply()) return handled;

    let timer;
    let answer;
    try {
      answer = await Promise.race([
        new Promise(resolve => {
          timer = setTimeout(() => { expire(); resolve(undefined); }, deadline - now());
        }),
        (async () => {
          try {
            const paused = await engine.MiNA.pause();
            console.log(`原生回答暂停请求：${paused ? '已接受' : '未接受'}。`);
          } catch { console.warn('原生回答暂停失败，继续处理。'); }
          if (!canReply()) return;
          if (acknowledgement) return acknowledgement;
          if (state.lastQuestionAt && now() - state.lastQuestionAt > (options.contextIdleMs ?? 300000)) resetContext();
          state.lastQuestionAt = now();
          try { return (await engine.askAI(msg)).text; }
          catch { if (canReply()) console.error('模型请求失败。'); }
        })(),
      ]);
    } finally { clearTimeout(timer); }
    // Check again even if a blocked event loop delayed the timeout callback.
    if (!canReply()) return handled;
    const successful = Boolean(answer);
    answer ||= '暂时没有收到大模型的回复，请稍后再试。';
    let accepted;
    try { accepted = await speak(engine.MiNA, engine.MiOT, answer, command); }
    catch { accepted = false; }
    if (!accepted) { console.error('音箱未接受播报请求。'); return handled; }
    console.log(`✅ ${acknowledgement ? '对话设置' : (engine.config.openai?.model || '模型')}播报已提交，耗时 ${now() - started} ms。`);

    if (!successful || !state.continuous || !current()) return handled;
    if (engine.MiNA.account?.device?.hardware !== 'LX01') {
      console.warn('未确认该机型的唤醒指令，未自动唤醒。'); return handled;
    }
    const completed = await waitForEnd(engine.MiNA, current);
    if (!completed || !current() || !state.continuous) {
      console.log('未确认完整播放结束，或已有新指令；跳过自动唤醒。'); return handled;
    }
    // 上游会过滤音乐等记录；在唤醒前额外检查，避免打断刚开始的原生操作。
    try {
      const recent = await engine.MiNA.getConversations({ limit: 1 });
      if (!recent || !Array.isArray(recent.records) || recent.records.some(r => r.time > msg.timestamp)) {
        console.log('出现更新指令或记录不可用，跳过自动唤醒。'); return handled;
      }
      if (!current() || !state.continuous) return handled;
      const awakened = await engine.MiOT.doAction(5, 2);
      console.log(`连续对话：下一轮唤醒${awakened ? '已接受' : '未接受'}。`);
    } catch { console.warn('自动唤醒失败，仍可手动叫小爱同学。'); }
    return handled;
  };
}
