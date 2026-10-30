import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultChatProfile, rewriteWithCurrentPreset } from '../src/chat.js';

test('defaultChatProfile fills OpenAI-compatible defaults', () => {
    const profile = defaultChatProfile('openai-compatible');
    assert.equal(profile.kind, 'chat');
    assert.equal(profile.type, 'openai-compatible');
    assert.equal(profile.model, 'gpt-4o-mini');
});

test('rewriteWithCurrentPreset forwards a quiet prompt and length to SillyTavern', async () => {
    const calls = [];
    globalThis.SillyTavern = {
        getContext: () => ({
            generateQuietPrompt: async options => {
                calls.push(options);
                return '{"positive":"a, b","negative":"lowres"}';
            },
        }),
    };
    const result = await rewriteWithCurrentPreset('instruction', 800);
    assert.equal(result, '{"positive":"a, b","negative":"lowres"}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].quietPrompt, 'instruction');
    assert.equal(calls[0].responseLength, 800);
    assert.equal(calls[0].quietToLoud, false);
});
