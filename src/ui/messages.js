import { get, saveSoon } from '../store.js';
import { buildCharacterPrompt, expandPrompt, parseRewriteResult } from '../prompt.js';
import { getCharacterLibrary, matchCharacterNames, matchPresentCharacters } from '../character-library.js';
import { ctx, stripHtml, debounce, toast, truncate } from '../util.js';
import { generateCloud, generateComfy, job } from '../jobs.js';
import { imageUrl } from '../history.js';
import { normalizeContextMessages } from '../plugin-model.js';
import { applyStats } from './monitor.js';
import { bridge, setValue, ui } from './core.js';
import { renderLibrary, renderLibraryCandidates } from './library.js';
import { closeSceneConfirm, openSceneConfirm } from './scene.js';

function expandText(text) {
    try {
        return expandPrompt(text);
    } catch (error) {
        console.warn('[画坊] 提示词宏展开失败', error);
        return String(text || '').trim();
    }
}

function messageChatId() {
    const context = ctx();
    return String(context?.getCurrentChatId?.() || context?.chatId || '');
}

function removeMessageArtifacts() {
    document.querySelectorAll('.is-gen-image-button').forEach(node => node.remove());
    document.querySelectorAll('.is-message-image-slot').forEach(node => node.remove());
}

export function refreshMessageGenButton() {
    document.querySelectorAll('.is-gen-image-button').forEach(node => node.remove());
    const chat = ctx()?.chat || [];
    for (let messageId = 0; messageId < chat.length; messageId += 1) {
        const message = chat[messageId];
        if (!message || message.is_user || message.is_system) continue;
        const buttons = document.querySelector(`.mes[mesid="${messageId}"] .mes_buttons`);
        if (!buttons) continue;
        const button = document.createElement('div');
        button.className = 'mes_button is-gen-image-button fa-solid fa-wand-magic-sparkles';
        button.title = '画坊：按这条消息生成插画（后台）';
        button.dataset.mesid = String(messageId);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            generateFromMessage(messageId);
        });
        const edit = buttons.querySelector('.mes_edit');
        buttons.insertBefore(button, edit || null);
        if (job.active
            && String(job.details?.messageId) === String(messageId)
            && String(job.details?.chatId || '') === messageChatId()) {
            button.classList.add('is-busy');
        }
    }
}

function messageSlot(messageId) {
    const block = document.querySelector(`.mes[mesid="${messageId}"] .mes_block`);
    if (!block) return null;
    let slot = block.querySelector(`.is-message-image-slot[data-mesid="${messageId}"]`);
    if (!slot) {
        slot = document.createElement('div');
        slot.className = 'is-message-image-slot';
        slot.dataset.mesid = String(messageId);
        const bias = block.querySelector('.mes_bias');
        block.insertBefore(slot, bias || null);
    }
    return slot;
}

function setMessageState(messageId, text, isError = false) {
    const slot = messageSlot(messageId);
    if (!slot) return;
    let state = slot.querySelector('.is-message-gen-state');
    if (!state) {
        slot.innerHTML = '';
        state = document.createElement('div');
        state.className = 'is-message-gen-state';
        const icon = document.createElement('i');
        const label = document.createElement('span');
        state.append(icon, label);
        slot.appendChild(state);
    }
    state.classList.toggle('is-error', !!isError);
    const icon = state.querySelector('i');
    if (icon) icon.className = `fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-spinner fa-spin'}`;
    const label = state.querySelector('span');
    if (label) label.textContent = text || '';
}

function renderMessageThumb(messageId, item) {
    if (!item) return;
    const slot = messageSlot(messageId);
    if (!slot) return;
    let url = item.path ? imageUrl(item.path) : item._url || '';
    if (!url && item.blob) {
        url = URL.createObjectURL(item.blob);
        item._url = url;
    }
    if (!url) return;
    slot.innerHTML = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'is-message-thumb';
    button.title = '画坊生成 · 点击放大';
    const image = document.createElement('img');
    image.src = url;
    image.alt = '画坊生成';
    const label = document.createElement('span');
    label.className = 'is-thumb-label';
    label.textContent = '画坊';
    button.append(image, label);
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        bridge.openLightbox?.(item, 'message');
    });
    slot.appendChild(button);
}

export function clearMessageSlot(messageId) {
    document.querySelector(`.mes[mesid="${messageId}"] .is-message-image-slot`)?.remove();
}

