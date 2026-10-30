import { getByPath, parseJsonLoose, pickNumber, pickString } from './util.js';
import { getBalanceCache, isBalanceFresh, setBalanceCache } from './store.js';
import { makeAuthHeaders, request } from './net.js';

function trimBase(raw) {
    return String(raw || '').trim().replace(/\/+$/, '');
}

function rootBase(profile) {
    return trimBase(profile.baseUrl).replace(/\/v1\/?$/i, '');
}

function auth(profile, extra = {}) {
    return { ...makeAuthHeaders(profile.apiKey), ...extra };
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function billingRange() {
    return { start_date: '2024-01-01', end_date: today() };
}

export function detectBalancePreset(profile) {
    const host = (() => {
        try {
            return new URL(profile.baseUrl).hostname;
        } catch {
            return '';
        }
    })();
    if (/openrouter\.ai$/i.test(host)) return 'openrouter';
    if (/deepseek\.com$/i.test(host)) return 'deepseek';
    if (/siliconflow\.(cn|com)$/i.test(host)) return 'siliconflow';
    if (/moonshot\.(cn|ai)$/i.test(host)) return 'moonshot';
    return 'openai-billing';
}

async function queryOpenAIBilling(profile) {
    const base = rootBase(profile);
    const headers = auth(profile);
    const range = billingRange();
    const subscription = await request(`${base}/v1/dashboard/billing/subscription`, { headers, timeout: 20_000 });
    const total = pickNumber(subscription.hard_limit_usd, subscription.soft_limit_usd, subscription.system_hard_limit_usd, subscription.access_until);
    const usageUrl = `${base}/v1/dashboard/billing/usage?start_date=${range.start_date}&end_date=${range.end_date}`;
    const usage = await request(usageUrl, { headers, timeout: 20_000 });
    const cents = pickNumber(usage.total_usage);
    const used = cents != null ? cents / 100 : undefined;
    const remaining = total != null && used != null ? total - used : undefined;
    return {
        ok: true,
        preset: 'openai-billing',
        total,
        used,
        remaining,
        currency: 'USD',
        unit: '$',
        plan: pickString(subscription.plan?.title, subscription.plan?.id),
        raw: { subscription, usage },
        message: total == null ? '上游返回了用量，但没有总额度字段' : '',
    };
}

async function queryNewApi(profile) {
    const base = rootBase(profile);
    let payload;
    let lastError;
    for (const value of [`Bearer ${profile.apiKey}`, profile.apiKey]) {
        try {
            payload = await request(`${base}/api/user/self`, {
                headers: { Authorization: value },
                timeout: 20_000,
            });
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!payload) throw lastError || new Error('New API 余额查询失败');
    const data = payload.data || payload;
    const quota = pickNumber(data.quota, data.remain_quota, data.remaining_quota);
    const used = pickNumber(data.used_quota, data.used);
    const requests = pickNumber(data.request_count);
    return {
        ok: true,
        preset: 'newapi',
        remaining: quota,
        used,
        total: quota != null && used != null ? quota + used : undefined,
        currency: '',
        unit: '额度',
        plan: pickString(data.group, data.username, data.role),
        raw: payload,
        message: requests != null ? `已请求 ${requests} 次` : '额度为 New API 原始单位，不一定等于美元',
    };
}

async function queryDeepSeek(profile) {
    const base = rootBase(profile);
    const payload = await request(`${base}/user/balance`, {
        headers: auth(profile),
        timeout: 20_000,
    });
    const info = Array.isArray(payload.balance_infos) ? payload.balance_infos[0] : null;
    const remaining = pickNumber(info?.total_balance, payload.total_balance);
    const granted = pickNumber(info?.granted_balance);
    const toppedUp = pickNumber(info?.topped_up_balance);
    return {
        ok: true,
        preset: 'deepseek',
        remaining,
        total: granted != null && toppedUp != null ? granted + toppedUp : undefined,
        currency: pickString(info?.currency, payload.currency, 'CNY'),
        unit: pickString(info?.currency, 'CNY') === 'USD' ? '$' : '¥',
        plan: payload.is_available === false ? '不可用' : '可用',
        raw: payload,
        message: '',
    };
}

async function queryOpenRouter(profile) {
    const base = /openrouter\.ai$/i.test(new URL(profile.baseUrl || 'https://openrouter.ai').hostname)
        ? 'https://openrouter.ai/api/v1'
        : `${rootBase(profile)}/api/v1`;
    const payload = await request(`${base}/credits`, {
        headers: auth(profile),
        timeout: 20_000,
    });
    const data = payload.data || payload;
    const total = pickNumber(data.total_credits);
    const used = pickNumber(data.total_usage);
    return {
        ok: true,
        preset: 'openrouter',
        total,
        used,
        remaining: total != null && used != null ? total - used : undefined,
        currency: 'USD',
        unit: '$',
        plan: '',
        raw: payload,
        message: '',
    };
}

async function querySiliconFlow(profile) {
    const base = rootBase(profile);
    const payload = await request(`${base}/v1/user/info`, {
        headers: auth(profile),
        timeout: 20_000,
    });
    const data = payload.data || payload;
    const remaining = pickNumber(data.totalBalance, data.balance, data.chargeBalance);
    const used = pickNumber(data.usedBalance, data.usage);
    return {
        ok: true,
        preset: 'siliconflow',
        remaining,
        used,
        total: remaining != null && used != null ? remaining + used : undefined,
        currency: 'CNY',
        unit: '¥',
        plan: pickString(data.name, data.username),
        raw: payload,
        message: data.status ? `账户状态：${data.status}` : '',
    };
}

async function queryMoonshot(profile) {
    const base = rootBase(profile);
    const payload = await request(`${base}/v1/users/me/balance`, {
        headers: auth(profile),
        timeout: 20_000,
    });
    const data = payload.data || payload;
    return {
        ok: true,
        preset: 'moonshot',
        remaining: pickNumber(data.available_balance, data.availableBalance),
        total: pickNumber(data.total_balance, data.totalBalance),
        currency: 'CNY',
        unit: '¥',
        plan: '',
        raw: payload,
        message: '',
    };
}

async function queryCustom(profile) {
    const config = profile.balance || {};
    let url = String(config.url || '').trim();
    if (!url) throw new Error('自定义余额接口没有填写 URL');
    url = url.replace(/\{\{\s*base\s*\}\}/gi, rootBase(profile)).replace(/\{\{\s*key\s*\}\}/gi, profile.apiKey || '');
    const headers = {
        ...auth(profile),
        ...(parseJsonLoose(config.headers) || {}),
    };
    const payload = await request(url, {
        method: config.method || 'GET',
        headers,
        body: config.body ? parseJsonLoose(config.body) : null,
        timeout: 20_000,
    });
    const remaining = getByPath(payload, config.remainingPath || '');
    const used = getByPath(payload, config.usedPath || '');
    const total = getByPath(payload, config.totalPath || '');
    const currency = getByPath(payload, config.currencyPath || '');
    const number = value => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    return {
        ok: true,
        preset: 'custom',
        remaining: number(remaining),
        used: number(used),
        total: number(total),
        currency: currency ? String(currency) : '',
        unit: config.unit || (currency ? String(currency) : ''),
        plan: '',
        raw: payload,
        message: remaining == null ? '没有在指定路径找到余额字段' : '',
    };
}

async function executePreset(preset, profile) {
    switch (preset) {
        case 'openai-billing': return queryOpenAIBilling(profile);
        case 'newapi': return queryNewApi(profile);
        case 'deepseek': return queryDeepSeek(profile);
        case 'openrouter': return queryOpenRouter(profile);
        case 'siliconflow': return querySiliconFlow(profile);
        case 'moonshot': return queryMoonshot(profile);
        case 'custom': return queryCustom(profile);
        case 'none': return { ok: false, preset, message: '该档案设置为不查询余额' };
        default: return queryOpenAIBilling(profile);
    }
}

export async function queryBalance(profile, { force = false } = {}) {
    if (!profile) throw new Error('没有选择 API 档案');
    const preset = profile.balancePreset === 'auto' || !profile.balancePreset
        ? detectBalancePreset(profile)
        : profile.balancePreset;
    if (preset === 'none') return { ok: false, preset, message: '该档案设置为不查询余额' };
    if (!force && isBalanceFresh(profile.id)) {
        const cached = getBalanceCache(profile.id);
        if (cached) return { ...cached, cached: true };
    }
    const result = await executePreset(preset, profile);
    setBalanceCache(profile.id, result);
    return result;
}

export function formatBalance(result) {
    if (!result) return '';
    if (!result.ok) return result.message || '不可用';
    const unit = result.unit || '';
    const fmt = value => {
        if (value == null || !Number.isFinite(Number(value))) return '';
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    };
    if (result.remaining != null) {
        return `${unit}${fmt(result.remaining)}`;
    }
    if (result.used != null) {
        return `已用 ${unit}${fmt(result.used)}`;
    }
    if (result.total != null) {
        return `总额 ${unit}${fmt(result.total)}`;
    }
    return result.message || '已查询';
}

export function balanceDetails(result) {
    if (!result?.ok) return result?.message || '';
    const parts = [];
    if (result.remaining != null) parts.push(`剩余 ${result.unit || ''}${Number(result.remaining).toLocaleString()}`);
    if (result.used != null) parts.push(`已用 ${result.unit || ''}${Number(result.used).toLocaleString()}`);
    if (result.total != null) parts.push(`总额 ${result.unit || ''}${Number(result.total).toLocaleString()}`);
    if (result.plan) parts.push(result.plan);
    if (result.message) parts.push(result.message);
    return parts.join(' · ');
}
