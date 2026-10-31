import {
    BALANCE_TTL,
    DEFAULT_NEGATIVE,
    DEFAULT_PROMPT_TEMPLATE,
    DEFAULT_REWRITE_SYSTEM,
    HISTORY_LIMIT,
    SETTINGS_KEY,
} from './constants.js';
import { normalizePluginRoute } from './plugin-model.js';
import { ctx, deepMerge, uid } from './util.js';

function defaultSettings() {
    return {
        version: 1,
        useServerProxy: true,
        provider: 'comfy',
        comfy: {
            url: '',
            auth: '',
            scanPrefix: '',
            scanPort: 8188,
            checkpoint: '',
            sampler: '',
            scheduler: '',
            vae: '',
            steps: 28,
            cfg: 7,
            width: 1024,
            height: 1024,
            batch: 1,
            seed: -1,
            loras: [],
            hires: {
                enabled: false,
                scale: 1.5,
                steps: 14,
                denoise: 0.45,
            },
            workflowMode: 'simple',
            customWorkflow: '',
            autoBind: true,
            autoPreview: true,
        },
        cloud: {
            profileId: '',
            model: '',
            width: 1024,
            height: 1024,
            heightRatio: '1:1',
            count: 1,
            seed: -1,
            extraBody: '{}',
        },
        imageProfiles: [],
        chatProfiles: [],
        pluginModel: {
            mode: 'current',
            profileId: '',
            connectionProfileId: '',
            contextMessages: 4,
        },
        libraryScan: {
            ai: true,
            scope: 'active',
        },
        prompt: {
            style: 'tags',
            template: DEFAULT_PROMPT_TEMPLATE,
            negative: DEFAULT_NEGATIVE,
            rewriteSystem: DEFAULT_REWRITE_SYSTEM,
            rewriteSystemSource: 'st',
            rewriteSystemCustom: DEFAULT_REWRITE_SYSTEM,
            recentCount: 6,
        },
        draft: {
            positive: '',
            negative: DEFAULT_NEGATIVE,
        },
        history: [],
        balanceCache: {},
        ui: {
            autoSave: true,
            autoRefresh: true,
            lastTab: 'generate',
            showFab: false,
        },
        lastGenerated: null,
    };
}

export const store = {
    settings: null,
    initialized: false,
    ready: false,
    pendingSave: false,
};

export function initStore() {
    const context = ctx();
    if (!context) throw new Error('SillyTavern context 不可用');
    context.extensionSettings[SETTINGS_KEY] = context.extensionSettings[SETTINGS_KEY] || {};
    const existing = context.extensionSettings[SETTINGS_KEY];
    const defaults = defaultSettings();
    const merged = deepMerge(defaults, existing);
    merged.version = 1;
    const legacyRoute = existing?.pluginModel ? null : existing?.prompt;
    const hadPluginModel = existing && typeof existing.pluginModel === 'object' && existing.pluginModel !== null;
    merged.pluginModel = normalizePluginRoute(hadPluginModel ? merged.pluginModel : {}, legacyRoute || {});
    if (merged.prompt) {
        delete merged.prompt.rewriteMode;
        delete merged.prompt.rewriteProfileId;
        delete merged.prompt.rewriteConnectionProfileId;
    }
    if (!Array.isArray(merged.imageProfiles)) merged.imageProfiles = [];
    if (!Array.isArray(merged.chatProfiles)) merged.chatProfiles = [];
    if (!Array.isArray(merged.history)) merged.history = [];
    if (!merged.balanceCache || typeof merged.balanceCache !== 'object') merged.balanceCache = {};
    for (const profile of [...merged.imageProfiles, ...merged.chatProfiles]) {
        ensureProfileShape(profile);
    }
    context.extensionSettings[SETTINGS_KEY] = merged;
    store.settings = merged;
    store.initialized = true;

    store.ready = true;
    return merged;
}

