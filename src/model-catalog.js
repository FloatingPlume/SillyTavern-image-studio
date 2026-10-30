import { testChatProfile } from './chat.js';
import { testImageProfile } from './providers.js';

export const MODEL_CATEGORIES = [
    { id: 'language', label: '语言模型' },
    { id: 'image', label: '图像模型' },
    { id: 'video', label: '视频模型' },
    { id: 'audio', label: '语音 / 音频' },
    { id: 'embedding', label: '向量 / 嵌入' },
    { id: 'other', label: '其他' },
];

const RULES = [
    {
        id: 'audio',
        pattern: /(whisper|tts|speech|audio|voice|lyria|music|suno|speechify|realtime|gpt-4o-audio|omni-audio|gpt-4o-mini-tts)/i,
    },
    {
        id: 'video',
        pattern: /(veo|sora|video|kling|runway|luma|pika|hailuo|seedance|wan2|hunyuan-video|cogvideo|mochi|minimax-hailuo)/i,
    },
    {
        id: 'image',
        pattern: /(image|imagen|dall-e|dalle|flux|stable-diffusion|sdxl|sd3|sd-|kolors|seedream|seededit|cogview|qwen-image|grok.*image|gpt-image|nano-banana|ideogram|recraft|playground|midjourney|mj-|hidream|janus|photomaker|character.*portrait)/i,
    },
    {
        id: 'embedding',
        pattern: /(embedding|embed|rerank|bge-|gte-|e5-|m3e|voyage|jina-embed|text-embedding)/i,
    },
    {
        id: 'language',
        pattern: /(gpt|chatgpt|claude|gemini|grok|llama|mistral|mixtral|qwen|deepseek|kimi|moonshot|glm|chatglm|ernie|doubao|command|gemma|phi-|nemotron|hermes|dolphin|sonar|perplexity|nova|ministral|magistral|devstral|codestral|instruct|vision|llm|o1|o3|o4)/i,
    },
];

export function classifyModel(id) {
    const value = String(id || '').trim();
    if (!value) return 'other';
    for (const rule of RULES) {
        if (rule.pattern.test(value)) return rule.id;
    }
    return 'other';
}

export function modelCategoryLabel(category) {
    return MODEL_CATEGORIES.find(item => item.id === category)?.label || MODEL_CATEGORIES.at(-1).label;
}

export function normalizeModels(models) {
    return [...new Set((models || []).map(item => {
        if (typeof item === 'string') return item.trim();
        return String(item?.id || item?.name || '').trim();
    }).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function categorizeModels(models) {
    return normalizeModels(models).map(id => ({ id, category: classifyModel(id), label: modelCategoryLabel(classifyModel(id)) }));
}

export function filterModels(models, { category = 'all', query = '' } = {}) {
    const term = String(query || '').trim().toLowerCase();
    return categorizeModels(models).filter(item => {
        if (category !== 'all' && item.category !== category) return false;
        if (term && !item.id.toLowerCase().includes(term)) return false;
        return true;
    });
}

export function categoryCounts(models) {
    const counts = Object.fromEntries(MODEL_CATEGORIES.map(item => [item.id, 0]));
    for (const item of categorizeModels(models)) counts[item.category] += 1;
    return counts;
}

export function modelSummary(models) {
    const categories = categoryCounts(models);
    return MODEL_CATEGORIES
        .filter(item => categories[item.id] > 0)
        .map(item => `${item.label} ${categories[item.id]}`)
        .join(' · ');
}

export function canAutoFetchModels(profile) {
    if (!profile || profile.type === 'custom' || !profile.baseUrl) return false;
    if (profile.apiKey) return true;
    try {
        const host = new URL(profile.baseUrl).hostname;
        return host === 'localhost'
            || host.startsWith('127.')
            || host.startsWith('10.')
            || host.startsWith('192.168.')
            || /^172.(1[6-9]|2[0-9]|3[01])./.test(host);
    } catch {
        return false;
    }
}

export async function fetchProfileModels(profile) {
    if (!profile) throw new Error('没有 API 档案');
    if (profile.kind === 'image') {
        if (profile.type === 'custom') throw new Error('自定义图片接口没有统一的模型列表接口，请手动填写模型名');
        const result = await testImageProfile(profile);
        return normalizeModels(result.models);
    }
    if (profile.kind === 'chat') {
        return normalizeModels(await testChatProfile(profile));
    }
    throw new Error('未知的 API 档案类型');
}
