import { clone } from './util.js';

export function buildSimpleWorkflow(params) {
    const {
        checkpoint,
        positive,
        negative,
        width,
        height,
        batch,
        seed,
        steps,
        cfg,
        sampler,
        scheduler,
        vae,
        loras = [],
        hires = null,
    } = params;

    if (!checkpoint) throw new Error('没有选择 checkpoint');

    const workflow = {
        1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: positive || '', clip: ['1', 1] } },
        3: { class_type: 'CLIPTextEncode', inputs: { text: negative || '', clip: ['1', 1] } },
        4: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: batch } },
        5: {
            class_type: 'KSampler',
            inputs: {
                seed,
                steps,
                cfg,
                sampler_name: sampler || 'euler',
                scheduler: scheduler || 'normal',
                denoise: 1,
                model: ['1', 0],
                positive: ['2', 0],
                negative: ['3', 0],
                latent_image: ['4', 0],
            },
        },
    };

    let modelRef = ['1', 0];
    let clipRef = ['1', 1];
    let lastNode = 10;

    for (const lora of loras.filter(item => item?.name)) {
        const id = String(lastNode++);
        workflow[id] = {
            class_type: 'LoraLoader',
            inputs: {
                model: modelRef,
                clip: clipRef,
                lora_name: lora.name,
                strength_model: Number(lora.strengthModel ?? 0.8),
                strength_clip: Number(lora.strengthClip ?? 0.8),
            },
        };
        modelRef = [id, 0];
        clipRef = [id, 1];
    }

    workflow[2].inputs.clip = clipRef;
    workflow[3].inputs.clip = clipRef;
    workflow[5].inputs.model = modelRef;

    let vaeRef = ['1', 2];
    if (vae) {
        workflow[100] = { class_type: 'VAELoader', inputs: { vae_name: vae } };
        vaeRef = ['100', 0];
    }

    let outputSamples = ['5', 0];
    if (hires?.enabled) {
        workflow[8] = {
            class_type: 'LatentUpscaleBy',
            inputs: {
                samples: ['5', 0],
                upscale_method: 'nearest-exact',
                scale_by: Number(hires.scale || 1.5),
            },
        };
        workflow[9] = {
            class_type: 'KSampler',
            inputs: {
                seed,
                steps: Number(hires.steps || 14),
                cfg,
                sampler_name: sampler || 'euler',
                scheduler: scheduler || 'normal',
                denoise: Number(hires.denoise ?? 0.45),
                model: modelRef,
                positive: ['2', 0],
                negative: ['3', 0],
                latent_image: ['8', 0],
            },
        };
        outputSamples = ['9', 0];
    }

    const decodeId = String(lastNode++);
    workflow[decodeId] = {
        class_type: 'VAEDecode',
        inputs: { samples: outputSamples, vae: vaeRef },
    };
    const saveId = String(lastNode++);
    workflow[saveId] = {
        class_type: 'SaveImage',
        inputs: { images: [decodeId, 0], filename_prefix: 'image-studio' },
    };

    return workflow;
}

