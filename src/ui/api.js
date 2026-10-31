import { BALANCE_PRESETS, CHAT_TYPES, CLOUD_IMAGE_TYPES } from '../constants.js';
import {
    get,
    getBalanceCache,
    getProfiles,
    save,
    saveSoon,
    setBalanceCache,
    upsertProfile,
} from '../store.js';
import {
    MODEL_CATEGORIES,
    canAutoFetchModels,
    categoryCounts,
    fetchProfileModels,
    filterModels,
    modelSummary,
    normalizeModels,
} from '../model-catalog.js';
import { defaultImageProfile } from '../providers.js';
import { normalizeContextMessages, resolvePluginRoute } from '../plugin-model.js';
import { queryBalance, formatBalance, balanceDetails } from '../balance.js';
import {
    applyChatProfile,
    currentChatConfig,
    defaultChatProfile,
    listConnectionProfiles,
} from '../chat.js';
import { escapeHtml, parseJsonLoose, toast, truncate } from '../util.js';
import {
    bridge,
    confirmAction,
    el,
    maskKey,
    profileHost,
    setHidden,
    setText,
    setValue,
    typeLabel,
    ui,
    valueOf,
} from './core.js';

export function currentPluginRoute() {
    return resolvePluginRoute(get(), {
        connectionProfiles: listConnectionProfiles(),
        current: currentChatConfig(),
    });
}

export function renderPluginModel() {
    const settings = get();
    const routeSettings = settings.pluginModel;
    setValue('is-plugin-mode', routeSettings.mode || 'current');
    setValue('is-plugin-context', routeSettings.contextMessages ?? 4);
    const chatSelect = el('is-plugin-profile');
    if (chatSelect) {
        const profiles = settings.chatProfiles || [];
        chatSelect.innerHTML = profiles.length
            ? profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === routeSettings.profileId ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model || '未设模型')}</option>`).join('')
            : '<option value="">（没有画坊聊天 API，去下方添加）</option>';
        if (routeSettings.mode === 'profile' && profiles.length && !profiles.some(profile => profile.id === routeSettings.profileId)) {
            routeSettings.profileId = profiles[0].id;
            saveSoon();
        }
        chatSelect.value = routeSettings.profileId || '';
    }
    const connectionSelect = el('is-plugin-connection');
    if (connectionSelect) {
        const profiles = listConnectionProfiles();
        connectionSelect.innerHTML = profiles.length
            ? profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === routeSettings.connectionProfileId ? 'selected' : ''}>${escapeHtml(profile.name)}${profile.model ? ` · ${escapeHtml(profile.model)}` : ''}</option>`).join('')
            : '<option value="">（酒馆没有连接配置）</option>';
        if (routeSettings.mode === 'connection' && profiles.length && !profiles.some(profile => profile.id === routeSettings.connectionProfileId)) {
            routeSettings.connectionProfileId = profiles[0].id;
            saveSoon();
        }
        connectionSelect.value = routeSettings.connectionProfileId || '';
    }
    syncPluginModelVisibility();
    renderPluginRouteLine();
}

function syncPluginModelVisibility() {
    const mode = valueOf('is-plugin-mode') || 'current';
    setHidden('is-plugin-profile-wrap', mode !== 'profile');
    setHidden('is-plugin-connection-wrap', mode !== 'connection');
}

export function renderPluginRouteLine() {
    const route = currentPluginRoute();
    const count = normalizeContextMessages(get().pluginModel.contextMessages);
    setText('is-rewrite-route', route.ready ? route.label : `${route.label}（未就绪）`);
    let text = '';
    if (route.mode === 'current') {
        text = '当前跟随酒馆聊天 API；系统提示词选“酒馆当前预设”时会连预设和正则一起使用。';
    } else if (!route.ready) {
        text = `当前：${route.label}。请先选择或创建对应配置。`;
    } else {
        text = `当前：${route.label}。独立调用，不改变酒馆聊天 API${route.mode === 'connection' ? '，也不带酒馆预设' : ''}。`;
    }
    setText('is-plugin-status', `${text} 每次附带 ${count} 条最近消息。`);
    syncRewriteSystemUI();
}

