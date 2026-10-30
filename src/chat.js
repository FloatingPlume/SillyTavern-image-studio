import { CHAT_TYPES } from './constants.js';
import { chatEndpoint, parseExtraBody, parseHeaders, v1Base } from './providers.js';
import { makeAuthHeaders, request } from './net.js';
import { ctx } from './util.js';

const SECRET_KEYS = {
    openai: 'api_key_openai',
    'openai-compatible': 'api_key_custom',
    gemini: 'api_key_makersuite',
    claude: 'api_key_claude',
    openrouter: 'api_key_openrouter',
    xai: 'api_key_xai',
};

const CONNECT_NAMES = {
    openai: 'openai',
    'openai-compatible': 'custom',
    gemini: 'google',
    claude: 'claude',
    openrouter: 'openrouter',
    xai: 'xai',
};

const DEFAULT_BASES = {
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    claude: 'https://api.anthropic.com',
    openrouter: 'https://openrouter.ai/api/v1',
    xai: 'https://api.x.ai/v1',
};

export function defaultChatProfile(type = 'openai-compatible') {
    const meta = CHAT_TYPES.find(item => item.id === type) || CHAT_TYPES[0];
    return {
        kind: 'chat',
        type: meta.id,
        name: meta.label,
        baseUrl: meta.defaultBase,
        apiKey: '',
        model: meta.defaultModel,
        headers: '{}',
        extraBody: '{}',
        balancePreset: 'auto',
        createdAt: Date.now(),
    };
}

function geminiBase(raw) {
    const base = String(raw || '').trim().replace(/\/+$/, '');
    return /\/v1beta$/i.test(base) ? base : `${base}/v1beta`;
}

function claudeBase(raw) {
    return String(raw || DEFAULT_BASES.claude).trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function modelsEndpoint(profile) {
    const base = String(profile.baseUrl || '').trim().replace(/\/+$/, '');
    if (profile.type === 'gemini') return `${geminiBase(base)}/models`;
    if (profile.type === 'claude') return `${claudeBase(base)}/v1/models`;
    if (profile.type === 'openrouter') return `${base || DEFAULT_BASES.openrouter}/models`;
    return `${v1Base(base)}/models`;
}

function claudeHeaders(profile) {
    return {
        'x-api-key': profile.apiKey || '',
        'anthropic-version': '2023-06-01',
        ...parseHeaders(profile.headers),
    };
}

async function chatCompleteOpenAI(profile, messages, options = {}) {
    const extra = parseExtraBody(profile.extraBody);
    const body = {
        model: profile.model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 600,
        stream: false,
        ...extra,
    };
    const headers = {
        ...makeAuthHeaders(profile.apiKey),
        ...parseHeaders(profile.headers),
        ...(profile.type === 'openrouter' ? { 'HTTP-Referer': location.origin, 'X-Title': 'Image Studio' } : {}),
    };
    const payload = await request(chatEndpoint(profile), {
        method: 'POST',
        headers,
        body,
        timeout: 180_000,
        signal: options.signal,
    });
    if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content ?? choice?.text ?? payload?.output_text;
    if (Array.isArray(content)) {
        return content.map(part => part?.text || part?.content || '').join('');
    }
    return String(content || '');
}

async function chatCompleteClaude(profile, messages, options = {}) {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
    const userMessages = messages.filter(message => message.role !== 'system').map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || ''),
    }));
    const extra = parseExtraBody(profile.extraBody);
    const payload = await request(`${claudeBase(profile.baseUrl)}/v1/messages`, {
        method: 'POST',
        headers: claudeHeaders(profile),
        body: {
            model: profile.model,
            max_tokens: options.maxTokens ?? 600,
            temperature: options.temperature ?? 0.7,
            system,
            messages: userMessages,
            ...extra,
        },
        timeout: 180_000,
        signal: options.signal,
    });
    if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return (payload?.content || []).map(part => part?.text || '').join('');
}

