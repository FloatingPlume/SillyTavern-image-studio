import { ComfyService } from './comfy.js';
import { generateCloudImages, parseExtraBody } from './providers.js';
import { buildCustomWorkflow, buildSimpleWorkflow, summarizeWorkflow } from './workflow.js';
import { addHistory, get, getActiveImageProfile, saveSoon } from './store.js';
import { imageUrl, saveBlobToST } from './history.js';
import { clamp, parseJsonLoose, toast, truncate, uid } from './util.js';

const NODE_LABELS = {
    CheckpointLoaderSimple: '加载模型',
    LoraLoader: '加载 LoRA',
    CLIPTextEncode: '文本编码',
    EmptyLatentImage: '初始化画布',
    KSampler: '采样',
    KSamplerAdvanced: '采样',
    LatentUpscaleBy: '潜空间放大',
    VAEDecode: 'VAE 解码',
    VAELoader: '加载 VAE',
    SaveImage: '保存图片',
};

export const job = {
    active: false,
    provider: null,
    status: 'idle',
    statusText: '',
    progress: 0,
    node: '',
    nodeProgress: '',
    queueRemaining: null,
    startedAt: 0,
    promptId: '',
    previewUrl: '',
    results: [],
    error: '',
    cancelled: false,
    details: null,
    comfy: null,
    models: null,
    pollTimer: null,
    timeoutTimer: null,
    cloudAbort: null,
    finishing: false,
    callbacks: {},
};

let previewObjectUrl = '';
const pendingMessages = [];

function emit(patch = {}) {
    Object.assign(job, patch);
    job.callbacks.onUpdate?.({ ...job });
}

function clearPreview() {
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = '';
    }
    emit({ previewUrl: '' });
}

function setPreview(blob) {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(blob);
    emit({ previewUrl: previewObjectUrl });
}

function resolveSeed(value) {
    const seed = Number(value);
    if (Number.isFinite(seed) && seed >= 0) return Math.floor(seed);
    return Math.floor(Math.random() * 4_294_967_295);
}

function elapsed() {
    return job.startedAt ? Date.now() - job.startedAt : 0;
}

function nodeLabel(nodeId, workflow) {
    if (!nodeId) return '';
    const node = workflow?.[nodeId];
    if (!node) return `节点 ${nodeId}`;
    return NODE_LABELS[node.class_type] || node.class_type;
}

function stopTimers() {
    if (job.pollTimer) {
        clearInterval(job.pollTimer);
        job.pollTimer = null;
    }
    if (job.timeoutTimer) {
        clearTimeout(job.timeoutTimer);
        job.timeoutTimer = null;
    }
}

function resetJob(provider, callbacks, details) {
    stopTimers();
    clearPreview();
    job.active = true;
    job.provider = provider;
    job.status = 'starting';
    job.statusText = '准备中';
    job.progress = 0;
    job.node = '';
    job.nodeProgress = '';
    job.queueRemaining = null;
    job.startedAt = Date.now();
    job.promptId = '';
    job.results = [];
    job.error = '';
    job.cancelled = false;
    job.details = details;
    job.finishing = false;
    job.cloudAbort = null;
    job.callbacks = callbacks || {};
    pendingMessages.length = 0;
    emit({});
}

function handleSocketMessage(message) {
    if (!message || message.type === 'status') {
        const remaining = message?.data?.status?.exec_info?.queue_remaining;
        if (Number.isFinite(Number(remaining))) emit({ queueRemaining: Number(remaining) });
        return;
    }
    if (!job.promptId) {
        pendingMessages.push(message);
        if (pendingMessages.length > 50) pendingMessages.shift();
        return;
    }
    const promptId = message.data?.prompt_id;
    if (promptId && promptId !== job.promptId) return;
    switch (message.type) {
        case 'execution_start':
            emit({ status: 'running', statusText: '开始执行', progress: 0 });
            break;
        case 'execution_cached':
            emit({ statusText: '部分节点已缓存' });
            break;
        case 'executing': {
            const nodeId = message.data?.node;
            if (!nodeId) {
                emit({ statusText: '执行完成，读取结果…', progress: 100 });
                finishComfy();
                break;
            }
            emit({ status: 'running', node: nodeId, nodeProgress: nodeLabel(nodeId, job.details?.workflow), statusText: nodeLabel(nodeId, job.details?.workflow) });
            break;
        }
        case 'progress': {
            const value = Number(message.data?.value);
            const max = Number(message.data?.max);
            const percent = max > 0 ? clamp(Math.round((value / max) * 100), 0, 99) : 0;
            const nodeId = message.data?.node;
            emit({
                progress: percent,
                node: nodeId || job.node,
                nodeProgress: max > 0 ? `${value}/${max}` : '',
                statusText: `${nodeLabel(nodeId, job.details?.workflow)} ${max > 0 ? `${value}/${max}` : ''}`.trim(),
            });
            break;
        }
        case 'progress_state': {
            const nodes = message.data?.nodes || {};
            const running = Object.entries(nodes).find(([, node]) => node.state === 'running');
            if (running) {
                const [nodeId, info] = running;
                const max = Number(info.max);
                const value = Number(info.value);
                emit({
                    progress: max > 0 ? clamp(Math.round((value / max) * 100), 0, 99) : job.progress,
                    node: nodeId,
                    nodeProgress: max > 0 ? `${value}/${max}` : '',
                    statusText: `${nodeLabel(nodeId, job.details?.workflow)} ${max > 0 ? `${value}/${max}` : ''}`.trim(),
                });
            }
            break;
        }
        case 'execution_error':
            failComfy(new Error(message.data?.exception_message || 'ComfyUI 执行失败'));
            break;
        case 'execution_interrupted':
            emit({ status: 'cancelled', statusText: '已中断' });
            endJob(false);
            break;
        case 'execution_success':
            emit({ statusText: '执行成功，读取结果…', progress: 100 });
            finishComfy();
            break;
        default:
            break;
    }
}

