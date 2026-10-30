# 画坊 · Image Studio

仓库：<https://github.com/FloatingPlume/SillyTavern-image-studio>

SillyTavern 1.18+ 的图像生成与 API 管理扩展。一个面板里同时管理本地 ComfyUI、云端生图 API、聊天 API、余额和生成记录。

> **状态：个人自用 beta，AI 辅助开发。**
> 本项目的需求、代码和测试脚本由作者与 AI 协作完成，作者负责在真实 SillyTavern / ComfyUI 环境验证与维护。它不是生产级商业插件，不承诺所有云端上游都一次适配成功；欢迎 issue 和 PR，但不保证即时响应。如果你所在社区禁止 AI 辅助内容，请不要在该社区发布或推荐本项目。

## 功能

- **本地 ComfyUI**：记住上次地址并自动检测；支持从手机扫描局域网发现 ComfyUI；实时显示 GPU / 显存 / 内存 / ComfyUI 版本、队列、WebSocket 进度、节点状态和实时预览帧。
- **透明请求**：生成前可展开查看实际发送的正/负面提示词、seed、尺寸、采样器、最终 API 工作流 JSON。
- **内置工作流**：Checkpoint / Sampler / Scheduler / VAE / LoRA / 高清修复（潜空间放大再采样）/ 批量。
- **自定义工作流**：粘贴 ComfyUI 导出的 API 格式 JSON；支持占位符，或自动识别 Checkpoint、KSampler、CLIPTextEncode、EmptyLatentImage、SaveImage 节点。
- **云端生图**：OpenAI 兼容中转、OpenAI 官方、Google Gemini / Imagen、xAI，以及可自由填写 URL / 请求体 / 返回路径的自定义接口。
- **API 管理**：多套生图与聊天档案、连接测试、自动获取模型列表、按语言 / 图像 / 视频 / 语音 / 嵌入分类筛选、Key 管理、余额查询（上游支持时）。
- **聊天 API 切换**：一键把聊天档案应用到酒馆（OpenAI 兼容 / OpenAI / Gemini / Claude / OpenRouter / xAI），自动写入酒馆密钥并切换模型。
- **提示词**：手写 + 宏；可选 AI 改写（默认关闭，点一次才发一次请求），支持“酒馆当前预设 / 画坊内置 / 自定义系统提示词”三种来源。
- **消息级生图**：最后一条角色消息操作栏有“画坊”按钮；点击后在后台按该消息抽取场景并生成，结果显示为消息下方的小缩略图，点击放大。
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

在 SillyDroid 的设置里（不是“APP设置”页）：

1. 打开 **SillyDroid 设置** → 顶部切到 **酒馆设置** 页签。
2. 向下滚动到 **代理与跨域** 分组，打开 **启用 CORS 代理**（它的说明文字就是“让服务端充当跨域代理”）。
3. 如果需要私网白名单：在同一页的 **单点登录与主机限制** 分组里打开 **启用私网地址白名单**，再在 **允许的私网地址段** 里加入电脑的局域网 IP（例如 `192.168.1.10`）或 `192.168.0.0/16`。
4. 保存后按页面提示重启酒馆服务。

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

点 **一键连接**。成功后会自动读取 Checkpoint、采样器和模型列表；以后打开扩展会优先尝试上次地址。

第一次找不到电脑时，可以点 **扫描局域网**：

- 扫描前缀填手机所在网段，例如 `192.168.1`；如果之前连接过，画坊会自动从地址里带出前缀。
- 画坊会通过酒馆服务端代理，向该网段 `1-254` 的 8188 端口各发一次轻量探测，找到后可直接点“使用”连接。
- 扫描是手动触发的，不会在后台自动跑；扫描期间可以点“停止扫描”。
- 如果自动识别不到手机网段（部分浏览器会隐藏本地 IP），手动填前三段即可。

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
| xAI | `grok-imagine-image` / `grok-2-image`；Grok 不接受 OpenAI 的 `size`，画坊改用 `aspect_ratio` / `resolution` |
| 自定义请求 | 自己填 URL、方法、请求体、返回路径 |

保存或点“获取模型”后，画坊会自动读取该 API 的 `/models`（支持的上游），并按名称分类：

- 语言模型
- 图像模型
- 视频模型
- 语音 / 音频
- 向量 / 嵌入
- 其他

模型列表支持分类筛选、搜索和点击选择。自定义图片接口没有统一模型列表，需要手动填写模型名。

多数中转只需要填 Base URL 和 Key，例如：

```text
Base URL: https://api.siliconflow.cn/v1
模型:      Kwai-Kolors/Kolors
```

云端 API 的负面提示词和 seed 只会对 **OpenAI 兼容中转** 默认发送；其他接口请用“固定额外请求体 JSON”补充模型专属参数。OpenAI 官方 DALL·E 3 的 `n` 必须为 1。

**xAI 特别注意：** xAI 的图片接口不接受 OpenAI 风格的 `size`。画坊对 `grok-imagine-*` 会发送 `aspect_ratio` 和 `resolution`（`1k`/`2k`），对旧版 `grok-2-image` 不发送尺寸参数，只保留 `n` / `response_format`。所以界面里的宽高只影响 Grok Imagine 的构图比例，不是精确像素尺寸。

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

## AI 改写的系统提示词

生成页 → AI 改写 → “系统提示词”有三种来源：

- **酒馆当前预设**（默认）：通过酒馆的 quiet generation 调用当前聊天 API，使用你当前预设里的系统提示词、角色上下文和常规输出处理；这个模式会强制走酒馆当前 API。
- **画坊内置**：使用内置的视觉提示词规范，不依赖你当前的聊天预设；可以直接在下方文本框里改，改完会自动切换为“自定义”。
- **自定义**：留了一个文本框，可以粘贴你自己的系统提示词/角色设定。是否被上游接受取决于模型和服务商策略。

内置模板只是图像提示词规范，不是通用破限模板；如果敏感场景被上游拒绝，优先使用你已经在酒馆里工作的预设或换成允许该内容的上游/本地模型。

## 从对话消息生图

角色回复结束时，最后一条角色消息的操作栏会多出一个 **画坊** 魔杖按钮：

1. 点击后画坊把“这条消息”作为目标画面，结合最近对话、角色卡描述、场景和当前系统提示词设置提取视觉提示词。
2. 优先使用你选择的系统提示词来源（默认酒馆当前预设）；如果聊天 API 不可用或提取失败，会回退到“角色外观 + 消息原文”。
3. 生图在后台执行，不阻塞继续聊天；面板里的进度/取消也会同步。
4. 结果以消息下方约 58px 的小缩略图出现，点击打开大图；图片同时进入画坊记录和酒馆图库。
5. 记录关联了消息和聊天；刷新页面后会尽量恢复缩略图。消息被编辑/滑动/删除后，对应旧缩略图会被清除，避免显示过期画面。

消息生图会额外消耗一次聊天请求用于场景提取；如果不想多这一次请求，可以先把系统提示词切到“画坊内置”，或者直接使用生成页手动写提示词。

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
- 局域网扫描依赖酒馆服务端跨域代理和同一网段；扫描最多会向本网段 254 个地址发一次轻量请求，只在手动点击时执行。
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
