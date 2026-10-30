# Changelog

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