function flushPendingMessages() {
    while (pendingMessages.length) {
        const message = pendingMessages.shift();
        handleSocketMessage(message);
    }
}

async function startPolling() {
    if (job.pollTimer) return;
    job.pollTimer = setInterval(async () => {
        if (!job.active || !job.promptId || job.finishing) return;
        try {
            const history = await job.comfy.history(job.promptId);
            if (history) {
                finishComfy(history);
                return;
            }
            const queue = await job.comfy.queue();
            const running = Array.isArray(queue?.queue_running) ? queue.queue_running : [];
            const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending : [];
            const pendingIndex = pending.findIndex(item => item?.[1] === job.promptId);
            if (pendingIndex >= 0) {
                emit({ queueRemaining: pending.length + running.length, statusText: `排队中，前面还有 ${pendingIndex} 个` });
            } else if (running.some(item => item?.[1] === job.promptId) && !job.comfy.isSocketOpen()) {
                emit({ status: 'running', statusText: '执行中（无实时进度）' });
            }
        } catch { /* ignore polling errors */ }
    }, 3000);
}

async function finishComfy(knownHistory = null) {
    if (job.finishing || !job.active) return;
    job.finishing = true;
    stopTimers();
    try {
        let history = knownHistory;
        for (let attempt = 0; attempt < 10 && !history; attempt += 1) {
            history = await job.comfy.history(job.promptId).catch(() => null);
            if (!history) await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!history) throw new Error('ComfyUI 执行结束，但没有找到历史结果');
        if (history.status?.status_str === 'error') {
            const errors = (history.status?.messages || [])
                .filter(item => item?.[0] === 'execution_error')
                .map(item => item?.[1])
                .map(item => `${item?.node_type || ''} [${item?.node_id || ''}] ${item?.exception_message || ''}`)
                .join('\n');
            throw new Error(errors || 'ComfyUI 执行失败');
        }
        let images = job.comfy.extractImages(history);
        for (let attempt = 0; attempt < 6 && images.length === 0; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 400));
            const refreshed = await job.comfy.history(job.promptId).catch(() => null);
            if (refreshed) images = job.comfy.extractImages(refreshed);
        }
        if (!images.length) throw new Error('ComfyUI 没有返回图片');
        emit({ statusText: `下载 ${images.length} 张图片…`, progress: 100 });
        const settings = get();
        const results = [];
        for (const info of images) {
            const blob = await job.comfy.imageBlob(info);
            const result = {
                blob,
                mime: blob.type || 'image/png',
                filename: info.filename || `image-studio-${Date.now()}.png`,
                info,
            };
            if (settings.ui.autoSave) {
                try {
                    const saved = await saveBlobToST(blob, { filename: `comfy-${job.details.seed}-${Date.now()}` });
                    result.path = saved.path;
                    result.filename = saved.filename;
                } catch (error) {
                    console.warn('[画坊] 自动保存失败', error);
                    toast('warning', '图片已生成，但保存到酒馆图库失败');
                }
            }
            results.push(result);
            addHistory(buildHistoryEntry(result, 'comfy'));
        }
        job.active = false;
        job.finishing = false;
        emit({ results, status: 'done', statusText: `完成 · ${images.length} 张`, progress: 100 });
        job.callbacks.onResult?.(results);
        job.callbacks.onDone?.({ results });
    } catch (error) {
        failComfy(error);
    } finally {
        job.finishing = false;
        job.active = false;
    }
}

