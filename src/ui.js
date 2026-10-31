import {
    BALANCE_PRESETS,
    CHAT_TYPES,
    CLOUD_IMAGE_TYPES,
    SIZE_PRESETS,
} from './constants.js';
import {
    get,
    getBalanceCache,
    getActiveImageProfile,
    getProfiles,
    removeProfile,
    save,
    saveSoon,
    setBalanceCache,
    upsertProfile,
} from './store.js';
import {
    buildCharacterPrompt,
    buildQuietRewritePrompt,
    buildRewriteMessages,
    expandPrompt,
    insertAtCursor,
    parseRewriteResult,
} from './prompt.js';
import {
    clamp,
    ctx,
    debounce,
    escapeHtml,
    formatBytes,
    imagePathToUrl,
    parseJsonLoose,
    stripHtml,
    toast,
    truncate,
} from './util.js';
import { ComfyService } from './comfy.js';
import {
    collectLibraryScanSources,
    composeFinalPrompt,
    defaultPresentCharacters,
    getCharacterLibrary,
    libraryEntriesFromScan,
    matchCharacterNames,
    matchPresentCharacters,
    mergeLibraryEntries,
    normalizeLibraryEntry,
    saveCharacterLibrary,
    scanCharacterCandidates,
} from './character-library.js';
import { buildLibraryScanMessages, parseLibraryScanResult } from './library-scan.js';
import {
    MODEL_CATEGORIES,
    canAutoFetchModels,
    categoryCounts,
    fetchProfileModels,
    filterModels,
    modelSummary,
    normalizeModels,
} from './model-catalog.js';
import {
    detectLocalSubnet,
    normalizeScanPrefix,
    portFromUrl,
    prefixFromUrl,
    scanComfy,
} from './discovery.js';
import { defaultImageProfile } from './providers.js';
import { initFloatingCat, renderCat } from './floating-cat.js';
import { normalizeContextMessages, resolvePluginRoute } from './plugin-model.js';
import { queryBalance, formatBalance, balanceDetails } from './balance.js';
import {
    applyChatProfile,
    chatComplete,
    currentChatConfig,
    defaultChatProfile,
    importCurrentChatProfile,
    listConnectionProfiles,
    rewriteWithConnectionProfile,
    rewriteWithCurrentApi,
    rewriteWithCurrentPreset,
    switchConnectionProfile,
} from './chat.js';
import {
    cancelJob,
    describeRequest,
    generateCloud,
    generateComfy,
    job,
    jobElapsedText,
} from './jobs.js';
import { downloadImageBlob, imageUrl, insertAsMessage, saveBlobToST, setAsBackground } from './history.js';
import { panelTemplate, settingsDrawerTemplate, wandItemTemplate } from './templates.js';

const ui = {
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
    libraryEditingId: null,
    libraryReferencePath: '',
    sceneConfirm: null,
};

let monitorComfy = new ComfyService();

function el(id) {
    return document.getElementById(id);
}

function valueOf(id) {
    return el(id)?.value ?? '';
}

function setValue(id, value) {
    const node = el(id);
    if (node) node.value = value ?? '';
}

function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text ?? '';
}

function setHidden(id, hidden) {
    const node = el(id);
    if (node) node.hidden = !!hidden;
}

function setHtml(id, html) {
    const node = el(id);
    if (node) node.innerHTML = html;
}

function activeDims() {
    const settings = get();
    return settings.provider === 'cloud' ? settings.cloud : settings.comfy;
}

function providerSettings() {
    return activeDims();
}

function profileHost(profile) {
    try {
        return new URL(profile.baseUrl).host;
    } catch {
        return profile.baseUrl || '未填写地址';
    }
}

function maskKey(profile) {
    return profile.apiKey ? '已配置 Key' : '无 Key';
}

function typeLabel(kind, type) {
    const meta = (kind === 'chat' ? CHAT_TYPES : CLOUD_IMAGE_TYPES).find(item => item.id === type);
    return meta?.label || type;
}

export function initUI() {
    if (ui.initialized) return;
    const context = ctx();
    if (!context) throw new Error('SillyTavern 尚未就绪');
    ensureDom();
    bindEvents();
    refreshForm();
    renderApi();
    renderHistory();
    renderCurrentChat();
    renderPluginModel();
    bindChatMessageEvents();
    initFloatingCat({
        openPanel: () => openPanel('generate'),
        openHistory: () => openPanel('history'),
        cancel: () => cancelJob(),
        openLightbox: item => openLightbox(item, 'history'),
    });
    ui.initialized = true;
    window.ImageStudio = {
        open: openPanel,
        close: closePanel,
        toggle: () => document.getElementById('is-panel')?.classList.contains('is-open') ? closePanel() : openPanel(),
        job,
    };
}

function ensureDom() {
    if (!document.getElementById('is-panel')) {
        const holder = document.createElement('div');
        holder.innerHTML = panelTemplate();
        while (holder.firstElementChild) {
            document.body.appendChild(holder.firstElementChild);
        }
    }

    if (!document.getElementById('is-wand')) {
        const item = document.createElement('div');
        item.innerHTML = wandItemTemplate();
        const wand = item.firstElementChild;
        let container = document.getElementById('is_wand_container');
        if (!container) {
            const menu = document.getElementById('extensionsMenu');
            if (menu) {
                container = document.createElement('div');
                container.id = 'is_wand_container';
                container.className = 'extension_container';
                menu.appendChild(container);
            }
        }
        if (container) {
            container.appendChild(wand);
        } else {
            const fab = document.createElement('button');
            fab.id = 'is-fab';
            fab.type = 'button';
            fab.title = '画坊';
            fab.innerHTML = '<i class="fa-solid fa-palette"></i>';
            document.body.appendChild(fab);
            fab.addEventListener('click', () => openPanel());
        }
    }

    if (!document.getElementById('is-settings-drawer')) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = settingsDrawerTemplate();
        const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (target) target.appendChild(wrapper.firstElementChild);
    }

    const panel = el('is-panel');
    panel?.addEventListener('click', event => {
        if (event.target === panel) return;
    });
}

function openPanel(tab = null) {
    const panel = el('is-panel');
    if (!panel) return;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    const overlay = el('is-overlay');
    if (overlay) overlay.hidden = false;
    if (tab) switchTab(tab);
    else switchTab(ui.tab || get().ui.lastTab || 'generate');
    refreshForm();
    renderApi();
    renderHistory();
    renderCurrentChat();
    renderPluginModel();
    refreshMessageGenButton();
    restoreMessageThumbnails();
    if (get().comfy.url) silentProbe();
    updateSettingsStatus();
}

function closePanel() {
    const panel = el('is-panel');
    if (panel) {
        panel.classList.remove('is-open');
        panel.setAttribute('aria-hidden', 'true');
    }
    const overlay = el('is-overlay');
    if (overlay) overlay.hidden = true;
    save();
    stopMonitor();
    if (ui.scanAbort) {
        ui.scanAbort.abort();
        ui.scanAbort = null;
    }
    closeLightbox();
}

function switchTab(tab) {
    const target = ['generate', 'monitor', 'library', 'api', 'history'].includes(tab) ? tab : 'generate';
    ui.tab = target;
    get().ui.lastTab = target;
    saveSoon();
    document.querySelectorAll('#is-panel [data-is-tab]').forEach(button => {
        button.classList.toggle('active', button.dataset.isTab === target);
    });
    document.querySelectorAll('#is-panel [data-is-pane]').forEach(pane => {
        pane.hidden = pane.dataset.isPane !== target;
    });
    if (target === 'monitor') startMonitor();
    else stopMonitor();
    if (target === 'api') {
        renderApi();
        renderCurrentChat();
    }
    if (target === 'history') renderHistory();
    if (target === 'library') renderLibrary();
    el('is-panel')?.querySelector('.is-body')?.scrollTo({ top: 0 });
}

function updateSettingsStatus() {
    const node = el('is-settings-status');
    if (!node) return;
    const text = ui.connection === 'ok' ? 'ComfyUI 已连接' : ui.connection === 'error' ? 'ComfyUI 未连接' : '本地 ComfyUI + 云端 API';
    node.textContent = text;
    node.classList.toggle('is-error', ui.connection === 'error');
}

