import { get, save, saveSoon } from '../store.js';
import { ComfyService } from '../comfy.js';
import {
    detectLocalSubnet,
    normalizeScanPrefix,
    portFromUrl,
    prefixFromUrl,
    scanComfy,
} from '../discovery.js';
import { clamp, escapeHtml, formatBytes, toast, truncate } from '../util.js';
import { bridge, el, setText, setValue, ui, valueOf } from './core.js';

const monitorComfy = new ComfyService();

export async function testComfyWithModels() {
    const settings = get();
    saveComfyFields();
    bridge.setConnection?.('busy', '检测 ComfyUI…');
    setText('is-comfy-status', '检测中…');
    try {
        const started = Date.now();
        const result = await monitorComfy.test();
        applyStats(ComfyService.parseSystemStats(result.stats));
        setText('is-comfy-status', `连接成功 · ${Date.now() - started}ms`);
        const urlPrefix = prefixFromUrl(settings.comfy.url);
        if (urlPrefix) {
            settings.comfy.scanPrefix = urlPrefix;
            settings.comfy.scanPort = portFromUrl(settings.comfy.url);
            setValue('is-scan-prefix', urlPrefix);
            setValue('is-scan-port', settings.comfy.scanPort);
            saveSoon();
        }
        const models = await monitorComfy.loadModels(true);
        ui.models = models;
        bridge.refreshComfySelects?.();
        if (!settings.comfy.checkpoint && models.checkpoints[0]) {
            settings.comfy.checkpoint = models.checkpoints[0];
            saveSoon();
            bridge.refreshComfySelects?.();
        }
        toast('success', `ComfyUI 已连接，读取到 ${models.checkpoints.length} 个 checkpoint`);
    } catch (error) {
        bridge.setConnection?.('error', 'ComfyUI 未连接');
        setText('is-comfy-status', `连接失败：${error.message || error}`);
        toast('error', `ComfyUI 连接失败：${truncate(error.message || error, 300)}`);
    }
}

export function silentProbe() {
    if (Date.now() - ui.lastComfyCheck < 45_000) return;
    ui.lastComfyCheck = Date.now();
    monitorComfy.test().then(async result => {
        applyStats(ComfyService.parseSystemStats(result.stats));
        if (!ui.models) {
            try {
                ui.models = await monitorComfy.loadModels(true);
                bridge.refreshComfySelects?.();
            } catch (error) {
                console.warn('[画坊] 读取 ComfyUI 模型失败', error);
            }
        }
    }).catch(() => {
        bridge.setConnection?.('error', 'ComfyUI 未连接');
    });
}

export function applyStats(stats) {
    if (!stats) return;
    ui.stats = stats;
    bridge.setConnection?.('ok', `ComfyUI ${stats.comfyVersion || ''} · ${stats.deviceName || '已连接'}`.trim());
    setText('is-stat-gpu', stats.deviceName || '未检测到 GPU');
    setText('is-stat-os', stats.os || '—');
    setText('is-stat-version', `${stats.comfyVersion || '—'} / Py ${stats.pythonVersion || '—'}`);
    const vramUsed = Math.max(0, (stats.vramTotal || 0) - (stats.vramFree || 0));
    const ramUsed = Math.max(0, (stats.ramTotal || 0) - (stats.ramFree || 0));
    setText('is-stat-vram-text', `${formatBytes(vramUsed)} / ${formatBytes(stats.vramTotal)}`);
    setText('is-stat-ram-text', `${formatBytes(ramUsed)} / ${formatBytes(stats.ramTotal)}`);
    const vramBar = el('is-vram-bar');
    const ramBar = el('is-ram-bar');
    if (vramBar) vramBar.style.width = stats.vramTotal ? `${clamp((vramUsed / stats.vramTotal) * 100, 0, 100)}%` : '0%';
    if (ramBar) ramBar.style.width = stats.ramTotal ? `${clamp((ramUsed / stats.ramTotal) * 100, 0, 100)}%` : '0%';
    setText('is-brief-text', `ComfyUI 已连接 · ${stats.deviceName || ''}`);
    setText('is-comfy-status', '已连接');
    bridge.updateSettingsStatus?.();
}