function failComfy(error) {
    console.error('[画坊] ComfyUI 生成失败', error);
    stopTimers();
    emit({ status: 'error', statusText: '生成失败', error: String(error?.message || error) });
    job.callbacks.onError?.(error);
    job.active = false;
}

function buildHistoryEntry(result, provider) {
    const details = job.details || {};
    return {
        id: uid('gen'),
        path: result.path || '',
        filename: result.filename || '',
        provider,
        profileName: details.profileName || '',
        model: details.model || details.checkpoint || '',
        positive: details.positive || '',
        negative: details.negative || '',
        seed: details.seed,
        width: details.width,
        height: details.height,
        createdAt: Date.now(),
        promptId: job.promptId,
    };
}

function endJob(keepResults = true) {
    stopTimers();
    job.active = false;
    if (!keepResults) job.results = [];
    emit({});
}

export async function generateComfy(callbacks, { positive = '', negative = '' } = {}) {
    if (job.active) throw new Error('已有生成任务进行中');
    const settings = get();
    const comfy = new ComfyService();
    positive = String(positive ?? '');
    negative = String(negative ?? '');
    const seed = resolveSeed(settings.comfy.seed);
    const details = {
        provider: 'comfy',
        positive,
        negative,
        seed,
        width: Number(settings.comfy.width),
        height: Number(settings.comfy.height),
        checkpoint: settings.comfy.checkpoint,
        profileName: 'ComfyUI',
        model: settings.comfy.checkpoint,
        workflow: null,
    };
    resetJob('comfy', callbacks, details);
    job.comfy = comfy;

    try {
        emit({ statusText: '连接 ComfyUI…' });
        const test = await comfy.test();
        job.callbacks.onStats?.(ComfyService.parseSystemStats(test.stats));
        emit({ statusText: '读取模型列表…' });
        const models = await comfy.loadModels(false);
        job.models = models;

        const checkpoint = settings.comfy.checkpoint && models.checkpoints.includes(settings.comfy.checkpoint)
            ? settings.comfy.checkpoint
            : models.checkpoints[0];
        if (!checkpoint) throw new Error('ComfyUI 没有可用 checkpoint');
        if (settings.comfy.checkpoint !== checkpoint) {
            settings.comfy.checkpoint = checkpoint;
            saveSoon();
        }
        const sampler = settings.comfy.sampler && models.samplers.includes(settings.comfy.sampler)
            ? settings.comfy.sampler
            : (models.samplers[0] || 'euler');
        const scheduler = settings.comfy.scheduler && models.schedulers.includes(settings.comfy.scheduler)
            ? settings.comfy.scheduler
            : (models.schedulers[0] || 'normal');

        const params = {
            checkpoint,
            positive,
            negative,
            width: Number(settings.comfy.width),
            height: Number(settings.comfy.height),
            batch: Number(settings.comfy.batch || 1),
            seed,
            steps: Number(settings.comfy.steps || 28),
            cfg: Number(settings.comfy.cfg || 7),
            sampler,
            scheduler,
            vae: settings.comfy.vae || '',
            loras: (settings.comfy.loras || []).filter(item => item?.name),
            hires: settings.comfy.hires,
            scale: settings.comfy.hires?.scale,
            hiresSteps: settings.comfy.hires?.steps,
        };

        let workflow;
        if (settings.comfy.workflowMode === 'custom') {
            if (!String(settings.comfy.customWorkflow || '').trim()) throw new Error('自定义工作流为空');
            const built = buildCustomWorkflow(settings.comfy.customWorkflow, params, settings.comfy.autoBind !== false);
            workflow = built.workflow;
            details.workflowNotes = built.notes;
            details.workflowMode = built.mode;
        } else {
            workflow = buildSimpleWorkflow(params);
            details.workflowMode = 'simple';
        }
        details.workflow = workflow;
        details.checkpoint = checkpoint;
        details.model = checkpoint;
        details.summary = summarizeWorkflow(workflow);
        emit({ statusText: '连接进度通道…', details });

        await new Promise(resolve => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            comfy.ensureSocket({
                onOpen: done,
                onMessage: handleSocketMessage,
                onPreview: setPreview,
                onError: () => done(),
                onClose: () => {
                    if (job.active) emit({ statusText: '进度连接已断开，改用轮询' });
                },
            }).catch(() => done());
            setTimeout(done, 2000);
        });

        emit({ statusText: '提交工作流…' });
        const submitted = await comfy.submit(workflow);
        job.promptId = submitted.prompt_id;
        emit({ promptId: submitted.prompt_id, status: 'queued', statusText: '已提交，等待执行' });
        flushPendingMessages();
        startPolling();
        job.timeoutTimer = setTimeout(() => {
            if (job.active) {
                comfy.interrupt(job.promptId).catch(() => {});
                failComfy(new Error('生成超时（20 分钟）'));
            }
        }, 20 * 60_000);
    } catch (error) {
        failComfy(error);
    }
}

