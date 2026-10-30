import test from 'node:test';
import assert from 'node:assert/strict';

import { ComfyService } from '../src/comfy.js';

test('parseSystemStats normalizes the /system_stats payload', () => {
    const stats = ComfyService.parseSystemStats({
        system: {
            os: 'win32',
            comfyui_version: '0.43.2',
            python_version: '3.13.11',
            pytorch_version: '2.9.1',
            ram_total: 16 * 1024 ** 3,
            ram_free: 4 * 1024 ** 3,
        },
        devices: [{
            name: 'cuda:0 Test GPU',
            type: 'cuda',
            vram_total: 6 * 1024 ** 3,
            vram_free: 5 * 1024 ** 3,
        }],
    });
    assert.equal(stats.comfyVersion, '0.43.2');
    assert.equal(stats.deviceName, 'cuda:0 Test GPU');
    assert.equal(stats.vramTotal, 6 * 1024 ** 3);
    assert.equal(stats.ramTotal, 16 * 1024 ** 3);
});

test('progressPercent clamps values and tolerates missing maxima', () => {
    assert.equal(ComfyService.progressPercent(5, 10), 50);
    assert.equal(ComfyService.progressPercent(20, 10), 100);
    assert.equal(ComfyService.progressPercent(1, 0), 0);
    assert.equal(ComfyService.progressPercent(-1, 10), 0);
});