export function saveComfyFields() {
    const settings = get();
    settings.comfy.url = String(valueOf('is-comfy-url') || '').trim();
    settings.comfy.auth = String(valueOf('is-comfy-auth') || '').trim();
    settings.useServerProxy = valueOf('is-comfy-proxy') !== 'direct';
    save();
}

export function startMonitor() {
    if (!el('is-panel')?.classList.contains('is-open')) return;
    stopMonitor();
    refreshMonitor();
    ui.monitorTimer = setInterval(() => {
        if (ui.tab !== 'monitor') return;
        refreshMonitor();
    }, 12_000);
}

export function stopMonitor() {
    if (ui.monitorTimer) {
        clearInterval(ui.monitorTimer);
        ui.monitorTimer = null;
    }
}

export async function refreshMonitor() {
    if (ui.monitorBusy) return;
    if (!get().comfy.url) {
        setText('is-comfy-status', '还没有填写 ComfyUI 地址');
        return;
    }
    ui.monitorBusy = true;
    try {
        const stats = await monitorComfy.test();
        applyStats(ComfyService.parseSystemStats(stats.stats));
        const queue = await monitorComfy.queue();
        renderQueue(queue);
    } catch (error) {
        bridge.setConnection?.('error', 'ComfyUI 未连接');
        setText('is-comfy-status', `连接失败：${truncate(error.message || error, 200)}`);
        setText('is-stat-queue', '—');
    } finally {
        ui.monitorBusy = false;
    }
}

function extractQueuePrompt(prompt) {
    const nodes = prompt && typeof prompt === 'object' ? Object.values(prompt) : [];
    for (const node of nodes) {
        if (node?.class_type && String(node.class_type).includes('CLIPTextEncode') && node.inputs?.text) {
            return String(node.inputs.text);
        }
    }
    return '';
}

function renderQueue(queue) {
    const running = Array.isArray(queue?.queue_running) ? queue.queue_running : [];
    const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : [];
    setText('is-stat-queue', `运行 ${running.length} · 等待 ${pending.length}`);
    setText('is-queue-count', running.length + pending.length ? `共 ${running.length + pending.length} 个` : '');
    const node = el('is-queue-list');
    if (!node) return;
    const rows = [];
    running.forEach(item => {
        rows.push(`<div class="is-queue-item is-running"><span class="is-grow">运行中 · ${escapeHtml(truncate(extractQueuePrompt(item?.[2]) || '未识别提示词', 90))}</span><button type="button" class="is-link" data-queue-action="interrupt" title="中断当前"><i class="fa-solid fa-stop"></i></button></div>`);
    });
    pending.forEach((item, index) => {
        rows.push(`<div class="is-queue-item"><span class="is-badge">${index + 1}</span><span class="is-grow">${escapeHtml(truncate(extractQueuePrompt(item?.[2]) || '未识别提示词', 90))}</span><button type="button" class="is-link" data-queue-action="cancel" data-id="${escapeHtml(item?.[1] || '')}" title="取消"><i class="fa-solid fa-xmark"></i></button></div>`);
    });
    node.innerHTML = rows.length ? rows.join('') : '<div class="is-hint">队列为空</div>';
}


export function renderScanResults() {
    const node = el('is-scan-results');
    if (!node) return;
    if (!ui.scanResults.length) {
        node.innerHTML = '';
        return;
    }
    node.innerHTML = ui.scanResults.map(item => `<div class="is-scan-result"><span class="is-scan-address">${escapeHtml(item.host)}:${item.port}</span><span class="is-grow">${escapeHtml(item.comfyVersion || 'ComfyUI')} · ${escapeHtml(item.deviceName || '')}</span><button type="button" class="is-link" data-scan-url="${escapeHtml(item.url)}">使用</button></div>`).join('');
}

