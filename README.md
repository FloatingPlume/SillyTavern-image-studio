# 画坊 · Image Studio

仓库：<https://github.com/FloatingPlume/SillyTavern-image-studio>

SillyTavern 1.18+ 的图像生成与 API 管理扩展。一个面板里同时管理本地 ComfyUI、云端生图 API、聊天 API、余额和生成记录。

> **状态：个人自用 beta，AI 辅助开发。**
> 本项目的需求、代码和测试脚本由作者与 AI 协作完成，作者负责在真实 SillyTavern / ComfyUI 环境验证与维护。它不是生产级商业插件，不承诺所有云端上游都一次适配成功；欢迎 issue 和 PR，但不保证即时响应。如果你所在社区禁止 AI 辅助内容，请不要在该社区发布或推荐本项目。

## 功能

- **本地 ComfyUI**：局域网连接 PC，实时显示 GPU / 显存 / 内存 / ComfyUI 版本、队列、WebSocket 进度、节点状态和实时预览帧。
- **透明请求**：生成前可展开查看实际发送的正/负面提示词、seed、尺寸、采样器、最终 API 工作流 JSON。
- **内置工作流**：Checkpoint / Sampler / Scheduler / VAE / LoRA / 高清修复（潜空间放大再采样）/ 批量。
- **自定义工作流**：粘贴 ComfyUI 导出的 API 格式 JSON；支持占位符，或自动识别 Checkpoint、KSampler、CLIPTextEncode、EmptyLatentImage、SaveImage 节点。
- **云端生图**：OpenAI 兼容中转、OpenAI 官方、Google Gemini / Imagen、xAI，以及可自由填写 URL / 请求体 / 返回路径的自定义接口。
- **API 管理**：多套生图与聊天档案、连接测试、模型发现、Key 管理、余额查询（上游支持时）。
- **聊天 API 切换**：一键把聊天档案应用到酒馆（OpenAI 兼容 / OpenAI / Gemini / Claude / OpenRouter / xAI），自动写入酒馆密钥并切换模型。
- **提示词**：手写 + 宏；可选 AI 改写（默认关闭，点一次才发一次请求），支持当前酒馆 API、画坊聊天档案、酒馆连接配置三种来源。
- **生成记录**：自动保存到酒馆图库 `image-studio` 目录；支持下载、设为聊天背景、插入聊天、复用参数。
- **移动端**：面板适配窄屏，使用酒馆原生主题变量，无额外前端框架。

## 安装

### 酒馆 / SillyDroid 扩展管理器（推荐）

酒馆菜单 → **扩展** → **安装扩展**，填入仓库地址，例如：

```text
https://github.com/FloatingPlume/SillyTavern-image-studio
```

或 Gitee 镜像地址。安装后刷新酒馆，魔杖菜单里会出现 **画坊**。

### SillyDroid 需要额外打开跨域代理

画坊的所有 HTTP 请求默认走酒馆服务端的 `/proxy/`，这样手机上的浏览器不需要 ComfyUI / 云端 API 提供 CORS 头。

在 SillyDroid 的设置里：

1. 打开 **让服务端充当跨域代理**。
2. 如果同时开启了 **私网地址白名单**，把电脑的局域网 IP（例如 `192.168.1.10`）或 `192.168.0.0/16` 加入允许列表。
3. 保存并重启酒馆服务。

如果代理不可用，PC / 队列页会显示 403 提示；这时也可以在画坊高级参数里关闭“通过酒馆服务端代理请求”，改为浏览器直连（需要目标允许 CORS）。

### 手动安装

SillyDroid 的扩展目录是：

```text
/data/data/com.jm.sillydroid/files/extensions
```

把整个 `image-studio` 文件夹放进去，刷新酒馆即可。PC 版酒馆对应目录是：

```text
SillyTavern/data/<用户名>/extensions/third-party/image-studio
```

## ComfyUI 局域网设置

手机上的 `127.0.0.1:8188` 指向手机自己，不是电脑。必须让 ComfyUI 监听局域网地址。