export function syncRewriteSystemUI() {
    const settings = get();
    const route = currentPluginRoute();
    const select = el('is-rewrite-system-source');
    const stOption = select?.querySelector('option[value="st"]');
    if (stOption) stOption.disabled = route.mode !== 'current';
    const requested = select?.value || settings.prompt.rewriteSystemSource || 'st';
    const effective = requested === 'st' && route.mode !== 'current' ? 'builtin' : requested;
    if (select && select.value !== effective) select.value = effective;
    const useStPreset = effective === 'st';
    setHidden('is-rewrite-system-text-wrap', useStPreset);
    if (effective === 'builtin') {
        setValue('is-rewrite-system-text', settings.prompt.rewriteSystem || '');
        setText('is-rewrite-system-hint', '使用画坊内置的视觉提示词规范；编辑下方文本会自动转为自定义。');
    } else if (effective === 'custom') {
        setValue('is-rewrite-system-text', settings.prompt.rewriteSystemCustom || settings.prompt.rewriteSystem || '');
        setText('is-rewrite-system-hint', '使用你填写的系统提示词；是否被上游接受取决于模型/服务商策略。');
    } else {
        setText('is-rewrite-system-hint', '使用酒馆当前预设、系统提示词与常规输出处理；会走酒馆当前聊天 API。');
    }
    if (requested === 'st' && route.mode !== 'current') {
        setText('is-rewrite-system-hint', '插件内部模型是独立链路，不能使用酒馆预设；本次使用画坊内置系统提示词。');
    }
}

export function syncWorkflowVisibility() {
    const mode = valueOf('is-workflow-mode') || 'simple';
    setHidden('is-custom-workflow-wrap', mode !== 'custom');
}

export function syncHiresVisibility() {
    const enabled = el('is-hires-enabled')?.checked;
    const fields = el('is-hires-fields');
    if (fields) {
        fields.querySelectorAll('input').forEach(input => {
            input.disabled = !enabled;
        });
    }
}

export function updateAutosave() {
    const box = el('is-autosave');
    if (box) box.checked = get().ui.autoSave !== false;
}

export function renderCurrentChat() {
    const node = el('is-current-chat');
    if (!node) return;
    const current = currentChatConfig();
    if (!current) {
        node.textContent = '酒馆聊天 API 未就绪';
        return;
    }
    node.innerHTML = `<i class="fa-solid fa-plug"></i><div class="is-grow is-current-chat-text"><div>当前酒馆：${escapeHtml(current.model || '未选模型')} · ${escapeHtml(current.source || current.mainApi || '')}</div><div class="is-hint">${escapeHtml(current.baseUrl || '')}</div></div>`;
}