function setConnection(state, text) {
    ui.connection = state;
    const dot = el('is-header-dot');
    const chip = el('is-header-status');
    const label = el('is-header-status-text');
    if (dot) dot.className = `is-dot ${state === 'ok' ? 'is-ok' : state === 'error' ? 'is-error' : state === 'busy' ? 'is-busy' : ''}`.trim();
    if (chip) {
        chip.classList.toggle('is-ok', state === 'ok');
        chip.classList.toggle('is-error', state === 'error');
    }
    if (label) label.textContent = text;
    const briefDot = el('is-brief-dot');
    const briefText = el('is-brief-text');
    if (briefDot) briefDot.className = `is-dot ${state === 'ok' ? 'is-ok' : state === 'error' ? 'is-error' : state === 'busy' ? 'is-busy' : ''}`.trim();
    if (briefText) briefText.textContent = text;
    updateSettingsStatus();
}

function refreshForm() {
    const settings = get();
    ui.provider = settings.provider === 'cloud' ? 'cloud' : 'comfy';
    ui.tab = settings.ui.lastTab || 'generate';

    setValue('is-positive', settings.draft?.positive || '');
    setValue('is-negative', settings.draft?.negative ?? settings.prompt.negative ?? '');
    setValue('is-count', ui.provider === 'cloud' ? settings.cloud.count : settings.comfy.batch);
    setValue('is-seed', ui.provider === 'cloud' ? settings.cloud.seed : settings.comfy.seed);
    setValue('is-width', ui.provider === 'cloud' ? settings.cloud.width : settings.comfy.width);
    setValue('is-height', ui.provider === 'cloud' ? settings.cloud.height : settings.comfy.height);
    setValue('is-comfy-url', settings.comfy.url || '');
    setValue('is-comfy-auth', settings.comfy.auth || '');
    setValue('is-scan-prefix', settings.comfy.scanPrefix || prefixFromUrl(settings.comfy.url) || '');
    setValue('is-scan-port', settings.comfy.scanPort || portFromUrl(settings.comfy.url));
    setValue('is-comfy-proxy', settings.useServerProxy === false ? 'direct' : 'proxy');
    setValue('is-use-proxy', settings.useServerProxy !== false);
    setValue('is-hires-enabled', !!settings.comfy.hires?.enabled);
    setValue('is-hires-scale', settings.comfy.hires?.scale ?? 1.5);
    setValue('is-hires-steps', settings.comfy.hires?.steps ?? 14);
    setValue('is-hires-denoise', settings.comfy.hires?.denoise ?? 0.45);
    setValue('is-workflow-mode', settings.comfy.workflowMode || 'simple');
    setValue('is-custom-workflow', settings.comfy.customWorkflow || '');
    setValue('is-auto-bind', settings.comfy.autoBind !== false);
    setValue('is-steps', settings.comfy.steps);
    setValue('is-cfg', settings.comfy.cfg);
    setValue('is-cloud-extra', settings.cloud.extraBody || '{}');
    setValue('is-autosave', settings.ui.autoSave !== false);
    setValue('is-rewrite-intent', '');
    setValue('is-rewrite-style', settings.prompt.style || 'tags');
    setValue('is-rewrite-system-source', settings.prompt.rewriteSystemSource || 'st');
    setValue('is-rewrite-system-text', settings.prompt.rewriteSystemCustom || settings.prompt.rewriteSystem || '');

    rebuildSizeOptions();
    syncProviderUI();
    refreshComfySelects();
    renderLoras();
    renderCloudProfiles();
    renderPluginModel();
    syncWorkflowVisibility();
    syncHiresVisibility();
    setConnection(ui.connection, el('is-header-status-text')?.textContent || 'ComfyUI 未连接');
    renderRequestDetails();
    renderResults();
    renderJob();
    updateAutosave();
}

function rebuildSizeOptions() {
    const select = el('is-size-preset');
    if (!select) return;
    const dims = activeDims();
    const current = `${dims.width}x${dims.height}`;
    select.innerHTML = '';
    for (const preset of SIZE_PRESETS) {
        const option = document.createElement('option');
        option.value = `${preset.width}x${preset.height}`;
        option.textContent = preset.label;
        select.appendChild(option);
    }
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = '自定义';
    select.appendChild(custom);
    select.value = SIZE_PRESETS.some(item => `${item.width}x${item.height}` === current) ? current : 'custom';
}

function syncProviderUI() {
    const settings = get();
    ui.provider = settings.provider === 'cloud' ? 'cloud' : 'comfy';
    document.querySelectorAll('[data-is-provider]').forEach(button => {
        button.classList.toggle('active', button.dataset.isProvider === ui.provider);
    });
    setHidden('is-cloud-bar', ui.provider !== 'cloud');
    setHidden('is-comfy-brief', ui.provider !== 'comfy');
    setHidden('is-comfy-model-wrap', ui.provider !== 'comfy');
    setHidden('is-cloud-model-wrap', ui.provider !== 'cloud');
    setHidden('is-comfy-advanced', ui.provider !== 'comfy');
    setHidden('is-cloud-advanced', ui.provider !== 'cloud');
    if (ui.provider === 'cloud') {
        const profile = getActiveImageProfile() || settings.imageProfiles[0];
        setValue('is-cloud-model', settings.cloud.model || profile?.model || '');
    }
    const dims = activeDims();
    setValue('is-count', ui.provider === 'cloud' ? settings.cloud.count : settings.comfy.batch);
    setValue('is-seed', ui.provider === 'cloud' ? settings.cloud.seed : settings.comfy.seed);
    setValue('is-width', dims.width);
    setValue('is-height', dims.height);
    rebuildSizeOptions();
}

function fillSelect(node, values, selected, placeholder = '') {
    if (!node) return;
    const list = [...new Set((values || []).filter(value => value != null && String(value).length))];
    if (selected && !list.includes(selected)) list.unshift(selected);
    node.innerHTML = '';
    if (placeholder) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = placeholder;
        node.appendChild(option);
    }
    for (const value of list) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        node.appendChild(option);
    }
    node.value = selected || (placeholder ? '' : list[0] || '');
}

function refreshComfySelects() {
    const settings = get();
    const models = ui.models || { checkpoints: [], samplers: [], schedulers: [], vaes: [], loras: [] };
    fillSelect(el('is-checkpoint'), models.checkpoints, settings.comfy.checkpoint, models.checkpoints.length ? '' : '（请检测 ComfyUI 读取模型）');
    fillSelect(el('is-sampler'), models.samplers, settings.comfy.sampler, '');
    fillSelect(el('is-scheduler'), models.schedulers, settings.comfy.scheduler, '');
    fillSelect(el('is-vae'), models.vaes, settings.comfy.vae, '（不单独加载 VAE）');
    renderLoras();
}

