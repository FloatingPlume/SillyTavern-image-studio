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
    buildRewriteMessages,
    expandPrompt,
    insertAtCursor,
    parseRewriteResult,
} from './prompt.js';
import {
    clamp,
    ctx,
    escapeHtml,
    formatBytes,
    imagePathToUrl,
    parseJsonLoose,
    toast,
    truncate,
} from './util.js';
import { ComfyService } from './comfy.js';
import { defaultImageProfile, testImageProfile } from './providers.js';
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
    switchConnectionProfile,
    testChatProfile,
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
    lastErrorToast: '',
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
    renderRewriteSelects();
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
    renderRewriteSelects();
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
    closeLightbox();
}

function switchTab(tab) {
    const target = ['generate', 'monitor', 'api', 'history'].includes(tab) ? tab : 'generate';
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
    setValue('is-rewrite-source', settings.prompt.rewriteMode || 'current');

    rebuildSizeOptions();
    syncProviderUI();
    refreshComfySelects();
    renderLoras();
    renderCloudProfiles();
    renderRewriteSelects();
    syncWorkflowVisibility();
    syncHiresVisibility();
    syncRewriteSourceVisibility();
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
        setText('is-cloud-hint', `${typeLabel('image', profile.type)} · ${profileHost(profile)} · ${profile.model || '未设默认模型'}${balanceText}`);
        if (!settings.cloud.model) {
            settings.cloud.model = profile.model || '';
            setValue('is-cloud-model', settings.cloud.model);
        }
    }
}

function renderRewriteSelects() {
    const settings = get();
    const chatSelect = el('is-rewrite-profile');
    const connectionSelect = el('is-rewrite-connection');
    if (chatSelect) {
        const profiles = settings.chatProfiles || [];
        chatSelect.innerHTML = profiles.length
            ? profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === settings.prompt.rewriteProfileId ? 'selected' : ''}>${escapeHtml(profile.name)} · ${escapeHtml(profile.model || '未设模型')}</option>`).join('')
            : '<option value="">（没有聊天档案）</option>';
        if (!settings.prompt.rewriteProfileId && profiles.length) {
            settings.prompt.rewriteProfileId = profiles[0].id;
            saveSoon();
        }
    }
    if (connectionSelect) {
        const profiles = listConnectionProfiles();
        connectionSelect.innerHTML = profiles.length
            ? profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === settings.prompt.rewriteConnectionProfileId ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')
            : '<option value="">（酒馆没有连接配置）</option>';
        if (!settings.prompt.rewriteConnectionProfileId && profiles.length) {
            settings.prompt.rewriteConnectionProfileId = profiles[0].id;
            saveSoon();
        }
    }
    setValue('is-rewrite-style', settings.prompt.style || 'tags');
    setValue('is-rewrite-source', settings.prompt.rewriteMode || 'current');
    syncRewriteSourceVisibility();
}

function syncRewriteSourceVisibility() {
    const source = valueOf('is-rewrite-source') || 'current';
    setHidden('is-rewrite-profile-wrap', source !== 'profile');
    setHidden('is-rewrite-connection-wrap', source !== 'connection');
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
                : settings.prompt.rewriteProfileId === profile.id;
            const applyButton = kind === 'chat'
                ? `<button type="button" class="is-link" data-api-action="apply" data-id="${escapeHtml(profile.id)}">应用到酒馆</button>`
                : '';
            const defaultButton = kind === 'image'
                ? `<button type="button" class="is-link" data-api-action="default" data-id="${escapeHtml(profile.id)}">${isDefault ? '当前默认' : '设为默认'}</button>`
                : `<button type="button" class="is-link" data-api-action="use-rewrite" data-id="${escapeHtml(profile.id)}">${isDefault ? '当前改写' : '用于改写'}</button>`;
            return `<div class="is-api-card ${isDefault ? 'is-default' : ''}" data-api-id="${escapeHtml(profile.id)}">
                <div class="is-api-card-head">
                    <span class="is-api-name">${escapeHtml(profile.name)}</span>
                    <span class="is-badge">${escapeHtml(typeLabel(kind, profile.type))}</span>
                    ${isDefault ? '<span class="is-badge">默认</span>' : ''}
                    <span class="is-grow"></span>
                    <span class="is-badge is-balance ${balance && !balance.ok ? 'is-error' : ''}" data-api-action="balance" data-id="${escapeHtml(profile.id)}" title="${balanceTitle}">${escapeHtml(balanceText)}</span>
                </div>
                <div class="is-api-meta">${escapeHtml(profileHost(profile))} · ${escapeHtml(profile.model || '未设模型')} · ${escapeHtml(maskKey(profile))}</div>
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
    renderRewriteSelects();
}

function renderConnectionProfiles() {
    const node = el('is-connection-profiles');
    if (!node) return;
    const profiles = listConnectionProfiles();
    if (!profiles.length) {
        node.innerHTML = '<div class="is-hint">酒馆里还没有连接配置。可以先在酒馆的连接配置里创建，再回来切换。</div>';
        return;
    }
    node.innerHTML = profiles.map(profile => `<div class="is-connection-item">
        <span class="is-api-name">${escapeHtml(profile.name)}</span>
        <span class="is-grow">${escapeHtml(profile.model || '')}</span>
        <button type="button" class="is-link" data-connection-action="switch" data-name="${escapeHtml(profile.name)}">切换</button>
        <button type="button" class="is-link" data-connection-action="rewrite" data-id="${escapeHtml(profile.id)}">用于改写</button>
    </div>`).join('');
}