export function buildImg2imgWorkflow(params) {
    const {
        checkpoint,
        positive,
        negative,
        width,
        height,
        batch,
        seed,
        steps,
        cfg,
        sampler,
        scheduler,
        vae,
        loras = [],
        hires = null,
        referenceImage,
        denoise = 0.55,
    } = params;
    if (!checkpoint) throw new Error('没有选择 checkpoint');
    if (!referenceImage) throw new Error('图生图模式缺少参考图');

    const workflow = {
        1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: positive || '', clip: ['1', 1] } },
        3: { class_type: 'CLIPTextEncode', inputs: { text: negative || '', clip: ['1', 1] } },
        4: { class_type: 'LoadImage', inputs: { image: referenceImage } },
        5: {
            class_type: 'ImageScale',
            inputs: {
                image: ['4', 0],
                upscale_method: 'lanczos',
                width,
                height,
                crop: 'center',
            },
        },
        6: {
            class_type: 'KSampler',
            inputs: {
                seed,
                steps,
                cfg,
                sampler_name: sampler || 'euler',
                scheduler: scheduler || 'normal',
                denoise: clampDenoise(denoise),
                model: ['1', 0],
                positive: ['2', 0],
                negative: ['3', 0],
                latent_image: null,
            },
        },
    };

    let scaledRef = ['5', 0];
    if (Number(batch) > 1) {
        workflow[7] = { class_type: 'RepeatImageBatch', inputs: { image: scaledRef, amount: Number(batch) } };
        scaledRef = ['7', 0];
    }

    let modelRef = ['1', 0];
    let clipRef = ['1', 1];
    let lastNode = 10;
    for (const lora of loras.filter(item => item?.name)) {
        const id = String(lastNode++);
        workflow[id] = {
            class_type: 'LoraLoader',
            inputs: {
                model: modelRef,
                clip: clipRef,
                lora_name: lora.name,
                strength_model: Number(lora.strengthModel ?? 0.8),
                strength_clip: Number(lora.strengthClip ?? 0.8),
            },
        };
        modelRef = [id, 0];
        clipRef = [id, 1];
    }
    workflow[2].inputs.clip = clipRef;
    workflow[3].inputs.clip = clipRef;
    workflow[6].inputs.model = modelRef;

    let vaeRef = ['1', 2];
    if (vae) {
        workflow[100] = { class_type: 'VAELoader', inputs: { vae_name: vae } };
        vaeRef = ['100', 0];
    }

    workflow[8] = {
        class_type: 'VAEEncode',
        inputs: { pixels: scaledRef, vae: vaeRef },
    };
    workflow[6].inputs.latent_image = ['8', 0];

    let outputSamples = ['6', 0];
    if (hires?.enabled) {
        workflow[20] = {
            class_type: 'LatentUpscaleBy',
            inputs: {
                samples: ['6', 0],
                upscale_method: 'nearest-exact',
                scale_by: Number(hires.scale || 1.5),
            },
        };
        workflow[21] = {
            class_type: 'KSampler',
            inputs: {
                seed,
                steps: Number(hires.steps || 14),
                cfg,
                sampler_name: sampler || 'euler',
                scheduler: scheduler || 'normal',
                denoise: Number(hires.denoise ?? 0.35),
                model: modelRef,
                positive: ['2', 0],
                negative: ['3', 0],
                latent_image: ['20', 0],
            },
        };
        outputSamples = ['21', 0];
    }

    workflow[50] = {
        class_type: 'VAEDecode',
        inputs: { samples: outputSamples, vae: vaeRef },
    };
    workflow[51] = {
        class_type: 'SaveImage',
        inputs: { images: ['50', 0], filename_prefix: 'image-studio' },
    };

    return workflow;
}

function clampDenoise(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0.55;
    return Math.min(1, Math.max(0.05, number));
}

export function parseWorkflow(text) {
    if (!text || !String(text).trim()) throw new Error('工作流为空');
    let parsed;
    try {
        parsed = JSON.parse(String(text));
    } catch (error) {
        throw new Error(`工作流不是有效 JSON：${error.message}`);
    }
    if (parsed?.prompt && typeof parsed.prompt === 'object' && !parsed.class_type) {
        parsed = parsed.prompt;
    }
    if (Array.isArray(parsed?.nodes) || Array.isArray(parsed?.links)) {
        throw new Error('这是 ComfyUI 的界面格式。请在 ComfyUI 菜单里使用「导出（API 格式）」后再导入。');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('工作流必须是 API 格式的节点对象');
    }
    const nodes = Object.entries(parsed).filter(([, node]) => node && typeof node === 'object' && node.class_type);
    if (nodes.length === 0) throw new Error('工作流里没有找到带 class_type 的节点');
    return parsed;
}

function isLink(value) {
    return Array.isArray(value) && value.length >= 2 && (typeof value[0] === 'string' || typeof value[0] === 'number');
}

