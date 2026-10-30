import { request } from './net.js';
import { ComfyService } from './comfy.js';

const DEFAULT_PORT = 8188;

export function normalizeScanPrefix(value) {
    const raw = String(value || '').trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/:\d+$/, '');
    const match = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?$/);
    if (!match) throw new Error('网段前缀应类似 192.168.1');
    const octets = [match[1], match[2], match[3], match[4]].filter(value => value != null).map(Number);
    if (octets.some(part => part < 0 || part > 255)) throw new Error('网段前缀里的数字必须在 0-255 之间');
    return octets.slice(0, 3).join('.');
}

export function prefixFromUrl(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        if (parsed.hostname === 'localhost' || parsed.hostname === '0.0.0.0' || parsed.hostname.startsWith('127.')) return null;
        const match = parsed.hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
        if (!match) return null;
        const prefix = match.slice(1).join('.');
        return normalizeScanPrefix(prefix);
    } catch {
        return null;
    }
}

export function portFromUrl(url, fallback = DEFAULT_PORT) {
    try {
        const parsed = new URL(String(url || '').trim());
        const port = Number(parsed.port);
        return Number.isFinite(port) && port > 0 && port <= 65535 ? port : fallback;
    } catch {
        return fallback;
    }
}

export function buildCandidates(prefix, { start = 1, end = 254, port = DEFAULT_PORT, priority = [] } = {}) {
    const base = normalizeScanPrefix(prefix);
    const from = Math.max(1, Math.min(254, Number(start) || 1));
    const to = Math.max(from, Math.min(254, Number(end) || 254));
    const result = [];
    const seen = new Set();
    for (const item of priority || []) {
        try {
            const url = new URL(String(item));
            if (url.hostname.startsWith(`${base}.`)) {
                const value = url.hostname;
                if (!seen.has(value)) {
                    seen.add(value);
                    result.push(value);
                }
            }
        } catch { /* ignore */ }
    }
    for (let index = from; index <= to; index += 1) {
        const host = `${base}.${index}`;
        if (seen.has(host)) continue;
        seen.add(host);
        result.push(host);
    }
    return result.map(host => ({ host, url: `http://${host}:${port}`, port }));
}

/**
 * Best-effort local IPv4 subnet discovery through WebRTC host candidates.
 * Some browsers return mDNS names instead of literal IPs; callers must handle null.
 */
export async function detectLocalSubnet(timeout = 1500) {
    if (typeof RTCPeerConnection !== 'function') return null;
    return await new Promise(resolve => {
        let finished = false;
        const peer = new RTCPeerConnection({ iceServers: [] });
        const finish = value => {
            if (finished) return;
            finished = true;
            try { peer.close(); } catch { /* ignore */ }
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeout);
        try {
            peer.createDataChannel('image-studio');
            peer.onicecandidate = event => {
                const candidate = event.candidate?.candidate || '';
                const match = candidate.match(/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
                if (match) {
                    const prefix = match[0].split('.').slice(0, 3).join('.');
                    clearTimeout(timer);
                    finish(prefix);
                }
            };
            peer.createOffer()
                .then(offer => peer.setLocalDescription(offer))
                .catch(() => finish(null));
        } catch {
            finish(null);
        }
    });
}

export async function scanComfy({
    prefix,
    start = 1,
    end = 254,
    port = DEFAULT_PORT,
    concurrency = 8,
    timeout = 600,
    onProgress = null,
    signal = null,
    priority = [],
    mode = 'proxy',
} = {}) {
    const candidates = buildCandidates(prefix, { start, end, port, priority });
    const found = [];
    let cursor = 0;
    let completed = 0;

    const worker = async () => {
        while (cursor < candidates.length) {
            if (signal?.aborted) return;
            const candidate = candidates[cursor++];
            try {
                const payload = await request(`${candidate.url}/system_stats`, {
                    mode,
                    timeout,
                    signal,
                });
                const stats = ComfyService.parseSystemStats(payload);
                found.push({
                    url: candidate.url,
                    host: candidate.host,
                    port: candidate.port,
                    comfyVersion: stats.comfyVersion,
                    deviceName: stats.deviceName,
                });
            } catch {
                // A closed port is the normal case; do not surface every failure.
            } finally {
                completed += 1;
                onProgress?.(completed, candidates.length, found.length);
            }
        }
    };

    const workers = Array.from({ length: Math.max(1, Math.min(16, Number(concurrency) || 8)) }, () => worker());
    await Promise.all(workers);

    return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}