### 绘世启动器

高级选项 → 网络设置 → 监听设置：

- 监听地址：`0.0.0.0`
- 监听端口：`8188`
- 打开 **开放远程连接**

保存后重新启动。Windows 防火墙需要允许 Python / ComfyUI 的 8188 端口入站（网络类型选“专用”）。

### 画坊里连接

PC / 队列 → 地址填电脑的局域网 IP：

```text
http://192.168.1.10:8188
```

点 **检测并读取模型**。成功后 Checkpoint 下拉会出现模型列表。

要点：

- 不要填 `127.0.0.1` 或 `localhost`（那是手机自己）。
- 手机和电脑要在同一个 Wi-Fi；如果电脑开了热点，填热点的网关地址。
- WebSocket 进度是直连 ComfyUI 的；HTTP 数据和图片走酒馆代理。
- 如果 ComfyUI 只监听 `127.0.0.1`，HTTP 可能通但 WebSocket 会被 ComfyUI 的 origin 检查拒绝，表现为“执行中（无实时进度）”。

## 云端生图

API 页 → **生图 API** → 添加。

| 类型 | 适用 |
| --- | --- |
| OpenAI 兼容中转 | new-api / one-api / 硅基流动 / 火山方舟等 `/v1/images/generations` |
| OpenAI 官方 | `api.openai.com`，gpt-image-1 / dall-e-3 |
| Google Gemini / Imagen | `generateContent` 与 Imagen `predict` |
| xAI | `api.x.ai` 的图片接口 |
| 自定义请求 | 自己填 URL、方法、请求体、返回路径 |

多数中转只需要填 Base URL 和 Key，例如：

```text
Base URL: https://api.siliconflow.cn/v1
模型:      Kwai-Kolors/Kolors
```

云端 API 的负面提示词和 seed 只会对 **OpenAI 兼容中转** 默认发送；其他接口请用“固定额外请求体 JSON”补充模型专属参数。OpenAI 官方 DALL·E 3 的 `n` 必须为 1。

## 余额查询

API 卡片的余额徽章点击即查，结果缓存 5 分钟。支持：

- OpenAI / 多数 one-api 中转的 `/v1/dashboard/billing/*`
- New API `/api/user/self`（需要访问令牌，显示原始额度单位）
- DeepSeek `/user/balance`
- OpenRouter `/api/v1/credits`
- 硅基流动 `/v1/user/info`
- Moonshot `/v1/users/me/balance`
- 自定义 URL + JSON 字段路径

上游没有开放余额接口时会显示“余额不可用”，不会影响生图。

## 聊天 API

聊天档案用于两件事：

1. **AI 改写提示词**：在生成页点“AI 改写”，选择“画坊聊天档案”。
2. **切换酒馆聊天 API**：API 页 → 聊天 API → 应用。会调用酒馆自身的 `/api`、`/api-url`、`/model`、`/secret-id` 逻辑，写入酒馆的密钥并切换当前模型。

也可直接使用 **酒馆当前聊天 API** 做改写（`generateRaw`），不依赖画坊聊天档案。改写只会在点击按钮时发一次请求，默认不自动触发。

Gemini / Claude / OpenAI 官方等固定域名的档案，Base URL 仅用于画坊自己调用；应用为酒馆聊天 API 时，酒馆会使用它自己的官方端点。

## 提示词宏

在正/负面提示词里可以使用：

| 宏 | 内容 |
| --- | --- |
| `{{charDescription}}` / `{{charAppearance}}` | 当前角色卡描述 |
| `{{charPersonality}}` | 角色性格 |
| `{{charScenario}}` | 场景 |
| `{{charName}}` / `{{userName}}` | 角色 / 用户名字 |
| `{{persona}}` | 当前用户设定 |
| `{{scene}}` / `{{recentMessages}}` | 最近几条聊天 |
| `{{lastMessage}}` / `{{lastUserMessage}}` | 最近一条角色 / 用户消息 |
| `{{firstMessage}}` | 角色开场白 |