export function restoreMessageThumbnails() {
    if (ui.disableMessageRestore) return;
    const chatId = messageChatId();
    const chat = ctx()?.chat || [];
    const history = get().history || [];
    for (let index = 0; index < chat.length; index += 1) {
        if (chat[index]?.is_user || chat[index]?.is_system) continue;
        if (ui.staleMessages.has(index)) continue;
        const slot = document.querySelector(`.mes[mesid="${index}"] .is-message-image-slot`);
        if (slot && slot.querySelector('.is-message-thumb, .is-message-gen-state')) continue;
        let item = ui.messageResults.get(index);
        if (!item) {
            const entry = history.find(candidate =>
                candidate.path
                && Number(candidate.messageId) === index
                && candidate.chatId === chatId);
            if (entry) item = entry;
        }
        if (item) renderMessageThumb(index, item);
    }
}

function attachMessageResult(messageId, result) {
    if (!result) return;
    const details = job.details || {};
    const item = {
        ...result,
        positive: details.positive || result.positive || '',
        negative: details.negative || result.negative || '',
        model: details.model || details.checkpoint || '',
        seed: details.seed,
        width: details.width,
        height: details.height,
        createdAt: Date.now(),
    };
    ui.messageResults.set(Number(messageId), item);
    ui.staleMessages.delete(Number(messageId));
    const sourceChat = String(details.chatId || '');
    if (!sourceChat || sourceChat === messageChatId()) {
        renderMessageThumb(messageId, item);
    }
}

async function effectiveLibraryEntries() {
    const existing = getCharacterLibrary();
    if (existing.length) return existing;
    try {
        const candidates = await scanCharacterCandidates();
        return candidates.filter(candidate => candidate.source === 'character-card' || candidate.source === 'persona');
    } catch (error) {
        console.warn('[画坊] 初始化角色库条目失败', error);
        return [];
    }
}

function recentContextText(beforeIndex = null) {
    const chat = ctx()?.chat || [];
    const limit = normalizeContextMessages(get().pluginModel.contextMessages);
    if (!limit) return '';
    const end = Number.isInteger(beforeIndex) ? Math.min(beforeIndex, chat.length) : chat.length;
    return chat.slice(Math.max(0, end - limit), end)
        .map(message => `${message.name || (message.is_user ? 'User' : 'Character')}: ${stripHtml(message.mes || '')}`)
        .join('\n');
}


async function openMessageSceneConfirm(messageId) {
    if (job.active || ui.messageGenBusy) {
        toast('warning', '已有画坊生成任务在运行，等它完成再点');
        return;
    }
    const context = ctx();
    const message = context?.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return;
    ui.messageGenBusy = true;
    const settings = get();
    const target = stripHtml(message.mes || '');
    const button = document.querySelector(`.mes[mesid="${messageId}"] .is-gen-image-button`);
    button?.classList.add('is-busy');
    ui.staleMessages.delete(Number(messageId));
    setMessageState(messageId, '提取场景与角色…');

    const entries = await effectiveLibraryEntries();
    let scene = '';
    let negative = settings.prompt.negative || '';
    let aiCharacters = [];
    try {
        const style = settings.prompt.style || 'tags';
        const raw = await bridge.requestRewrite?.({
            style,
            intent: 'Illustrate this exact message as one cinematic image. Infer the location, lighting, pose, expression and mood from the target message and the preceding context. Do not paint dialogue text or UI.',
            positive: '',
            negative,
            targetMessage: target,
            targetIndex: Number(messageId),
            libraryEntries: entries,
        });
        const parsed = parseRewriteResult(raw, negative);
        scene = parsed.positive;
        negative = parsed.negative || negative;
        aiCharacters = parsed.characters || [];
    } catch (error) {
        console.warn('[画坊] 场景提取失败，使用消息原文兜底', error);
        scene = [buildCharacterPrompt(), truncate(target, 1200)].filter(Boolean).join(', ');
    }
    scene = expandText(scene);
    if (!scene) {
        closeSceneConfirm();
        setMessageState(messageId, '没有可用的提示词', true);
        return;
    }
    const aiMatches = matchCharacterNames(entries, aiCharacters);
    const textMatches = matchPresentCharacters(entries, `${target}\n${recentContextText(Number(messageId))}`);
    let selected = [...new Map([...aiMatches, ...textMatches].map(entry => [entry.id, entry])).values()];
    if (!selected.length) selected = defaultPresentCharacters(entries);
    const selectedIds = new Set(selected.map(entry => entry.id));
    openSceneConfirm({
        messageId: Number(messageId),
        entries,
        selectedIds,
        targetText: target,
        style: settings.prompt.style || 'tags',
        scene,
        negative,
    });
}