function walkInputs(workflow, visitor) {
    for (const [nodeId, node] of Object.entries(workflow)) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        for (const [inputName, value] of Object.entries(node.inputs)) {
            visitor(nodeId, node, inputName, value);
        }
    }
}

const PLACEHOLDERS = {
    '%positive%': 'positive',
    '%negative%': 'negative',
    '%seed%': 'seed',
    '%steps%': 'steps',
    '%cfg%': 'cfg',
    '%width%': 'width',
    '%height%': 'height',
    '%batch%': 'batch',
    '%checkpoint%': 'checkpoint',
    '%model%': 'checkpoint',
    '%sampler%': 'sampler',
    '%scheduler%': 'scheduler',
    '%denoise%': 'denoise',
    '%scale%': 'scale',
    '%hires_steps%': 'hiresSteps',
    '%vae%': 'vae',
    '%reference%': 'referenceImage',
};

export function workflowHasPlaceholders(workflow) {
    let found = false;
    walkInputs(workflow, (_nodeId, _node, _inputName, value) => {
        if (found) return;
        if (typeof value === 'string' && Object.keys(PLACEHOLDERS).some(token => value.includes(token))) {
            found = true;
        }
    });
    return found;
}

export function replacePlaceholders(workflow, params) {
    const values = {
        positive: params.positive ?? '',
        negative: params.negative ?? '',
        seed: Number(params.seed ?? 0),
        steps: Number(params.steps ?? 28),
        cfg: Number(params.cfg ?? 7),
        width: Number(params.width ?? 1024),
        height: Number(params.height ?? 1024),
        batch: Number(params.batch ?? 1),
        checkpoint: params.checkpoint ?? '',
        sampler: params.sampler ?? 'euler',
        scheduler: params.scheduler ?? 'normal',
        denoise: Number(params.denoise ?? 1),
        scale: Number(params.scale ?? 1.5),
        hiresSteps: Number(params.hiresSteps ?? 14),
        vae: params.vae ?? '',
        referenceImage: params.referenceImage ?? '',
    };

    walkInputs(workflow, (_nodeId, _node, inputName, value) => {
        for (const [token, key] of Object.entries(PLACEHOLDERS)) {
            if (typeof value === 'string' && value.trim() === token) {
                _node.inputs[inputName] = values[key];
                return;
            }
        }
        if (typeof value === 'string') {
            let next = value;
            for (const [token, key] of Object.entries(PLACEHOLDERS)) {
                next = next.split(token).join(String(values[key] ?? ''));
            }
            if (next !== value) _node.inputs[inputName] = next;
        }
    });

    return workflow;
}

function findNodes(workflow, predicate) {
    return Object.entries(workflow).filter(([, node]) => node?.class_type && predicate(node, node.class_type));
}

function setInputIfPresent(node, name, value) {
    if (!node?.inputs || !(name in node.inputs)) return false;
    node.inputs[name] = value;
    return true;
}

