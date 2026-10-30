import { request, ApiError } from './net.js';
import { get } from './store.js';
import { clamp, pickNumber, pickString } from './util.js';

function normalizeBase(raw) {
    let value = String(raw || '').trim();
    if (!value) throw new Error('请先填写 ComfyUI 地址');
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
    return value.replace(/\/+$/, '');
}

function basicAuthHeader(auth) {
    const value = String(auth || '').trim();
    if (!value) return {};
    if (value.includes(':')) {
        return { Authorization: `Basic ${btoa(value)}` };
    }
    return { Authorization: `Bearer ${value}` };
}

function optionsOfRequired(input) {
    if (!Array.isArray(input)) return [];
    const first = input[0];
    return Array.isArray(first) ? first : [];
}

function requiredOf(nodeInfo, name) {
    return nodeInfo?.input?.required?.[name] || nodeInfo?.input?.optional?.[name] || null;
}

export class ComfyService {
    constructor() {
        this.ws = null;
        this.wsAttempts = 0;
        this.manualClose = false;
        this.objectCache = null;
        this.objectCacheBase = '';
        this.clientId = `image-studio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        this.callbacks = {};
    }

    get config() {
        return get().comfy;
    }

    base() {
        return normalizeBase(this.config.url);
    }

    endpoint(path) {
        const base = this.base();
        return `${base}${path.startsWith('/') ? path : `/${path}`}`;
    }

    mode() {
        return get().useServerProxy === false ? 'direct' : 'proxy';
    }

    headers(extra = {}) {
        return { ...basicAuthHeader(this.config.auth), ...extra };
    }

    async request(path, { method = 'GET', body = null, timeout = 60_000, responseType = 'json' } = {}) {
        return request(this.endpoint(path), {
            method,
            body,
            headers: this.headers(),
            mode: this.mode(),
            timeout,
            responseType,
        });
    }

    async systemStats() {
        return this.request('/system_stats', { timeout: 15_000 });
    }

    async test() {
        const started = Date.now();
        const stats = await this.systemStats();
        return { stats, ms: Date.now() - started, base: this.base() };
    }

    async fetchNodeInfo(nodeClass) {
        try {
            return await this.request(`/object_info/${encodeURIComponent(nodeClass)}`, { timeout: 30_000 });
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
        }
    }

    async loadModels(force = false) {
        const base = this.base();
        if (!force && this.objectCache && this.objectCacheBase === base) return this.objectCache;

        const classes = ['CheckpointLoaderSimple', 'KSampler', 'VAELoader', 'LoraLoader'];
        const infos = {};
        let partial = true;
        for (const name of classes) {
            const info = await this.fetchNodeInfo(name);
            if (!info) {
                partial = false;
                break;
            }
            infos[name] = info[name] || Object.values(info)[0];
        }

        if (!partial) {
            const full = await this.request('/object_info', { timeout: 60_000 });
            this.objectCache = this.parseModels(full);
        } else {
            this.objectCache = this.parseModels(infos);
        }
        this.objectCacheBase = base;
        return this.objectCache;
    }

    parseModels(infos) {
        const ckpt = infos.CheckpointLoaderSimple || infos['CheckpointLoaderSimple'] || {};
        const sampler = infos.KSampler || {};
        const vae = infos.VAELoader || {};
        const lora = infos.LoraLoader || {};

        return {
            checkpoints: optionsOfRequired(requiredOf(ckpt, 'ckpt_name')),
            samplers: optionsOfRequired(requiredOf(sampler, 'sampler_name')),
            schedulers: optionsOfRequired(requiredOf(sampler, 'scheduler')),
            vaes: optionsOfRequired(requiredOf(vae, 'vae_name')),
            loras: optionsOfRequired(requiredOf(lora, 'lora_name')),
        };
    }

    async submit(workflow) {
        const result = await this.request('/prompt', {
            method: 'POST',
            body: { prompt: workflow, client_id: this.clientId },
            timeout: 30_000,
        });
        if (result?.node_errors && Object.keys(result.node_errors).length > 0) {
            const details = Object.entries(result.node_errors)
                .map(([nodeId, error]) => `${nodeId}: ${error?.class_type || ''} ${(error?.errors || []).map(item => item.message || item.details).join('; ')}`)
                .join('\n');
            throw new Error(`ComfyUI 工作流校验失败：\n${details}`);
        }
        if (!result?.prompt_id) {
            throw new Error('ComfyUI 没有返回 prompt_id');
        }
        return result;
    }

    async queue() {
        return this.request('/queue', { timeout: 15_000 });
    }

    async history(promptId) {
        const result = await this.request(`/history/${encodeURIComponent(promptId)}`, { timeout: 20_000 });
        return result?.[promptId] || null;
    }

    async interrupt(promptId = '') {
        return this.request('/interrupt', { method: 'POST', body: promptId ? { prompt_id: promptId } : {}, timeout: 15_000 });
    }

    async deleteQueue(promptIds = []) {
        if (!promptIds.length) return null;
        return this.request('/queue', { method: 'POST', body: { delete: promptIds }, timeout: 15_000 });
    }

    async clearQueue() {
        return this.request('/queue', { method: 'POST', body: { clear: true }, timeout: 15_000 });
    }

    imageUrl(info) {
        const params = new URLSearchParams({
            filename: String(info.filename || ''),
            subfolder: String(info.subfolder || ''),
            type: String(info.type || 'output'),
        });
        return this.endpoint(`/view?${params.toString()}`);
    }

    async imageBlob(info) {
        return request(this.imageUrl(info), {
            mode: this.mode(),
            headers: this.headers(),
            timeout: 120_000,
            responseType: 'blob',
        });
    }

    extractImages(historyItem) {
        const images = [];
        for (const output of Object.values(historyItem?.outputs || {})) {
            for (const image of output?.images || []) {
                if (image?.filename) images.push(image);
            }
        }
        return images;
    }

    async ensureSocket(callbacks = {}) {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.callbacks = callbacks;
            return this.ws;
        }
        return this.openSocket(callbacks);
    }

    openSocket(callbacks = {}) {
        this.closeSocket(true);
        this.callbacks = callbacks;
        this.manualClose = false;
        const url = `${this.base().replace(/^http/i, 'ws')}/ws?clientId=${encodeURIComponent(this.clientId)}`;
        const socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        this.ws = socket;

        socket.onopen = () => {
            this.wsAttempts = 0;
            callbacks.onOpen?.();
        };
        socket.onerror = () => {
            callbacks.onError?.(new Error('WebSocket 连接失败'));
        };
        socket.onclose = (event) => {
            callbacks.onClose?.(event);
            if (!this.manualClose && this.wsAttempts < 3) {
                this.wsAttempts += 1;
                const delay = this.wsAttempts * 1500;
                setTimeout(() => {
                    if (!this.manualClose) this.openSocket(this.callbacks);
                }, delay);
            }
        };
        socket.onmessage = async (event) => {
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    callbacks.onMessage?.(message);
                } catch {
                    // ignore malformed frames
                }
                return;
            }
            try {
                const buffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
                if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 8) return;
                const view = new DataView(buffer);
                const eventType = view.getUint32(0);
                if (eventType === 1) {
                    const format = view.getUint32(4);
                    const mime = format === 2 ? 'image/png' : 'image/jpeg';
                    callbacks.onPreview?.(new Blob([buffer.slice(8)], { type: mime }));
                    return;
                }
                if (eventType === 4) {
                    const metadataLength = view.getUint32(4);
                    const metadataStart = 8;
                    const imageStart = metadataStart + metadataLength;
                    let mime = 'image/png';
                    try {
                        const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, metadataStart, metadataLength)));
                        mime = metadata.image_type || metadata.mime_type || mime;
                    } catch { /* ignore */ }
                    callbacks.onPreview?.(new Blob([buffer.slice(imageStart)], { type: mime }));
                    return;
                }
            } catch (error) {
                callbacks.onError?.(error);
            }
        };
        return socket;
    }

    closeSocket(manual = true) {
        this.manualClose = manual;
        if (this.ws) {
            try {
                this.ws.onclose = null;
                this.ws.close();
            } catch { /* ignore */ }
            this.ws = null;
        }
    }

    isSocketOpen() {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    static parseSystemStats(stats) {
        const system = stats?.system || {};
        const devices = Array.isArray(stats?.devices) ? stats.devices : [];
        const device = devices[0] || {};
        return {
            os: pickString(system.os, '未知'),
            comfyVersion: pickString(system.comfyui_version, '未知'),
            pythonVersion: pickString(system.python_version, '未知'),
            pytorchVersion: pickString(system.pytorch_version, '未知'),
            ramTotal: pickNumber(system.ram_total, 0),
            ramFree: pickNumber(system.ram_free, 0),
            deviceName: pickString(device.name, '未检测到 GPU'),
            vramTotal: pickNumber(device.vram_total, 0),
            vramFree: pickNumber(device.vram_free, 0),
            torchVramTotal: pickNumber(device.torch_vram_total, 0),
            torchVramFree: pickNumber(device.torch_vram_free, 0),
            deviceType: pickString(device.type, ''),
            devices: devices.map(item => ({
                name: pickString(item.name, 'GPU'),
                vramTotal: pickNumber(item.vram_total, 0),
                vramFree: pickNumber(item.vram_free, 0),
                type: pickString(item.type, ''),
            })),
        };
    }

    static progressPercent(value, max) {
        const total = Number(max);
        const current = Number(value);
        if (!Number.isFinite(total) || total <= 0) return 0;
        return clamp(Math.round((current / total) * 100), 0, 100);
    }
}
