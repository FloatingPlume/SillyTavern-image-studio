export function ctx() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function uid(prefix = 'is') {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
}

export function toInt(value, fallback = 0) {
    const number = parseInt(String(value ?? ''), 10);
    return Number.isFinite(number) ? number : fallback;
}

export function formatBytes(bytes) {
    const number = Number(bytes);
    if (!Number.isFinite(number) || number <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = number;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function truncate(text, length = 120) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

export function stripHtml(text) {
    return String(text ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

export function parseJsonLoose(text) {
    if (text == null) return null;
    if (typeof text === 'object') return text;
    const raw = String(text).trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) {
            try {
                return JSON.parse(fenced[1]);
            } catch { /* ignore */ }
        }
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1));
            } catch { /* ignore */ }
        }
        return null;
    }
}

export function getByPath(object, path) {
    if (!path) return undefined;
    const segments = String(path)
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
    let current = object;
    for (const segment of segments) {
        if (current == null) return undefined;
        current = current[segment];
    }
    return current;
}

export function pickNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return undefined;
}

export function pickString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
}

export function debounce(fn, wait = 250) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, wait);
    };
}

export function toast(kind, message) {
    const text = String(message ?? '');
    if (globalThis.toastr?.[kind]) {
        globalThis.toastr[kind](text, '画坊', { preventDuplicates: true, timeOut: kind === 'error' ? 7000 : 3500 });
        return;
    }
    console[kind === 'error' ? 'error' : 'log'](`[画坊] ${text}`);
}

export function slugify(text, fallback = 'image') {
    const value = String(text ?? '')
        .normalize('NFKD')
        .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return value || fallback;
}

export function mimeToFormat(mime) {
    const value = String(mime || '').toLowerCase();
    if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
    if (value.includes('webp')) return 'webp';
    if (value.includes('gif')) return 'gif';
    return 'png';
}

export function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export function base64ToBlob(base64, mime = 'image/png') {
    const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text) {
    const value = String(text ?? '');
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch { /* ignore */ }
        area.remove();
        return ok;
    }
}

export function imagePathToUrl(path) {
    if (!path) return '';
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    return `/${String(path).replace(/^\/+/, '')}`;
}

export function sanitizeFileName(name, extension = 'png') {
    const base = String(name || 'image').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    return `${base || 'image'}.${extension}`;
}

export function deepMerge(target, source) {
    if (Array.isArray(source)) return clone(source);
    if (typeof source !== 'object' || source == null) return source;
    const output = typeof target === 'object' && target != null && !Array.isArray(target) ? target : {};
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            output[key] = clone(value);
        } else if (typeof value === 'object' && value != null) {
            output[key] = deepMerge(output[key], value);
        } else {
            output[key] = value;
        }
    }
    return output;
}