export function autoBindWorkflow(workflow, params) {
    const notes = [];
    const samplers = findNodes(workflow, node =>
        node.inputs && ('seed' in node.inputs) && ('steps' in node.inputs) && ('sampler_name' in node.inputs));
    const clipNodes = findNodes(workflow, node => String(node.class_type).includes('CLIPTextEncode'));

    if (samplers.length > 0) {
        const [primaryId, primary] = samplers[0];
        setInputIfPresent(primary, 'seed', Number(params.seed));
        setInputIfPresent(primary, 'steps', Number(params.steps));
        setInputIfPresent(primary, 'cfg', Number(params.cfg));
        setInputIfPresent(primary, 'sampler_name', params.sampler || primary.inputs.sampler_name);
        setInputIfPresent(primary, 'scheduler', params.scheduler || primary.inputs.scheduler);
        if (params.denoise != null && Number(primary.inputs.denoise ?? 1) < 1) {
            setInputIfPresent(primary, 'denoise', Number(params.denoise));
        }
        for (const [, sampler] of samplers.slice(1)) {
            setInputIfPresent(sampler, 'seed', Number(params.seed));
        }

        const positiveLink = primary.inputs.positive;
        const negativeLink = primary.inputs.negative;
        if (isLink(positiveLink) && workflow[positiveLink[0]]?.inputs && 'text' in workflow[positiveLink[0]].inputs) {
            workflow[positiveLink[0]].inputs.text = params.positive;
            notes.push(`正面提示词 → 节点 ${positiveLink[0]}`);
        } else if (clipNodes[0]) {
            setInputIfPresent(clipNodes[0][1], 'text', params.positive);
            notes.push(`正面提示词 → 节点 ${clipNodes[0][0]}（推测）`);
        }
        if (isLink(negativeLink) && workflow[negativeLink[0]]?.inputs && 'text' in workflow[negativeLink[0]].inputs) {
            workflow[negativeLink[0]].inputs.text = params.negative;
            notes.push(`负面提示词 → 节点 ${negativeLink[0]}`);
        } else if (clipNodes[1]) {
            setInputIfPresent(clipNodes[1][1], 'text', params.negative);
            notes.push(`负面提示词 → 节点 ${clipNodes[1][0]}（推测）`);
        }
        notes.push(`采样器 → 节点 ${primaryId}${samplers.length > 1 ? ` 等 ${samplers.length} 个` : ''}`);
    } else {
        notes.push('没有识别到 KSampler，参数可能不会写入工作流');
    }

    const latents = findNodes(workflow, node =>
        node.inputs && ('width' in node.inputs) && ('height' in node.inputs) && ('batch_size' in node.inputs));
    for (const [, latent] of latents) {
        setInputIfPresent(latent, 'width', Number(params.width));
        setInputIfPresent(latent, 'height', Number(params.height));
        setInputIfPresent(latent, 'batch_size', Number(params.batch));
    }

    const checkpoints = findNodes(workflow, node =>
        String(node.class_type).includes('CheckpointLoader') && node.inputs && ('ckpt_name' in node.inputs));
    for (const [, loader] of checkpoints) {
        setInputIfPresent(loader, 'ckpt_name', params.checkpoint);
    }

    if (params.vae) {
        const vaeLoaders = findNodes(workflow, node =>
            String(node.class_type).includes('VAELoader') && node.inputs && ('vae_name' in node.inputs));
        for (const [, loader] of vaeLoaders) {
            setInputIfPresent(loader, 'vae_name', params.vae);
        }
    }

    const saveNodes = findNodes(workflow, node =>
        String(node.class_type).includes('SaveImage') && node.inputs && ('filename_prefix' in node.inputs));
    for (const [, saver] of saveNodes) {
        setInputIfPresent(saver, 'filename_prefix', 'image-studio');
    }

    if (params.referenceImage) {
        const imageLoaders = findNodes(workflow, node =>
            String(node.class_type).includes('LoadImage') && node.inputs && ('image' in node.inputs));
        if (imageLoaders.length > 0) {
            setInputIfPresent(imageLoaders[0][1], 'image', params.referenceImage);
            notes.push(`参考图 → 节点 ${imageLoaders[0][0]}`);
        }
    }

    return notes;
}

export function buildCustomWorkflow(text, params, autoBind = true) {
    let workflow = parseWorkflow(text);
    workflow = clone(workflow);
    let mode = 'none';
    let notes = [];
    if (workflowHasPlaceholders(workflow)) {
        workflow = replacePlaceholders(workflow, params);
        mode = 'placeholders';
        notes.push('已替换 %positive% 等占位符');
    } else if (autoBind) {
        notes = autoBindWorkflow(workflow, params);
        mode = 'auto';
    }
    return { workflow, mode, notes };
}

export function summarizeWorkflow(workflow) {
    const counts = {};
    for (const node of Object.values(workflow)) {
        if (node?.class_type) counts[node.class_type] = (counts[node.class_type] || 0) + 1;
    }
    return {
        nodeCount: Object.keys(workflow).length,
        classes: Object.entries(counts).map(([name, count]) => `${name} ×${count}`),
    };
}
