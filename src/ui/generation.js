import { get, saveSoon } from '../store.js';
import { expandPrompt } from '../prompt.js';
import { escapeHtml, toast, truncate } from '../util.js';
import { job, jobElapsedText, describeRequest, generateCloud, generateComfy } from '../jobs.js';
import { imageUrl } from '../history.js';
import { applyStats } from './monitor.js';
import { renderHistory } from './history.js';
import { renderCat } from '../floating-cat.js';
import { bridge, el, setHidden, setText, ui, valueOf } from './core.js';

export function renderJob() {
    const active = job.active;
    const wrap = el('is-job');
    if (wrap) wrap.hidden = !active && !job.details && !job.results.length && !job.error;
    setText('is-job-status', job.statusText || (active ? '生成中' : ''));
    setText('is-job-time', active ? jobElapsedText() : '');
    const bar = el('is-progress-bar');
    if (bar) bar.style.width = `${job.progress || 0}%`;
    const progressWrap = el('is-progress-bar')?.parentElement;
    if (progressWrap) {
        progressWrap.classList.toggle('is-indeterminate', active && job.provider === 'cloud' && job.progress === 0 && job.status === 'running');
    }
    setText('is-node-label', job.nodeProgress || job.node || '');
    setText('is-queue-label', job.queueRemaining != null ? `队列 ${job.queueRemaining}` : '');
    setHidden('is-ws-warning', !job.wsUnavailable);
    const preview = el('is-preview');
    const empty = el('is-preview-empty');
    if (preview && empty) {
        if (job.previewUrl) {
            preview.src = job.previewUrl;
            preview.hidden = false;
            empty.hidden = true;
        } else {
            preview.hidden = true;
            empty.hidden = !(active && job.provider === 'comfy');
        }
    }
    const errorNode = el('is-job-error');
    if (errorNode) {
        errorNode.hidden = !job.error;
        errorNode.textContent = job.error || '';
    }
    const generate = el('is-generate');
    const cancel = el('is-cancel');
    if (generate) {
        generate.hidden = active;
        generate.disabled = false;
    }
    if (cancel) cancel.hidden = !active;
    renderRequestDetails();
    if (!active) stopJobTimer();
    bridge.updateSettingsStatus?.();
    renderCat();
}

export function renderResults() {
    const node = el('is-results');
    if (!node) return;
    if (!job.results.length) {
        node.innerHTML = '';
        renderCat();
        return;
    }
    node.innerHTML = job.results.map((result, index) => {
        const url = result.path ? imageUrl(result.path) : (result._url || '');
        return `<div class="is-result">
            <img src="${escapeHtml(url)}" alt="生成结果" data-result-view="${index}" />
            <div class="is-result-actions">
                <button type="button" data-result-action="view" data-index="${index}" title="查看"><i class="fa-solid fa-expand"></i></button>
                <button type="button" data-result-action="download" data-index="${index}" title="下载"><i class="fa-solid fa-download"></i></button>
                <button type="button" data-result-action="bg" data-index="${index}" title="设为背景"><i class="fa-solid fa-image"></i></button>
                <button type="button" data-result-action="chat" data-index="${index}" title="插入聊天"><i class="fa-solid fa-comment"></i></button>
            </div>
        </div>`;
    }).join('');
    for (const [index, result] of job.results.entries()) {
        if (result.blob && !result.path && !result._url) {
            result._url = URL.createObjectURL(result.blob);
            ui.resultUrls.set(index, result._url);
        }
    }
    if (job.results.some(result => result.blob && !result.path)) renderResultsAgain();
    renderCat();
}

function renderResultsAgain() {
    const node = el('is-results');
    if (!node) return;
    node.querySelectorAll('[data-result-view]').forEach(image => {
        const index = Number(image.dataset.resultView);
        const result = job.results[index];
        if (result?._url) image.src = result._url;
    });
}