export function renderApi() {
    const settings = get();
    document.querySelectorAll('[data-is-api-kind]').forEach(button => {
        button.classList.toggle('active', button.dataset.isApiKind === ui.apiKind);
    });
    renderPluginModel();
    const list = el('is-api-list');
    if (!list) return;
    const kind = ui.apiKind;
    const profiles = kind === 'chat' ? settings.chatProfiles : settings.imageProfiles;
    if (!profiles.length) {
        list.innerHTML = `<div class="is-hint">还没有${kind === 'chat' ? '聊天' : '生图'} API。点“添加”创建一条，或从酒馆导入当前聊天配置。</div>`;
    } else {
        list.innerHTML = profiles.map(profile => {
            const balance = getBalanceCache(profile.id);
            const balanceText = ui.balanceBusy.has(profile.id) ? '查询中…' : balance ? (balance.ok ? formatBalance(balance) : '余额不可用') : '查余额';
            const balanceTitle = balance ? escapeHtml(balanceDetails(balance)) : '点击查询余额';
            const isDefault = kind === 'image'
                ? settings.cloud.profileId === profile.id
                : settings.pluginModel.mode === 'profile' && settings.pluginModel.profileId === profile.id;
            const applyButton = kind === 'chat'
                ? `<button type="button" class="is-link" data-api-action="apply" data-id="${escapeHtml(profile.id)}">应用到酒馆</button>`
                : '';
            const defaultButton = kind === 'image'
                ? `<button type="button" class="is-link" data-api-action="default" data-id="${escapeHtml(profile.id)}">${isDefault ? '当前默认' : '设为默认'}</button>`
                : `<button type="button" class="is-link" data-api-action="use-plugin" data-id="${escapeHtml(profile.id)}">${isDefault ? '当前插件模型' : '设为插件模型'}</button>`;
            const defaultBadge = isDefault
                ? `<span class="is-badge">${kind === 'image' ? '默认' : '插件模型'}</span>`
                : '';
            return `<div class="is-api-card ${isDefault ? 'is-default' : ''}" data-api-id="${escapeHtml(profile.id)}">
                <div class="is-api-card-head">
                    <span class="is-api-name">${escapeHtml(profile.name)}</span>
                    <span class="is-badge">${escapeHtml(typeLabel(kind, profile.type))}</span>
                    ${defaultBadge}
                    <span class="is-grow"></span>
                    <span class="is-badge is-balance ${balance && !balance.ok ? 'is-error' : ''}" data-api-action="balance" data-id="${escapeHtml(profile.id)}" title="${balanceTitle}">${escapeHtml(balanceText)}</span>
                </div>
                <div class="is-api-meta">${escapeHtml(profileHost(profile))} · ${escapeHtml(profile.model || '未设模型')} · ${escapeHtml(maskKey(profile))}</div>
                <div class="is-api-meta">${profile.models?.length ? `缓存 ${profile.models.length} 个模型 · ${escapeHtml(modelSummary(profile.models))}` : '未获取模型列表'}</div>
                <div class="is-api-actions">
                    ${defaultButton}
                    ${applyButton}
                    <button type="button" class="is-link" data-api-action="test" data-id="${escapeHtml(profile.id)}">测试</button>
                    <button type="button" class="is-link" data-api-action="edit" data-id="${escapeHtml(profile.id)}">编辑</button>
                    <button type="button" class="is-link" data-api-action="delete" data-id="${escapeHtml(profile.id)}">删除</button>
                </div>
            </div>`;
        }).join('');
    }
    renderConnectionProfiles();
}

export function renderConnectionProfiles() {
    const node = el('is-connection-profiles');
    if (!node) return;
    const profiles = listConnectionProfiles();
    if (!profiles.length) {
        node.innerHTML = '<div class="is-hint">酒馆里还没有连接配置。可以先在酒馆的连接配置里创建，再回来切换。</div>';
        return;
    }
    const route = get().pluginModel;
    node.innerHTML = profiles.map(profile => {
        const selected = route.mode === 'connection' && route.connectionProfileId === profile.id;
        return `<div class="is-connection-item">
        <div class="is-connection-main">
            <span class="is-api-name">${escapeHtml(profile.name)}</span>
            ${selected ? '<span class="is-badge">插件模型</span>' : ''}
            <span class="is-connection-model">${escapeHtml(profile.model || '')}</span>
        </div>
        <div class="is-connection-actions">
            <button type="button" class="is-link" data-connection-action="switch" data-name="${escapeHtml(profile.name)}">切换</button>
            <button type="button" class="is-link" data-connection-action="plugin" data-id="${escapeHtml(profile.id)}">${selected ? '当前插件模型' : '设为插件模型'}</button>
        </div>
    </div>`;
    }).join('');
}


