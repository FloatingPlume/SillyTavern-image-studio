import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRewriteResult } from '../src/prompt.js';

test('parseRewriteResult reads the expected JSON shape', () => {
    const result = parseRewriteResult('{"positive":"a, b","negative":"lowres"}', 'fallback');
    assert.deepEqual(result, { positive: 'a, b', negative: 'lowres' });
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
