import test from 'node:test';
import assert from 'node:assert/strict';

import { generateCloudImages } from '../src/providers.js';
import { initStore } from '../src/store.js';

const reference = () => ({
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
    filename: 'reference.png',
    name: 'Aria',
});

function initTestStore() {
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: { imageStudio: { useServerProxy: false } },
            eventTypes: {},
            eventSource: { on() {}, once() {}, emit() {} },
        }),
    };
    initStore();
}

test('Gemini sends the reference image as inlineData', async () => {
    initTestStore();
    const originalFetch = globalThis.fetch;
    let requestBody = null;
    globalThis.fetch = async (url, options) => {
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa('fake-image') } }] } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        const results = await generateCloudImages({
            type: 'gemini',
            baseUrl: 'https://gemini.example.com',
            apiKey: 'key',
            model: 'gemini-2.5-flash-image',
            headers: '{}',
            extraBody: '{}',
        }, {
            positive: 'portrait',
            model: 'gemini-2.5-flash-image',
            width: 1024,
            height: 1024,
            count: 1,
            reference: reference(),
        });
        assert.equal(results.length, 1);
        const parts = requestBody.contents[0].parts;
        assert.equal(parts[0].text, 'portrait');
        assert.equal(parts[1].inlineData.mimeType, 'image/png');
        assert.ok(parts[1].inlineData.data);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('OpenAI-compatible reference generation uses a multipart images/edits request', async () => {
    initTestStore();
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let form = null;
    let contentType = '';
    globalThis.fetch = async (url, options) => {
        requestUrl = String(url);
        form = options.body;
        contentType = options.headers['Content-Type'] || '';
        return new Response(JSON.stringify({ data: [{ b64_json: btoa('edited-image') }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    try {
        const results = await generateCloudImages({
            type: 'openai-compatible',
            baseUrl: 'https://relay.example.com/v1',
            apiKey: 'key',
            model: 'gpt-image-1',
            headers: '{}',
            extraBody: '{}',
        }, {
            positive: 'portrait',
            model: 'gpt-image-1',
            width: 1024,
            height: 1024,
            count: 1,
            reference: reference(),
        });
        assert.equal(results.length, 1);
        assert.match(requestUrl, /\/images\/edits$/);
        assert.ok(form instanceof FormData);
        assert.equal(form.get('model'), 'gpt-image-1');
        assert.equal(form.get('prompt'), 'portrait');
        assert.ok(form.get('image'));
        assert.equal(contentType, '');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('xAI refuses a reference image with a clear error', async () => {
    initTestStore();
    await assert.rejects(() => generateCloudImages({
        type: 'xai',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: 'key',
        model: 'grok-imagine-image',
        headers: '{}',
        extraBody: '{}',
    }, {
        positive: 'portrait',
        model: 'grok-imagine-image',
        width: 1024,
        height: 1024,
        count: 1,
        reference: reference(),
    }), /没有适配参考图/);
});
