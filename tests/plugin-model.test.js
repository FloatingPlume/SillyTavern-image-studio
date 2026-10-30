import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePluginRoute, resolvePluginRoute } from '../src/plugin-model.js';
import { selectContextMessages } from '../src/prompt.js';
import { initStore } from '../src/store.js';

test('normalizePluginRoute migrates legacy rewrite settings', () => {
    const route = normalizePluginRoute({}, {
        rewriteMode: 'profile',
        rewriteProfileId: 'chat-1',
        rewriteConnectionProfileId: 'conn-1',
    });
    assert.deepEqual(route, {
        mode: 'profile',
        profileId: 'chat-1',
        connectionProfileId: 'conn-1',
        contextMessages: 4,
    });
});

test('normalizePluginRoute keeps valid settings and clamps context size', () => {
    assert.equal(normalizePluginRoute({ contextMessages: 99 }).contextMessages, 20);
    assert.equal(normalizePluginRoute({ contextMessages: -5 }).contextMessages, 0);
    assert.equal(normalizePluginRoute({ contextMessages: 'nope' }).contextMessages, 4);
    assert.equal(normalizePluginRoute({ mode: 'bogus' }).mode, 'current');
});

test('resolvePluginRoute reports profile and connection readiness', () => {
    const settings = {
        pluginModel: { mode: 'profile', profileId: 'chat-1', contextMessages: 3 },
        chatProfiles: [{ id: 'chat-1', name: '便宜模型', model: 'small-model' }],
        prompt: {},
    };
    const profileRoute = resolvePluginRoute(settings);
    assert.equal(profileRoute.ready, true);
    assert.equal(profileRoute.model, 'small-model');
    assert.match(profileRoute.label, /便宜模型/);

    settings.pluginModel = { mode: 'connection', connectionProfileId: 'missing' };
    const missing = resolvePluginRoute(settings, { connectionProfiles: [] });
    assert.equal(missing.ready, false);

    settings.pluginModel = { mode: 'current' };
    const current = resolvePluginRoute(settings, { current: { model: 'chat-model', source: 'custom' } });
    assert.equal(current.ready, true);
    assert.equal(current.model, 'chat-model');
});

test('selectContextMessages trims before the target and supports zero', () => {
    const chat = ['one', 'two', 'three', 'four', 'five'].map((name, index) => ({ name, mes: name, index }));
    assert.deepEqual(
        selectContextMessages(chat, { limit: 2, beforeIndex: 4 }).map(message => message.name),
        ['three', 'four'],
    );
    assert.deepEqual(
        selectContextMessages(chat, { limit: 2 }).map(message => message.name),
        ['four', 'five'],
    );
    assert.deepEqual(selectContextMessages(chat, { limit: 0 }), []);
});

test('initStore migrates legacy rewrite settings into pluginModel', () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            extensionSettings: {
                imageStudio: {
                    prompt: {
                        rewriteMode: 'connection',
                        rewriteProfileId: 'chat-9',
                        rewriteConnectionProfileId: 'conn-9',
                    },
                },
            },
            eventTypes: {},
            eventSource: { on() {}, once() {}, emit() {} },
        }),
    };
    const settings = initStore();
    assert.deepEqual(settings.pluginModel, {
        mode: 'connection',
        profileId: 'chat-9',
        connectionProfileId: 'conn-9',
        contextMessages: 4,
    });
    assert.equal(settings.prompt.rewriteMode, undefined);
    assert.equal(settings.prompt.rewriteProfileId, undefined);
    assert.equal(settings.prompt.rewriteConnectionProfileId, undefined);
});
