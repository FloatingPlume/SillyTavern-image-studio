import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCustomWorkflow,
    buildImg2imgWorkflow,
    buildSimpleWorkflow,
    parseWorkflow,
    summarizeWorkflow,
    workflowHasPlaceholders,
} from '../src/workflow.js';

const baseParams = {
    checkpoint: 'nova.safetensors',
    positive: 'positive prompt',
    negative: 'negative prompt',
    width: 1024,
    height: 1024,
    batch: 1,
    seed: 123456,
    steps: 28,
    cfg: 7,
    sampler: 'euler',
    scheduler: 'normal',
    vae: '',
    loras: [],
    hires: { enabled: false, scale: 1.5, steps: 14, denoise: 0.45 },
};

test('simple workflow wires checkpoint, prompts, sampler, decode and save', () => {
    const workflow = buildSimpleWorkflow(baseParams);
    assert.equal(workflow['1'].class_type, 'CheckpointLoaderSimple');
    assert.equal(workflow['1'].inputs.ckpt_name, 'nova.safetensors');
    assert.equal(workflow['2'].inputs.text, 'positive prompt');
    assert.equal(workflow['3'].inputs.text, 'negative prompt');
    assert.equal(workflow['5'].inputs.seed, 123456);
    assert.equal(workflow['5'].inputs.steps, 28);
    assert.deepEqual(workflow['5'].inputs.positive, ['2', 0]);
    assert.equal(Object.values(workflow).find(node => node.class_type === 'VAEDecode').class_type, 'VAEDecode');
    assert.equal(Object.values(workflow).find(node => node.class_type === 'SaveImage').class_type, 'SaveImage');
    assert.equal(summarizeWorkflow(workflow).nodeCount, 7);
});

test('simple workflow supports LoRA chain, separate VAE and hires pass', () => {
    const workflow = buildSimpleWorkflow({
        ...baseParams,
        vae: 'sdxl_vae.safetensors',
        loras: [{ name: 'detail.safetensors', strengthModel: 0.7, strengthClip: 0.6 }],
        hires: { enabled: true, scale: 1.5, steps: 8, denoise: 0.4 },
    });
    assert.equal(workflow['10'].class_type, 'LoraLoader');
    assert.deepEqual(workflow['2'].inputs.clip, ['10', 1]);
    assert.deepEqual(workflow['5'].inputs.model, ['10', 0]);
    assert.equal(workflow['100'].class_type, 'VAELoader');
    assert.equal(workflow['9'].class_type, 'KSampler');
    assert.equal(workflow['9'].inputs.denoise, 0.4);
    assert.deepEqual(workflow['11'].inputs.samples, ['9', 0]);
    assert.deepEqual(workflow['11'].inputs.vae, ['100', 0]);
});

test('img2img workflow scales the reference, repeats batches and encodes latents', () => {
    const workflow = buildImg2imgWorkflow({
        ...baseParams,
        batch: 2,
        referenceImage: 'reference.png',
        denoise: 0.48,
    });
    assert.equal(workflow['4'].class_type, 'LoadImage');
    assert.equal(workflow['4'].inputs.image, 'reference.png');
    assert.equal(workflow['5'].class_type, 'ImageScale');
    assert.equal(workflow['7'].class_type, 'RepeatImageBatch');
    assert.equal(workflow['7'].inputs.amount, 2);
    assert.equal(workflow['8'].class_type, 'VAEEncode');
    assert.deepEqual(workflow['8'].inputs.pixels, ['7', 0]);
    assert.deepEqual(workflow['6'].inputs.latent_image, ['8', 0]);
    assert.equal(workflow['6'].inputs.denoise, 0.48);
});

test('custom workflow accepts %reference% and auto-binds LoadImage.image', () => {
    const placeholder = {
        1: { class_type: 'LoadImage', inputs: { image: '%reference%' } },
        2: { class_type: 'KSampler', inputs: { seed: 1 } },
    };
    const built = buildCustomWorkflow(JSON.stringify(placeholder), {
        ...baseParams,
        referenceImage: 'uploaded.png',
    });
    assert.equal(built.workflow['1'].inputs.image, 'uploaded.png');

    const auto = {
        1: { class_type: 'LoadImage', inputs: { image: 'old.png' } },
        2: { class_type: 'KSampler', inputs: { seed: 1 } },
    };
    const bound = buildCustomWorkflow(JSON.stringify(auto), {
        ...baseParams,
        referenceImage: 'uploaded.png',
    }, true);
    assert.equal(bound.workflow['1'].inputs.image, 'uploaded.png');
    assert.ok(bound.notes.some(note => note.includes('参考图')));
});

test('parseWorkflow rejects UI-format exports and accepts wrapped API prompts', () => {
    assert.throws(() => parseWorkflow(JSON.stringify({ nodes: [], links: [] })), /界面格式/);
    const wrapped = { prompt: { 1: { class_type: 'KSampler', inputs: {} } } };
    assert.equal(parseWorkflow(JSON.stringify(wrapped))['1'].class_type, 'KSampler');
});

test('placeholder workflow replaces typed exact tokens and embedded tokens', () => {
    const workflow = {
        1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '%checkpoint%' } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: 'prefix %positive% suffix' } },
        4: { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: '%batch%' } },
        5: { class_type: 'KSampler', inputs: { seed: '%seed%', steps: '%steps%', cfg: '%cfg%' } },
    };
    assert.equal(workflowHasPlaceholders(workflow), true);
    const built = buildCustomWorkflow(JSON.stringify(workflow), {
        ...baseParams,
        width: 832,
        height: 1216,
        seed: 99,
    });
    assert.equal(built.mode, 'placeholders');
    assert.equal(built.workflow['1'].inputs.ckpt_name, 'nova.safetensors');
    assert.equal(built.workflow['2'].inputs.text, 'prefix positive prompt suffix');
    assert.equal(built.workflow['4'].inputs.width, 832);
    assert.equal(built.workflow['5'].inputs.seed, 99);
    assert.equal(built.workflow['5'].inputs.steps, 28);
});

test('auto-bind maps prompts and generation parameters when no placeholders exist', () => {
    const workflow = {
        1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'old.safetensors' } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: 'old positive', clip: ['1', 1] } },
        3: { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['1', 1] } },
        4: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
        5: {
            class_type: 'KSampler',
            inputs: {
                seed: 1,
                steps: 20,
                cfg: 8,
                sampler_name: 'euler',
                scheduler: 'normal',
                denoise: 1,
                positive: ['2', 0],
                negative: ['3', 0],
                latent_image: ['4', 0],
            },
        },
        6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0] } },
        7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'old' } },
    };
    const built = buildCustomWorkflow(JSON.stringify(workflow), {
        ...baseParams,
        positive: 'new positive',
        negative: 'new negative',
        checkpoint: 'new.safetensors',
        width: 768,
        height: 1344,
        seed: 42,
        steps: 12,
        cfg: 5,
    }, true);
    assert.equal(built.mode, 'auto');
    assert.equal(built.workflow['1'].inputs.ckpt_name, 'new.safetensors');
    assert.equal(built.workflow['2'].inputs.text, 'new positive');
    assert.equal(built.workflow['3'].inputs.text, 'new negative');
    assert.equal(built.workflow['4'].inputs.width, 768);
    assert.equal(built.workflow['4'].inputs.height, 1344);
    assert.equal(built.workflow['5'].inputs.seed, 42);
    assert.equal(built.workflow['5'].inputs.steps, 12);
    assert.equal(built.workflow['7'].inputs.filename_prefix, 'image-studio');
});
