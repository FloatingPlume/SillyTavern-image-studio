import test from 'node:test';
import assert from 'node:assert/strict';

import {
    balanceDetails,
    detectBalancePreset,
    formatBalance,
} from '../src/balance.js';

test('detectBalancePreset recognizes known providers and falls back to OpenAI billing', () => {
    assert.equal(detectBalancePreset({ baseUrl: 'https://openrouter.ai/api/v1' }), 'openrouter');
    assert.equal(detectBalancePreset({ baseUrl: 'https://api.deepseek.com/v1' }), 'deepseek');
    assert.equal(detectBalancePreset({ baseUrl: 'https://api.siliconflow.cn/v1' }), 'siliconflow');
    assert.equal(detectBalancePreset({ baseUrl: 'https://api.moonshot.cn/v1' }), 'moonshot');
    assert.equal(detectBalancePreset({ baseUrl: 'https://relay.example.com/v1' }), 'openai-billing');
});

test('formatBalance and balanceDetails format common result shapes', () => {
    assert.equal(formatBalance({ ok: true, remaining: 16.5, unit: '$' }), '$16.5');
    assert.equal(formatBalance({ ok: true, used: 3.5, unit: '$' }), '已用 $3.5');
    assert.equal(formatBalance({ ok: false, message: '不支持' }), '不支持');
    const details = balanceDetails({ ok: true, remaining: 16.5, used: 3.5, total: 20, unit: '$', plan: 'Pro' });
    assert.match(details, /剩余/);
    assert.match(details, /已用/);
    assert.match(details, /Pro/);
});