function renderHistory() {
    const settings = get();
    const node = el('is-history-list');
    if (!node) return;
    updateAutosave();
    if (!settings.history.length) {
        node.innerHTML = '<div class="is-hint">还没有生成记录。图片默认会保存到酒馆图库的 image-studio 文件夹。</div>';
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
}

function renderResults() {
    const node = el('is-results');
    if (!node) return;
    if (!job.results.length) {
        node.innerHTML = '';
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
        if (profile.kind === 'chat' && !settings.prompt.rewriteProfileId) {
            settings.prompt.rewriteProfileId = profile.id;
        }
        save();
        setHidden('is-api-editor', true);
        ui.editing = null;
        renderApi();
        renderCloudProfiles();
        syncProviderUI();
        toast('success', 'API 已保存');
    } catch (error) {
        setText('is-profile-status', error.message || String(error));
        toast('error', error.message || String(error));
    }
}

async function testEditorProfile() {
    try {
        const profile = readEditorProfile();
        setText('is-profile-status', '测试中…');
        if (profile.kind === 'image' && profile.type === 'custom') {
            setText('is-profile-status', '自定义接口没有统一的连接检测，请直接生成一张测试图');
            return;
        }
        if (profile.kind === 'chat') {
            const models = await testChatProfile(profile);
            setText('is-profile-status', `连接成功，发现 ${models.length} 个模型`);
            fillModelDatalist(models);
        } else {
            const result = await testImageProfile(profile);
            fillModelDatalist(result.imageModels.length ? result.imageModels : result.models);
            setText('is-profile-status', `连接成功，发现 ${result.models.length} 个模型${result.imageModels.length ? `（${result.imageModels.length} 个生图）` : ''}`);
            if (!valueOf('is-profile-model') && result.imageModels[0]) setValue('is-profile-model', result.imageModels[0]);
        }
        toast('success', 'API 连接成功');
    } catch (error) {
        setText('is-profile-status', `失败：${error.message || error}`);
    }
}

function fillModelDatalist(models) {
    const datalist = el('is-model-list');
    if (!datalist) return;
    datalist.innerHTML = (models || []).slice(0, 100).map(model => `<option value="${escapeHtml(model)}"></option>`).join('');
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
        if (kind === 'chat') {
            const models = await testChatProfile(profile);
            fillModelDatalist(models);
            toast('success', `连接成功，发现 ${models.length} 个模型`);
        } else {
            const result = await testImageProfile(profile);
            fillModelDatalist(result.imageModels.length ? result.imageModels : result.models);
            toast('success', `连接成功，发现 ${result.models.length} 个模型${result.imageModels.length ? `（${result.imageModels.length} 个生图）` : ''}`);
        }
    } catch (error) {
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

async function runRewrite() {
    if (ui.rewriteBusy) return;
    const settings = get();
    const source = valueOf('is-rewrite-source') || 'current';
    const style = valueOf('is-rewrite-style') || 'tags';
    const intent = String(valueOf('is-rewrite-intent') || '').trim();
    const positive = String(valueOf('is-positive') || '').trim();
    const negative = String(valueOf('is-negative') || '').trim();
    settings.prompt.style = style;
    settings.prompt.rewriteMode = source;
    saveSoon();

    const messages = buildRewriteMessages({ style, intent, positive, negative });
    ui.rewriteBusy = true;
    setText('is-rewrite-status', '请求中…');
    const button = el('is-rewrite-run');
    if (button) button.disabled = true;
    try {
        let raw = '';
        if (source === 'current') {
            raw = await rewriteWithCurrentApi(messages, 700);
        } else if (source === 'profile') {
            const profile = settings.chatProfiles.find(item => item.id === settings.prompt.rewriteProfileId) || settings.chatProfiles[0];
            if (!profile) throw new Error('还没有聊天 API 档案，请到 API 页添加');
            raw = await chatComplete(profile, messages, { maxTokens: 700, temperature: 0.75 });
        } else {
            const profiles = listConnectionProfiles();
            const profile = profiles.find(item => item.id === settings.prompt.rewriteConnectionProfileId) || profiles[0];
            if (!profile) throw new Error('酒馆里还没有连接配置');
            raw = await rewriteWithConnectionProfile(profile.id, messages, 700);
        }
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
            testComfyWithModels();
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
        if (target.closest('#is-rewrite-run')) {
            runRewrite();
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
                    if (kind === 'chat' && settings.prompt.rewriteProfileId === profile.id) settings.prompt.rewriteProfileId = '';
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
            } else if (action === 'use-rewrite') {
                get().prompt.rewriteProfileId = id;
                get().prompt.rewriteMode = 'profile';
                save();
                renderApi();
                renderRewriteSelects();
                toast('success', '已设为改写用的聊天 API');
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
                get().prompt.rewriteConnectionProfileId = connectionAction.dataset.id;
                get().prompt.rewriteMode = 'connection';
                save();
                renderRewriteSelects();
                toast('success', '已设为改写用的酒馆连接配置');
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
            case 'is-rewrite-source':
                settings.prompt.rewriteMode = target.value;
                saveSoon();
                syncRewriteSourceVisibility();
                break;
            case 'is-rewrite-profile':
                settings.prompt.rewriteProfileId = target.value;
                saveSoon();
                break;
            case 'is-rewrite-connection':
                settings.prompt.rewriteConnectionProfileId = target.value;
                saveSoon();
                break;
            case 'is-profile-type':
                syncEditorVisibility();
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