export function renderRequestDetails() {
    const node = el('is-request-body');
    const details = describeRequest();
    if (!node) return;
    if (!details) {
        node.innerHTML = '<div class="is-hint">生图后会在这里显示实际发送的正面/负面提示词、种子和工作流 JSON。</div>';
        return;
    }
    const workflow = details.workflowJson ? `<details class="is-request-block"><summary class="is-request-block-head">工作流 JSON <button type="button" class="is-link" data-copy-block>复制</button></summary><pre>${escapeHtml(details.workflowJson)}</pre></details>` : '';
    node.innerHTML = `
        <div class="is-request-block"><div class="is-request-block-head"><span>正面提示词</span><button type="button" class="is-link" data-copy-block>复制</button></div><pre>${escapeHtml(details.positive)}</pre></div>
        <div class="is-request-block"><div class="is-request-block-head"><span>负面提示词</span><button type="button" class="is-link" data-copy-block>复制</button></div><pre>${escapeHtml(details.negative || '（空）')}</pre></div>
        <div class="is-request-block"><div class="is-request-block-head"><span>参数</span></div><pre>${escapeHtml(`seed: ${details.seed}\nsize: ${details.width}x${details.height}\nmodel: ${details.model || details.checkpoint || ''}\nprovider: ${details.provider}${details.workflowMode ? `\nworkflow: ${details.workflowMode}` : ''}${details.reference ? `\nreference: ${details.reference.name || details.reference.file || ''}` : ''}`)}</pre></div>
        ${workflow}`;
}

function startJobTimer() {
    stopJobTimer();
    ui.jobTimer = setInterval(() => {
        if (!job.active) {
            stopJobTimer();
            return;
        }
        setText('is-job-time', jobElapsedText());
    }, 1000);
}

function stopJobTimer() {
    if (ui.jobTimer) {
        clearInterval(ui.jobTimer);
        ui.jobTimer = null;
    }
}

function referenceSourceUrl() {
    if (ui.referenceObjectUrl) return ui.referenceObjectUrl;
    const path = get().draft?.referencePath;
    return path ? imageUrl(path) : '';
}

export function renderReferenceBar() {
    const bar = el('is-reference-bar');
    const image = el('is-reference-thumb');
    const label = el('is-reference-label');
    if (!bar || !image || !label) return;
    const src = referenceSourceUrl();
    if (!src) {
        bar.hidden = true;
        image.removeAttribute('src');
        label.textContent = '';
        return;
    }
    const name = get().draft?.referenceName || '已选择';
    bar.hidden = false;
    image.src = src;
    label.textContent = `参考图：${name}${ui.referenceBlob ? ' · 本次上传' : ''}`;
}

export function setGenerationReference(reference) {
    const settings = get();
    if (ui.referenceObjectUrl) {
        URL.revokeObjectURL(ui.referenceObjectUrl);
        ui.referenceObjectUrl = '';
    }
    ui.referenceBlob = reference?.blob || null;
    if (ui.referenceBlob) ui.referenceObjectUrl = URL.createObjectURL(ui.referenceBlob);
    settings.draft.referencePath = reference?.path || '';
    settings.draft.referenceName = reference?.name || '';
    saveSoon();
    renderReferenceBar();
    bridge.renderCloudProfiles?.();
}

export function clearGenerationReference() {
    const input = el('is-reference-file');
    if (input) input.value = '';
    setGenerationReference(null);
}

export async function resolveGenerationReference() {
    if (ui.referenceBlob) {
        return {
            blob: ui.referenceBlob,
            filename: ui.referenceBlob.name || `${get().draft?.referenceName || 'reference'}.png`,
            name: get().draft?.referenceName || '参考图',
            path: '',
        };
    }
    const path = get().draft?.referencePath;
    if (!path) return null;
    const response = await fetch(imageUrl(path));
    if (!response.ok) throw new Error(`读取参考图失败：HTTP ${response.status}`);
    const blob = await response.blob();
    const name = get().draft?.referenceName || '参考图';
    return {
        blob,
        filename: `${name.replace(/[\\/:*?"<>|]/g, '_')}.png`,
        name,
        path,
    };
}