export function ensureProfileShape(profile) {
    if (!profile.id) profile.id = uid(profile.kind === 'chat' ? 'chat' : 'img');
    if (!profile.kind) profile.kind = profile.applyConfig ? 'chat' : 'image';
    profile.name = String(profile.name || '未命名 API');
    profile.type = String(profile.type || 'openai-compatible');
    profile.baseUrl = String(profile.baseUrl || '');
    profile.apiKey = String(profile.apiKey || '');
    profile.model = String(profile.model || '');
    if (!Array.isArray(profile.models)) profile.models = [];
    profile.models = profile.models.map(item => String(item?.id || item || '').trim()).filter(Boolean);
    profile.modelsFetchedAt = Number(profile.modelsFetchedAt || 0);
    profile.modelsError = String(profile.modelsError || '');
    profile.headers = typeof profile.headers === 'string' ? profile.headers : JSON.stringify(profile.headers || {}, null, 2);
    profile.extraBody = typeof profile.extraBody === 'string' ? profile.extraBody : JSON.stringify(profile.extraBody || {}, null, 2);
    profile.balancePreset = profile.balancePreset || 'auto';
    profile.balance = profile.balance || {
        url: '',
        method: 'GET',
        headers: '{}',
        remainingPath: '',
        usedPath: '',
        totalPath: '',
        currencyPath: '',
        unit: '',
    };
    profile.custom = profile.custom || {
        endpoint: '',
        method: 'POST',
        body: '',
        responsePath: 'data.0.b64_json',
        responseType: 'base64',
        mime: 'image/png',
    };
    profile.createdAt = profile.createdAt || Date.now();
    return profile;
}

export function get() {
    if (!store.settings) initStore();
    const context = ctx();
    const canonical = context?.extensionSettings?.[SETTINGS_KEY];
    if (canonical && canonical !== store.settings) {
        const reseated = deepMerge(store.settings, canonical);
        context.extensionSettings[SETTINGS_KEY] = reseated;
        store.settings = reseated;
    }
    return store.settings;
}

export function save() {
    const context = ctx();
    if (!store.ready) {
        store.pendingSave = true;
        return;
    }
    if (context?.saveSettingsDebounced) {
        context.saveSettingsDebounced();
    } else if (context?.saveSettings) {
        context.saveSettings();
    }
}

let saveTimer = null;
export function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        save();
    }, 600);
}

export function getProfiles(kind) {
    const settings = get();
    return kind === 'chat' ? settings.chatProfiles : settings.imageProfiles;
}

export function upsertProfile(kind, profile) {
    const settings = get();
    const list = kind === 'chat' ? settings.chatProfiles : settings.imageProfiles;
    ensureProfileShape(profile);
    profile.kind = kind;
    const index = list.findIndex(item => item.id === profile.id);
    if (index >= 0) {
        list[index] = profile;
    } else {
        list.push(profile);
    }
    saveSoon();
    return profile;
}

export function removeProfile(kind, id) {
    const settings = get();
    const list = kind === 'chat' ? settings.chatProfiles : settings.imageProfiles;
    const index = list.findIndex(item => item.id === id);
    if (index >= 0) {
        list.splice(index, 1);
        saveSoon();
    }
}

export function getActiveImageProfile() {
    const settings = get();
    return settings.imageProfiles.find(profile => profile.id === settings.cloud.profileId) || null;
}

export function addHistory(entry) {
    const settings = get();
    settings.history.unshift(entry);
    if (settings.history.length > HISTORY_LIMIT) {
        settings.history.splice(HISTORY_LIMIT);
    }
    saveSoon();
}

export function removeHistory(id) {
    const settings = get();
    const index = settings.history.findIndex(item => item.id === id);
    if (index >= 0) {
        settings.history.splice(index, 1);
        saveSoon();
    }
}

export function clearHistory() {
    const settings = get();
    settings.history = [];
    saveSoon();
}

export function getBalanceCache(profileId) {
    const settings = get();
    return settings.balanceCache?.[profileId] || null;
}

export function setBalanceCache(profileId, value) {
    const settings = get();
    settings.balanceCache = settings.balanceCache || {};
    settings.balanceCache[profileId] = { ...value, at: Date.now() };
    saveSoon();
}

export function isBalanceFresh(profileId) {
    const cache = getBalanceCache(profileId);
    return !!cache && Date.now() - Number(cache.at || 0) < BALANCE_TTL;
}
