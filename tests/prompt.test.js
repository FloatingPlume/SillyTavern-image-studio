import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRewriteMessages, parseRewriteResult } from '../src/prompt.js';
import { get, initStore } from '../src/store.js';

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
    assert.match(messages[1].content, /OUTPUT CONTRACT/);
});

test('parseRewriteResult reads the expected JSON shape and character selection', () => {
    const result = parseRewriteResult('{"positive":"a, b","negative":"lowres","characters":["Aria"]}', 'fallback');
    assert.deepEqual(result, { positive: 'a, b', negative: 'lowres', characters: ['Aria'] });
});

test('buildRewriteMessages only sends the configured number of preceding messages', () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: {},
            eventTypes: {},
            eventSource: { on() {}, once() {}, emit() {} },
            chat: [
                { is_user: true, name: 'User', mes: 'first line' },
                { is_user: false, name: 'A', mes: 'second line' },
                { is_user: true, name: 'User', mes: 'third line' },
                { is_user: false, name: 'A', mes: 'fourth line' },
                { is_user: false, name: 'A', mes: 'target line' },
            ],
            characters: [{ name: 'A' }],
            characterId: 0,
            name1: 'User',
            name2: 'A',
            getCharacterCardFields: () => ({ description: 'a wolf' }),
            substituteParams: value => value,
        }),
    };
    initStore();
    get().pluginModel.contextMessages = 2;
    const messages = buildRewriteMessages({ targetMessage: 'target line', targetIndex: 4 });
    assert.match(messages[1].content, /third line/);
    assert.match(messages[1].content, /fourth line/);
    assert.doesNotMatch(messages[1].content, /first line/);
    assert.doesNotMatch(messages[1].content, /second line/);
    assert.equal(messages[1].content.match(/target line/g).length, 1);
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
