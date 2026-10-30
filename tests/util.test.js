import test from 'node:test';
import assert from 'node:assert/strict';

import {
    deepMerge,
    escapeHtml,
    getByPath,
    mimeToFormat,
    parseJsonLoose,
} from '../src/util.js';

test('deepMerge: persisted values override defaults, arrays replace wholesale', () => {
    const defaults = {
        comfy: { url: '', checkpoint: '', n: 1 },
        history: [{ old: true }],
        profiles: [],
    };
    const persisted = {
        comfy: { url: 'http://192.168.1.10:8188', checkpoint: 'nova.safetensors' },
        history: [],
        profiles: [{ id: 'p1' }],
    };
    const merged = deepMerge(defaults, persisted);
    assert.equal(merged.comfy.url, 'http://192.168.1.10:8188');
    assert.equal(merged.comfy.checkpoint, 'nova.safetensors');
    assert.equal(merged.comfy.n, 1);
    assert.deepEqual(merged.history, []);
    assert.deepEqual(merged.profiles, [{ id: 'p1' }]);
});

test('deepMerge: source arrays are cloned', () => {
    const source = { list: [{ a: 1 }] };
    const merged = deepMerge({}, source);
    assert.notEqual(merged.list, source.list);
    merged.list[0].a = 2;
    assert.equal(source.list[0].a, 1);
});

test('escapeHtml covers the five HTML-sensitive characters', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('parseJsonLoose handles plain, fenced and embedded JSON', () => {
    assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
    assert.deepEqual(parseJsonLoose('```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(parseJsonLoose('prefix {"a":3} suffix'), { a: 3 });
    assert.equal(parseJsonLoose('not json'), null);
});

test('getByPath supports dot and bracket paths', () => {
    const payload = { data: [{ total_balance: '12.5' }], plan: { title: 'Pro' } };
    assert.equal(getByPath(payload, 'data.0.total_balance'), '12.5');
    assert.equal(getByPath(payload, 'data[0].total_balance'), '12.5');
    assert.equal(getByPath(payload, 'plan.title'), 'Pro');
    assert.equal(getByPath(payload, 'missing.path'), undefined);
});

test('mimeToFormat maps image mime types to ComfyUI/ST formats', () => {
    assert.equal(mimeToFormat('image/jpeg'), 'jpg');
    assert.equal(mimeToFormat('image/webp'), 'webp');
    assert.equal(mimeToFormat('image/png'), 'png');
});