function renderLoras() {
    const settings = get();
    const list = el('is-loras');
    if (!list) return;
    const loras = settings.comfy.loras || [];
    if (!loras.length) {
        list.innerHTML = '<div class="is-hint">没有添加 LoRA</div>';
        return;
    }
    const options = ui.models?.loras?.length ? ui.models.loras : loras.map(item => item.name).filter(Boolean);
    list.innerHTML = loras.map((lora, index) => {
        const optionsHtml = [...new Set([lora.name, ...options].filter(Boolean))]
            .map(name => `<option value="${escapeHtml(name)}" ${name === lora.name ? 'selected' : ''}>${escapeHtml(name)}</option>`)
            .join('');
        return `<div class="is-lora-row" data-lora-index="${index}">
            <select class="text_pole" data-lora-field="name">${optionsHtml || '<option value="">（无可用 LoRA）</option>'}</select>
            <input class="text_pole" type="number" min="0" max="2" step="0.05" data-lora-field="strengthModel" value="${Number(lora.strengthModel ?? 0.8)}" title="模型权重" />
            <input class="text_pole" type="number" min="0" max="2" step="0.05" data-lora-field="strengthClip" value="${Number(lora.strengthClip ?? 0.8)}" title="CLIP 权重" />
            <button type="button" class="is-icon-button" data-lora-remove="${index}" title="移除"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }).join('');
}

function renderCloudProfiles() {
    const settings = get();
    const select = el('is-cloud-profile');
    if (!select) return;
    const profiles = settings.imageProfiles || [];
    if (!profiles.length) {
        select.innerHTML = '<option value="">（没有生图 API，去 API 页添加）</option>';
        setText('is-cloud-hint', '还没有生图 API。到 API 页添加 OpenAI 兼容、Gemini、xAI 或自定义接口。');
        return;
    }
    if (!settings.cloud.profileId || !profiles.some(profile => profile.id === settings.cloud.profileId)) {
        settings.cloud.profileId = profiles[0].id;
        settings.cloud.model = profiles[0].model || settings.cloud.model;
        saveSoon();
    }
    select.innerHTML = profiles.map(profile =>
        `<option value="${escapeHtml(profile.id)}" ${profile.id === settings.cloud.profileId ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(typeLabel('image', profile.type))}</option>`).join('');
    const profile = profiles.find(item => item.id === settings.cloud.profileId);
    if (profile) {
        const cached = getBalanceCache(profile.id);
        const balanceText = cached?.ok ? ` · 余额 ${formatBalance(cached)}` : '';
        const xaiHint = profile.type === 'xai' ? ' · Grok 尺寸按宽高比/分辨率，不发送 size' : '';
        setText('is-cloud-hint', `${typeLabel('image', profile.type)} · ${profileHost(profile)} · ${profile.model || '未设默认模型'}${balanceText}${xaiHint}`);
        const imageModels = filterModels(profile.models || [], { category: 'image' }).map(item => item.id);
        const fallbackModels = (profile.models || []).filter(Boolean);
        const choices = imageModels.length ? imageModels : fallbackModels;
        fillModelDatalist(choices, 'is-cloud-model-list');
        setText('is-cloud-model-hint', choices.length
            ? `已缓存 ${profile.models.length} 个模型 · 图像 ${imageModels.length} 个 · 下拉可筛选`
            : '还没有模型缓存；到 API 页编辑这个档案，点“获取模型”。');
        if (!settings.cloud.model) {
            settings.cloud.model = profile.model || choices[0] || '';
            setValue('is-cloud-model', settings.cloud.model);
        }
    }
}

function currentPluginRoute() {
    return resolvePluginRoute(get(), {
        connectionProfiles: listConnectionProfiles(),
        current: currentChatConfig(),
    });
}

function renderPluginModel() {
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

function renderPluginRouteLine() {
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

function syncRewriteSystemUI() {
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

function syncWorkflowVisibility() {
    const mode = valueOf('is-workflow-mode') || 'simple';
    setHidden('is-custom-workflow-wrap', mode !== 'custom');
}

function syncHiresVisibility() {
    const enabled = el('is-hires-enabled')?.checked;
    const fields = el('is-hires-fields');
    if (fields) {
        fields.querySelectorAll('input').forEach(input => {
            input.disabled = !enabled;
        });
    }
}

function updateAutosave() {
    const box = el('is-autosave');
    if (box) box.checked = get().ui.autoSave !== false;
}

function renderCurrentChat() {
    const node = el('is-current-chat');
    if (!node) return;
    const current = currentChatConfig();
    if (!current) {
        node.textContent = '酒馆聊天 API 未就绪';
        return;
    }
    node.innerHTML = `<i class="fa-solid fa-plug"></i><div class="is-grow is-current-chat-text"><div>当前酒馆：${escapeHtml(current.model || '未选模型')} · ${escapeHtml(current.source || current.mainApi || '')}</div><div class="is-hint">${escapeHtml(current.baseUrl || '')}</div></div>`;
}

function renderApi() {
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

function renderConnectionProfiles() {
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

function renderHistory() {
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

function renderJob() {
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
    updateSettingsStatus();
    renderCat();
}

function renderResults() {
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

function renderRequestDetails() {
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
        <div class="is-request-block"><div class="is-request-block-head"><span>参数</span></div><pre>${escapeHtml(`seed: ${details.seed}\nsize: ${details.width}x${details.height}\nmodel: ${details.model || details.checkpoint || ''}\nprovider: ${details.provider}${details.workflowMode ? `\nworkflow: ${details.workflowMode}` : ''}`)}</pre></div>
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

function jobCallbacks() {
    return {
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

async function startGeneration() {
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
    job.results = [];
    renderResults();
    setHidden('is-job', false);
    setHidden('is-cancel', true);
    setHidden('is-generate', false);
    startJobTimer();
    setConnection(ui.provider === 'comfy' ? 'busy' : ui.connection, ui.provider === 'comfy' ? 'ComfyUI 连接中…' : '云端请求中…');
    try {
        if (ui.provider === 'cloud') {
            await generateCloud(jobCallbacks(), { positive: expanded, negative: expandedNegative });
        } else {
            await generateComfy(jobCallbacks(), { positive: expanded, negative: expandedNegative });
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

async function testComfyWithModels() {
    const settings = get();
    saveComfyFields();
    setConnection('busy', '检测 ComfyUI…');
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
        refreshComfySelects();
        if (!settings.comfy.checkpoint && models.checkpoints[0]) {
            settings.comfy.checkpoint = models.checkpoints[0];
            saveSoon();
            refreshComfySelects();
        }
        toast('success', `ComfyUI 已连接，读取到 ${models.checkpoints.length} 个 checkpoint`);
    } catch (error) {
        setConnection('error', 'ComfyUI 未连接');
        setText('is-comfy-status', `连接失败：${error.message || error}`);
        toast('error', `ComfyUI 连接失败：${truncate(error.message || error, 300)}`);
    }
}

function silentProbe() {
    if (Date.now() - ui.lastComfyCheck < 45_000) return;
    ui.lastComfyCheck = Date.now();
    monitorComfy.test().then(async result => {
        applyStats(ComfyService.parseSystemStats(result.stats));
        if (!ui.models) {
            try {
                ui.models = await monitorComfy.loadModels(true);
                refreshComfySelects();
            } catch (error) {
                console.warn('[画坊] 读取 ComfyUI 模型失败', error);
            }
        }
    }).catch(() => {
        setConnection('error', 'ComfyUI 未连接');
    });
}

function applyStats(stats) {
    if (!stats) return;
    ui.stats = stats;
    setConnection('ok', `ComfyUI ${stats.comfyVersion || ''} · ${stats.deviceName || '已连接'}`.trim());
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
    updateSettingsStatus();
}

function saveComfyFields() {
    const settings = get();
    settings.comfy.url = String(valueOf('is-comfy-url') || '').trim();
    settings.comfy.auth = String(valueOf('is-comfy-auth') || '').trim();
    settings.useServerProxy = valueOf('is-comfy-proxy') !== 'direct';
    save();
}

function startMonitor() {
    if (!el('is-panel')?.classList.contains('is-open')) return;
    stopMonitor();
    refreshMonitor();
    ui.monitorTimer = setInterval(() => {
        if (ui.tab !== 'monitor') return;
        refreshMonitor();
    }, 12_000);
}

function stopMonitor() {
    if (ui.monitorTimer) {
        clearInterval(ui.monitorTimer);
        ui.monitorTimer = null;
    }
}

async function refreshMonitor() {
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
        setConnection('error', 'ComfyUI 未连接');
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

function openProfileEditor(kind, profile = null) {
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

function renderModelBrowser() {
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

async function fetchEditorModels({ silent = false, force = false } = {}) {
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

async function refreshProfileModels(id, kind, { silent = true } = {}) {
    const profile = getProfiles(kind).find(item => item.id === id);
    if (!profile || profile.type === 'custom') return;
    try {
        const models = await fetchProfileModels(profile);
        profile.models = normalizeModels(models);
        profile.modelsFetchedAt = Date.now();
        profile.modelsError = '';
        save();
        renderApi();
        renderCloudProfiles();
        if (!silent) toast('success', `模型列表已更新：${profile.models.length} 个`);
    } catch (error) {
        profile.modelsError = String(error.message || error);
        save();
        if (!silent) toast('error', `获取模型失败：${truncate(error.message || error, 350)}`);
    }
}

function syncEditorVisibility() {
    const kind = ui.editing?.kind || ui.apiKind;
    const type = valueOf('is-profile-type');
    setHidden('is-custom-fields', !(kind === 'image' && type === 'custom'));
    setHidden('is-balance-fields', valueOf('is-profile-balance') !== 'custom');
    const meta = (kind === 'chat' ? CHAT_TYPES : CLOUD_IMAGE_TYPES).find(item => item.id === type);
    setText('is-profile-type-hint', meta?.hint || '');
    const balanceMeta = BALANCE_PRESETS.find(item => item.id === valueOf('is-profile-balance'));
    setText('is-balance-preset-hint', balanceMeta?.hint || '');
}

function readEditorProfile() {
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

function saveProfileEditor() {
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
        renderCloudProfiles();
        syncProviderUI();
        toast('success', 'API 已保存');
        if (shouldFetchModels) {
            setTimeout(() => refreshProfileModels(profile.id, profile.kind, { silent: false }), 150);
        }
    } catch (error) {
        setText('is-profile-status', error.message || String(error));
        toast('error', error.message || String(error));
    }
}

async function testEditorProfile() {
    await fetchEditorModels({ silent: false, force: true });
}

function fillModelDatalist(models, targetId = 'is-model-list') {
    const datalist = el(targetId);
    if (!datalist) return;
    datalist.innerHTML = normalizeModels(models).slice(0, 500).map(model => `<option value="${escapeHtml(model)}"></option>`).join('');
}

async function testProfileById(id, kind) {
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
        renderCloudProfiles();
        toast('success', `连接成功，发现 ${profile.models.length} 个模型 · ${modelSummary(profile.models)}`);
    } catch (error) {
        profile.modelsError = String(error.message || error);
        save();
        toast('error', `测试失败：${truncate(error.message || error, 400)}`);
    }
}

async function refreshBalanceById(id, kind, force = true) {
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

async function refreshAllBalances() {
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

async function applyChatById(id) {
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

async function confirmAction(message) {
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

function openLightbox(item, source = 'history') {
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

function closeLightbox() {
    const lightbox = el('is-lightbox');
    if (lightbox) lightbox.hidden = true;
    ui.lightbox = null;
}

function entryById(id) {
    return get().history.find(item => item.id === id);
}

async function ensurePath(item) {
    if (item.path) return item.path;
    if (item.blob) {
        const saved = await saveBlobToST(item.blob, { filename: `image-studio-${Date.now()}` });
        item.path = saved.path;
        if (!item.filename) item.filename = saved.filename;
        return item.path;
    }
    throw new Error('没有可用的图片文件');
}

async function downloadItem(item) {
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

async function backgroundFromItem(item) {
    try {
        const path = await ensurePath(item);
        await setAsBackground(path);
        toast('success', '已设为聊天背景');
    } catch (error) {
        toast('error', `设置背景失败：${error.message || error}`);
    }
}

async function chatFromItem(item) {
    try {
        const path = await ensurePath(item);
        await insertAsMessage(path, item.positive || '');
        toast('success', '已作为一条消息插入聊天');
        closeLightbox();
    } catch (error) {
        toast('error', `插入聊天失败：${error.message || error}`);
    }
}

function reuseEntry(entry) {
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
    switchTab('generate');
    refreshForm();
    toast('success', '参数已复用');
}

async function requestPluginCompletion(messages, { maxTokens = 800, temperature = 0.6 } = {}) {
    const route = currentPluginRoute();
    if (route.mode === 'current') {
        return await rewriteWithCurrentApi(messages, maxTokens);
    }
    if (route.mode === 'profile') {
        if (!route.profile) throw new Error('插件内部模型未就绪：请到 API 页选择画坊聊天 API');
        return await chatComplete(route.profile, messages, { maxTokens, temperature });
    }
    if (!route.connection) throw new Error('插件内部模型未就绪：请到 API 页选择酒馆连接配置');
    return await rewriteWithConnectionProfile(route.connection.id, messages, maxTokens);
}

async function requestRewrite({ style, intent, positive, negative, targetMessage = '', targetIndex = null, libraryEntries = [] }) {
    const settings = get();
    const chat = ctx()?.chat || [];
    let target = targetMessage;
    let index = Number.isInteger(targetIndex) ? targetIndex : null;
    if (!target) {
        for (let cursor = chat.length - 1; cursor >= 0; cursor -= 1) {
            const message = chat[cursor];
            if (!message?.mes || message.is_user || message.is_system) continue;
            target = stripHtml(message.mes);
            if (index == null) index = cursor;
            break;
        }
    }
    const route = currentPluginRoute();
    const select = el('is-rewrite-system-source');
    const requestedSource = select?.value || settings.prompt.rewriteSystemSource || 'st';
    const systemSource = requestedSource === 'st' && route.mode !== 'current' ? 'builtin' : requestedSource;
    const contextMessages = normalizeContextMessages(settings.pluginModel.contextMessages);
    if (systemSource === 'st') {
        const quietPrompt = buildQuietRewritePrompt({
            style,
            intent,
            positive,
            negative,
            targetMessage: target,
            targetIndex: index,
            libraryEntries,
            contextMessages,
        });
        return await rewriteWithCurrentPreset(quietPrompt, 800);
    }
    const systemOverride = systemSource === 'custom'
        ? (valueOf('is-rewrite-system-text') || settings.prompt.rewriteSystemCustom || settings.prompt.rewriteSystem)
        : settings.prompt.rewriteSystem;
    const messages = buildRewriteMessages({
        style,
        intent,
        positive,
        negative,
        targetMessage: target,
        targetIndex: index,
        libraryEntries,
        systemOverride,
        contextMessages,
    });
    if (route.mode === 'current') {
        return await rewriteWithCurrentApi(messages, 700);
    }
    if (route.mode === 'profile') {
        if (!route.profile) throw new Error('插件内部模型未就绪：请到 API 页选择画坊聊天 API');
        return await chatComplete(route.profile, messages, { maxTokens: 700, temperature: 0.75 });
    }
    if (!route.connection) throw new Error('插件内部模型未就绪：请到 API 页选择酒馆连接配置');
    return await rewriteWithConnectionProfile(route.connection.id, messages, 700);
}

async function runRewrite() {
    if (ui.rewriteBusy) return;
    const settings = get();
    const systemSource = valueOf('is-rewrite-system-source') || 'st';
    const style = valueOf('is-rewrite-style') || 'tags';
    const intent = String(valueOf('is-rewrite-intent') || '').trim();
    const positive = String(valueOf('is-positive') || '').trim();
    const negative = String(valueOf('is-negative') || '').trim();
    const route = currentPluginRoute();
    const effectiveSource = systemSource === 'st' && route.mode !== 'current' ? 'builtin' : systemSource;
    settings.prompt.style = style;
    settings.prompt.rewriteSystemSource = effectiveSource;
    if (systemSource === 'custom') {
        settings.prompt.rewriteSystemCustom = valueOf('is-rewrite-system-text') || settings.prompt.rewriteSystemCustom;
    }
    saveSoon();

    ui.rewriteBusy = true;
    setText('is-rewrite-status', effectiveSource === 'st'
        ? '使用酒馆当前预设请求中…'
        : `使用插件内部模型（${route.label}）请求中…`);
    const button = el('is-rewrite-run');
    if (button) button.disabled = true;
    try {
        const raw = await requestRewrite({ style, intent, positive, negative, libraryEntries: getCharacterLibrary() });
        const parsed = parseRewriteResult(raw, negative);
        if (!parsed.positive) throw new Error('模型没有给出可用的提示词');
        setValue('is-positive', parsed.positive);
        if (parsed.negative) setValue('is-negative', parsed.negative);
        settings.draft.positive = parsed.positive;
        settings.draft.negative = parsed.negative || negative;
        saveSoon();
        setText('is-rewrite-status', `已写入提示词 · ${parsed.positive.length} 字符`);
        toast('success', '提示词已改写');
    } catch (error) {
        setText('is-rewrite-status', `失败：${error.message || error}`);
        toast('error', `AI 改写失败：${truncate(error.message || error, 400)}`);
    } finally {
        ui.rewriteBusy = false;
        if (button) button.disabled = false;
    }
}

function renderScanResults() {
    const node = el('is-scan-results');
    if (!node) return;
    if (!ui.scanResults.length) {
        node.innerHTML = '';
        return;
    }
    node.innerHTML = ui.scanResults.map(item => `<div class="is-scan-result"><span class="is-scan-address">${escapeHtml(item.host)}:${item.port}</span><span class="is-grow">${escapeHtml(item.comfyVersion || 'ComfyUI')} · ${escapeHtml(item.deviceName || '')}</span><button type="button" class="is-link" data-scan-url="${escapeHtml(item.url)}">使用</button></div>`).join('');
}

async function scanForComfy() {
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

async function useScanResult(url) {
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

function renderLibrary() {
    const context = ctx();
    const character = context?.characters?.[context?.characterId];
    setText('is-library-char', character ? `当前：${character.name || '未命名'}` : '当前没有打开角色卡');
    renderLibraryScanOptions();
    const entries = getCharacterLibrary();
    const list = el('is-library-list');
    if (!list) return;
    if (!entries.length) {
        list.innerHTML = '<div class="is-hint">角色库还是空的。点“扫描角色卡 / 世界书”找候选，或手动添加。</div>';
        return;
    }
    list.innerHTML = entries.map(entry => {
        const thumb = entry.referencePath ? imageUrl(entry.referencePath) : '';
        return `<div class="is-library-item" data-library-id="${escapeHtml(entry.id)}">
            ${thumb
                ? `<img class="is-library-thumb" src="${escapeHtml(thumb)}" alt="${escapeHtml(entry.name)}" loading="lazy" />`
                : '<div class="is-library-thumb is-library-thumb-empty"><i class="fa-solid fa-user"></i></div>'}
            <div class="is-library-info">
                <strong>${escapeHtml(entry.name)} <span class="is-badge">${escapeHtml(libraryRoleLabel(entry.role))}</span></strong>
                <div class="is-hint">${escapeHtml(entry.aliases?.length ? `别名：${entry.aliases.join('、')}` : '无别名')}</div>
                <div class="is-library-desc">${escapeHtml(truncate(entry.appearance || '未填写外貌', 110))}</div>
                <div class="is-library-actions">
                    <button type="button" class="is-link" data-library-action="edit" data-id="${escapeHtml(entry.id)}">编辑</button>
                    <button type="button" class="is-link" data-library-action="delete" data-id="${escapeHtml(entry.id)}">删除</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderLibraryCandidates() {
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

async function scanLibrary() {
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
                const raw = await requestPluginCompletion(messages, { maxTokens: 1800, temperature: 0.2 });
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

async function addSelectedLibraryCandidates() {
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

function clearLibraryReferencePreview() {
    const image = el('is-library-reference-preview');
    const clear = el('is-library-reference-clear');
    if (image) {
        image.hidden = true;
        image.removeAttribute('src');
    }
    if (clear) clear.hidden = true;
}

function updateLibraryReferencePreview() {
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

function openLibraryEditor(entry = null) {
    ui.libraryEditingId = entry?.id || null;
    ui.libraryReferencePath = entry?.referencePath || '';
    setText('is-library-editor-title', entry ? `编辑角色：${entry.name}` : '添加角色');
    setValue('is-library-name', entry?.name || '');
    setValue('is-library-aliases', entry?.aliases?.join(', ') || '');
    setValue('is-library-role', entry?.role || 'character');
    setValue('is-library-appearance', entry?.appearance || '');
    setValue('is-library-outfit', entry?.outfit || '');
    setValue('is-library-notes', entry?.notes || '');
    updateLibraryReferencePreview();
    const editor = el('is-library-editor');
    if (editor) {
        editor.hidden = false;
        setTimeout(() => editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        el('is-library-name')?.focus();
    }
}

function closeLibraryEditor() {
    ui.libraryEditingId = null;
    ui.libraryReferencePath = '';
    setHidden('is-library-editor', true);
    clearLibraryReferencePreview();
}

async function saveLibraryEditor() {
    const name = String(valueOf('is-library-name') || '').trim();
    if (!name) {
        toast('warning', '角色名不能为空');
        return;
    }
    try {
        let entries = getCharacterLibrary();
        const entry = normalizeLibraryEntry({
            id: ui.libraryEditingId || undefined,
            name,
            aliases: String(valueOf('is-library-aliases') || '').split(/[,，]/).map(alias => alias.trim()).filter(Boolean),
            role: valueOf('is-library-role') || 'character',
            appearance: valueOf('is-library-appearance'),
            outfit: valueOf('is-library-outfit'),
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
        renderLibrary();
        setText('is-library-status', '角色库已保存到当前角色卡');
        toast('success', '角色已保存');
    } catch (error) {
        toast('error', error.message || String(error));
    }
}

async function deleteLibraryEntry(id) {
    const entry = getCharacterLibrary().find(item => item.id === id);
    if (!entry) return;
    if (!(await confirmAction(`删除角色「${escapeHtml(entry.name)}」？`))) return;
    try {
        const entries = getCharacterLibrary().filter(item => item.id !== id);
        await saveCharacterLibrary(entries);
        renderLibrary();
        toast('success', '已删除');
    } catch (error) {
        toast('error', error.message || String(error));
    }
}

async function setLibraryReferenceFile(file) {
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

function messageChatId() {
    const context = ctx();
    return String(context?.getCurrentChatId?.() || context?.chatId || '');
}

function removeMessageArtifacts() {
    document.querySelectorAll('.is-gen-image-button').forEach(node => node.remove());
    document.querySelectorAll('.is-message-image-slot').forEach(node => node.remove());
}

function refreshMessageGenButton() {
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
        openLightbox(item, 'message');
    });
    slot.appendChild(button);
}

function clearMessageSlot(messageId) {
    document.querySelector(`.mes[mesid="${messageId}"] .is-message-image-slot`)?.remove();
}

function restoreMessageThumbnails() {
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

function selectedConfirmEntries() {
    const entries = ui.sceneConfirm?.entries || [];
    const checked = new Set([...document.querySelectorAll('[data-confirm-char]:checked')]
        .map(input => input.dataset.confirmChar));
    return entries.filter(entry => checked.has(entry.id));
}

function updateConfirmReferences() {
    const node = el('is-confirm-refs');
    if (!node) return;
    const selected = selectedConfirmEntries().filter(entry => entry.referencePath);
    node.innerHTML = selected.length
        ? selected.map(entry => `<img class="is-confirm-ref" src="${escapeHtml(imageUrl(entry.referencePath))}" alt="${escapeHtml(entry.name)} 参考图" title="${escapeHtml(entry.name)}" loading="lazy" />`).join('')
        : '';
}

function updateConfirmFinal() {
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
function openSceneConfirm(data) {
    ui.sceneConfirm = data;
    setText('is-confirm-target', `目标消息：${truncate(data.targetText || '（无文本）', 240)}`);
    setValue('is-confirm-scene', data.scene);
    setValue('is-confirm-negative', data.negative || '');
    setText('is-confirm-status', data.entries.length ? '' : '角色库为空；可先去角色库扫描，或直接生成纯场景图。');
    renderConfirmCharacters();
    const node = el('is-confirm');
    if (node) node.hidden = false;
}

function closeSceneConfirm(clearBusy = true) {
    const node = el('is-confirm');
    if (node) node.hidden = true;
    const messageId = ui.sceneConfirm?.messageId;
    ui.sceneConfirm = null;
    if (clearBusy) {
        ui.messageGenBusy = false;
        document.querySelectorAll('.is-gen-image-button.is-busy').forEach(button => button.classList.remove('is-busy'));
        if (messageId != null) {
            clearMessageSlot(messageId);
            setTimeout(restoreMessageThumbnails, 50);
        }
        refreshMessageGenButton();
    }
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
        const raw = await requestRewrite({
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

async function startMessageImageGeneration(messageId, positive, negative) {
    if (!positive) {
        toast('warning', '场景提示词为空');
        return;
    }
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
            renderJob();
            renderHistory();
        },
        onStats: stats => applyStats(stats),
        onResult: results => {
            if (results?.[0]) attachMessageResult(messageId, results[0]);
            button?.classList.remove('is-busy');
            renderResults();
            renderHistory();
        },
        onDone: () => {
            ui.messageGenBusy = false;
            button?.classList.remove('is-busy');
            setTimeout(refreshMessageGenButton, 50);
            renderJob();
            toast('success', '画坊：消息插画已生成');
        },
        onError: error => {
            ui.messageGenBusy = false;
            button?.classList.remove('is-busy');
            setMessageState(messageId, `生成失败：${truncate(error?.message || error, 80)}`, true);
            setTimeout(refreshMessageGenButton, 50);
            renderJob();
        },
    };
    try {
        if (settings.provider === 'cloud') {
            await generateCloud(callbacks, { positive, negative, meta });
        } else {
            await generateComfy(callbacks, { positive, negative, meta });
        }
    } catch (error) {
        ui.messageGenBusy = false;
        button?.classList.remove('is-busy');
        setMessageState(messageId, `生成失败：${truncate(error.message || error, 80)}`, true);
        toast('error', `画坊消息生图失败：${truncate(error.message || error, 350)}`);
    }
}

async function confirmSceneGeneration() {
    if (!ui.sceneConfirm) return;
    const scene = String(valueOf('is-confirm-scene') || '').trim();
    if (!scene) {
        setText('is-confirm-status', '场景提示词不能为空');
        return;
    }
    const entries = selectedConfirmEntries();
    const negative = String(valueOf('is-confirm-negative') || '').trim();
    const positive = composeFinalPrompt(scene, entries, ui.sceneConfirm.style || 'tags');
    const messageId = ui.sceneConfirm.messageId;
    closeSceneConfirm(false);
    await startMessageImageGeneration(messageId, positive, negative);
}

async function generateFromMessage(messageId) {
    await openMessageSceneConfirm(messageId);
}

function bindChatMessageEvents() {
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

function bindEvents() {
    document.addEventListener('click', event => {
        const target = event.target;

        if (target.closest('#is-wand') || target.closest('#is-fab') || target.closest('#is-open-from-settings')) {
            event.preventDefault();
            openPanel();
            return;
        }
        if (target.closest('#is-close')) {
            closePanel();
            return;
        }
        if (target.closest('#is-overlay')) {
            closePanel();
            return;
        }
        if (target.closest('#is-header-status')) {
            switchTab('monitor');
            return;
        }
        const tab = target.closest('[data-is-tab]');
        if (tab) {
            switchTab(tab.dataset.isTab);
            return;
        }
        const provider = target.closest('[data-is-provider]');
        if (provider) {
            get().provider = provider.dataset.isProvider;
            saveSoon();
            syncProviderUI();
            renderResults();
            renderJob();
            return;
        }
        const apiKind = target.closest('[data-is-api-kind]');
        if (apiKind) {
            ui.apiKind = apiKind.dataset.isApiKind;
            setHidden('is-api-editor', true);
            ui.editing = null;
            renderApi();
            return;
        }
        if (target.closest('#is-quick-test')) {
            if (!valueOf('is-comfy-url')) {
                switchTab('monitor');
                toast('info', '先填 ComfyUI 地址，或点“扫描局域网”');
                el('is-comfy-url')?.focus();
                return;
            }
            testComfyWithModels();
            return;
        }
        if (target.closest('#is-fetch-models')) {
            fetchEditorModels({ silent: false, force: true });
            return;
        }
        const modelCategory = target.closest('[data-model-category]');
        if (modelCategory) {
            ui.modelCategory = modelCategory.dataset.modelCategory;
            renderModelBrowser();
            return;
        }
        const modelSelect = target.closest('[data-model-select]');
        if (modelSelect) {
            setValue('is-profile-model', modelSelect.dataset.modelSelect);
            renderModelBrowser();
            return;
        }
        if (target.closest('#is-scan-comfy')) {
            scanForComfy();
            return;
        }
        const scanResult = target.closest('[data-scan-url]');
        if (scanResult) {
            useScanResult(scanResult.dataset.scanUrl);
            return;
        }
        if (target.closest('#is-refresh-models')) {
            testComfyWithModels();
            return;
        }
        if (target.closest('#is-fill-char')) {
            const text = buildCharacterPrompt();
            const positive = el('is-positive');
            if (positive) {
                if (!positive.value.trim()) positive.value = text;
                else insertAtCursor(positive, text);
                get().draft.positive = positive.value;
                saveSoon();
            }
            return;
        }
        if (target.closest('#is-rewrite-toggle')) {
            const box = el('is-rewrite-box');
            if (box) box.hidden = !box.hidden;
            return;
        }
        if (target.closest('#is-rewrite-route-settings')) {
            switchTab('api');
            document.querySelector('#is-panel .is-plugin-model')?.scrollIntoView({ block: 'center' });
            return;
        }
        if (target.closest('#is-rewrite-run')) {
            runRewrite();
            return;
        }
        if (target.closest('#is-library-scan')) {
            scanLibrary();
            return;
        }
        if (target.closest('#is-library-add')) {
            openLibraryEditor();
            return;
        }
        if (target.closest('#is-library-add-selected')) {
            addSelectedLibraryCandidates();
            return;
        }
        if (target.closest('#is-library-clear-candidates')) {
            ui.libraryCandidates = [];
            renderLibraryCandidates();
            setText('is-library-status', '');
            return;
        }
        if (target.closest('#is-library-save')) {
            saveLibraryEditor();
            return;
        }
        if (target.closest('#is-library-cancel')) {
            closeLibraryEditor();
            return;
        }
        if (target.closest('#is-library-reference-clear')) {
            ui.libraryReferencePath = '';
            updateLibraryReferencePreview();
            return;
        }
        const libraryAction = target.closest('[data-library-action]');
        if (libraryAction) {
            const id = libraryAction.dataset.id;
            const entry = getCharacterLibrary().find(item => item.id === id);
            if (!entry) return;
            if (libraryAction.dataset.libraryAction === 'edit') openLibraryEditor(entry);
            else deleteLibraryEntry(id);
            return;
        }
        if (target.closest('#is-confirm-close') || target.closest('#is-confirm-cancel')) {
            closeSceneConfirm();
            return;
        }
        if (target.closest('#is-confirm-open-library')) {
            closeSceneConfirm();
            openPanel('library');
            return;
        }
        if (target.closest('#is-confirm-generate')) {
            confirmSceneGeneration();
            return;
        }
        if (target.id === 'is-confirm') {
            closeSceneConfirm();
            return;
        }
        if (target.closest('#is-rewrite-system-reset')) {
            const settings = get();
            settings.prompt.rewriteSystemCustom = settings.prompt.rewriteSystem;
            settings.prompt.rewriteSystemSource = 'builtin';
            setValue('is-rewrite-system-source', 'builtin');
            saveSoon();
            syncRewriteSystemUI();
            return;
        }
        if (target.closest('#is-add-lora')) {
            const settings = get();
            settings.comfy.loras = settings.comfy.loras || [];
            settings.comfy.loras.push({ name: ui.models?.loras?.[0] || '', strengthModel: 0.8, strengthClip: 0.8 });
            saveSoon();
            renderLoras();
            return;
        }
        const removeLora = target.closest('[data-lora-remove]');
        if (removeLora) {
            const index = Number(removeLora.dataset.loraRemove);
            get().comfy.loras.splice(index, 1);
            saveSoon();
            renderLoras();
            return;
        }
        if (target.closest('#is-generate')) {
            startGeneration();
            return;
        }
        if (target.closest('#is-cancel')) {
            cancelJob();
            return;
        }
        if (target.closest('#is-test-comfy')) {
            testComfyWithModels();
            return;
        }
        if (target.closest('#is-save-comfy')) {
            saveComfyFields();
            toast('success', '连接设置已保存');
            refreshForm();
            return;
        }
        if (target.closest('#is-refresh-monitor')) {
            refreshMonitor();
            return;
        }
        if (target.closest('#is-interrupt')) {
            monitorComfy.interrupt().then(() => toast('info', '已请求中断当前任务')).catch(error => toast('error', error.message));
            return;
        }
        if (target.closest('#is-clear-queue')) {
            confirmAction('清空 ComfyUI 所有等待中的任务？').then(ok => {
                if (!ok) return;
                monitorComfy.clearQueue().then(() => {
                    toast('success', '已清空等待队列');
                    refreshMonitor();
                }).catch(error => toast('error', error.message));
            });
            return;
        }
        const queueAction = target.closest('[data-queue-action]');
        if (queueAction) {
            if (queueAction.dataset.queueAction === 'interrupt') {
                monitorComfy.interrupt().catch(error => toast('error', error.message));
            } else if (queueAction.dataset.queueAction === 'cancel') {
                monitorComfy.deleteQueue([queueAction.dataset.id]).then(() => refreshMonitor()).catch(error => toast('error', error.message));
            }
            return;
        }
        if (target.closest('#is-add-api')) {
            openProfileEditor(ui.apiKind);
            return;
        }
        if (target.closest('#is-import-chat')) {
            try {
                const profile = importCurrentChatProfile();
                openProfileEditor('chat', profile);
                setText('is-profile-status', '已填入当前酒馆聊天配置；Key 不会自动读取，请手动补上再保存。');
            } catch (error) {
                toast('error', error.message || String(error));
            }
            return;
        }
        if (target.closest('#is-refresh-balances')) {
            refreshAllBalances();
            return;
        }
        if (target.closest('#is-profile-save')) {
            saveProfileEditor();
            return;
        }
        if (target.closest('#is-profile-test')) {
            testEditorProfile();
            return;
        }
        if (target.closest('#is-profile-cancel')) {
            setHidden('is-api-editor', true);
            ui.editing = null;
            return;
        }
        if (target.closest('#is-validate-workflow')) {
            validateWorkflow();
            return;
        }
        if (target.closest('#is-lb-close')) {
            closeLightbox();
            return;
        }
        if (target.id === 'is-lightbox') {
            closeLightbox();
            return;
        }
        if (target.closest('#is-lb-download')) {
            if (ui.lightbox?.item) downloadItem(ui.lightbox.item);
            return;
        }
        if (target.closest('#is-lb-bg')) {
            if (ui.lightbox?.item) backgroundFromItem(ui.lightbox.item);
            return;
        }
        if (target.closest('#is-lb-chat')) {
            if (ui.lightbox?.item) chatFromItem(ui.lightbox.item);
            return;
        }
        if (target.closest('#is-clear-history')) {
            confirmAction('清空画坊生成记录？（不会删除酒馆图库里的图片文件）').then(ok => {
                if (!ok) return;
                get().history = [];
                save();
                renderHistory();
            });
            return;
        }
        const copyBlock = target.closest('[data-copy-block]');
        if (copyBlock) {
            const block = copyBlock.closest('.is-request-block');
            const text = block?.querySelector('pre')?.textContent || '';
            navigator.clipboard?.writeText(text).then(() => toast('success', '已复制')).catch(() => toast('error', '复制失败'));
            return;
        }

        const apiAction = target.closest('[data-api-action]');
        if (apiAction) {
            const id = apiAction.dataset.id;
            const kind = ui.apiKind;
            const action = apiAction.dataset.apiAction;
            if (action === 'edit') {
                const profile = getProfiles(kind).find(item => item.id === id);
                if (profile) openProfileEditor(kind, profile);
            } else if (action === 'delete') {
                const profile = getProfiles(kind).find(item => item.id === id);
                if (!profile) return;
                confirmAction(`删除 API「${escapeHtml(profile.name)}」？`).then(ok => {
                    if (!ok) return;
                    removeProfile(kind, profile.id);
                    const settings = get();
                    if (kind === 'image' && settings.cloud.profileId === profile.id) settings.cloud.profileId = '';
                    if (kind === 'chat' && settings.pluginModel.profileId === profile.id) {
                        settings.pluginModel.profileId = '';
                        if (!settings.chatProfiles.length) settings.pluginModel.mode = 'current';
                    }
                    save();
                    renderApi();
                    renderCloudProfiles();
                    toast('success', '已删除');
                });
            } else if (action === 'default') {
                get().cloud.profileId = id;
                const profile = get().imageProfiles.find(item => item.id === id);
                if (profile) get().cloud.model = profile.model;
                save();
                renderApi();
                renderCloudProfiles();
                syncProviderUI();
            } else if (action === 'use-plugin') {
                get().pluginModel.mode = 'profile';
                get().pluginModel.profileId = id;
                save();
                renderApi();
                toast('success', '已设为插件内部模型（不会改变酒馆聊天 API）');
            } else if (action === 'test') {
                testProfileById(id, kind);
            } else if (action === 'balance') {
                refreshBalanceById(id, kind, true);
            } else if (action === 'apply') {
                applyChatById(id);
            }
            return;
        }

        const connectionAction = target.closest('[data-connection-action]');
        if (connectionAction) {
            if (connectionAction.dataset.connectionAction === 'switch') {
                const name = connectionAction.dataset.name;
                confirmAction(`切换到酒馆连接配置「${escapeHtml(name)}」？`).then(ok => {
                    if (!ok) return;
                    switchConnectionProfile(name).then(() => {
                        renderCurrentChat();
                        toast('success', `已切换：${name}`);
                    }).catch(error => toast('error', error.message));
                });
            } else {
                get().pluginModel.mode = 'connection';
                get().pluginModel.connectionProfileId = connectionAction.dataset.id;
                save();
                renderApi();
                toast('success', '已设为插件内部模型（不会改变酒馆聊天 API）');
            }
            return;
        }

        const historyAction = target.closest('[data-history-action]');
        if (historyAction) {
            const entry = entryById(historyAction.dataset.id);
            if (!entry) return;
            const action = historyAction.dataset.historyAction;
            if (action === 'view') openLightbox(entry);
            else if (action === 'reuse') reuseEntry(entry);
            else if (action === 'download') downloadItem(entry);
            else if (action === 'bg') backgroundFromItem(entry);
            else if (action === 'chat') chatFromItem(entry);
            else if (action === 'delete') {
                confirmAction('删除这条生成记录？（图片文件仍保留在酒馆图库）').then(ok => {
                    if (!ok) return;
                    get().history = get().history.filter(item => item.id !== entry.id);
                    save();
                    renderHistory();
                });
            }
            return;
        }
        const historyOpen = target.closest('[data-history-open]');
        if (historyOpen) {
            const entry = entryById(historyOpen.dataset.historyOpen);
            if (entry) openLightbox(entry);
            return;
        }

        const resultAction = target.closest('[data-result-action]');
        if (resultAction) {
            const index = Number(resultAction.dataset.index);
            const result = job.results[index];
            if (!result) return;
            if (resultAction.dataset.resultAction === 'view') openLightbox(result, 'result');
            else if (resultAction.dataset.resultAction === 'download') downloadItem(result);
            else if (resultAction.dataset.resultAction === 'bg') backgroundFromItem(result);
            else if (resultAction.dataset.resultAction === 'chat') chatFromItem(result);
            return;
        }
        const resultView = target.closest('[data-result-view]');
        if (resultView) {
            const result = job.results[Number(resultView.dataset.resultView)];
            if (result) openLightbox(result, 'result');
        }
    });

    document.addEventListener('input', event => {
        const target = event.target;
        if (!target?.id) {
            const row = target?.closest?.('[data-lora-index]');
            if (row && target.dataset.loraField) {
                const index = Number(row.dataset.loraIndex);
                const settings = get();
                settings.comfy.loras[index][target.dataset.loraField] = target.dataset.loraField === 'name' ? target.value : Number(target.value);
                saveSoon();
            }
            return;
        }
        const settings = get();
        switch (target.id) {
            case 'is-positive':
                settings.draft.positive = target.value;
                saveSoon();
                break;
            case 'is-negative':
                settings.draft.negative = target.value;
                saveSoon();
                break;
            case 'is-width':
            case 'is-height':
            case 'is-count':
            case 'is-seed': {
                const dims = activeDims();
                const key = target.id === 'is-count' ? (ui.provider === 'cloud' ? 'count' : 'batch') : target.id.replace('is-', '');
                dims[key === 'count' ? 'count' : key] = Number(target.value);
                if (target.id === 'is-width' || target.id === 'is-height') {
                    const preset = el('is-size-preset');
                    if (preset) preset.value = 'custom';
                }
                saveSoon();
                break;
            }
            case 'is-steps':
            case 'is-cfg':
                settings.comfy[target.id === 'is-steps' ? 'steps' : 'cfg'] = Number(target.value);
                saveSoon();
                break;
            case 'is-hires-scale':
            case 'is-hires-steps':
            case 'is-hires-denoise': {
                const key = target.id.replace('is-hires-', '');
                settings.comfy.hires[key] = Number(target.value);
                saveSoon();
                break;
            }
            case 'is-custom-workflow':
                settings.comfy.customWorkflow = target.value;
                saveSoon();
                break;
            case 'is-cloud-extra':
                settings.cloud.extraBody = target.value;
                saveSoon();
                break;
            case 'is-comfy-url':
            case 'is-comfy-auth':
                settings.comfy[target.id === 'is-comfy-url' ? 'url' : 'auth'] = target.value;
                saveSoon();
                break;
            case 'is-rewrite-intent':
                break;
            case 'is-rewrite-system-text':
                settings.prompt.rewriteSystemCustom = target.value;
                settings.prompt.rewriteSystemSource = 'custom';
                setValue('is-rewrite-system-source', 'custom');
                setText('is-rewrite-system-hint', '使用你填写的系统提示词；是否被上游接受取决于模型/服务商策略。');
                saveSoon();
                break;
            case 'is-plugin-context':
                if (target.value === '') break;
                settings.pluginModel.contextMessages = normalizeContextMessages(target.value);
                saveSoon();
                renderPluginRouteLine();
                break;
            case 'is-model-search':
                ui.modelQuery = target.value;
                renderModelBrowser();
                break;
            case 'is-confirm-scene':
                updateConfirmFinal();
                break;
            case 'is-profile-name':
            case 'is-profile-base':
            case 'is-profile-key':
            case 'is-profile-model':
            case 'is-profile-headers':
            case 'is-profile-extra':
            case 'is-balance-url':
            case 'is-balance-headers':
            case 'is-balance-remaining':
            case 'is-balance-used':
            case 'is-balance-total':
            case 'is-balance-currency':
            case 'is-balance-unit':
            case 'is-custom-endpoint':
            case 'is-custom-body':
            case 'is-custom-response-path':
            case 'is-custom-mime':
                break;
            case 'is-cloud-model':
                settings.cloud.model = target.value;
                saveSoon();
                break;
            default:
                break;
        }
    });

    document.addEventListener('change', event => {
        const target = event.target;
        if (target?.id === 'is-library-reference-file') {
            const file = target.files?.[0];
            setLibraryReferenceFile(file);
            return;
        }
        if (target?.matches?.('[data-confirm-char]')) {
            const entry = selectedConfirmEntries().find(item => item.id === target.dataset.confirmChar);
            if (entry && ui.sceneConfirm) ui.sceneConfirm.selectedIds.add(entry.id);
            if (!target.checked && ui.sceneConfirm) ui.sceneConfirm.selectedIds.delete(target.dataset.confirmChar);
            updateConfirmFinal();
            return;
        }
        const loraRow = target?.closest?.('[data-lora-index]');
        if (loraRow && target.dataset.loraField) {
            const index = Number(loraRow.dataset.loraIndex);
            const settings = get();
            if (settings.comfy.loras?.[index]) {
                settings.comfy.loras[index][target.dataset.loraField] = target.dataset.loraField === 'name' ? target.value : Number(target.value);
                saveSoon();
            }
            return;
        }
        if (!target?.id) return;
        const settings = get();
        switch (target.id) {
            case 'is-size-preset': {
                if (target.value === 'custom') return;
                const [width, height] = target.value.split('x').map(Number);
                const dims = activeDims();
                dims.width = width;
                dims.height = height;
                setValue('is-width', width);
                setValue('is-height', height);
                saveSoon();
                break;
            }
            case 'is-checkpoint':
                settings.comfy.checkpoint = target.value;
                saveSoon();
                break;
            case 'is-sampler':
                settings.comfy.sampler = target.value;
                saveSoon();
                break;
            case 'is-scheduler':
                settings.comfy.scheduler = target.value;
                saveSoon();
                break;
            case 'is-vae':
                settings.comfy.vae = target.value;
                saveSoon();
                break;
            case 'is-workflow-mode':
                settings.comfy.workflowMode = target.value;
                saveSoon();
                syncWorkflowVisibility();
                break;
            case 'is-auto-bind':
                settings.comfy.autoBind = target.checked;
                saveSoon();
                break;
            case 'is-hires-enabled':
                settings.comfy.hires.enabled = target.checked;
                saveSoon();
                syncHiresVisibility();
                break;
            case 'is-use-proxy':
                settings.useServerProxy = target.checked;
                setValue('is-comfy-proxy', target.checked ? 'proxy' : 'direct');
                saveSoon();
                break;
            case 'is-comfy-proxy':
                settings.useServerProxy = target.value !== 'direct';
                setValue('is-use-proxy', settings.useServerProxy);
                saveSoon();
                break;
            case 'is-cloud-profile': {
                settings.cloud.profileId = target.value;
                const profile = settings.imageProfiles.find(item => item.id === target.value);
                settings.cloud.model = profile?.model || '';
                setValue('is-cloud-model', settings.cloud.model);
                saveSoon();
                renderCloudProfiles();
                break;
            }
            case 'is-rewrite-style':
                settings.prompt.style = target.value;
                saveSoon();
                break;
            case 'is-rewrite-system-source':
                settings.prompt.rewriteSystemSource = target.value;
                if (target.value === 'custom' && !settings.prompt.rewriteSystemCustom) {
                    settings.prompt.rewriteSystemCustom = settings.prompt.rewriteSystem;
                }
                saveSoon();
                syncRewriteSystemUI();
                break;
            case 'is-plugin-mode':
                settings.pluginModel.mode = ['current', 'profile', 'connection'].includes(target.value) ? target.value : 'current';
                saveSoon();
                renderApi();
                break;
            case 'is-plugin-profile':
                settings.pluginModel.profileId = target.value;
                saveSoon();
                renderApi();
                break;
            case 'is-plugin-connection':
                settings.pluginModel.connectionProfileId = target.value;
                saveSoon();
                renderApi();
                break;
            case 'is-plugin-context': {
                settings.pluginModel.contextMessages = normalizeContextMessages(target.value);
                setValue('is-plugin-context', settings.pluginModel.contextMessages);
                saveSoon();
                renderPluginRouteLine();
                break;
            }
            case 'is-profile-type':
                syncEditorVisibility();
                ui.editorModels = [];
                ui.modelCategory = ui.editing?.kind === 'chat' ? 'language' : 'image';
                renderModelBrowser();
                if (ui.editing?.isNew) {
                    const list = ui.editing.kind === 'chat' ? CHAT_TYPES : CLOUD_IMAGE_TYPES;
                    const meta = list.find(item => item.id === target.value);
                    if (meta) {
                        setValue('is-profile-base', meta.defaultBase || '');
                        setValue('is-profile-model', meta.defaultModel || '');
                        setValue('is-profile-name', meta.label);
                    }
                }
                break;
            case 'is-profile-balance':
                syncEditorVisibility();
                break;
            case 'is-library-ai-scan':
                settings.libraryScan = settings.libraryScan || { ai: true, scope: 'active' };
                settings.libraryScan.ai = target.checked;
                saveSoon();
                break;
            case 'is-library-scan-scope':
                settings.libraryScan = settings.libraryScan || { ai: true, scope: 'active' };
                settings.libraryScan.scope = target.value === 'all' ? 'all' : 'active';
                saveSoon();
                break;
            case 'is-autosave':
                settings.ui.autoSave = target.checked;
                save();
                break;
            case 'is-workflow-file': {
                const file = target.files?.[0];
                if (!file) return;
                file.text().then(text => {
                    settings.comfy.customWorkflow = text;
                    setValue('is-custom-workflow', text);
                    saveSoon();
                    validateWorkflow();
                }).catch(error => toast('error', `读取工作流失败：${error.message}`));
                break;
            }
            default:
                break;
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (el('is-confirm') && !el('is-confirm').hidden) {
            closeSceneConfirm();
            return;
        }
        if (!el('is-lightbox')?.hidden) {
            closeLightbox();
            return;
        }
        if (el('is-panel')?.classList.contains('is-open')) closePanel();
    });
}

function validateWorkflow() {
    const text = valueOf('is-custom-workflow') || '';
    try {
        const parsed = parseJsonLoose(text);
        if (!parsed || typeof parsed !== 'object') throw new Error('不是有效 JSON');
        if (Array.isArray(parsed.nodes)) throw new Error('这是界面格式，请用 ComfyUI 的“导出（API 格式）”');
        const nodes = Object.values(parsed).filter(node => node?.class_type);
        if (!nodes.length) throw new Error('没有找到 class_type 节点');
        const classes = [...new Set(nodes.map(node => node.class_type))];
        setText('is-workflow-status', `有效 · ${nodes.length} 个节点 · ${classes.slice(0, 8).join(', ')}${classes.length > 8 ? '…' : ''}`);
        get().comfy.customWorkflow = text;
        saveSoon();
    } catch (error) {
        setText('is-workflow-status', `无效：${error.message || error}`);
    }
}

export function togglePanel() {
    const panel = el('is-panel');
    if (panel?.classList.contains('is-open')) closePanel();
    else openPanel();
}