export function renderGenerationSource() {
    const bar = el('is-generation-source');
    const label = el('is-generation-source-label');
    if (!bar || !label) return;
    const source = get().draft?.source || { type: 'manual', label: '手动提示词' };
    const type = source.type || 'manual';
    let text = source.label || (type === 'manual' ? '手动提示词' : '');
    if (source.detail) text += ` · ${source.detail}`;
    if (source.modified) text += ' · 已手动修改';
    label.textContent = text;
    bar.classList.toggle('is-library', type === 'library');
    bar.classList.toggle('is-message', type === 'message');
    const reset = el('is-generation-source-reset');
    if (reset) reset.hidden = type === 'manual';
}

export function setGenerationSource(source = {}) {
    const settings = get();
    settings.draft.source = {
        type: source.type || 'manual',
        label: source.label || '手动提示词',
        detail: source.detail || '',
        modified: !!source.modified,
    };
    saveSoon();
    renderGenerationSource();
}

export function resetGenerationSource() {
    setGenerationSource({ type: 'manual', label: '手动提示词' });
}

export function markGenerationSourceModified() {
    const settings = get();
    if (!settings.draft.source) return;
    if (settings.draft.source.type === 'manual') return;
    if (settings.draft.source.modified) return;
    settings.draft.source.modified = true;
    saveSoon();
    renderGenerationSource();
}

export function jobCallbacks() {    return {
        onUpdate: snapshot => {
            if (snapshot.status === 'done' || snapshot.status === 'error' || snapshot.status === 'cancelled') {
                stopJobTimer();
                if (snapshot.status === 'done') toast('success', '画坊：生成完成');
            }
            renderJob();
            if (snapshot.status === 'done') {
                renderResults();
                renderHistory();
                el('is-results')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        },
        onStats: stats => applyStats(stats),
        onResult: () => renderResults(),
        onError: error => {
            const message = String(error?.message || error);
            if (ui.lastErrorToast !== message) {
                ui.lastErrorToast = message;
                toast('error', truncate(message, 500));
                setTimeout(() => { if (ui.lastErrorToast === message) ui.lastErrorToast = ''; }, 3000);
            }
            renderJob();
        },
    };
}

export async function startGeneration() {
    if (job.active) return;
    const settings = get();
    const positive = String(valueOf('is-positive') || '').trim();
    const negative = String(valueOf('is-negative') || '').trim();
    if (!positive) {
        toast('warning', '先写正面提示词，或点“角色外观”填入');
        el('is-positive')?.focus();
        return;
    }
    settings.draft.positive = positive;
    settings.draft.negative = negative;
    saveSoon();
    const expanded = expandText(positive);
    const expandedNegative = expandText(negative);
    if (!expanded) {
        toast('warning', '提示词展开后为空，请检查宏');
        return;
    }
    let reference = null;
    try {
        reference = await resolveGenerationReference();
    } catch (error) {
        toast('error', error.message || String(error));
        return;
    }
    job.results = [];
    renderResults();
    setHidden('is-job', false);
    setHidden('is-cancel', true);
    setHidden('is-generate', false);
    startJobTimer();
    bridge.setConnection?.(ui.provider === 'comfy' ? 'busy' : ui.connection, ui.provider === 'comfy' ? 'ComfyUI 连接中…' : '云端请求中…');
    try {
        if (ui.provider === 'cloud') {
            await generateCloud(jobCallbacks(), { positive: expanded, negative: expandedNegative, reference });
        } else {
            await generateComfy(jobCallbacks(), { positive: expanded, negative: expandedNegative, reference });
        }
    } catch (error) {
        toast('error', error.message || String(error));
    } finally {
        renderJob();
        renderResults();
    }
}

function expandText(text) {
    try {
        return expandPrompt(text);
    } catch (error) {
        console.warn('[画坊] 提示词宏展开失败', error);
        return String(text || '').trim();
    }
}

