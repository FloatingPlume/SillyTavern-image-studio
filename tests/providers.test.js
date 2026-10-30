import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildOpenAIImageBody,
    defaultImageProfile,
    parseExtraBody,
    parseHeaders,
    v1Base,
} from '../src/providers.js';

test('v1Base normalizes common OpenAI-compatible base URLs', () => {
    assert.equal(v1Base('https://api.openai.com'), 'https://api.openai.com/v1');
    assert.equal(v1Base('https://api.openai.com/v1'), 'https://api.openai.com/v1');
    assert.equal(v1Base('https://relay.example.com/v1/'), 'https://relay.example.com/v1');
    assert.equal(v1Base('https://relay.example.com/openai/v1'), 'https://relay.example.com/openai/v1');
});

test('defaultImageProfile fills type-specific defaults', () => {
    const openai = defaultImageProfile('openai');
    assert.equal(openai.type, 'openai');
    assert.equal(openai.baseUrl, 'https://api.openai.com/v1');
    assert.equal(openai.model, 'gpt-image-1');
    assert.equal(openai.kind, 'image');

    const custom = defaultImageProfile('custom');
    assert.equal(custom.type, 'custom');
    assert.equal(custom.balancePreset, 'auto');
    assert.ok(custom.custom);
});

test('xAI image body uses aspect_ratio/resolution and never sends size', () => {
    const profile = {
        type: 'xai', model: 'grok-imagine-image', extraBody: '{}', headers: '{}',
    };
    const body = buildOpenAIImageBody(profile, {
        positive: 'a wolf', width: 1536, height: 1024, count: 2, seed: 1, negative: 'bad',
    });
    assert.equal(body.size, undefined);
    assert.equal(body.aspect_ratio, '3:2');
    assert.equal(body.resolution, '2K');
    assert.equal(body.response_format, 'url');
    assert.equal(body.n, 2);
    assert.equal(body.negative_prompt, undefined);
    assert.equal(body.seed, undefined);
});

test('legacy xAI grok-2-image omits size and aspect controls', () => {
    const body = buildOpenAIImageBody({
        type: 'xai', model: 'grok-2-image', extraBody: '{}',
    }, { positive: 'a cat', width: 1024, height: 1024, count: 1 });
    assert.equal(body.size, undefined);
    assert.equal(body.aspect_ratio, undefined);
    assert.equal(body.resolution, undefined);
    assert.equal(body.response_format, 'url');
});

test('OpenAI-compatible body keeps OpenAI-style size and negative prompt', () => {
    const body = buildOpenAIImageBody({
        type: 'openai-compatible', model: 'flux-schnell', extraBody: '{}',
    }, { positive: 'a cat', negative: 'bad', width: 1024, height: 1536, count: 1, seed: 7 });
    assert.equal(body.size, '1024x1536');
    assert.equal(body.negative_prompt, 'bad');
    assert.equal(body.seed, 7);
    assert.equal(body.response_format, 'b64_json');
});

test('parseExtraBody and parseHeaders validate JSON objects', () => {
    assert.deepEqual(parseExtraBody('{"quality":"high"}'), { quality: 'high' });
    assert.deepEqual(parseExtraBody(''), {});
    assert.throws(() => parseExtraBody('[]'), /对象/);
    assert.throws(() => parseExtraBody('nope'), /对象/);

    assert.deepEqual(parseHeaders('{"X-Test":123}'), { 'X-Test': '123' });
    assert.throws(() => parseHeaders('[1,2]'), /对象/);
});
