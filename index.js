import { initStore } from './src/store.js';
import { initUI } from './src/ui.js';

let booted = false;

function boot() {
    if (booted) return;
    booted = true;
    try {
        initStore();
        initUI();
        console.info('[画坊] Image Studio 已加载');
    } catch (error) {
        console.error('[画坊] 初始化失败', error);
        globalThis.toastr?.error?.(`画坊初始化失败：${error?.message || error}`, '画坊', { timeOut: 8000 });
    }
}

export async function activate() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) return;

    try {
        const core = await import('/script.js');
        if (core?.settingsReady) {
            boot();
            return;
        }
    } catch (error) {
        console.warn('[画坊] 无法检查设置状态，等待 APP_READY', error);
    }

    const events = context.eventTypes || context.event_types || {};
    const appReady = events.APP_READY || 'app_ready';
    try {
        context.eventSource?.once?.(appReady, boot);
    } catch { /* ignore */ }
    setTimeout(boot, 15_000);
}
