import assert from 'node:assert/strict';
import {createMessageHandler,createConfig} from '../config.mjs';
import {waitForSpeechEnd,isNativeCommand} from '../conversation.mjs';
let calls=[], resets=0, tick=1000, currentMsg;
const engine={status:'running',config:createConfig({}),MiNA:{account:{device:{hardware:'LX01'}},pause:async()=>{calls.push('pause');return true},play:async()=>{calls.push('speak');return true},getConversations:async()=>({records:[{time:currentMsg.timestamp}]})},MiOT:{doAction:async(s,a)=>{calls.push(`wake:${s},${a}`);return true}},askAI:async()=>{calls.push('ai');return {text:'测试回复'}}};
const handler=createMessageHandler(null,{resetContext:()=>resets++,now:()=>tick,waitForEnd:async()=>true});
async function send(text){tick+=100;currentMsg={id:String(tick),timestamp:tick,text};engine.lastMsg=currentMsg;calls=[];await handler(engine,currentMsg);return [...calls]}
assert.deepEqual(await send('天空为什么是蓝色的'),['pause','ai','speak']);
assert.deepEqual(await send('播放音乐'),[]);
assert.deepEqual(await send('小爱同学，打开连续对话'),['pause','speak','wake:5,2']);
assert.deepEqual(await send('那夕阳呢'),['pause','ai','speak','wake:5,2']);
assert.deepEqual(await send('关闭连续对话'),['pause','speak']);
assert.deepEqual(await send('那火星呢'),['pause','ai','speak']);
assert.deepEqual(await send('切回小爱'),['pause','speak']);
assert.deepEqual(await send('讲个故事'),[]);
assert.deepEqual(await send('开启智能对话'),['pause','speak']);
assert.deepEqual(await send('讲个故事'),['pause','ai','speak']);
const beforeReset=resets;tick+=300001;await send('换个话题');assert.equal(resets,beforeReset+1);
await send('打开连续对话');
engine.MiNA.getConversations=async()=>({records:[{time:currentMsg.timestamp+1}]});
assert.deepEqual(await send('解释彩虹'),['pause','ai','speak']);
engine.askAI=async()=>{calls.push('ai');engine.lastMsg={id:'new'};return {text:'过期回复'}};
assert.deepEqual(await send('旧问题'),['pause','ai']);
assert.equal(isNativeCommand('为什么播放音乐会让人开心'),false);
assert.equal(isNativeCommand('设置明天七点的闹钟'),true);
async function checkEnd(statuses,current=()=>true){let clock=0,i=0;return waitForSpeechEnd({getStatus:async()=>({status:statuses[Math.min(i++,statuses.length-1)]})},current,{now:()=>clock,sleep:async ms=>{clock+=ms},pollMs:1000,timeoutMs:6000})}
assert.equal(await checkEnd(['playing','idle','idle']),true);
assert.equal(await checkEnd(['idle']),false);
assert.equal(await checkEnd(['unknown']),false);
assert.equal(await checkEnd(['playing'],()=>false),false);
console.log('通过：无前缀问答、原生指令保留、开关口令、上下文超时、新指令取消回复和唤醒、播放结束检测。');

assert.equal(createConfig({}).openai.enableProxy, false);
assert.equal(createConfig({HTTPS_PROXY:'http://127.0.0.1:8888'}).openai.enableProxy, true);
assert.equal(createConfig({OPENAI_MODEL:'custom-model'}).openai.extra.createParams.reasoning_effort, undefined);
assert.equal(createConfig({OPENAI_MODEL:'gpt-6-astra'}).openai.extra.createParams.reasoning_effort, undefined);
