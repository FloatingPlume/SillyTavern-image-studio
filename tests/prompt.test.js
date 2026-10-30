import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRewriteMessages, parseRewriteResult } from '../src/prompt.js';
import { initStore } from '../src/store.js';

test('buildRewriteMessages puts the target message and visual-continuity rules into the request', () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: {},
            eventTypes: {},
            eventSource: { on() {}, once() {}, emit() {} },
            chat: [{ is_user: false, name: 'A', mes: 'A stands under the rain.' }],
            characters: [{ name: 'A' }],
            characterId: 0,
            name1: 'User',
            name2: 'A',
            getCharacterCardFields: () => ({ description: 'a wolf', personality: 'calm', scenario: 'rooftop' }),
            powerUserSettings: { persona_description: 'traveler' },
            substituteParams: value => value,
        }),
    };
    initStore();
    const messages = buildRewriteMessages({ targetMessage: 'A turns around under the rain.', systemOverride: 'custom system' });
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /custom system/);
    assert.match(messages[0].content, /target moment/i);
    assert.match(messages[1].content, /A turns around under the rain/);
});

test('parseRewriteResult reads the expected JSON shape and character selection', () => {
    const result = parseRewriteResult('{"positive":"a, b","negative":"lowres","characters":["Aria"]}', 'fallback');
    assert.deepEqual(result, { positive: 'a, b', negative: 'lowres', characters: ['Aria'] });
});

test('parseRewriteResult handles fenced JSON', () => {
    const result = parseRewriteResult('```json\n{"positive":"tag1, tag2","negative":"bad"}\n```', 'fallback');
    assert.equal(result.positive, 'tag1, tag2');
    assert.equal(result.negative, 'bad');
});

test('parseRewriteResult falls back to plain text and keeps the negative prompt', () => {
    const result = parseRewriteResult('masterpiece, anthro wolf, rain', 'lowres, bad anatomy');
    assert.equal(result.positive, 'masterpiece, anthro wolf, rain');
    assert.equal(result.negative, 'lowres, bad anatomy');
});

test('parseRewriteResult strips a leading quote wrapper', () => {
    const result = parseRewriteResult('"a, b, c"', '');
    assert.equal(result.positive, 'a, b, c');
});
