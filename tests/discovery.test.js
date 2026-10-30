import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCandidates,
    normalizeScanPrefix,
    portFromUrl,
    prefixFromUrl,
} from '../src/discovery.js';

test('normalizeScanPrefix accepts a full IP or a three-octet prefix', () => {
    assert.equal(normalizeScanPrefix('192.168.1'), '192.168.1');
    assert.equal(normalizeScanPrefix('192.168.1.55'), '192.168.1');
    assert.equal(normalizeScanPrefix('http://192.168.1.55:8188/'), '192.168.1');
    assert.throws(() => normalizeScanPrefix('192.168.1.999'), /0-255/);
    assert.throws(() => normalizeScanPrefix('not-an-ip'), /网段前缀/);
});

test('prefixFromUrl and portFromUrl read ComfyUI URLs', () => {
    assert.equal(prefixFromUrl('http://192.168.3.5:8188'), '192.168.3');
    assert.equal(prefixFromUrl('http://localhost:8188'), null);
    assert.equal(prefixFromUrl('not a url'), null);
    assert.equal(portFromUrl('http://192.168.3.5:8188'), 8188);
    assert.equal(portFromUrl('http://192.168.3.5'), 8188);
});

test('buildCandidates prioritizes known hosts and respects range bounds', () => {
    const candidates = buildCandidates('192.168.3', {
        start: 1,
        end: 5,
        port: 8188,
        priority: ['http://192.168.3.5:8188', 'http://192.168.3.99:8188'],
    });
    assert.deepEqual(candidates.map(item => item.host), ['192.168.3.5', '192.168.3.99', '192.168.3.1', '192.168.3.2', '192.168.3.3', '192.168.3.4']);
    assert.equal(candidates[0].url, 'http://192.168.3.5:8188');
});
