import { get, saveSoon } from '../store.js';
import { expandPrompt } from '../prompt.js';
import { escapeHtml, toast, truncate } from '../util.js';
import { generateCloud, generateComfy, job } from '../jobs.js';
import { imageUrl, saveBlobToST } from '../history.js';
import {
    collectLibraryScanSources,
    defaultPresentCharacters,
    getCharacterLibrary,
    libraryEntriesFromScan,
    mergeLibraryEntries,
    normalizeLibraryEntry,
    saveCharacterLibrary,
} from '../character-library.js';
import {
    buildCharacterPromptMessages,
    buildLibraryScanMessages,
    parseCharacterPromptResult,
    parseLibraryScanResult,
} from '../library-scan.js';
import { bridge, ui, confirmAction, el, setHidden, setText, setValue, valueOf } from './core.js';
import { openSceneConfirm } from './scene.js';

function expandText(text) {
    try {
        return expandPrompt(text);
    } catch (error) {
        console.warn('[画坊] 提示词宏展开失败', error);
        return String(text || '').trim();
    }
}

function libraryRoleLabel(role) {
    return role === 'user' ? '用户角色' : role === 'npc' ? 'NPC' : '角色';
}

function librarySourceLabel(source) {
    if (source === 'persona') return '用户设定';
    if (source === 'character-card') return '角色卡';
    if (source === 'ai-scan') return 'AI';
    return '世界书';
}

function renderLibraryScanOptions() {
    const settings = get();
    const ai = el('is-library-ai-scan');
    if (ai) ai.checked = settings.libraryScan?.ai !== false;
    const scope = el('is-library-scan-scope');
    if (scope) scope.value = settings.libraryScan?.scope === 'all' ? 'all' : 'active';
}

