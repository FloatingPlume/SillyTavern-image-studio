import { CHAT_TYPES, CLOUD_IMAGE_TYPES } from '../constants.js';
import { ctx } from '../util.js';

export const ui = {
    initialized: false,
    tab: 'generate',
    apiKind: 'image',
    provider: 'comfy',
    models: null,
    stats: null,
    connection: 'idle',
    monitorTimer: null,
    monitorBusy: false,
    jobTimer: null,
    lastComfyCheck: 0,
    editing: null,
    balanceBusy: new Set(),
    lightbox: null,
    resultUrls: new Map(),
    rewriteBusy: false,
    libraryScanBusy: false,
    lastErrorToast: '',
    editorModels: [],
    modelCategory: 'all',
    modelQuery: '',
    modelsFetching: false,
    scanAbort: null,
    scanResults: [],
    messageResults: new Map(),
    staleMessages: new Set(),
    chatEventsBound: false,
    disableMessageRestore: false,
    messageGenBusy: false,
    libraryCandidates: [],
    librarySelected: new Set(),
    librarySelectionInitialized: false,
    libraryConvertBusy: false,
    libraryEditingId: null,
    libraryReferencePath: '',
    referenceBlob: null,
    referenceObjectUrl: '',
    sceneConfirm: null,
};

/**
 * Cross-feature callbacks filled in by ui.js after all modules load.
 * Keeps feature modules independent and avoids circular imports.
 */
export const bridge = {};

export function wireBridge(patch) {
    Object.assign(bridge, patch);
}

export function el(id) {
    return document.getElementById(id);
}

export function valueOf(id) {
    return el(id)?.value ?? '';
}

export function setValue(id, value) {
    const node = el(id);
    if (node) node.value = value ?? '';
}

export function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text ?? '';
}

export function setHidden(id, hidden) {
    const node = el(id);
    if (node) node.hidden = !!hidden;
}

export function setHtml(id, html) {
    const node = el(id);
    if (node) node.innerHTML = html;
}

export function profileHost(profile) {
    try {
        return new URL(profile.baseUrl).host;
    } catch {
        return profile.baseUrl || '未填写地址';
    }
}

export function maskKey(profile) {
    return profile.apiKey ? '已配置 Key' : '无 Key';
}

export function typeLabel(kind, type) {
    const meta = (kind === 'chat' ? CHAT_TYPES : CLOUD_IMAGE_TYPES).find(item => item.id === type);
    return meta?.label || type;
}

export async function confirmAction(message) {
    const context = ctx();
    if (context?.callGenericPopup && context?.POPUP_TYPE?.CONFIRM != null) {
        const result = await context.callGenericPopup(message, context.POPUP_TYPE.CONFIRM, '', {
            okButton: '确定',
            cancelButton: '取消',
        });
        return result === context.POPUP_RESULT?.AFFIRMATIVE;
    }
    return globalThis.confirm ? globalThis.confirm(message) : true;
}
