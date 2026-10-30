import test from 'node:test';
import assert from 'node:assert/strict';

import {
    canAutoFetchModels,
    categorizeModels,
    categoryCounts,
    classifyModel,
    filterModels,
    normalizeModels,
} from '../src/model-catalog.js';

test('classifyModel separates language, image, video, audio and embedding models', () => {
    assert.equal(classifyModel('gpt-4o-mini'), 'language');
    assert.equal(classifyModel('claude-sonnet-4-5'), 'language');
    assert.equal(classifyModel('gemini-2.5-flash'), 'language');
    assert.equal(classifyModel('gpt-image-1'), 'image');
    assert.equal(classifyModel('dall-e-3'), 'image');
    assert.equal(classifyModel('gemini-2.5-flash-image'), 'image');
    assert.equal(classifyModel('imagen-4.0-generate-001'), 'image');
    assert.equal(classifyModel('Kwai-Kolors/Kolors'), 'image');
    assert.equal(classifyModel('veo-3.1-generate-preview'), 'video');
    assert.equal(classifyModel('sora-2'), 'video');
    assert.equal(classifyModel('doubao-seedance-1-0-pro'), 'video');
    assert.equal(classifyModel('tts-1'), 'audio');
    assert.equal(classifyModel('whisper-1'), 'audio');
    assert.equal(classifyModel('gpt-4o-audio-preview'), 'audio');
    assert.equal(classifyModel('text-embedding-3-small'), 'embedding');
    assert.equal(classifyModel('BAAI/bge-m3'), 'embedding');
});

test('canAutoFetchModels only opts in for keyed or local endpoints', () => {
    assert.equal(canAutoFetchModels({ type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x' }), true);
    assert.equal(canAutoFetchModels({ type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' }), false);
    assert.equal(canAutoFetchModels({ type: 'openai-compatible', baseUrl: 'http://192.168.1.10:8000/v1', apiKey: '' }), true);
    assert.equal(canAutoFetchModels({ type: 'custom', baseUrl: 'http://x', apiKey: 'sk' }), false);
});

test('normalizeModels deduplicates, trims and sorts', () => {
    assert.deepEqual(normalizeModels([' z ', 'a', { id: 'a' }, '', null]), ['a', 'z']);
});

test('filterModels filters by category and search text', () => {
    const models = ['gpt-4o', 'gpt-image-1', 'sora-2', 'tts-1', 'flux-schnell'];
    assert.deepEqual(Object.fromEntries(categorizeModels(models).map(item => [item.id, item.category])), {
        'gpt-4o': 'language',
        'gpt-image-1': 'image',
        'sora-2': 'video',
        'tts-1': 'audio',
        'flux-schnell': 'image',
    });
    assert.equal(filterModels(models, { category: 'image' }).length, 2);
    assert.deepEqual(filterModels(models, { query: 'GPT' }).map(item => item.id), ['gpt-4o', 'gpt-image-1']);
    assert.deepEqual(categoryCounts(models), {
        language: 1, image: 2, video: 1, audio: 1, embedding: 0, other: 0,
    });
});
