# Changelog

## 0.5.2 — 2026-10-31

- 修复角色库“扫描候选”在安卓端左侧被超宽复选框占满、右侧设定信息被挤成单字竖排的问题。
- 面板通用输入框宽度规则不再作用于 checkbox / radio，候选勾选框恢复原生尺寸；候选正文占满剩余宽度。
- 增加对应的 CSS 回归测试。

## 0.5.1 — 2026-10-31

- 安卓窄屏适配：按钮、徽章和操作链接不再被压成逐字竖排；空间不足时整枚按钮换行。
- 酒馆连接配置改为两段式布局（名称/模型 + 操作），窄屏下操作自动落到下一行。
- 标题栏、字段标题行、API 卡片头、任务状态行、扫描结果和操作按钮组支持换行。
- 面板启用 `text-size-adjust: 100%`，避免安卓字体放大把布局挤成窄列；≤380px 时三列参数改为两列并收紧内边距。

## 0.5.0 — 2026-10-31

- 新增“插件内部模型”独立链路：场景提取、角色挑选和提示词改写不再只能占用酒馆聊天 API，可跟随当前 API、使用画坊聊天档案，或使用酒馆连接配置。
- API 页新增“插件内部模型”卡片：模式、聊天档案/连接配置、附带最近消息数（0–20）；聊天档案卡片可一键“设为插件模型”并显示徽章。
- 插件请求由画坊拼装“目标消息 + 最近 N 条消息 + 角色库 + 当前角色卡字段”；消息生图按目标消息位置向前取上下文。酒馆预设可能自行再带上下文。
- 独立链路下禁用“酒馆当前预设”，自动改用内置/自定义系统提示词，并在界面说明实际来源；不会切换或修改酒馆聊天 API。
- 迁移旧版 `rewriteMode` / `rewriteProfileId` / `rewriteConnectionProfileId` 设置。
- 修复角色库页签无法切换的问题（页签白名单遗漏 `library`）。
- 测试增至 50 项，覆盖插件模型迁移、路由解析和上下文裁剪。

## 0.4.0 — 2026-10-31

- 每条角色消息都可独立生图，不再只限最后一条。
- 新增角色库页签：扫描当前角色卡、主/聊天世界书、用户设定候选，确认后保存到角色卡；支持外貌、服装、别名和参考图。
- 消息生图新增二次确认：AI 提取场景/选择角色后，用户可编辑提示词、勾选角色、预览参考图和最终提示词再生成。
- 最终提示词会追加选中角色的外貌/服装，提升文字层面的角色一致性。
- 新增可拖动像素黑猫悬浮窗，显示后台进度、停止和最近缩略图；右侧面板保留。

## 0.3.1 — 2026-10-31

- 消息生图互斥与取消状态完善；按钮在任务结束后正确恢复。
- 手动 AI 改写也会把最后一条角色消息作为目标场景，提高抽取准确度。
- 删除消息后停止恢复旧缩略图，避免图片错位到其他消息。

## 0.3.0 — 2026-10-31

- 最后一条角色消息的操作栏新增“画坊”生图按钮；后台生成，不阻塞聊天。
- 生成结果以消息下方的小缩略图呈现，点击打开大图；记录关联消息与聊天，重新渲染/刷新后可恢复。
- 提示词改为以“目标消息”为焦点，从最近对话、角色卡和场景中抽取当前画面，而不是泛泛总结聊天。
- 消息生图会优先调用当前系统提示词设置（酒馆预设/内置/自定义）做场景提取，失败时回退到角色外观 + 消息原文。
- 消息任务支持取消、错误状态和“已有任务”互斥。

## 0.2.3 — 2026-10-31

- 修复 xAI `resolution` 枚举大小写：改为接口要求的 `1k` / `2k`（此前发了 `1K` / `2K`，触发 HTTP 422）。

## 0.2.2 — 2026-10-30

- 修复 xAI Grok 生图因 `size` 参数被拒绝的问题：xAI 单独构造请求体，不再发送 OpenAI 风格 `size`。
- `grok-imagine-*` 使用 `aspect_ratio` + `resolution`（1K/2K）；旧版 `grok-2-image` 只发 prompt/model/n/response_format。
- xAI 默认模型更新为 `grok-imagine-image`，并在界面提示尺寸适配方式。

## 0.2.1 — 2026-10-30

- AI 改写支持系统提示词来源：酒馆当前预设（含角色上下文与常规输出处理）、画坊内置、自定义文本框。
- 默认使用酒馆当前预设，解决自定义 system prompt 绕开用户预设的问题。
- 自定义文本编辑后自动切换为自定义来源；支持一键恢复内置。

## 0.2.0 — 2026-10-30

- API 档案支持自动获取模型列表，并按语言 / 图像 / 视频 / 音频 / 嵌入分类、搜索和选择。
- 新增 Android 端局域网扫描 ComfyUI：可从上次地址或手机网段探测 8188 端口，支持停止和直接使用结果。
- ComfyUI 连接改为“一键连接”，成功后自动缓存模型并记住扫描前缀/端口。

## 0.1.1 — 2026-10-30

- Privacy pass: removed the author's LAN IP and specific GPU model from documentation; examples are now generic.
- Added an explicit AI-assisted / personal beta status and maintenance expectations.
- Removed dead code and unused imports.
- Added Node unit tests, syntax checks, GitHub Actions CI, issue templates, SECURITY.md and CONTRIBUTING.md.
- Added a short note on MIT/AGPL boundaries with SillyTavern.

## 0.1.0 — 2026-10-30

- Initial public beta for SillyTavern 1.18 / SillyDroid.
- Local ComfyUI LAN support with model discovery, queue, WebSocket progress, live preview, cancel and history.
- Simple workflow builder (checkpoint, sampler, VAE, LoRA, hires) and custom API-format workflow import with placeholders/auto-bind.
- Cloud image providers: OpenAI-compatible, OpenAI, Gemini/Imagen, xAI, custom request template.
- Image/chat profile manager, provider tests, balance presets, and chat profile apply.
- Prompt macros, optional AI rewrite via current SillyTavern API / chat profile / connection profile.
- Image history, save to SillyTavern gallery, background and chat insertion.
- Unit tests, syntax checks and CI.
