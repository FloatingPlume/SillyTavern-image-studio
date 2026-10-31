import { CLOUD_IMAGE_TYPES } from './constants.js';
import { base64ToBlob, getByPath, parseJsonLoose } from './util.js';
import { fetchImageBlob, makeAuthHeaders, request } from './net.js';

function trimBase(raw) {
    return String(raw || '').trim().replace(/\/+$/, '');
}

export function v1Base(raw) {
    const base = trimBase(raw);
    if (!base) throw new Error('请填写 API Base URL');
    if (/\/v1$/i.test(base)) return base;
    if (/\/v1\//i.test(base)) return base;
    return `${base}/v1`;
}

function imagesEndpoint(profile) {
    const base = trimBase(profile.baseUrl);
    if (!base) throw new Error('请填写 API Base URL');
    if (/\/images\/generations\/?$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/images/generations`;
    if (/\/v1\//i.test(base)) return `${base.replace(/\/+$/, '')}/images/generations`;
    return `${base}/v1/images/generations`;
}

function editsEndpoint(profile) {
    const base = trimBase(profile.baseUrl);
    if (!base) throw new Error('请填写 API Base URL');
    if (/\/images\/edits\/?$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/images/edits`;
    if (/\/v1\//i.test(base)) return `${base.replace(/\/+$/, '')}/images/edits`;
    return `${base}/v1/images/edits`;
}

export function chatEndpoint(profile) {
    const base = trimBase(profile.baseUrl);
    if (!base) throw new Error('请填写 API Base URL');
    if (/\/chat\/completions\/?$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
    if (/\/v1\//i.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
}

function modelsEndpoint(profile) {
    const base = trimBase(profile.baseUrl);
    if (profile.type === 'gemini') {
        const geminiBase = /\/v1beta$/i.test(base) ? base : `${base}/v1beta`;
        return `${geminiBase}/models`;
    }
    if (/\/models\/?$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/models`;
    return `${base}/v1/models`;
}

export function parseExtraBody(text) {
    if (!text || !String(text).trim()) return {};
    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('额外参数必须是 JSON 对象');
    }
    return parsed;
}

export function parseHeaders(text) {
    if (!text || !String(text).trim()) return {};
    const parsed = parseJsonLoose(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('额外请求头必须是 JSON 对象');
    }
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function sniffMime(blob, fallback = 'image/png') {
    if (blob?.type && blob.type !== 'application/octet-stream') return blob.type;
    return fallback;
}

async function blobFromBase64(base64, mime = 'image/png') {
    return base64ToBlob(String(base64).replace(/-/g, '+').replace(/_/g, '/'), mime);
}

async function blobToBase64(blob) {
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let index = 0; index < buffer.length; index += 1) binary += String.fromCharCode(buffer[index]);
    return btoa(binary);
}

async function resolveImageItem(item, mimeFallback = 'image/png', signal = null) {
    if (!item) return null;
    if (typeof item === 'string') {
        if (/^https?:\/\//i.test(item)) {
            return { blob: await fetchImageBlob(item, { signal }), revisedPrompt: '' };
        }
        if (item.length > 128) {
            return { blob: await blobFromBase64(item, mimeFallback), revisedPrompt: '' };
        }
        return null;
    }
    const b64 = item.b64_json || item.b64 || item.image_base64 || item.base64 || item.bytesBase64Encoded;
    if (b64) {
        return { blob: await blobFromBase64(b64, item.mime_type || item.mimeType || mimeFallback), revisedPrompt: item.revised_prompt || item.revisedPrompt || '' };
    }
    const url = item.url || item.image_url || item.imageUrl;
    if (url) {
        const blob = await fetchImageBlob(url, { signal });
        return { blob, revisedPrompt: item.revised_prompt || item.revisedPrompt || '' };
    }
    return null;
}

function collectOpenAIItems(payload) {
    const data = payload?.data ?? payload?.images ?? payload?.output ?? payload?.result;
    if (Array.isArray(data)) return data;
    if (typeof data === 'string') return [data];
    if (data && typeof data === 'object') {
        if (Array.isArray(data.data)) return data.data;
        if (Array.isArray(data.images)) return data.images;
        return [data];
    }
    return [];
}

export function buildOpenAIImageBody(profile, params) {
    const extra = parseExtraBody(profile.extraBody);
    const model = String(params.model || profile.model || '');
    const count = Math.max(1, Number(params.count || 1));
    const width = Number(params.width || 1024);
    const height = Number(params.height || 1024);

    if (profile.type === 'xai') {
        const body = {
            model,
            prompt: params.positive,
            n: Math.min(count, /grok-imagine/i.test(model) ? 4 : 10),
            response_format: 'url',
        };
        if (/grok-imagine/i.test(model)) {
            body.aspect_ratio = sizeToAspect(width, height);
            body.resolution = Math.max(width, height) >= 1536 ? '2k' : '1k';
        }
        return { ...body, ...extra };
    }

    const body = {
        model,
        prompt: params.positive,
        n: count,
        size: `${width}x${height}`,
    };
    if (!/^gpt-image/i.test(model)) {
        body.response_format = 'b64_json';
    }
    if (profile.type === 'openai-compatible' && params.negative) {
        body.negative_prompt = params.negative;
    }
    if (profile.type === 'openai-compatible' && Number(params.seed) >= 0) {
        body.seed = Number(params.seed);
    }
    Object.assign(body, extra);
    return body;
}

async function generateOpenAI(profile, params) {
    if (params.reference?.blob) {
        return generateOpenAIEdit(profile, params);
    }
    const body = buildOpenAIImageBody(profile, params);
    const headers = {
        ...makeAuthHeaders(profile.apiKey),
        ...parseHeaders(profile.headers),
        ...(profile.type === 'openrouter' ? { 'HTTP-Referer': location.origin, 'X-Title': 'Image Studio' } : {}),
    };
    const payload = await request(imagesEndpoint(profile), {
        method: 'POST',
        headers,
        body,
        timeout: 10 * 60_000,
        signal: params.signal,
    });

    if (payload?.error) {
        throw new Error(payload.error.message || JSON.stringify(payload.error));
    }

    const items = collectOpenAIItems(payload);
    const results = [];
    for (const item of items) {
        const resolved = await resolveImageItem(item, 'image/png', params.signal);
        if (resolved) results.push({ ...resolved, mime: sniffMime(resolved.blob) });
    }
    if (results.length === 0) {
        throw new Error(`接口没有返回图片：${JSON.stringify(payload).slice(0, 500)}`);
    }
    return results;
}

async function generateOpenAIEdit(profile, params) {
    const model = String(params.model || profile.model || '');
    if (profile.type === 'xai') {
        throw new Error('xAI 生图接口没有适配参考图编辑；请改用 Gemini / OpenAI，或使用本地 ComfyUI 图生图');
    }
    if (profile.type === 'openai' && !/^gpt-image|^dall-e-2/i.test(model)) {
        throw new Error(`模型 ${model || '(未填写)'} 不支持 /images/edits；请选择 gpt-image-1 或 dall-e-2，或清除参考图`);
    }
    const form = new FormData();
    form.append('image', params.reference.blob, params.reference.filename || 'reference.png');
    form.append('prompt', params.positive || '');
    form.append('model', model);
    form.append('n', String(Math.max(1, Number(params.count || 1))));
    form.append('size', `${Number(params.width || 1024)}x${Number(params.height || 1024)}`);
    if (/^dall-e-2/i.test(model)) form.append('response_format', 'b64_json');
    const extra = parseExtraBody(profile.extraBody);
    for (const [key, value] of Object.entries(extra)) {
        if (['string', 'number', 'boolean'].includes(typeof value)) form.append(key, String(value));
    }
    const headers = {
        ...makeAuthHeaders(profile.apiKey),
        ...parseHeaders(profile.headers),
    };
    const payload = await request(editsEndpoint(profile), {
        method: 'POST',
        headers,
        body: form,
        mode: 'direct',
        timeout: 10 * 60_000,
        signal: params.signal,
    });
    if (payload?.error) {
        throw new Error(payload.error.message || JSON.stringify(payload.error));
    }
    const items = collectOpenAIItems(payload);
    const results = [];
    for (const item of items) {
        const resolved = await resolveImageItem(item, 'image/png', params.signal);
        if (resolved) results.push({ ...resolved, mime: sniffMime(resolved.blob) });
    }
    if (results.length === 0) {
        throw new Error(`图片编辑接口没有返回图片：${JSON.stringify(payload).slice(0, 500)}`);
    }
    return results;
}

function sizeToAspect(width, height) {
    const ratio = Number(width) / Number(height);
    const candidates = [
        { label: '1:1', value: 1 },
        { label: '3:4', value: 3 / 4 },
        { label: '4:3', value: 4 / 3 },
        { label: '9:16', value: 9 / 16 },
        { label: '16:9', value: 16 / 9 },
        { label: '2:3', value: 2 / 3 },
        { label: '3:2', value: 3 / 2 },
    ];
    return candidates.reduce((best, item) =>
        Math.abs(item.value - ratio) < Math.abs(best.value - ratio) ? item : best).label;
}

function geminiBase(raw) {
    const base = trimBase(raw);
    if (/\/v1beta$/i.test(base)) return base;
    if (/\/v1beta\//i.test(base)) return base.replace(/\/+$/, '');
    return `${base}/v1beta`;
}

async function generateGemini(profile, params) {
    const base = geminiBase(profile.baseUrl);
    const model = params.model || profile.model;
    if (!model) throw new Error('请填写 Gemini / Imagen 模型名');
    const extra = parseExtraBody(profile.extraBody);
    const headers = {
        ...parseHeaders(profile.headers),
        ...(profile.apiKey ? { 'x-goog-api-key': profile.apiKey } : {}),
    };
    const aspectRatio = params.aspectRatio || sizeToAspect(params.width, params.height);
    const hasReference = !!params.reference?.blob;
    if (hasReference && /^imagen/i.test(model)) {
        throw new Error('当前 Imagen 接口未适配参考图；请改用 Gemini 图像模型，或清除参考图');
    }

    if (/^imagen/i.test(model)) {
        const body = {
            instances: [{ prompt: params.positive }],
            parameters: {
                sampleCount: Number(params.count || 1),
                aspectRatio,
                ...(params.negative ? { negativePrompt: params.negative } : {}),
                ...(extra.parameters || {}),
            },
            ...extra,
        };
        const payload = await request(`${base}/models/${encodeURIComponent(model)}:predict`, {
            method: 'POST',
            headers,
            body,
            timeout: 10 * 60_000,
            signal: params.signal,
        });
        const predictions = payload?.predictions || payload?.data?.predictions || [];
        const results = [];
        for (const item of predictions) {
            const resolved = await resolveImageItem(item, 'image/png', params.signal);
            if (resolved) results.push({ ...resolved, mime: sniffMime(resolved.blob) });
        }
        if (results.length === 0) {
            const reason = payload?.raiFilteredReason || payload?.error?.message || JSON.stringify(payload).slice(0, 500);
            throw new Error(`Imagen 没有返回图片：${reason}`);
        }
        return results;
    }

    const promptText = params.negative
        ? `${params.positive}\n\nAvoid these elements: ${params.negative}`
        : params.positive;
    const generationConfig = {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(extra.generationConfig || {}),
    };
    if (params.aspectRatio || params.width !== params.height) {
        generationConfig.imageConfig = {
            ...(generationConfig.imageConfig || {}),
            aspectRatio,
        };
    }
    const parts = [{ text: promptText }];
    if (hasReference) {
        parts.push({
            inlineData: {
                mimeType: params.reference.blob.type || 'image/png',
                data: await blobToBase64(params.reference.blob),
            },
        });
    }
    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig,
        ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'generationConfig')),
    };
    let payload;
    try {
        payload = await request(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers,
            body,
            timeout: 10 * 60_000,
            signal: params.signal,
        });
    } catch (error) {
        if (error?.status === 400 && generationConfig.imageConfig) {
            delete generationConfig.imageConfig;
            payload = await request(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
                method: 'POST',
                headers,
                body,
                timeout: 10 * 60_000,
                signal: params.signal,
            });
        } else {
            throw error;
        }
    }
    const candidates = payload?.candidates || [];
    const results = [];
    let textOnly = '';
    for (const candidate of candidates) {
        for (const part of candidate?.content?.parts || []) {
            const inline = part.inlineData || part.inline_data;
            if (inline?.data) {
                const mime = inline.mimeType || inline.mime_type || 'image/png';
                const blob = await blobFromBase64(inline.data, mime);
                results.push({ blob, mime, revisedPrompt: part.text || '' });
            } else if (part.text) {
                textOnly += part.text;
            }
        }
    }
    if (results.length === 0) {
        const reason = payload?.promptFeedback?.blockReason
            || candidates[0]?.finishReason
            || payload?.error?.message
            || textOnly
            || JSON.stringify(payload).slice(0, 500);
        throw new Error(`Gemini 没有返回图片：${reason}`);
    }
    return results;
}

function renderTemplate(value, variables) {
    if (typeof value === 'string') {
        return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => variables[key] == null ? '' : String(variables[key]));
    }
    if (Array.isArray(value)) return value.map(item => renderTemplate(item, variables));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, variables)]));
    }
    return value;
}

async function generateCustom(profile, params) {
    const custom = profile.custom || {};
    const extra = parseExtraBody(profile.extraBody);
    const endpoint = custom.endpoint || profile.baseUrl;
    if (!endpoint) throw new Error('请填写自定义接口 URL');
    const referenceBase64 = params.reference?.blob ? await blobToBase64(params.reference.blob) : '';
    const variables = {
        prompt: params.positive,
        positive: params.positive,
        negative: params.negative || '',
        model: params.model || profile.model || '',
        width: params.width,
        height: params.height,
        size: `${params.width}x${params.height}`,
        seed: params.seed,
        n: params.count,
        key: profile.apiKey || '',
        reference_base64: referenceBase64,
        referenceBase64,
        referenceMime: params.reference?.blob?.type || '',
        referenceName: params.reference?.name || '',
    };
    let body = null;
    if (custom.body && String(custom.body).trim()) {
        const template = parseJsonLoose(custom.body);
        if (!template) throw new Error('自定义请求体不是有效 JSON');
        body = renderTemplate(template, variables);
    } else {
        body = {
            model: variables.model,
            prompt: variables.prompt,
            n: Number(params.count || 1),
            size: variables.size,
        };
    }
    const headers = {
        ...makeAuthHeaders(profile.apiKey),
        ...parseHeaders(profile.headers),
        ...parseHeaders(custom.headers || '{}'),
    };
    const payload = await request(endpoint, {
        method: custom.method || 'POST',
        headers,
        body,
        timeout: 10 * 60_000,
        signal: params.signal,
    });

    const path = custom.responsePath || 'data.0.b64_json';
    let raw = getByPath(payload, path);
    if (raw == null) {
        const items = collectOpenAIItems(payload);
        const results = [];
        for (const item of items) {
            const resolved = await resolveImageItem(item, 'image/png', params.signal);
            if (resolved) results.push({ ...resolved, mime: sniffMime(resolved.blob, custom.mime || 'image/png') });
        }
        if (results.length) return results;
        throw new Error(`自定义接口没有在 ${path} 找到图片：${JSON.stringify(payload).slice(0, 500)}`);
    }
    if (Array.isArray(raw)) raw = raw[0];
    const resolved = await resolveImageItem(raw, custom.mime || 'image/png', params.signal);
    if (!resolved) throw new Error('自定义接口返回的图片字段为空');
    return [{ ...resolved, mime: sniffMime(resolved.blob, custom.mime || 'image/png') }];
}

export async function generateCloudImages(profile, params) {
    if (!profile) throw new Error('没有选择生图 API');
    switch (profile.type) {
        case 'openai':
        case 'openai-compatible':
        case 'xai':
            return generateOpenAI(profile, params);
        case 'gemini':
            return generateGemini(profile, params);
        case 'custom':
            return generateCustom(profile, params);
        default:
            throw new Error(`不支持的生图接口类型：${profile.type}`);
    }
}

export async function testImageProfile(profile) {
    const headers = {
        ...makeAuthHeaders(profile.apiKey),
        ...parseHeaders(profile.headers),
        ...(profile.type === 'gemini' && profile.apiKey ? { 'x-goog-api-key': profile.apiKey } : {}),
    };
    const payload = await request(modelsEndpoint(profile), {
        headers,
        timeout: 20_000,
    });
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    const models = list
        .map(item => typeof item === 'string' ? item : (item.id || item.name || ''))
        .map(name => String(name).replace(/^models\//, ''))
        .filter(Boolean);
    const imageModels = models.filter(name => /image|imagen|dall-e|flux|kolors|seedream|qwen-image|grok.*image|stable-diffusion|sdxl/i.test(name));
    return { models, imageModels };
}

export function defaultImageProfile(type = 'openai-compatible') {
    const meta = CLOUD_IMAGE_TYPES.find(item => item.id === type) || CLOUD_IMAGE_TYPES[0];
    return {
        kind: 'image',
        type: meta.id,
        name: meta.label,
        baseUrl: meta.defaultBase,
        apiKey: '',
        model: meta.defaultModel,
        headers: '{}',
        extraBody: '{}',
        balancePreset: 'auto',
        custom: {
            endpoint: '',
            method: 'POST',
            headers: '{}',
            body: '',
            responsePath: 'data.0.b64_json',
            responseType: 'base64',
            mime: 'image/png',
        },
    };
}