export async function scanForComfy() {
    if (ui.scanAbort) {
        ui.scanAbort.abort();
        ui.scanAbort = null;
        setText('is-scan-progress', '已停止扫描');
        const button = el('is-scan-comfy');
        if (button) button.textContent = '扫描局域网';
        return;
    }
    if (get().useServerProxy === false) {
        setText('is-scan-progress', '扫描依赖酒馆跨域代理，请先在高级参数打开“通过酒馆服务端代理请求”。');
        return;
    }
    saveComfyFields();
    let prefix = valueOf('is-scan-prefix');
    if (!prefix) prefix = prefixFromUrl(get().comfy.url);
    if (!prefix) {
        setText('is-scan-progress', '正在探测手机所在网段…');
        prefix = await detectLocalSubnet();
    }
    if (!prefix) {
        setText('is-scan-progress', '没能自动识别网段，请在“扫描前缀”里填前三段，例如 192.168.1。');
        return;
    }
    try {
        prefix = normalizeScanPrefix(prefix);
    } catch (error) {
        setText('is-scan-progress', error.message || String(error));
        return;
    }
    const port = Number(valueOf('is-scan-port')) || portFromUrl(get().comfy.url);
    setValue('is-scan-prefix', prefix);
    const settings = get();
    settings.comfy.scanPrefix = prefix;
    settings.comfy.scanPort = port;
    saveSoon();
    const controller = new AbortController();
    ui.scanAbort = controller;
    ui.scanResults = [];
    renderScanResults();
    const button = el('is-scan-comfy');
    if (button) button.textContent = '停止扫描';
    setText('is-scan-progress', `扫描 ${prefix}.1-254 的 ${port} 端口…`);
    try {
        const found = await scanComfy({
            prefix,
            port,
            priority: [get().comfy.url].filter(Boolean),
            concurrency: 8,
            timeout: 650,
            signal: controller.signal,
            onProgress: (done, total, count) => {
                setText('is-scan-progress', `扫描中 ${done}/${total} · 已发现 ${count}`);
            },
        });
        if (controller.signal.aborted) {
            setText('is-scan-progress', '已停止扫描');
            return;
        }
        ui.scanResults = found;
        renderScanResults();
        setText('is-scan-progress', found.length
            ? `扫描完成 · 找到 ${found.length} 个 ComfyUI，点“使用”连接`
            : '没有找到 ComfyUI。确认电脑已监听 0.0.0.0、8188 端口放行防火墙、手机和电脑在同一 Wi-Fi，且酒馆“启用 CORS 代理”已打开。');
        if (found.length) toast('success', `发现 ${found.length} 个 ComfyUI`);
        else toast('warning', '本网段没有发现 ComfyUI');
    } catch (error) {
        setText('is-scan-progress', `扫描失败：${error.message || error}`);
    } finally {
        ui.scanAbort = null;
        const btn = el('is-scan-comfy');
        if (btn) btn.textContent = '扫描局域网';
    }
}

export async function useScanResult(url) {
    setValue('is-comfy-url', url);
    get().comfy.url = url;
    const prefix = prefixFromUrl(url);
    if (prefix) {
        setValue('is-scan-prefix', prefix);
        get().comfy.scanPrefix = prefix;
    }
    setValue('is-scan-port', portFromUrl(url));
    get().comfy.scanPort = portFromUrl(url);
    saveSoon();
    await testComfyWithModels();
}



export async function interruptComfy() {
    await monitorComfy.interrupt();
    toast('info', '已请求中断当前任务');
}

export async function clearComfyQueue() {
    await monitorComfy.clearQueue();
    toast('success', '已清空等待队列');
    await refreshMonitor();
}

export async function cancelQueuedComfy(id) {
    await monitorComfy.deleteQueue([id]);
    await refreshMonitor();
}
