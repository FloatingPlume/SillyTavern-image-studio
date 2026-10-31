import { clamp, escapeHtml, toast } from '../util.js';
import { get, getProfiles, removeProfile, save, saveSoon } from '../store.js';
import { cancelJob } from '../jobs.js';
import { importCurrentChatProfile, switchConnectionProfile } from '../chat.js';
import { buildCharacterPrompt } from '../prompt.js';
import { getCharacterLibrary } from '../character-library.js';
import { normalizeContextMessages } from '../plugin-model.js';
import {
    applyChatById,
    fetchEditorModels,
    openProfileEditor,
    refreshAllBalances,
    refreshBalanceById,
    renderApi,
    renderCurrentChat,
    renderModelBrowser,
    renderPluginRouteLine,
    saveProfileEditor,
    syncEditorVisibility,
    syncHiresVisibility,
    syncRewriteSystemUI,
    syncWorkflowVisibility,
    testEditorProfile,
    testProfileById,
} from './api.js';
import {
    addSelectedLibraryCandidates,
    closeLibraryEditor,
    convertSelectedLibraryPrompts,
    deleteLibraryEntry,
    generateFromLibrary,
    openLibraryEditor,
    renderLibraryCandidates,
    saveLibraryEditor,
    scanLibrary,
    setLibraryReferenceFile,
    updateLibraryReferencePreview,
} from './library.js';
import {
    closeSceneConfirm,
    confirmSceneGeneration,
    selectedConfirmEntries,
    updateConfirmFinal,
} from './scene.js';
import {
    cancelQueuedComfy,
    clearComfyQueue,
    interruptComfy,
    refreshMonitor,
    saveComfyFields,
    scanForComfy,
    testComfyWithModels,
    useScanResult,
} from './monitor.js';
import {
    clearGenerationReference,
    markGenerationSourceModified,
    renderJob,
    renderResults,
    resetGenerationSource,
    setGenerationReference,
    setGenerationSource,
    startGeneration,
} from './generation.js';
import {
    backgroundFromItem,
    chatFromItem,
    closeLightbox,
    downloadItem,
    entryById,
    openLightbox,
    renderHistory,
    reuseEntry,
} from './history.js';
import { confirmAction, el, setHidden, setText, setValue, ui, valueOf } from './core.js';

export function bindEvents(deps) {
    const { activeDims, refreshForm, renderCloudProfiles, syncProviderUI, renderLoras, switchTab, openPanel, closePanel, runRewrite, validateWorkflow, loadIpadapterTemplate } = deps;
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
                positive.value = text;
                get().draft.positive = positive.value;
                setGenerationSource({ type: 'manual', label: '手动提示词', detail: '角色外观' });
                saveSoon();
                toast('success', '已用角色外观替换提示词');
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
        if (target.closest('#is-library-convert')) {
            convertSelectedLibraryPrompts();
            return;
        }
        if (target.closest('#is-library-generate')) {
            generateFromLibrary();
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
        if (target.closest('#is-reference-clear')) {
            clearGenerationReference();
            return;
        }
        if (target.closest('#is-generation-source-reset')) {
            resetGenerationSource();
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
            interruptComfy().catch(error => toast('error', error.message));
            return;
        }
        if (target.closest('#is-clear-queue')) {
            confirmAction('清空 ComfyUI 所有等待中的任务？').then(ok => {
                if (!ok) return;
                clearComfyQueue().catch(error => toast('error', error.message));
            });
            return;
        }
        const queueAction = target.closest('[data-queue-action]');
        if (queueAction) {
            if (queueAction.dataset.queueAction === 'interrupt') {
                interruptComfy().catch(error => toast('error', error.message));
            } else if (queueAction.dataset.queueAction === 'cancel') {
                cancelQueuedComfy(queueAction.dataset.id).catch(error => toast('error', error.message));
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
        if (target.closest('#is-load-ipadapter')) {
            loadIpadapterTemplate();
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
                markGenerationSourceModified();
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
            case 'is-img2img-denoise':
                settings.comfy.img2imgDenoise = clamp(Number(target.value || 0.55), 0.05, 1);
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
        if (target?.id === 'is-reference-file') {
            const file = target.files?.[0];
            if (file) setGenerationReference({ blob: file, name: file.name });
            return;
        }
        if (target?.matches?.('[data-library-check]')) {
            const id = target.dataset.libraryCheck;
            if (target.checked) ui.librarySelected.add(id);
            else ui.librarySelected.delete(id);
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