export function openProfileEditor(kind, profile = null) {
    const isNew = !profile;
    const base = profile || (kind === 'chat' ? defaultChatProfile() : defaultImageProfile());
    const copy = JSON.parse(JSON.stringify(base));
    if (isNew) {
        copy.name = kind === 'chat' ? '新聊天 API' : '新生图 API';
    }
    ui.apiKind = kind;
    ui.editing = { kind, isNew, id: profile?.id || null };
    document.querySelectorAll('[data-is-api-kind]').forEach(button => {
        button.classList.toggle('active', button.dataset.isApiKind === kind);
    });
    setText('is-editor-title', isNew ? `添加${kind === 'chat' ? '聊天' : '生图'} API` : `编辑：${copy.name}`);
    const typeSelect = el('is-profile-type');
    const types = kind === 'chat' ? CHAT_TYPES : CLOUD_IMAGE_TYPES;
    typeSelect.innerHTML = types.map(meta => `<option value="${escapeHtml(meta.id)}">${escapeHtml(meta.label)}</option>`).join('');
    setValue('is-profile-name', copy.name);
    setValue('is-profile-type', copy.type);
    setValue('is-profile-base', copy.baseUrl || '');
    setValue('is-profile-key', copy.apiKey || '');
    setValue('is-profile-model', copy.model || '');
    setValue('is-model-search', '');
    ui.editorModels = normalizeModels([...(copy.models || []), copy.model]);
    ui.modelCategory = kind === 'chat' ? 'language' : 'image';
    ui.modelQuery = '';
    ui.editing.modelsFetchedAt = Number(copy.modelsFetchedAt || 0);
    fillModelDatalist(ui.editorModels);
    renderModelBrowser();
    if (!ui.editorModels.length && canAutoFetchModels(copy)) {
        const editingId = ui.editing.id;
        setTimeout(() => {
            if (!ui.editing || ui.editing.id !== editingId) return;
            fetchEditorModels({ silent: true });
        }, 350);
    }
    setValue('is-profile-headers', copy.headers || '{}');
    setValue('is-profile-extra', copy.extraBody || '{}');
    const balanceSelect = el('is-profile-balance');
    balanceSelect.innerHTML = BALANCE_PRESETS.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
    setValue('is-profile-balance', copy.balancePreset || 'auto');
    const balance = copy.balance || {};
    setValue('is-balance-url', balance.url || '');
    setValue('is-balance-method', balance.method || 'GET');
    setValue('is-balance-headers', balance.headers || '{}');
    setValue('is-balance-remaining', balance.remainingPath || '');
    setValue('is-balance-used', balance.usedPath || '');
    setValue('is-balance-total', balance.totalPath || '');
    setValue('is-balance-currency', balance.currencyPath || '');
    setValue('is-balance-unit', balance.unit || '');
    const custom = copy.custom || {};
    setValue('is-custom-endpoint', custom.endpoint || '');
    setValue('is-custom-method', custom.method || 'POST');
    setValue('is-custom-body', custom.body || '');
    setValue('is-custom-response-path', custom.responsePath || 'data.0.b64_json');
    setValue('is-custom-mime', custom.mime || 'image/png');
    setText('is-profile-status', '');
    el('is-profile-type-hint').textContent = types.find(item => item.id === copy.type)?.hint || '';
    syncEditorVisibility();
    const editor = el('is-api-editor');
    if (editor) {
        editor.hidden = false;
        setTimeout(() => editor.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        const first = el('is-profile-name');
        first?.focus();
    }
}

export function renderModelBrowser() {
    const categoryNode = el('is-model-categories');
    const browserNode = el('is-model-browser');
    const statusNode = el('is-model-status');
    if (!categoryNode || !browserNode) return;
    const models = ui.editorModels || [];
    const counts = categoryCounts(models);
    const categories = [
        { id: 'all', label: '全部', count: models.length },
        ...MODEL_CATEGORIES.filter(item => counts[item.id] > 0).map(item => ({ ...item, count: counts[item.id] })),
    ];
    if (!models.length) {
        categoryNode.innerHTML = '';
        browserNode.innerHTML = '<div class="is-hint">还没有模型列表。点“获取模型”自动拉取并分类，或直接手填模型名。</div>';
        if (statusNode) statusNode.textContent = '尚未获取模型列表';
        return;
    }
    if (ui.modelCategory !== 'all' && counts[ui.modelCategory] === 0) ui.modelCategory = 'all';
    categoryNode.innerHTML = categories.map(item => `<button type="button" class="is-chip ${item.id === ui.modelCategory ? 'active' : ''}" data-model-category="${escapeHtml(item.id)}">${escapeHtml(item.label)}<span class="is-chip-count">${item.count}</span></button>`).join('');
    const filtered = filterModels(models, { category: ui.modelCategory, query: ui.modelQuery });
    const selected = valueOf('is-profile-model');
    browserNode.innerHTML = filtered.length
        ? filtered.slice(0, 300).map(item => `<button type="button" class="is-model-row ${item.id === selected ? 'is-selected' : ''}" data-model-select="${escapeHtml(item.id)}"><span class="is-model-id">${escapeHtml(item.id)}</span><span class="is-badge">${escapeHtml(item.label)}</span></button>`).join('')
        : '<div class="is-hint">当前筛选没有匹配的模型。</div>';
    if (statusNode) {
        const fetched = ui.editing?.modelsFetchedAt
            ? ` · ${new Date(ui.editing.modelsFetchedAt).toLocaleTimeString()}`
            : '';
        statusNode.textContent = `${models.length} 个模型 · ${modelSummary(models)}${fetched}`;
    }
}

export async function fetchEditorModels({ silent = false, force = false } = {}) {
    if (ui.modelsFetching || !ui.editing) return;
    let profile;
    try {
        profile = readEditorProfile();
    } catch (error) {
        setText('is-model-status', error.message || String(error));
        if (!silent) toast('error', error.message || String(error));
        return;
    }
    if (profile.type === 'custom') {
        setText('is-model-status', '自定义接口不支持自动获取模型，请手填模型名');
        return;
    }
    if (!force && ui.editorModels.length && Date.now() - Number(ui.editing.modelsFetchedAt || 0) < 10 * 60_000) {
        renderModelBrowser();
        return;
    }
    ui.modelsFetching = true;
    setText('is-model-status', '正在获取模型列表…');
    try {
        const models = await fetchProfileModels(profile);
        ui.editorModels = normalizeModels([...(models || []), valueOf('is-profile-model')]);
        ui.editing.modelsFetchedAt = Date.now();
        const preferred = filterModels(ui.editorModels, { category: ui.editing.kind === 'chat' ? 'language' : 'image' });
        if (!valueOf('is-profile-model') || !ui.editorModels.includes(valueOf('is-profile-model'))) {
            const next = preferred[0]?.id || ui.editorModels[0] || '';
            if (next) setValue('is-profile-model', next);
        }
        fillModelDatalist(ui.editorModels);
        renderModelBrowser();
        setText('is-model-status', `已获取 ${ui.editorModels.length} 个模型 · ${modelSummary(ui.editorModels)}`);
        if (!silent) toast('success', `已获取 ${ui.editorModels.length} 个模型`);
    } catch (error) {
        setText('is-model-status', `获取失败：${error.message || error}`);
        if (!silent) toast('error', `获取模型失败：${truncate(error.message || error, 350)}`);
    } finally {
        ui.modelsFetching = false;
    }
}

export async function refreshProfileModels(id, kind, { silent = true } = {}) {
    const profile = getProfiles(kind).find(item => item.id === id);
    if (!profile || profile.type === 'custom') return;
    try {
        const models = await fetchProfileModels(profile);
        profile.models = normalizeModels(models);
        profile.modelsFetchedAt = Date.now();
        profile.modelsError = '';
        save();
        renderApi();
        bridge.renderCloudProfiles?.();
        if (!silent) toast('success', `模型列表已更新：${profile.models.length} 个`);
    } catch (error) {
        profile.modelsError = String(error.message || error);
        save();
        if (!silent) toast('error', `获取模型失败：${truncate(error.message || error, 350)}`);
    }
}

export function syncEditorVisibility() {
    const kind = ui.editing?.kind || ui.apiKind;
    const type = valueOf('is-profile-type');
    setHidden('is-custom-fields', !(kind === 'image' && type === 'custom'));
    setHidden('is-balance-fields', valueOf('is-profile-balance') !== 'custom');
    const meta = (kind === 'chat' ? CHAT_TYPES : CLOUD_IMAGE_TYPES).find(item => item.id === type);
    setText('is-profile-type-hint', meta?.hint || '');
    const balanceMeta = BALANCE_PRESETS.find(item => item.id === valueOf('is-profile-balance'));
    setText('is-balance-preset-hint', balanceMeta?.hint || '');
}

export function readEditorProfile() {
    const kind = ui.editing?.kind || ui.apiKind;
    const type = valueOf('is-profile-type');
    const headers = parseJsonLoose(valueOf('is-profile-headers') || '{}');
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new Error('额外请求头必须是 JSON 对象');
    const extraBody = parseJsonLoose(valueOf('is-profile-extra') || '{}');
    if (!extraBody || typeof extraBody !== 'object' || Array.isArray(extraBody)) throw new Error('固定额外请求体必须是 JSON 对象');
    const balanceHeaders = parseJsonLoose(valueOf('is-balance-headers') || '{}');
    if (!balanceHeaders || typeof balanceHeaders !== 'object' || Array.isArray(balanceHeaders)) throw new Error('余额请求头必须是 JSON 对象');
    const customBody = valueOf('is-custom-body');
    if (kind === 'image' && type === 'custom' && customBody.trim()) {
        const parsed = parseJsonLoose(customBody);
        if (!parsed || typeof parsed !== 'object') throw new Error('自定义请求体不是有效 JSON');
    }
    const profile = {
        id: ui.editing?.id || undefined,
        kind,
        name: String(valueOf('is-profile-name') || '').trim(),
        type,
        baseUrl: String(valueOf('is-profile-base') || '').trim(),
        apiKey: String(valueOf('is-profile-key') || ''),
        model: String(valueOf('is-profile-model') || '').trim(),
        models: normalizeModels(ui.editorModels),
        modelsFetchedAt: Number(ui.editing?.modelsFetchedAt || 0),
        modelsError: '',
        headers: JSON.stringify(headers, null, 2),
        extraBody: JSON.stringify(extraBody, null, 2),
        balancePreset: valueOf('is-profile-balance') || 'auto',
        balance: {
            url: String(valueOf('is-balance-url') || '').trim(),
            method: valueOf('is-balance-method') || 'GET',
            headers: JSON.stringify(balanceHeaders, null, 2),
            remainingPath: String(valueOf('is-balance-remaining') || '').trim(),
            usedPath: String(valueOf('is-balance-used') || '').trim(),
            totalPath: String(valueOf('is-balance-total') || '').trim(),
            currencyPath: String(valueOf('is-balance-currency') || '').trim(),
            unit: String(valueOf('is-balance-unit') || '').trim(),
        },
        custom: {
            endpoint: String(valueOf('is-custom-endpoint') || '').trim(),
            method: valueOf('is-custom-method') || 'POST',
            body: customBody,
            responsePath: String(valueOf('is-custom-response-path') || '').trim(),
            mime: String(valueOf('is-custom-mime') || 'image/png').trim(),
        },
    };
    if (!profile.name) throw new Error('给 API 起个名字');
    if (!profile.baseUrl && type !== 'custom') throw new Error('填写 Base URL');
    return profile;
}

export function saveProfileEditor() {
    try {
        const profile = readEditorProfile();
        upsertProfile(profile.kind, profile);
        const settings = get();
        if (profile.kind === 'image' && !settings.cloud.profileId) {
            settings.cloud.profileId = profile.id;
            settings.cloud.model = profile.model;
        }
        if (profile.kind === 'chat' && !settings.pluginModel.profileId) {
            settings.pluginModel.profileId = profile.id;
        }
        const shouldFetchModels = !profile.models.length && canAutoFetchModels(profile);
        save();
        setHidden('is-api-editor', true);
        ui.editing = null;
        renderApi();
        bridge.renderCloudProfiles?.();
        bridge.syncProviderUI?.();
        toast('success', 'API 已保存');
        if (shouldFetchModels) {
            setTimeout(() => refreshProfileModels(profile.id, profile.kind, { silent: false }), 150);
        }
    } catch (error) {
        setText('is-profile-status', error.message || String(error));
        toast('error', error.message || String(error));
    }
}

export async function testEditorProfile() {
    await fetchEditorModels({ silent: false, force: true });
}

export function fillModelDatalist(models, targetId = 'is-model-list') {
    const datalist = el(targetId);
    if (!datalist) return;
    datalist.innerHTML = normalizeModels(models).slice(0, 500).map(model => `<option value="${escapeHtml(model)}"></option>`).join('');
}

export async function testProfileById(id, kind) {
    const profile = getProfiles(kind).find(item => item.id === id);
    if (!profile) return;
    try {
        if (kind === 'image' && profile.type === 'custom') {
            toast('info', '自定义接口请直接生成测试');
            return;
        }
        toast('info', '测试中…');
        const models = await fetchProfileModels(profile);
        profile.models = normalizeModels(models);
        profile.modelsFetchedAt = Date.now();
        profile.modelsError = '';
        upsertProfile(kind, profile);
        save();
        fillModelDatalist(profile.models);
        renderApi();
        bridge.renderCloudProfiles?.();
        toast('success', `连接成功，发现 ${profile.models.length} 个模型 · ${modelSummary(profile.models)}`);
    } catch (error) {
        profile.modelsError = String(error.message || error);
        save();
        toast('error', `测试失败：${truncate(error.message || error, 400)}`);
    }
}

export async function refreshBalanceById(id, kind, force = true) {
    const profile = getProfiles(kind).find(item => item.id === id);
    if (!profile) return;
    if (ui.balanceBusy.has(id)) return;
    ui.balanceBusy.add(id);
    renderApi();
    try {
        const result = await queryBalance(profile, { force });
        setBalanceCache(id, result);
        if (result.ok) toast('success', `${profile.name}：${formatBalance(result)}`);
        else toast('warning', `${profile.name}：${result.message || '该上游不可查询余额'}`);
    } catch (error) {
        const result = { ok: false, message: truncate(error.message || error, 300) };
        setBalanceCache(id, result);
        toast('warning', `${profile.name} 余额查询失败：${result.message}`);
    } finally {
        ui.balanceBusy.delete(id);
        renderApi();
    }
}

export async function refreshAllBalances() {
    const profiles = [...(get().imageProfiles || []), ...(get().chatProfiles || [])]
        .filter(profile => profile.balancePreset !== 'none');
    if (!profiles.length) {
        toast('info', '没有需要查询余额的 API');
        return;
    }
    for (const profile of profiles) {
        await refreshBalanceById(profile.id, profile.kind);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    toast('success', '余额刷新完成');
}

export async function applyChatById(id) {
    const profile = get().chatProfiles.find(item => item.id === id);
    if (!profile) return;
    if (!(await confirmAction(`把「${escapeHtml(profile.name)}」设为酒馆当前聊天 API？会写入酒馆的 API 设置。`))) return;
    try {
        toast('info', '正在切换酒馆聊天 API…');
        const result = await applyChatProfile(profile);
        renderCurrentChat();
        toast('success', `已应用${result?.model ? ` · ${result.model}` : ''}`);
    } catch (error) {
        toast('error', `应用失败：${error.message || error}`);
    }
}


