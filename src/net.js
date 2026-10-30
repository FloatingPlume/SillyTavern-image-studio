import { get } from './store.js';
import { ctx, parseJsonLoose } from './util.js';

export class ApiError extends Error {
    constructor(message, { status = 0, body = null, url = '', proxied = false, cause = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
        this.url = url;
        this.proxied = proxied;
        this.cause = cause;
    }
}

export function useProxyDefault() {
    return get().useServerProxy !== false;
}

export function proxyUrl(url) {
    return `/proxy/${encodeURIComponent(String(url))}`;
}

function mergeSignal(signal, timeout) {
    const controller = new AbortController();
    const timer = timeout > 0 ? setTimeout(() => controller.abort(new Error('请求超时')), timeout) : null;
    const abort = () => controller.abort(signal?.reason || new Error('请求已取消'));
    if (signal) {
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
    }
    return {
        signal: controller.signal,
        cleanup() {
            if (timer) clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abort);
        },
    };
}

function describeProxyHint(error, proxied) {
    if (!proxied) {
        return '直连失败。若目标是 ComfyUI，请开启跨域或改用「酒馆服务端代理」；云端 API 通常也需要服务端代理来避开跨域。';
    }
    if (error?.status === 403) {
        return '酒馆服务端代理返回 403。请在 SillyDroid 设置开启「让服务端充当跨域代理」；如果开了私网白名单，把电脑 IP 加入允许列表。';
    }
    return '请求没有到达目标。请确认酒馆跨域代理已开启，以及目标地址在手机网络里可达。';
}

export async function request(url, options = {}) {
    const {
        method = 'GET',
        headers = {},
        body = null,
        timeout = 60_000,
        mode,
        signal = null,
        responseType = 'auto',
    } = options;

    const proxied = mode === 'proxy' ? true : mode === 'direct' ? false : useProxyDefault();
    const target = proxied ? proxyUrl(url) : String(url);
    const finalHeaders = { ...headers };
    let payload = body;

    if (payload != null && typeof payload !== 'string' && !(payload instanceof FormData)) {
        payload = JSON.stringify(payload);
    }
    if (payload != null && !finalHeaders['Content-Type'] && !finalHeaders['content-type']) {
        finalHeaders['Content-Type'] = 'application/json';
    }

    const { signal: mergedSignal, cleanup } = mergeSignal(signal, timeout);

    let response;
    try {
        response = await fetch(target, {
            method,
            headers: finalHeaders,
            body: payload ?? undefined,
            signal: mergedSignal,
            credentials: 'omit',
            cache: 'no-store',
        });
    } catch (error) {
        cleanup();
        if (error?.name === 'AbortError' || signal?.aborted) {
            throw new ApiError('请求已取消', { url, proxied, cause: error });
        }
        throw new ApiError(describeProxyHint({}, proxied) + ` ${error?.message || ''}`.trim(), { url, proxied, cause: error });
    }
    cleanup();

    if (!response.ok) {
        let text = '';
        try {
            text = await response.text();
        } catch { /* ignore */ }
        const parsed = parseJsonLoose(text);
        const message = parsed?.error?.message || parsed?.message || parsed?.error || text || `HTTP ${response.status}`;
        throw new ApiError(
            `HTTP ${response.status}: ${String(message).slice(0, 600)}`,
            { status: response.status, body: parsed || text, url, proxied },
        );
    }

    if (responseType === 'blob' || responseType === 'arrayBuffer') {
        return responseType === 'blob' ? response.blob() : response.arrayBuffer();
    }
    if (responseType === 'text') {
        return response.text();
    }

    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (responseType === 'json' || type.includes('application/json')) {
        const text = await response.text();
        if (!text) return null;
        const parsed = parseJsonLoose(text);
        if (parsed == null) {
            throw new ApiError(`接口返回的不是有效 JSON：${text.slice(0, 300)}`, {
                status: response.status, body: text, url, proxied,
            });
        }
        return parsed;
    }

    const text = await response.text();
    const parsed = parseJsonLoose(text);
    return parsed ?? text;
}

export async function stRequest(path, options = {}) {
    const context = ctx();
    const headers = context?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
    const { method = 'GET', body = null, timeout = 60_000, signal = null, responseType = 'json' } = options;
    const { signal: mergedSignal, cleanup } = mergeSignal(signal, timeout);
    let response;
    try {
        response = await fetch(String(path), {
            method,
            headers: { ...headers, ...(options.headers || {}) },
            body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
            signal: mergedSignal,
            credentials: 'same-origin',
        });
    } catch (error) {
        cleanup();
        throw new ApiError(`酒馆接口请求失败：${error?.message || error}`, { url: path, cause: error });
    }
    cleanup();

    if (!response.ok) {
        let text = '';
        try {
            text = await response.text();
        } catch { /* ignore */ }
        throw new ApiError(`酒馆接口 ${response.status}：${text.slice(0, 500) || response.statusText}`, {
            status: response.status, body: text, url: path,
        });
    }
    if (responseType === 'blob') return response.blob();
    const text = await response.text();
    if (!text) return null;
    return responseType === 'text' ? text : (parseJsonLoose(text) ?? text);
}

export async function fetchImageBlob(url, { mode, signal = null } = {}) {
    if (!url) throw new ApiError('图片地址为空');
    if (/^data:/i.test(url)) {
        const response = await fetch(url);
        return response.blob();
    }
    return request(url, { mode, timeout: 120_000, responseType: 'blob', signal });
}

export function makeAuthHeaders(apiKey, extra = {}) {
    const headers = { ...extra };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
}
