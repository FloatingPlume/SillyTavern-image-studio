import { SIZE_PRESETS } from './constants.js';
import { get, getActiveImageProfile, getBalanceCache, save, saveSoon } from './store.js';
import { buildQuietRewritePrompt, buildRewriteMessages, parseRewriteResult } from './prompt.js';
import { ctx, escapeHtml, parseJsonLoose, stripHtml, toast, truncate } from './util.js';
import { getCharacterLibrary } from './character-library.js';
import { filterModels } from './model-catalog.js';
import { portFromUrl, prefixFromUrl } from './discovery.js';
import { initFloatingCat } from './floating-cat.js';
import { normalizeContextMessages } from './plugin-model.js';
import { formatBalance } from './balance.js';
import {
    chatComplete,
    rewriteWithConnectionProfile,
    rewriteWithCurrentApi,
    rewriteWithCurrentPreset,
} from './chat.js';
import { cancelJob, job } from './jobs.js';
import { panelTemplate, settingsDrawerTemplate, wandItemTemplate } from './templates.js';
import { bindEvents } from './ui/events.js';
import {
    el,
    profileHost,
    setHidden,
    setText,
    setValue,
    typeLabel,
    ui,
    valueOf,
    wireBridge,
} from './ui/core.js';
import { renderLibrary, startLibraryImageGeneration } from './ui/library.js';
import {
    bindChatMessageEvents,
    clearMessageSlot,
    refreshMessageGenButton,
    restoreMessageThumbnails,
    startMessageImageGeneration,
} from './ui/messages.js';
import { silentProbe, startMonitor, stopMonitor } from './ui/monitor.js';
import {
    clearGenerationReference,
    markGenerationSourceModified,
    renderGenerationSource,
    renderJob,
    renderReferenceBar,
    renderRequestDetails,
    renderResults,
    resetGenerationSource,
    resolveGenerationReference,
    setGenerationReference,
    setGenerationSource,
} from './ui/generation.js';
import { closeLightbox, openLightbox, renderHistory } from './ui/history.js';
import {
    currentPluginRoute,
    fillModelDatalist,
    renderApi,
    renderCurrentChat,
    renderPluginModel,
    syncHiresVisibility,
    syncWorkflowVisibility,
    updateAutosave,
} from './ui/api.js';

function activeDims() {
    const settings = get();
    return settings.provider === 'cloud' ? settings.cloud : settings.comfy;
}

function providerSettings() {
    return activeDims();
}

export function initUI() {
    if (ui.initialized) return;
    const context = ctx();
    if (!context) throw new Error('SillyTavern 尚未就绪');
    wireBridge({
        switchTab,
        openPanel,
        refreshForm,
        requestRewrite,
        requestPluginCompletion,
        renderJob,
        renderResults,
        renderHistory,
        setGenerationSource,
        setGenerationReference,
        clearGenerationReference,
        resetGenerationSource,
        resolveGenerationReference,
        openLightbox,
        renderCloudProfiles,
        syncProviderUI,
        refreshComfySelects,
        setConnection,
        updateSettingsStatus,
        startMessageImageGeneration,
        startLibraryImageGeneration,
        clearMessageSlot,
        refreshMessageGenButton,
        restoreMessageThumbnails,
    });
    ensureDom();
    bindEvents({
        activeDims,
        refreshForm,
        renderCloudProfiles,
        syncProviderUI,
        renderLoras,
        switchTab,
        openPanel,
        closePanel,
        runRewrite,
        validateWorkflow,
        loadIpadapterTemplate,
    });
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
    setValue('is-img2img-denoise', settings.comfy.img2imgDenoise ?? 0.55);
    renderReferenceBar();
    renderGenerationSource();
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
        const hasReference = !!(settings.draft?.referencePath || ui.referenceBlob);
        let referenceHint = '';
        if (hasReference) {
            const refModel = settings.cloud.model || profile.model;
            if (profile.type === 'xai') referenceHint = ' · 参考图：xAI 不支持，请清除';
            else if (profile.type === 'gemini' && /^imagen/i.test(refModel)) referenceHint = ' · 参考图：Imagen 未适配，请换 Gemini 图像模型';
            else if (profile.type === 'custom' && !/reference/i.test(profile.custom?.body || '')) referenceHint = ' · 参考图：请求体需使用 reference 变量';
            else if (profile.type === 'openai' && !/^gpt-image|^dall-e-2/i.test(refModel)) referenceHint = ' · 参考图：该模型不支持 edits';
            else if (profile.type === 'openai-compatible') referenceHint = ' · 参考图：尝试直连 /images/edits（需接口支持 CORS）';
            else if (profile.type === 'openai') referenceHint = ' · 参考图：直连 /images/edits（需 CORS 与 gpt-image-1/dall-e-2）';
            else referenceHint = ' · 参考图：将使用图生图/编辑接口';
        }
        setText('is-cloud-hint', `${typeLabel('image', profile.type)} · ${profileHost(profile)} · ${profile.model || '未设默认模型'}${balanceText}${xaiHint}${referenceHint}`);
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
        markGenerationSourceModified();
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

async function loadIpadapterTemplate() {
    try {
        const response = await fetch(new URL('../workflows/ipadapter-plus.json', import.meta.url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const settings = get();
        settings.comfy.customWorkflow = text;
        settings.comfy.workflowMode = 'custom';
        setValue('is-custom-workflow', text);
        setValue('is-workflow-mode', 'custom');
        saveSoon();
        syncWorkflowVisibility();
        validateWorkflow();
        setText('is-workflow-status', '已载入 IPAdapter Plus 模板 · 需要参考图和 IPAdapter 模型');
        if (!get().draft?.referencePath && !ui.referenceBlob) {
            toast('warning', 'IPAdapter 模板需要参考图；请先在角色库选择角色或在高级参数里选图');
        } else {
            toast('success', '已载入 IPAdapter 模板');
        }
    } catch (error) {
        toast('error', `载入模板失败：${error.message || error}`);
    }
}

export function togglePanel() {
    const panel = el('is-panel');
    if (panel?.classList.contains('is-open')) closePanel();
    else openPanel();
}