async function chatCompleteGemini(profile, messages, options = {}) {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
    const contents = messages
        .filter(message => message.role !== 'system')
        .map(message => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(message.content || '') }],
        }));
    const extra = parseExtraBody(profile.extraBody);
    const payload = await request(`${geminiBase(profile.baseUrl)}/models/${encodeURIComponent(profile.model)}:generateContent`, {
        method: 'POST',
        headers: {
            ...(profile.apiKey ? { 'x-goog-api-key': profile.apiKey } : {}),
            ...parseHeaders(profile.headers),
        },
        body: {
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: {
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens ?? 700,
                ...(extra.generationConfig || {}),
            },
            ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'generationConfig')),
        },
        timeout: 180_000,
        signal: options.signal,
    });
    if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    return (payload?.candidates?.[0]?.content?.parts || []).map(part => part?.text || '').join('');
}

export async function chatComplete(profile, messages, options = {}) {
    if (!profile) throw new Error('没有选择聊天 API');
    if (!profile.model) throw new Error('聊天 API 没有填写模型');
    switch (profile.type) {
        case 'claude':
            return chatCompleteClaude(profile, messages, options);
        case 'gemini':
            return chatCompleteGemini(profile, messages, options);
        case 'openai':
        case 'openai-compatible':
        case 'openrouter':
        case 'xai':
            return chatCompleteOpenAI(profile, messages, options);
        default:
            throw new Error(`不支持的聊天接口类型：${profile.type}`);
    }
}

