import {
    composeFinalPrompt,
} from '../character-library.js';
import { imageUrl } from '../history.js';
import { escapeHtml, truncate } from '../util.js';
import { bridge, el, setText, setValue, ui, valueOf } from './core.js';

function libraryRoleLabel(role) {
    return role === 'user' ? '用户角色' : role === 'npc' ? 'NPC' : '角色';
}

export function selectedConfirmEntries() {
    const entries = ui.sceneConfirm?.entries || [];
    const checked = new Set([...document.querySelectorAll('[data-confirm-char]:checked')]
        .map(input => input.dataset.confirmChar));
    return entries.filter(entry => checked.has(entry.id));
}

export function updateConfirmReferences() {
    const node = el('is-confirm-refs');
    if (!node) return;
    const selected = selectedConfirmEntries().filter(entry => entry.referencePath);
    node.innerHTML = selected.length
        ? selected.map(entry => `<img class="is-confirm-ref" src="${escapeHtml(imageUrl(entry.referencePath))}" alt="${escapeHtml(entry.name)} 参考图" title="${escapeHtml(entry.name)}" loading="lazy" />`).join('')
        : '';
}

export function updateConfirmFinal() {
    if (!ui.sceneConfirm) return;
    const scene = String(valueOf('is-confirm-scene') || '');
    const entries = selectedConfirmEntries();
    const style = ui.sceneConfirm.style || 'tags';
    setText('is-confirm-final', composeFinalPrompt(scene, entries, style));
    updateConfirmReferences();
}

function renderConfirmCharacters() {
    const node = el('is-confirm-characters');
    if (!node || !ui.sceneConfirm) return;
    const entries = ui.sceneConfirm.entries || [];
    if (!entries.length) {
        node.innerHTML = '<div class="is-hint">角色库为空。可以先去“角色库”扫描角色卡/世界书，或直接生成纯场景图。</div>';
        updateConfirmFinal();
        return;
    }
    node.innerHTML = entries.map(entry => {
        const checked = ui.sceneConfirm.selectedIds.has(entry.id) ? 'checked' : '';
        const thumb = entry.referencePath ? `<img src="${escapeHtml(imageUrl(entry.referencePath))}" alt="" loading="lazy" />` : '<span class="is-confirm-char-icon fa-solid fa-user"></span>';
        return `<label class="is-confirm-char">
            <input type="checkbox" data-confirm-char="${escapeHtml(entry.id)}" ${checked} />
            ${thumb}
            <span class="is-grow"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(libraryRoleLabel(entry.role))} · ${escapeHtml(truncate(entry.appearance || '未填写外貌', 70))}</small></span>
        </label>`;
    }).join('');
    updateConfirmFinal();
}

/**
 * @param {{messageId:number, entries:Array, selectedIds:Set<string>, targetText:string, style:string, scene:string, negative:string}} data
 */
export function openSceneConfirm(data) {
    ui.sceneConfirm = data;
    const label = data.mode === 'library' ? '角色库' : '目标消息';
    setText('is-confirm-target', `${label}：${truncate(data.targetText || '（无文本）', 240)}`);
    setValue('is-confirm-scene', data.scene);
    setValue('is-confirm-negative', data.negative || '');
    setText('is-confirm-status', data.entries.length ? '' : '角色库为空；可先去角色库扫描，或直接生成纯场景图。');
    renderConfirmCharacters();
    const node = el('is-confirm');
    if (node) node.hidden = false;
}

export function closeSceneConfirm(clearBusy = true) {
    const node = el('is-confirm');
    if (node) node.hidden = true;
    const messageId = ui.sceneConfirm?.messageId;
    ui.sceneConfirm = null;
    if (clearBusy) {
        ui.messageGenBusy = false;
        document.querySelectorAll('.is-gen-image-button.is-busy').forEach(button => button.classList.remove('is-busy'));
        if (messageId != null) {
            bridge.clearMessageSlot?.(messageId);
            setTimeout(() => bridge.restoreMessageThumbnails?.(), 50);
        }
        bridge.refreshMessageGenButton?.();
    }
}


export async function confirmSceneGeneration() {
    if (!ui.sceneConfirm) return;
    const mode = ui.sceneConfirm.mode || 'message';
    const rawScene = String(valueOf('is-confirm-scene') || '').trim();
    const scene = rawScene || (mode === 'library'
        ? 'full body character reference, neutral background, soft lighting'
        : '');
    if (!scene) {
        setText('is-confirm-status', '场景提示词不能为空');
        return;
    }
    const entries = selectedConfirmEntries();
    const negative = String(valueOf('is-confirm-negative') || '').trim();
    const positive = composeFinalPrompt(scene, entries, ui.sceneConfirm.style || 'tags');
    const messageId = ui.sceneConfirm.messageId;
    if (mode === 'library') {
        const referenceEntry = entries.find(entry => entry.referencePath);
        bridge.setGenerationReference?.(referenceEntry
            ? { path: referenceEntry.referencePath, name: referenceEntry.name }
            : null);
        closeSceneConfirm(false);
        await bridge.startLibraryImageGeneration?.(positive, negative, entries);
        return;
    }
    const referenceEntry = entries.find(entry => entry.referencePath);
    if (referenceEntry) {
        bridge.setGenerationReference?.({ path: referenceEntry.referencePath, name: referenceEntry.name });
    }
    closeSceneConfirm(false);
    await bridge.startMessageImageGeneration?.(messageId, positive, negative);
}

