export const PLUGIN_MODES = [
    { id: 'current', label: '跟随酒馆当前聊天 API' },
    { id: 'profile', label: '画坊聊天 API 档案' },
    { id: 'connection', label: '酒馆连接配置' },
];

export const PLUGIN_CONTEXT_DEFAULT = 4;
export const PLUGIN_CONTEXT_MAX = 20;

export function normalizeContextMessages(value, fallback = PLUGIN_CONTEXT_DEFAULT) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(PLUGIN_CONTEXT_MAX, Math.round(number)));
}

export function normalizePluginRoute(route, legacyPrompt = {}) {
    const source = route && typeof route === 'object' ? route : {};
    const legacyMode = legacyPrompt?.rewriteMode;
    const mode = PLUGIN_MODES.some(item => item.id === source.mode)
        ? source.mode
        : PLUGIN_MODES.some(item => item.id === legacyMode)
            ? legacyMode
            : 'current';
    return {
        mode,
        profileId: String(source.profileId || legacyPrompt?.rewriteProfileId || ''),
        connectionProfileId: String(source.connectionProfileId || legacyPrompt?.rewriteConnectionProfileId || ''),
        contextMessages: normalizeContextMessages(source.contextMessages),
    };
}

export function resolvePluginRoute(settings, { connectionProfiles = [], current = null } = {}) {
    const route = normalizePluginRoute(settings?.pluginModel, settings?.prompt);
    if (route.mode === 'profile') {
        const profile = (settings?.chatProfiles || []).find(item => item.id === route.profileId) || null;
        return {
            mode: route.mode,
            route,
            profile,
            connection: null,
            model: profile?.model || '',
            label: profile ? `${profile.name} · ${profile.model || '未设模型'}` : '未选择画坊聊天 API',
            ready: !!profile,
        };
    }
    if (route.mode === 'connection') {
        const connection = connectionProfiles.find(item => item.id === route.connectionProfileId) || null;
        return {
            mode: route.mode,
            route,
            profile: null,
            connection,
            model: connection?.model || '',
            label: connection
                ? `${connection.name}${connection.model ? ` · ${connection.model}` : ''}`
                : '未选择酒馆连接配置',
            ready: !!connection,
        };
    }
    return {
        mode: 'current',
        route,
        profile: null,
        connection: null,
        model: current?.model || '',
        label: current
            ? `酒馆当前 · ${current.model || current.source || '聊天 API'}`
            : '酒馆当前聊天 API',
        ready: true,
    };
}