export async function generateCloud(callbacks, { positive = '', negative = '' } = {}) {
    if (job.active) throw new Error('已有生成任务进行中');
    const settings = get();
    const profile = getActiveImageProfile() || settings.imageProfiles[0];
    if (!profile) throw new Error('还没有配置生图 API，请到 API 页添加');
    positive = String(positive ?? '');
    negative = String(negative ?? '');
    const seed = resolveSeed(settings.cloud.seed);
    const model = String(settings.cloud.model || profile.model || '');
    const width = Number(settings.cloud.width || settings.comfy.width || 1024);
    const height = Number(settings.cloud.height || settings.comfy.height || 1024);
    const details = {
        provider: 'cloud',
        profileName: profile.name,
        model,
        positive,
        negative,
        seed,
        width,
        height,
        count: Number(settings.cloud.count || 1),
    };
    resetJob('cloud', callbacks, details);
    const controller = new AbortController();
    job.cloudAbort = controller;

    try {
        emit({ status: 'running', statusText: `请求 ${profile.name}…` });
        let generationExtra = {};
        try {
            generationExtra = parseExtraBody(settings.cloud.extraBody);
        } catch { /* ignore */ }
        let profileExtra = {};
        try {
            profileExtra = parseExtraBody(profile.extraBody);
        } catch { /* ignore */ }
        const profileCopy = {
            ...profile,
            model,
            extraBody: JSON.stringify({ ...profileExtra, ...generationExtra }),
        };
        const results = await generateCloudImages(profileCopy, {
            positive,
            negative,
            model,
            width,
            height,
            count: Number(settings.cloud.count || 1),
            seed,
            aspectRatio: settings.cloud.heightRatio,
            signal: controller.signal,
        });
        emit({ statusText: `下载 ${results.length} 张图片…` });
        const savedResults = [];
        for (const result of results) {
            const savedResult = { ...result };
            if (settings.ui.autoSave) {
                try {
                    const saved = await saveBlobToST(result.blob, { filename: `cloud-${seed}-${Date.now()}` });
                    savedResult.path = saved.path;
                    savedResult.filename = saved.filename;
                } catch (error) {
                    console.warn('[画坊] 自动保存失败', error);
                    toast('warning', '图片已返回，但保存到酒馆图库失败');
                }
            }
            savedResults.push(savedResult);
            addHistory(buildHistoryEntry(savedResult, 'cloud'));
        }
        emit({ results: savedResults, status: 'done', statusText: `完成 · ${savedResults.length} 张`, progress: 100 });
        job.callbacks.onResult?.(savedResults);
        job.callbacks.onDone?.({ results: savedResults });
        endJob(true);
    } catch (error) {
        if (controller.signal.aborted) {
            emit({ status: 'cancelled', statusText: '已取消' });
            endJob(false);
            return;
        }
        console.error('[画坊] 云端生图失败', error);
        emit({ status: 'error', statusText: '生成失败', error: String(error?.message || error) });
        job.callbacks.onError?.(error);
        endJob(false);
    }
}

export async function cancelJob() {
    if (!job.active) return;
    job.cancelled = true;
    emit({ statusText: '正在停止…' });
    if (job.provider === 'comfy' && job.comfy) {
        try {
            if (job.promptId) await job.comfy.deleteQueue([job.promptId]);
            await job.comfy.interrupt(job.promptId);
        } catch (error) {
            console.warn('[画坊] 停止 ComfyUI 失败', error);
        }
        stopTimers();
        emit({ status: 'cancelled', statusText: '已停止', active: false });
        job.active = false;
    } else if (job.cloudAbort) {
        job.cloudAbort.abort();
    }
}

export function jobElapsedText() {
    if (!job.startedAt) return '';
    const seconds = Math.max(0, Math.round(elapsed() / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function describeRequest() {
    const details = job.details;
    if (!details) return null;
    return {
        ...details,
        workflowJson: details.workflow ? JSON.stringify(details.workflow, null, 2) : '',
        promptExcerpt: truncate(details.positive, 300),
    };
}

export function resultImageUrl(result) {
    if (result?.path) return imageUrl(result.path);
    if (result?.blob) return URL.createObjectURL(result.blob);
    return '';
}

export function hasJobDetails() {
    return !!job.details;
}

export function parseWorkflowPreview(text) {
    return parseJsonLoose(text);
}
