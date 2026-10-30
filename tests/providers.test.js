import test from 'node:test';
import assert from 'node:assert/strict';

import {
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

test('parseExtraBody and parseHeaders validate JSON objects', () => {
    assert.deepEqual(parseExtraBody('{"quality":"high"}'), { quality: 'high' });
    assert.deepEqual(parseExtraBody(''), {});
    assert.throws(() => parseExtraBody('[]'), /对象/);
    assert.throws(() => parseExtraBody('nope'), /对象/);

    assert.deepEqual(parseHeaders('{"X-Test":123}'), { 'X-Test': '123' });
    assert.throws(() => parseHeaders('[1,2]'), /对象/);
});