export async function testChatProfile(profile) {
    if (profile.type === 'claude') {
        const payload = await request(modelsEndpoint(profile), {
            headers: claudeHeaders(profile),
            timeout: 20_000,
        });
        return (payload?.data || []).map(item => item.id).filter(Boolean);
    }
    const headers = {
        ...makeAuthHeaders(profile.apiKey),
        ...parseHeaders(profile.headers),
        ...(profile.type === 'gemini' && profile.apiKey ? { 'x-goog-api-key': profile.apiKey } : {}),
    };
    const payload = await request(modelsEndpoint(profile), { headers, timeout: 20_000 });
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    return list.map(item => typeof item === 'string' ? item : (item.id || item.name || ''))
        .map(name => String(name).replace(/^models\//, ''))
        .filter(Boolean);
}

export function currentChatConfig() {
    const context = ctx();
    if (!context) return null;
    const settings = context.chatCompletionSettings || {};
    let source = String(settings.chat_completion_source || '');
    let model = '';
    try {
        model = String(context.getChatCompletionModel?.() || '');
    } catch { /* ignore */ }
    model = model || String(settings.custom_model || settings.openai_model || settings.claude_model || settings.google_model || '');
    let type = 'openai-compatible';
    let apiKeyUrl = '';
    switch (source) {
        case 'openai': type = 'openai'; apiKeyUrl = 'https://api.openai.com/v1'; break;
        case 'custom': type = 'openai-compatible'; apiKeyUrl = settings.custom_url || ''; break;
        case 'claude': type = 'claude'; apiKeyUrl = 'https://api.anthropic.com'; break;
        case 'makersuite': type = 'gemini'; apiKeyUrl = 'https://generativelanguage.googleapis.com/v1beta'; break;
        case 'openrouter': type = 'openrouter'; apiKeyUrl = 'https://openrouter.ai/api/v1'; break;
        case 'xai': type = 'xai'; apiKeyUrl = 'https://api.x.ai/v1'; break;
        default: apiKeyUrl = settings.custom_url || '';
    }
    return {
        mainApi: context.mainApi,
        source,
        model,
        type,
        baseUrl: apiKeyUrl,
        preset: settings.preset_settings_openai || '',
        proxy: settings.reverse_proxy || '',
    };
}

export function importCurrentChatProfile() {
    const current = currentChatConfig();
    if (!current) throw new Error('读取酒馆配置失败');
    const meta = CHAT_TYPES.find(item => item.id === current.type) || CHAT_TYPES[0];
    return {
        ...defaultChatProfile(current.type),
        name: `酒馆 · ${current.model || meta.label}`,
        baseUrl: current.baseUrl || meta.defaultBase,
        model: current.model || meta.defaultModel,
        apiKey: '',
        importedFrom: 'sillytavern',
    };
}

async function callSlashCommand(name, args, value) {
    const context = ctx();
    const command = context?.SlashCommandParser?.commands?.[name];
    if (command?.callback) {
        return await command.callback(args || {}, value ?? '');
    }
    const text = value == null ? `/${name}` : `/${name} ${value}`;
    return await context.executeSlashCommandsWithOptions(text, {
        handleParserErrors: false,
        handleExecutionErrors: true,
    });
}

export async function applyChatProfile(profile) {
    if (!profile) throw new Error('没有选择聊天档案');
    const context = ctx();
    if (!context) throw new Error('酒馆未就绪');
    const connectName = CONNECT_NAMES[profile.type] || 'custom';
    const secretKey = SECRET_KEYS[profile.type];

    if (profile.type === 'openai-compatible') {
        const baseUrl = String(profile.baseUrl || '').trim();
        if (!baseUrl) throw new Error('OpenAI 兼容档案需要填写 Base URL');
        context.chatCompletionSettings.custom_url = baseUrl;
        if (globalThis.$) {
            $('#custom_api_url_text').val(baseUrl).trigger('input');
        }
    }

    let secretId = null;
    if (profile.apiKey && secretKey) {
        try {
            const secrets = await import('/scripts/secrets.js');
            secretId = await secrets.writeSecret(secretKey, profile.apiKey, `画坊 · ${profile.name}`);
        } catch (error) {
            console.warn('[画坊] 写入酒馆密钥失败', error);
        }
    }

    if (secretId) {
        await callSlashCommand('secret-id', { quiet: 'true', key: secretKey }, secretId);
    }

    await callSlashCommand('api', { quiet: 'true' }, connectName);

    if (profile.type === 'openai-compatible' && profile.baseUrl) {
        await callSlashCommand('api-url', { api: 'custom', connect: 'false', quiet: 'true' }, profile.baseUrl);
    }

    if (profile.model) {
        await callSlashCommand('model', { quiet: 'true' }, profile.model);
    }

    context.saveSettingsDebounced?.();
    const after = currentChatConfig();
    return {
        ...after,
        applied: true,
        sourceMatched: after?.source === context.chatCompletionSettings?.chat_completion_source,
    };
}

export function listConnectionProfiles() {
    const context = ctx();
    const profiles = context?.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        mode: profile.mode,
        api: profile.api,
        model: profile.model,
        apiUrl: profile['api-url'],
    }));
}

export async function switchConnectionProfile(name) {
    return callSlashCommand('profile', { await: 'true', timeout: '2500' }, name);
}

export async function rewriteWithConnectionProfile(profileId, messages, maxTokens = 600) {
    const shared = await import('/scripts/extensions/shared.js');
    if (!shared?.ConnectionManagerRequestService) throw new Error('酒馆没有加载连接管理器扩展');
    const result = await shared.ConnectionManagerRequestService.sendRequest(
        profileId,
        messages,
        maxTokens,
        { stream: false, includePreset: false, includeInstruct: false, extractData: true },
    );
    if (typeof result === 'string') return result;
    return result?.content || result?.text || result?.message?.content || '';
}

export async function rewriteWithCurrentApi(messages, maxTokens = 700) {
    const context = ctx();
    if (!context?.generateRaw) throw new Error('当前酒馆版本不支持 generateRaw');
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
    const prompt = messages.filter(message => message.role !== 'system').map(message => message.content).join('\n\n');
    return await context.generateRaw({
        prompt,
        systemPrompt: system,
        responseLength: maxTokens,
        quietToLoud: false,
    });
}