export async function startMessageImageGeneration(messageId, positive, negative) {
    if (!positive) {
        toast('warning', '场景提示词为空');
        return;
    }
    const sourceMessage = ctx()?.chat?.[messageId];
    bridge.setGenerationSource?.({
        type: 'message',
        label: `对话生图 · 第 ${Number(messageId) + 1} 条`,
        detail: truncate(stripHtml(sourceMessage?.mes || ''), 48),
    });
    ui.messageGenBusy = true;
    const settings = get();
    const chatId = messageChatId();
    const button = document.querySelector(`.mes[mesid="${messageId}"] .is-gen-image-button`);
    button?.classList.add('is-busy');
    settings.draft.positive = positive;
    settings.draft.negative = negative;
    setValue('is-positive', positive);
    setValue('is-negative', negative);
    saveSoon();
    let reference = null;
    try {
        reference = await bridge.resolveGenerationReference?.();
    } catch (error) {
        console.warn('[画坊] 参考图读取失败，按文字生成', error);
    }
    setMessageState(messageId, '生成中…');

    const meta = { messageId: Number(messageId), chatId, source: 'message' };
    const callbacks = {
        onUpdate: snapshot => {
            if (snapshot.status === 'done') return;
            if (snapshot.status === 'cancelled') {
                ui.messageGenBusy = false;
                button?.classList.remove('is-busy');
                setMessageState(messageId, '已停止', true);
                setTimeout(refreshMessageGenButton, 50);
                return;
            }
            setMessageState(messageId, snapshot.statusText || '生成中…');
            button?.classList.add('is-busy');
            bridge.renderJob?.();
            bridge.renderHistory?.();
        },
        onStats: stats => applyStats(stats),
        onResult: results => {
            if (results?.[0]) attachMessageResult(messageId, results[0]);
            button?.classList.remove('is-busy');
            bridge.renderResults?.();
            bridge.renderHistory?.();
        },
        onDone: () => {
            ui.messageGenBusy = false;
            button?.classList.remove('is-busy');
            setTimeout(refreshMessageGenButton, 50);
            bridge.renderJob?.();
            toast('success', '画坊：消息插画已生成');
        },
        onError: error => {
            ui.messageGenBusy = false;
            button?.classList.remove('is-busy');
            setMessageState(messageId, `生成失败：${truncate(error?.message || error, 80)}`, true);
            setTimeout(refreshMessageGenButton, 50);
            bridge.renderJob?.();
        },
    };
    try {
        if (settings.provider === 'cloud') {
            await generateCloud(callbacks, { positive, negative, meta, reference });
        } else {
            await generateComfy(callbacks, { positive, negative, meta, reference });
        }
    } catch (error) {
        ui.messageGenBusy = false;
        button?.classList.remove('is-busy');
        setMessageState(messageId, `生成失败：${truncate(error.message || error, 80)}`, true);
        toast('error', `画坊消息生图失败：${truncate(error.message || error, 350)}`);
    }
}


async function generateFromMessage(messageId) {
    await openMessageSceneConfirm(messageId);
}

export function bindChatMessageEvents() {
    if (ui.chatEventsBound) return;
    const context = ctx();
    const eventSource = context?.eventSource;
    if (!eventSource?.on) return;
    ui.chatEventsBound = true;
    const types = context.eventTypes || context.event_types || {};
    const schedule = debounce(() => {
        refreshMessageGenButton();
        restoreMessageThumbnails();
    }, 100);
    const names = ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'CHAT_CHANGED', 'GENERATION_ENDED'];
    for (const name of names) {
        const eventName = types[name] || String(name).toLowerCase();
        eventSource.on(eventName, (...args) => {
            if (name === 'CHAT_CHANGED') {
                removeMessageArtifacts();
                ui.messageResults.clear();
                ui.staleMessages.clear();
                ui.disableMessageRestore = false;
                closeLibraryEditor();
                ui.libraryCandidates = [];
                ui.librarySelected.clear();
                ui.librarySelectionInitialized = false;
                bridge.clearGenerationReference?.();
                bridge.resetGenerationSource?.();
                renderLibraryCandidates();
                if (ui.tab === 'library') renderLibrary();
                setTimeout(schedule, 250);
                return;
            }
            if (name === 'MESSAGE_DELETED') {
                removeMessageArtifacts();
                ui.messageResults.clear();
                ui.staleMessages.clear();
                ui.disableMessageRestore = true;
                refreshMessageGenButton();
                return;
            }
            if (name === 'MESSAGE_SWIPED' || name === 'MESSAGE_EDITED') {
                const id = Number(args[0]);
                if (Number.isInteger(id) && id >= 0) {
                    ui.staleMessages.add(id);
                    ui.messageResults.delete(id);
                    clearMessageSlot(id);
                }
            }
            schedule();
        });
    }
    setTimeout(schedule, 700);
}

