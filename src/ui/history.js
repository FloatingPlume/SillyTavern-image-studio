import { get, save } from '../store.js';
import { escapeHtml, imagePathToUrl, truncate } from '../util.js';
import { downloadImageBlob, imageUrl, insertAsMessage, saveBlobToST, setAsBackground } from '../history.js';
import { renderCat } from '../floating-cat.js';
import { updateAutosave } from './api.js';
import { bridge, el, ui } from './core.js';

export function renderHistory() {
    const settings = get();
    const node = el('is-history-list');
    if (!node) return;
    updateAutosave();
    if (!settings.history.length) {
        node.innerHTML = '<div class="is-hint">还没有生成记录。图片默认会保存到酒馆图库的 image-studio 文件夹。</div>';
        renderCat();
        return;
    }
    node.innerHTML = settings.history.map(entry => {
        const thumb = entry.path ? imagePathToUrl(entry.path) : '';
        const thumbHtml = thumb
            ? `<img class="is-history-thumb" src="${escapeHtml(thumb)}" alt="生成记录" data-history-open="${escapeHtml(entry.id)}" loading="lazy" />`
            : `<div class="is-history-thumb is-history-placeholder" data-history-open="${escapeHtml(entry.id)}"><i class="fa-solid fa-image"></i></div>`;
        return `<div class="is-history-item">
            ${thumbHtml}
            <div class="is-history-info">
                <strong>${escapeHtml(truncate(entry.positive || '未记录提示词', 80))}</strong>
                <span>${escapeHtml(entry.provider === 'comfy' ? 'ComfyUI' : entry.profileName || '云端')} · ${escapeHtml(entry.model || '')}</span>
                <span>${new Date(entry.createdAt).toLocaleString()} · seed ${escapeHtml(entry.seed ?? '—')} · ${escapeHtml(entry.width || '')}×${escapeHtml(entry.height || '')}</span>
                <div class="is-history-actions">
                    <button type="button" class="is-link" data-history-action="view" data-id="${escapeHtml(entry.id)}">查看</button>
                    <button type="button" class="is-link" data-history-action="reuse" data-id="${escapeHtml(entry.id)}">复用参数</button>
                    <button type="button" class="is-link" data-history-action="download" data-id="${escapeHtml(entry.id)}">下载</button>
                    <button type="button" class="is-link" data-history-action="bg" data-id="${escapeHtml(entry.id)}">背景</button>
                    <button type="button" class="is-link" data-history-action="chat" data-id="${escapeHtml(entry.id)}">插入聊天</button>
                    <button type="button" class="is-link" data-history-action="delete" data-id="${escapeHtml(entry.id)}">删除记录</button>
                </div>
            </div>
        </div>`;
    }).join('');
    renderCat();
}

export function openLightbox(item, source = 'history') {
    if (!item) return;
    ui.lightbox = { item, source };
    const path = item.path || '';
    const url = path ? imageUrl(path) : item._url || (item.blob ? URL.createObjectURL(item.blob) : '');
    const img = el('is-lb-img');
    if (img) img.src = url;
    const meta = el('is-lb-meta');
    if (meta) {
        meta.textContent = [
            item.positive ? `提示词：${item.positive}` : '',
            item.negative ? `负面：${item.negative}` : '',
            `模型：${item.model || item.profileName || '—'} · seed ${item.seed ?? '—'} · ${item.width || ''}×${item.height || ''}`,
            item.createdAt ? new Date(item.createdAt).toLocaleString() : '',
        ].filter(Boolean).join('\n');
    }
    const bg = el('is-lb-bg');
    const chat = el('is-lb-chat');
    if (bg) bg.disabled = false;
    if (chat) chat.disabled = false;
    const lightbox = el('is-lightbox');
    if (lightbox) lightbox.hidden = false;
}

export function closeLightbox() {
    const lightbox = el('is-lightbox');
    if (lightbox) lightbox.hidden = true;
    ui.lightbox = null;
}

export function entryById(id) {
    return get().history.find(item => item.id === id);
}

export async function ensurePath(item) {
    if (item.path) return item.path;
    if (item.blob) {
        const saved = await saveBlobToST(item.blob, { filename: `image-studio-${Date.now()}` });
        item.path = saved.path;
        if (!item.filename) item.filename = saved.filename;
        return item.path;
    }
    throw new Error('没有可用的图片文件');
}

export async function downloadItem(item) {
    try {
        const filename = item.filename || `${item.seed || Date.now()}.png`;
        if (item.blob) {
            downloadImageBlob(item.blob, filename);
            return;
        }
        if (item.path) {
            const response = await fetch(imageUrl(item.path));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            downloadImageBlob(blob, filename);
            return;
        }
        throw new Error('没有图片文件');
    } catch (error) {
        toast('error', `下载失败：${error.message || error}`);
    }
}

export async function backgroundFromItem(item) {
    try {
        const path = await ensurePath(item);
        await setAsBackground(path);
        toast('success', '已设为聊天背景');
    } catch (error) {
        toast('error', `设置背景失败：${error.message || error}`);
    }
}

export async function chatFromItem(item) {
    try {
        const path = await ensurePath(item);
        await insertAsMessage(path, item.positive || '');
        toast('success', '已作为一条消息插入聊天');
        closeLightbox();
    } catch (error) {
        toast('error', `插入聊天失败：${error.message || error}`);
    }
}

export function reuseEntry(entry) {
    const settings = get();
    settings.draft.positive = entry.positive || '';
    settings.draft.negative = entry.negative || '';
    settings.comfy.seed = entry.seed ?? -1;
    settings.cloud.seed = entry.seed ?? -1;
    settings.comfy.width = entry.width || settings.comfy.width;
    settings.comfy.height = entry.height || settings.comfy.height;
    settings.cloud.width = entry.width || settings.cloud.width;
    settings.cloud.height = entry.height || settings.cloud.height;
    settings.provider = entry.provider === 'comfy' ? 'comfy' : 'cloud';
    save();
    bridge.switchTab?.('generate');
    bridge.refreshForm?.();
    toast('success', '参数已复用');
}

