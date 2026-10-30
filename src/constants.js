export const MODULE_NAME = 'image-studio';
export const SETTINGS_KEY = 'imageStudio';
export const PANEL_ID = 'is-panel';
export const HISTORY_LIMIT = 40;
export const BALANCE_TTL = 5 * 60 * 1000;

export const DEFAULT_REWRITE_SYSTEM = `You are a visual prompt engineer for an image generation model. Convert the given scene into a concise image prompt.
Rules:
- Describe only what can be seen: subjects, appearance, clothing, pose, expression, environment, lighting, camera, composition.
- Keep the main subject consistent with the character description provided.
- Do not write a story, dialogue, or analysis.
- No markdown, no code fences.
Return JSON only: {"positive":"...","negative":"..."}`;

export const DEFAULT_PROMPT_TEMPLATE = 'masterpiece, best quality, {{charDescription}}\n{{scene}}';
export const DEFAULT_NEGATIVE = 'lowres, bad anatomy, bad hands, bad proportions, extra digits, watermark, signature, text, logo, blurry, jpeg artifacts';

export const SIZE_PRESETS = [
    { label: '1024 × 1024 (1:1)', width: 1024, height: 1024 },
    { label: '832 × 1216 (2:3)', width: 832, height: 1216 },
    { label: '1216 × 832 (3:2)', width: 1216, height: 832 },
    { label: '896 × 1152 (3:4)', width: 896, height: 1152 },
    { label: '1152 × 896 (4:3)', width: 1152, height: 896 },
    { label: '768 × 1344 (9:16)', width: 768, height: 1344 },
    { label: '1344 × 768 (16:9)', width: 1344, height: 768 },
    { label: '512 × 512 (小图测试)', width: 512, height: 512 },
];

export const CLOUD_IMAGE_TYPES = [
    {
        id: 'openai-compatible',
        label: 'OpenAI 兼容中转',
        hint: 'new-api / one-api / 硅基流动 / 火山等，走 /v1/images/generations',
        defaultBase: '',
        defaultModel: 'gpt-image-1',
        secretKey: 'api_key_custom',
    },
    {
        id: 'openai',
        label: 'OpenAI 官方',
        hint: 'api.openai.com，支持 gpt-image-1 / dall-e-3',
        defaultBase: 'https://api.openai.com/v1',
        defaultModel: 'gpt-image-1',
        secretKey: 'api_key_openai',
    },
    {
        id: 'gemini',
        label: 'Google Gemini / Imagen',
        hint: '原生 generateContent / predict 接口',
        defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.5-flash-image',
        secretKey: 'api_key_makersuite',
    },
    {
        id: 'xai',
        label: 'xAI Grok Image',
        hint: 'api.x.ai，OpenAI 风格图片接口',
        defaultBase: 'https://api.x.ai/v1',
        defaultModel: 'grok-2-image',
        secretKey: 'api_key_xai',
    },
    {
        id: 'custom',
        label: '自定义请求',
        hint: '自己填 URL / 请求体 / 返回路径，适配非主流接口',
        defaultBase: '',
        defaultModel: '',
        secretKey: '',
    },
];

export const CHAT_TYPES = [
    {
        id: 'openai-compatible',
        label: 'OpenAI 兼容中转',
        hint: '/v1/chat/completions',
        defaultBase: '',
        defaultModel: 'gpt-4o-mini',
        secretKey: 'api_key_custom',
    },
    {
        id: 'openai',
        label: 'OpenAI 官方',
        hint: 'api.openai.com',
        defaultBase: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        secretKey: 'api_key_openai',
    },
    {
        id: 'gemini',
        label: 'Google Gemini',
        hint: 'generateContent',
        defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.5-flash',
        secretKey: 'api_key_makersuite',
    },
    {
        id: 'claude',
        label: 'Anthropic Claude',
        hint: 'api.anthropic.com',
        defaultBase: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-5',
        secretKey: 'api_key_claude',
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        hint: 'openrouter.ai',
        defaultBase: 'https://openrouter.ai/api/v1',
        defaultModel: 'google/gemini-2.5-flash',
        secretKey: 'api_key_openrouter',
    },
    {
        id: 'xai',
        label: 'xAI',
        hint: 'api.x.ai',
        defaultBase: 'https://api.x.ai/v1',
        defaultModel: 'grok-4',
        secretKey: 'api_key_xai',
    },
];

export const BALANCE_PRESETS = [
    { id: 'auto', label: '自动识别', hint: '按域名选择常见余额接口' },
    { id: 'openai-billing', label: 'OpenAI / 中转计费', hint: '/v1/dashboard/billing/*，多数 one-api 中转可用' },
    { id: 'newapi', label: 'New API 用户额度', hint: '/api/user/self，需要访问令牌' },
    { id: 'deepseek', label: 'DeepSeek', hint: '/user/balance' },
    { id: 'openrouter', label: 'OpenRouter', hint: '/api/v1/credits' },
    { id: 'siliconflow', label: '硅基流动', hint: '/v1/user/info' },
    { id: 'moonshot', label: 'Moonshot', hint: '/v1/users/me/balance' },
    { id: 'custom', label: '自定义余额接口', hint: '自己填 URL 和 JSON 路径' },
    { id: 'none', label: '不查询', hint: '该上游没有余额接口' },
];

