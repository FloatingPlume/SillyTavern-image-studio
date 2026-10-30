import { stRequest } from './net.js';
import { ctx, blobToBase64, downloadBlob, mimeToFormat, sanitizeFileName, slugify } from './util.js';

export async function saveBlobToST(blob, { filename, folder = 'image-studio' } = {}) {
    const format = mimeToFormat(blob.type);
    const image = await blobToBase64(blob);
    const baseName = sanitizeFileName(filename || `${slugify(new Date().toISOString())}`, format).replace(/\.[^.]+$/, '');
    const payload = await stRequest('/api/images/upload', {
        method: 'POST',
        body: {
            image,
            format,
            filename: baseName,
            ch_name: folder,
        },
        timeout: 120_000,
    });
    if (!payload?.path) throw new Error('图片保存到酒馆失败');
    return { path: payload.path, format, filename: `${baseName}.${format}` };
}

export function imageUrl(path) {
    if (!path) return '';
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    return `/${String(path).replace(/^\/+/, '')}`;
}

export async function setAsBackground(path) {
    const context = ctx();
    if (!context) throw new Error('酒馆未就绪');
    const eventName = context.eventTypes?.FORCE_SET_BACKGROUND || context.event_types?.FORCE_SET_BACKGROUND || 'force_set_background';
    await context.eventSource.emit(eventName, {
        url: `url("${encodeURI(imageUrl(path))}")`,
        path,
    });
}

export async function insertAsMessage(path, prompt = '') {
    const context = ctx();
    if (!context) throw new Error('酒馆未就绪');
    if (!Array.isArray(context.chat)) throw new Error('当前没有打开的聊天');
    const eventTypes = context.eventTypes || context.event_types || {};
    const name = context.name2 || 'Artist';
    const message = {
        name,
        is_user: false,
        is_system: false,
        send_date: Date.now(),
        mes: '',
        extra: {
            media: [{
                url: path,
                type: 'image',
                title: prompt || 'Image Studio',
                generation_type: 'free',
                negative: '',
                source: 'generated',
            }],
            media_display: 'gallery',
            media_index: 0,
            inline_image: false,
        },
    };
    context.chat.push(message);
    const messageId = context.chat.length - 1;
    if (eventTypes.MESSAGE_RECEIVED) {
        await context.eventSource.emit(eventTypes.MESSAGE_RECEIVED, messageId, 'extension');
    }
    context.addOneMessage(message);
    if (eventTypes.CHARACTER_MESSAGE_RENDERED) {
        await context.eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, messageId, 'extension');
    }
    await context.saveChat?.();
    setTimeout(() => context.scrollOnMediaLoad?.(), 300);
    return messageId;
}

export function downloadImageBlob(blob, filename) {
    downloadBlob(blob, filename || `image-studio-${Date.now()}.png`);
}

export async function deleteStoredImage(path) {
    if (!path) return;
    try {
        await stRequest('/api/images/delete', {
            method: 'POST',
            body: { path },
        });
    } catch (error) {
        throw new Error(`删除图片文件失败：${error.message}`);
    }
}