export function renderLibrary() {
    const context = ctx();
    const character = context?.characters?.[context?.characterId];
    setText('is-library-char', character ? `当前：${character.name || '未命名'}` : '当前没有打开角色卡');
    renderLibraryScanOptions();
    const entries = getCharacterLibrary();
    const validIds = new Set(entries.map(entry => entry.id));
    for (const id of [...ui.librarySelected]) {
        if (!validIds.has(id)) ui.librarySelected.delete(id);
    }
    if (!ui.librarySelectionInitialized && entries.length) {
        defaultPresentCharacters(entries).forEach(entry => ui.librarySelected.add(entry.id));
        ui.librarySelectionInitialized = true;
    }
    const list = el('is-library-list');
    if (!list) return;
    if (!entries.length) {
        list.innerHTML = '<div class="is-hint">角色库还是空的。点“扫描角色卡 / 世界书”找候选，或手动添加。</div>';
        return;
    }
    list.innerHTML = entries.map(entry => {
        const thumb = entry.referencePath ? imageUrl(entry.referencePath) : '';
        const selected = ui.librarySelected.has(entry.id);
        return `<div class="is-library-item" data-library-id="${escapeHtml(entry.id)}">
            <label class="is-library-check" title="选中后用于 AI 转提示词 / 生图">
                <input type="checkbox" data-library-check="${escapeHtml(entry.id)}" ${selected ? 'checked' : ''} />
            </label>
            ${thumb
                ? `<img class="is-library-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(entry.name)}" loading="lazy" />`
                : '<div class="is-library-thumb is-library-thumb-empty"><i class="fa-solid fa-user"></i></div>'}
            <div class="is-library-info">
                <strong>${escapeHtml(entry.name)} <span class="is-badge">${escapeHtml(libraryRoleLabel(entry.role))}</span></strong>
                <div class="is-hint">${escapeHtml(entry.aliases?.length ? `别名：${entry.aliases.join('、')}` : '无别名')}</div>
                <div class="is-library-desc">${escapeHtml(truncate(entry.appearance || '未填写外貌', 110))}</div>
                ${entry.prompt ? '<div class="is-hint is-library-prompt-hint">提示词：已转换</div>' : ''}
                <div class="is-library-actions">
                    <button type="button" class="is-link" data-library-action="edit" data-id="${escapeHtml(entry.id)}">编辑</button>
                    <button type="button" class="is-link" data-library-action="delete" data-id="${escapeHtml(entry.id)}">删除</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

export function renderLibraryCandidates() {
    const wrap = el('is-library-candidates-wrap');
    const list = el('is-library-candidates');
    if (!wrap || !list) return;
    const candidates = ui.libraryCandidates || [];
    wrap.hidden = !candidates.length;
    if (!candidates.length) {
        list.innerHTML = '';
        return;
    }
    const existingNames = new Set((getCharacterLibrary() || []).map(entry => entry.name.toLowerCase()));
    list.innerHTML = candidates.map(candidate => {
        const existing = existingNames.has(candidate.name.toLowerCase());
        const checked = !existing && (candidate.source === 'character-card' || candidate.source === 'persona');
        return `<label class="is-library-candidate">
            <input type="checkbox" data-library-candidate="${escapeHtml(candidate.id)}" ${checked ? 'checked' : ''} />
            <span class="is-library-candidate-body">
                <strong>${escapeHtml(candidate.name)}</strong>
                <span class="is-badge">${escapeHtml(librarySourceLabel(candidate.source))}</span>
                ${existing ? '<span class="is-badge">已在库</span>' : ''}
                <span class="is-hint">${escapeHtml(truncate(candidate.appearance, 160))}</span>
                ${candidate.outfit ? `<span class="is-hint">服装：${escapeHtml(truncate(candidate.outfit, 120))}</span>` : ''}
            </span>
        </label>`;
    }).join('');
}

export async function scanLibrary() {
    if (ui.libraryScanBusy) return;
    const settings = get();
    const aiInput = el('is-library-ai-scan');
    const useAi = aiInput ? aiInput.checked : settings.libraryScan?.ai !== false;
    const scope = valueOf('is-library-scan-scope') === 'all' ? 'all' : 'active';
    settings.libraryScan = { ai: useAi, scope };
    saveSoon();
    ui.libraryScanBusy = true;
    const button = el('is-library-scan');
    if (button) button.disabled = true;
    setText('is-library-status', scope === 'all'
        ? '正在读取角色卡、用户设定和整本关联世界书…'
        : '正在收集角色卡、用户设定和当前对话激活的世界书…');
    try {
        const collected = await collectLibraryScanSources({ scope });
        let candidates = collected.mechanical || [];
        let status = '';
        let extraWorldbookCandidates = 0;
        if (useAi && collected.sources.length) {
            setText('is-library-status', `AI 提炼中…（${collected.sources.length} 个来源，约 ${collected.meta.totalChars} 字符）`);
            try {
                const messages = buildLibraryScanMessages({
                    sources: collected.sources,
                    existingNames: getCharacterLibrary().map(entry => entry.name),
                });
                const raw = await bridge.requestPluginCompletion?.(messages, { maxTokens: 1800, temperature: 0.2 });
                const characters = parseLibraryScanResult(raw);
                if (!characters.length) throw new Error('模型没有返回可用的角色设定');
                const aiCandidates = libraryEntriesFromScan(characters, collected.sources);
                candidates = aiCandidates;
                if (collected.meta.activationFallback) {
                    const known = new Set(aiCandidates.map(candidate => candidate.name.toLowerCase()));
                    const extras = (collected.mechanical || []).filter(candidate =>
                        candidate.source.startsWith('worldbook:') && !known.has(candidate.name.toLowerCase()));
                    extraWorldbookCandidates = extras.length;
                    candidates = aiCandidates.concat(extras);
                }
                status = extraWorldbookCandidates
                    ? `AI 提炼 ${aiCandidates.length} 个角色；世界书未激活，另补入 ${extraWorldbookCandidates} 个机械候选`
                    : `AI 从 ${collected.sources.length} 个来源提炼出 ${aiCandidates.length} 个角色`;
            } catch (error) {
                console.warn('[画坊] AI 角色库扫描失败，使用机械候选', error);
                candidates = collected.mechanical || [];
                status = `AI 提炼失败，已退回机械扫描：${truncate(error.message || error, 120)}`;
            }
        } else {
            status = useAi ? '没有可提炼的文本，使用机械扫描' : '使用机械扫描';
        }
        ui.libraryCandidates = candidates;
        renderLibraryCandidates();
        const notes = [];
        if (collected.meta.activated) notes.push(`当前对话激活 ${collected.meta.activated} 条世界书`);
        if (collected.meta.activationFallback && collected.meta.scannedBooks && !extraWorldbookCandidates) notes.push('未检测到激活条目，世界书已回退为机械扫描');
        if (collected.meta.omittedSources) notes.push(`另有 ${collected.meta.omittedSources} 条来源因数量/长度限制未发送`);
        const suffix = notes.length ? `（${notes.join('；')}）` : '';
        setText('is-library-status', candidates.length
            ? `${status}；找到 ${candidates.length} 个候选，勾选后加入角色库${suffix}`
            : `${status}；没有找到带外貌信息的候选，可以手动添加${suffix}`);
    } catch (error) {
        setText('is-library-status', `扫描失败：${error.message || error}`);
    } finally {
        ui.libraryScanBusy = false;
        if (button) button.disabled = false;
    }
}

function selectedLibraryEntries() {
    return getCharacterLibrary().filter(entry => ui.librarySelected.has(entry.id));
}

async function ensureLibraryPrompts(entries, { force = false } = {}) {
    const style = get().prompt.style === 'natural' ? 'natural' : 'tags';
    const pending = (entries || []).filter(entry =>
        (entry.appearance || entry.outfit)
        && (force || !entry.prompt || (entry.promptStyle !== style && entry.promptStyle !== 'manual')));
    if (!pending.length) return entries;
    const messages = buildCharacterPromptMessages({ entries: pending, style });
    const raw = await bridge.requestPluginCompletion?.(messages, { maxTokens: 1400, temperature: 0.25 });
    const parsed = parseCharacterPromptResult(raw);
    if (!parsed.length) throw new Error('模型没有返回角色提示词');
    const promptByName = new Map(parsed.map(item => [item.name.toLowerCase(), item.prompt]));
    const all = getCharacterLibrary().map(entry => {
        if (!pending.some(item => item.id === entry.id)) return entry;
        const names = [entry.name, ...(entry.aliases || [])].map(name => name.toLowerCase());
        const prompt = names.map(name => promptByName.get(name)).find(Boolean);
        return prompt
            ? { ...entry, prompt, promptStyle: style, updatedAt: Date.now() }
            : entry;
    });
    await saveCharacterLibrary(all);
    renderLibrary();
    const updated = getCharacterLibrary();
    return updated.filter(entry => (entries || []).some(item => item.id === entry.id));
}

function setLibraryActionsDisabled(disabled) {
    for (const id of ['is-library-convert', 'is-library-generate', 'is-library-scan']) {
        const button = el(id);
        if (button) button.disabled = disabled;
    }
}

export async function convertSelectedLibraryPrompts() {
    if (ui.libraryConvertBusy) return;
    const entries = selectedLibraryEntries();
    if (!entries.length) {
        toast('warning', '先在角色库里勾选角色');
        return;
    }
    if (!entries.some(entry => entry.appearance || entry.outfit)) {
        toast('warning', '所选角色没有外貌/服装文字可转换');
        return;
    }
    ui.libraryConvertBusy = true;
    setLibraryActionsDisabled(true);
    setText('is-library-status', `AI 转换提示词中…（${entries.length} 个角色）`);
    try {
        const updated = await ensureLibraryPrompts(entries, { force: true });
        const converted = updated.filter(entry => entry.prompt).length;
        setText('is-library-status', `已转换 ${converted}/${entries.length} 个角色提示词；生成时会优先使用它们`);
        toast(converted ? 'success' : 'warning', converted ? '角色提示词已更新' : '没有得到可用的角色提示词');
    } catch (error) {
        setText('is-library-status', `提示词转换失败：${truncate(error.message || error, 200)}`);
        toast('error', `提示词转换失败：${truncate(error.message || error, 300)}`);
    } finally {
        ui.libraryConvertBusy = false;
        setLibraryActionsDisabled(false);
    }
}

export async function generateFromLibrary() {
    if (ui.libraryConvertBusy) return;
    if (job.active) {
        toast('warning', '已有画坊生成任务在运行，等它完成再点');
        return;
    }
    const style = get().prompt.style === 'natural' ? 'natural' : 'tags';
    let entries = selectedLibraryEntries();
    if (!entries.length) {
        toast('warning', '先在角色库里勾选角色');
        return;
    }
    ui.libraryConvertBusy = true;
    setLibraryActionsDisabled(true);
    setText('is-library-status', `准备角色提示词…（${entries.length} 个角色）`);
    try {
        try {
            entries = await ensureLibraryPrompts(entries);
        } catch (error) {
            console.warn('[画坊] 角色提示词转换失败，使用角色库原文', error);
            setText('is-library-status', `提示词转换失败，先用角色库原文：${truncate(error.message || error, 120)}`);
        }
        const settings = get();
        const referenceEntry = entries.find(entry => entry.referencePath);
        bridge.setGenerationReference?.(referenceEntry
            ? { path: referenceEntry.referencePath, name: referenceEntry.name }
            : null);
        setText('is-library-status', `角色提示词已准备（${entries.length} 个角色），确认后生成`);
        openSceneConfirm({
            mode: 'library',
            messageId: null,
            entries,
            selectedIds: new Set(entries.map(entry => entry.id)),
            targetText: entries.map(entry => entry.name).join('、'),
            style,
            scene: settings.draft?.positive?.trim() || '',
            negative: settings.draft?.negative ?? settings.prompt.negative ?? '',
        });
        setText('is-confirm-status', '确认后生成；场景留空会生成角色展示图。');
    } finally {
        ui.libraryConvertBusy = false;
        setLibraryActionsDisabled(false);
    }
}

export async function startLibraryImageGeneration(positive, negative, entries) {
    if (!positive) {
        toast('warning', '角色库生成的提示词为空');
        return;
    }
    bridge.setGenerationSource?.({
        type: 'library',
        label: '角色库生图',
        detail: (entries || []).map(entry => entry.name).join('、'),
    });
    const settings = get();
    settings.draft.positive = positive;
    settings.draft.negative = negative;
    saveSoon();
    setValue('is-positive', positive);
    setValue('is-negative', negative);
    let reference = null;
    try {
        reference = await bridge.resolveGenerationReference?.();
    } catch (error) {
        toast('warning', `参考图读取失败，将按文字生成：${truncate(error.message || error, 160)}`);
    }
    bridge.switchTab?.('generate');
    job.results = [];
    bridge.renderResults?.();
    setHidden('is-job', false);
    setHidden('is-cancel', true);
    setHidden('is-generate', false);
    startJobTimer();
    setConnection(ui.provider === 'comfy' ? 'busy' : ui.connection, ui.provider === 'comfy' ? 'ComfyUI 连接中…' : '云端请求中…');
    const meta = {
        source: 'library',
        libraryIds: (entries || []).map(entry => entry.id),
    };
    try {
        if (ui.provider === 'cloud') {
            await generateCloud(jobCallbacks(), { positive, negative, meta, reference });
        } else {
            await generateComfy(jobCallbacks(), { positive, negative, meta, reference });
        }
    } catch (error) {
        toast('error', `角色库生图失败：${truncate(error.message || error, 350)}`);
    } finally {
        bridge.renderJob?.();
        bridge.renderResults?.();
    }
}

export async function addSelectedLibraryCandidates() {
    const ids = [...document.querySelectorAll('[data-library-candidate]:checked')]
        .map(input => input.dataset.libraryCandidate);
    if (!ids.length) {
        toast('warning', '先勾选要加入的角色');
        return;
    }
    const selected = ui.libraryCandidates.filter(candidate => ids.includes(candidate.id));
    try {
        const entries = mergeLibraryEntries(getCharacterLibrary(), selected);
        await saveCharacterLibrary(entries);
        const saved = getCharacterLibrary();
        for (const candidate of selected) {
            const entry = saved.find(item => item.name.toLowerCase() === candidate.name.toLowerCase());
            if (entry) ui.librarySelected.add(entry.id);
        }
        ui.librarySelectionInitialized = true;
        ui.libraryCandidates = [];
        renderLibraryCandidates();
        renderLibrary();
        setText('is-library-status', `已加入 ${selected.length} 个角色`);
        toast('success', '角色库已更新');
    } catch (error) {
        setText('is-library-status', `保存失败：${error.message || error}`);
        toast('error', error.message || String(error));
    }
}

export function clearLibraryReferencePreview() {
    const image = el('is-library-reference-preview');
    const clear = el('is-library-reference-clear');
    if (image) {
        image.hidden = true;
        image.removeAttribute('src');
    }
    if (clear) clear.hidden = true;
}

export function updateLibraryReferencePreview() {
    const image = el('is-library-reference-preview');
    const clear = el('is-library-reference-clear');
    if (!image) return;
    if (ui.libraryReferencePath) {
        image.src = imageUrl(ui.libraryReferencePath);
        image.hidden = false;
        if (clear) clear.hidden = false;
    } else {
        clearLibraryReferencePreview();
    }
}

export function openLibraryEditor(entry = null) {
    ui.libraryEditingId = entry?.id || null;
    ui.libraryReferencePath = entry?.referencePath || '';
    setText('is-library-editor-title', entry ? `编辑角色：${entry.name}` : '添加角色');
    setValue('is-library-name', entry?.name || '');
    setValue('is-library-aliases', entry?.aliases?.join(', ') || '');
    setValue('is-library-role', entry?.role || 'character');
    setValue('is-library-appearance', entry?.appearance || '');
    setValue('is-library-outfit', entry?.outfit || '');
    setValue('is-library-prompt', entry?.prompt || '');
    setValue('is-library-notes', entry?.notes || '');
    updateLibraryReferencePreview();
    const editor = el('is-library-editor');
    if (editor) {
        editor.hidden = false;
        setTimeout(() => editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        el('is-library-name')?.focus();
    }
}

export function closeLibraryEditor() {
    ui.libraryEditingId = null;
    ui.libraryReferencePath = '';
    setHidden('is-library-editor', true);
    clearLibraryReferencePreview();
}

export async function saveLibraryEditor() {
    const name = String(valueOf('is-library-name') || '').trim();
    if (!name) {
        toast('warning', '角色名不能为空');
        return;
    }
    try {
        let entries = getCharacterLibrary();
        const prompt = String(valueOf('is-library-prompt') || '').trim();
        const entry = normalizeLibraryEntry({
            id: ui.libraryEditingId || undefined,
            name,
            aliases: String(valueOf('is-library-aliases') || '').split(/[,，]/).map(alias => alias.trim()).filter(Boolean),
            role: valueOf('is-library-role') || 'character',
            appearance: valueOf('is-library-appearance'),
            outfit: valueOf('is-library-outfit'),
            prompt,
            promptStyle: prompt ? 'manual' : '',
            notes: valueOf('is-library-notes'),
            referencePath: ui.libraryReferencePath,
            referenceName: '',
            source: 'manual',
        });
        const index = entries.findIndex(item => item.id === ui.libraryEditingId);
        if (index >= 0) entries[index] = { ...entry, id: entries[index].id };
        else entries.push(entry);
        await saveCharacterLibrary(entries);
        closeLibraryEditor();
        const saved = getCharacterLibrary().find(item => item.name.toLowerCase() === name.toLowerCase());
        if (saved) {
            ui.librarySelected.add(saved.id);
            ui.librarySelectionInitialized = true;
        }
        renderLibrary();
        setText('is-library-status', '角色库已保存到当前角色卡');
        toast('success', '角色已保存');
    } catch (error) {
        toast('error', error.message || String(error));
    }
}

export async function deleteLibraryEntry(id) {
    const entry = getCharacterLibrary().find(item => item.id === id);
    if (!entry) return;
    if (!(await confirmAction(`删除角色「${escapeHtml(entry.name)}」？`))) return;
    try {
        const entries = getCharacterLibrary().filter(item => item.id !== id);
        await saveCharacterLibrary(entries);
        ui.librarySelected.delete(id);
        renderLibrary();
        toast('success', '已删除');
    } catch (error) {
        toast('error', error.message || String(error));
    }
}

export async function setLibraryReferenceFile(file) {
    if (!file) return;
    setText('is-library-status', '正在保存参考图…');
    try {
        const saved = await saveBlobToST(file, { filename: `character-ref-${Date.now()}` });
        ui.libraryReferencePath = saved.path;
        updateLibraryReferencePreview();
        setText('is-library-status', '参考图已保存，保存角色后生效');
    } catch (error) {
        setText('is-library-status', `参考图保存失败：${error.message || error}`);
    }
}

