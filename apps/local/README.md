# 本地音箱助手：社区维护预览

这是在小爱音箱 mini（LX01）实机验证后整理的本地适配层。基于上游 MiGPT-Next 已发布依赖运行，不需要修改原示例。本目录仍是面向开发者的预览，完整的图形配置向导见 [路线图](../../docs/ROADMAP.md)。

已保留的改进：无“请问”前缀问答、尽早暂停原生回复、用语音开关连续对话、确认播报结束后再唤醒、取消过期回答和唤醒、保留原生控制指令、独立代理设置、凭证日志脱敏、本地配置页并发修复、macOS 后台服务管理。

## 先了解

- **只有 LX01 的这台样机经过实测**，不能据此承诺全部 mini 固件或全部小爱机型可用。
- 免刷机方案仍依赖小米云端语音记录和非官方设备接口；不是离线语音识别，也不保证立即打断原生小爱。
- 连续对话由本机在播报结束后再次唤醒设备实现。无人接话时不会反复唤醒，聆听时间由设备固件决定。
- 上游 `LICENSE` 为 MIT，另附 `agreement.md` 含非商业用途表述。本 fork 保留两者，商业分发和推广前需要厘清这些文本的适用关系。见 [许可证说明](../../docs/LICENSING_NOTES.md)。

## 运行

需要 Node.js 22.16+（实测 Node 24）；配置网页额外需要 Python 3.9+。

```sh
cd apps/local
npm ci
cp .env.example .env
npm run setup
```

打开终端显示的本机地址。在页面填写小米数字 ID 和 passToken（或密码），以及模型服务的 API key。页面只显示“已保存”，不回显凭证；留空保留旧值。passToken 相当于登录凭证，请只粘贴到自己的本机页面。

如果小米要求额外验证，按[上游登录说明](https://github.com/idootop/migpt-next/issues/4)在小米账号官网完成登录，再从自己的浏览器复制 passToken。此预览暂不提供自动化浏览器取凭证。

`.env` 中选择模型和服务地址，再运行：

```sh
npm run check
npm run devices
```

从设备列表找到目标音箱，将其 `miotDID` 填到 `.env` 的 `MI_DID`。不要填他人设备编号或直接套用示例型号。

```sh
npm run probe
npm run test-ai
npm run test-tts
npm start
```

分别验证账号、模型、音箱是否真正出声，再开启日常服务。暂停或退出命令见下文。

## 模型服务

`.env.example` 预填了 **AI Plug** 的接口地址和 `gpt-5.6-luna`，它是本 fork 维护方运营的可选服务：[AI Plug](https://aiplug.work/)。使用它需要自行创建账号和专用密钥，模型调用可能计费。模型是否可用及价格以服务商当时的控制台为准。

也可以把 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` 换成其他兼容 OpenAI Chat Completions 的服务；无需使用 AI Plug。当前实测组合是 AI Plug + Luna，其他组合需通过 `test-ai` 验证，不会自动改用更贵的模型。

代理默认不启用。需要 Surge 等本地代理时，根据实际端口设置 `HTTPS_PROXY`；小米 API 仍按上游客户端方式直连。Docker 中的 `127.0.0.1` 指容器自身，不能照搬宿主机端口设置。

## 日常口令

- 直接提问，例如“小爱同学，天空为什么是蓝色的”，不用“请问”。
- “打开连续对话”“开启连续对话”“开始持续对话”：答完后自动唤醒一次，供直接追问。
- “结束连续对话”“关闭连续对话”：退出自动续听，仍可手动唤醒后提问。
- “切回小爱”：关闭模型接管；“开启智能对话”：恢复。
- “别说了”“再见”“结束对话”：结束当前连续会话。

最近 12 条消息用于上下文；五分钟没有新问题或退出会话时清空。常见音乐、音量、闹钟、家电控制继续交给原生小爱；这是一个保守的关键词分类器，可能漏识别复杂口令，不能视为完整的智能家居控制系统。

## macOS 后台运行

先停止前台的 `npm start`（Control+C），确保同一音箱只有一个服务实例，然后：

```sh
npm run service -- install
npm run service -- status
```

程序复制到 `~/Library/Application Support/MiGPT-Next`，避免后台服务从 Documents 启动时的权限问题。安装时复制已配置凭证；后续更新不会覆盖已安装凭证。安装命令只能说明任务已提交，应以 `status` 和运行日志确认服务是否成功。

```sh
npm run service -- configure  # 修改已安装服务的凭证
npm run service -- restart
npm run service -- stop
npm run service -- start
npm run service -- uninstall # 移除自启项，保留数据
```

服务依赖当前 Node 可执行文件；升级或删除该 Node 版本后应重新安装服务。Mac 必须开机联网；插电不休眠可在系统电池设置中开启。脚本不修改合盖、屏幕锁定或系统安全设置。

## 测试与维护

```sh
npm test
python3 -m unittest discover -s test -p 'test_*.py'
```

这些检查不访问真实音箱或模型，不需要凭证。实际音箱验证记录见 [LX01 验证说明](../../docs/LX01_VALIDATION.md)。配置向导、模型发现、更完整的兼容性检测、安装包和长期稳定性是后续工作，不是此提交已经完成的功能。