酒馆原生宏（`{{char}}`、`{{user}}`、`{{date}}` 等）仍会继续展开。

## 自定义 ComfyUI 工作流

1. 在 ComfyUI 里搭好工作流。
2. 菜单 → **导出（API 格式）**，保存 JSON。
3. 画坊高级参数 → 工作流选“自定义 API 工作流” → 选择文件或粘贴 JSON → 检查。

两种写法：

### 占位符（推荐，最可控）

把需要替换的输入改成这些字符串：

```text
%positive% %negative% %seed% %steps% %cfg% %width% %height%
%batch% %checkpoint% %sampler% %scheduler% %denoise% %scale% %vae%
```

例如：

```json
"text": "%positive%",
"seed": "%seed%",
"width": "%width%"
```

### 自动识别

没有占位符时，开启“自动识别节点”，会尽量绑定：

- KSampler 的 seed / steps / cfg / sampler / scheduler / denoise
- KSampler positive / negative 链路指向的 CLIPTextEncode
- EmptyLatentImage 的 width / height / batch
- CheckpointLoaderSimple 的 ckpt_name
- SaveImage 的 filename_prefix

复杂工作流（多采样阶段、ControlNet、IPAdapter 等）建议用占位符，避免自动绑定猜错。UI 格式的工作流不适用，必须导出 API 格式。

## 数据与隐私

- 图片生成后会保存到酒馆用户目录的 `user/images/image-studio/`，可在酒馆里继续使用。
- API Key 存在酒馆的扩展设置（`settings.json`）里，和酒馆其他 API Key 同级；不要公开分享 `settings.json`。
- 画坊没有遥测、上传或第三方统计。请求只发往你配置的 ComfyUI / API 地址。
- 云端接口的请求会经过酒馆服务端 `/proxy/`；酒馆会剥离 Cookie、Origin 等头，但会转发 Authorization。
- 安全报告方式和密钥注意事项见 [SECURITY.md](SECURITY.md)。

## 已知限制

- 云端接口差异很大；OpenAI 兼容路径适配最好，Gemini / Imagen / xAI 已按公开接口实现。
- 余额接口需要上游开放；部分中转只允许网页登录态查询，API Key 查询会失败。
- ComfyUI 实时预览取决于启动参数 `--preview-method` 和模型；没有预览帧时会显示“等待预览帧”。
- 如果 ComfyUI 的 WebSocket 被网络设备阻断，进度会退化为轮询，只能显示“执行中”和队列状态。
- 扩展按 SillyTavern 1.18 的公开扩展 API 编写；酒馆后续版本若有 API 变更，需要同步适配。

## 开发与验证

- 目标环境：SillyTavern 1.18.0，SillyDroid Android 宿主。
- 已在 ST 1.18 + 本地真实 ComfyUI 0.43.2（NVIDIA 6 GB 级移动显卡）上验证连接、模型读取、出图、保存；并用模拟服务覆盖 WebSocket 进度、预览帧、队列、取消、云端 OpenAI / Gemini / Imagen / 自定义接口、余额和聊天切换。
- 纯逻辑模块有 Node 测试；本地运行 `npm run check && npm test`，GitHub Actions 也会执行同样的检查。涉及真实浏览器/酒馆 UI 的交互仍需人工验收。
- 无构建步骤，原生 ES Module + CSS；文件结构：

```text
manifest.json
index.js
style.css
src/
  ui.js         面板与交互
  jobs.js       ComfyUI / 云端任务调度
  comfy.js      ComfyUI HTTP + WebSocket
  workflow.js   工作流生成与自定义绑定
  providers.js  云端生图适配
  balance.js    余额查询
  chat.js       聊天 API / 提示词改写
  prompt.js     宏与提示词构建
  history.js    图库 / 背景 / 插入聊天
  store.js      设置持久化
```

## License

本扩展自身代码以 MIT 发布。SillyTavern 本体为 AGPL-3.0；本项目只在运行时调用其公开前端模块，不包含 SillyTavern 源码。
