import test from 'node:test';
import assert from 'node:assert/strict';

import {
    collectLibraryScanSources,
    composeFinalPrompt,
    defaultPresentCharacters,
    getCharacterLibrary,
    saveCharacterLibrary,
    matchCharacterNames,
    matchPresentCharacters,
    mergeLibraryEntries,
    normalizeLibraryEntry,
    scanCharacterCandidates,
} from '../src/character-library.js';

const entries = [
    normalizeLibraryEntry({ id: 'a', name: 'Aria', aliases: ['Ari'], role: 'character', appearance: 'black fur, amber eyes', outfit: 'red cloak', source: 'character-card' }),
    normalizeLibraryEntry({ id: 'b', name: 'User', aliases: ['Tester'], role: 'user', appearance: 'short hair, green jacket', source: 'persona' }),
    normalizeLibraryEntry({ id: 'c', name: 'Borin', aliases: ['Bor'], role: 'npc', appearance: 'tall wolf, scar', source: 'worldbook:town' }),
];

test('normalizeLibraryEntry splits aliases and fills defaults', () => {
    const entry = normalizeLibraryEntry({ name: ' X ', aliases: 'a, b，c' });
    assert.equal(entry.name, 'X');
    assert.deepEqual(entry.aliases, ['a', 'b', 'c']);
    assert.equal(entry.role, 'character');
    assert.equal(entry.prompt, '');
    assert.ok(entry.id);
});

test('matchPresentCharacters and matchCharacterNames find library entries', () => {
    assert.deepEqual(matchPresentCharacters(entries, 'Aria meets Borin at the gate').map(entry => entry.name), ['Aria', 'Borin']);
    assert.deepEqual(matchCharacterNames(entries, ['Ari', 'user']).map(entry => entry.name), ['Aria', 'User']);
});

test('defaultPresentCharacters prefers the current card and persona', () => {
    assert.deepEqual(defaultPresentCharacters(entries).map(entry => entry.name), ['Aria', 'User']);
});

test('composeFinalPrompt prefers converted character prompts over raw sheets', () => {
    const entry = normalizeLibraryEntry({
        name: 'Aria',
        appearance: 'a very long raw appearance that should not be used',
        outfit: 'raw outfit',
        prompt: 'silver hair, amber eyes, red cloak',
        promptStyle: 'tags',
    });
    const prompt = composeFinalPrompt('rainy rooftop', [entry], 'tags');
    assert.match(prompt, /silver hair/);
    assert.doesNotMatch(prompt, /very long raw appearance/);
});

test('composeFinalPrompt appends authoritative appearance and outfit', () => {
    const prompt = composeFinalPrompt('rainy rooftop, night', [entries[0], entries[1]], 'tags');
    assert.match(prompt, /rainy rooftop/);
    assert.doesNotMatch(prompt, /Aria/);
    assert.match(prompt, /black fur/);
    assert.match(prompt, /red cloak/);
    assert.match(prompt, /short hair/);
});

test('scanCharacterCandidates collects card, persona and appearance-relevant lorebook entries', async () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            characterId: 0,
            characters: [{ name: 'Aria', avatar: 'aria.png', data: { extensions: { world: 'Town Lore' } } }],
            name1: 'Tester',
            chatMetadata: { world_info: 'Chat Lore' },
            powerUserSettings: { persona_description: 'short hair, green jacket' },
            getCharacterCardFields: () => ({ description: 'black fur, amber eyes', personality: 'calm', scenario: 'rooftop' }),
            loadWorldInfo: async name => ({
                entries: {
                    1: { key: ['Borin'], content: 'Borin is a tall wolf with a scar over one eye.', comment: 'Borin' },
                    2: { key: ['Market'], content: 'The market sells fruit and cloth.', comment: 'Market' },
                },
            }),
        }),
    };
    const candidates = await scanCharacterCandidates();
    assert.ok(candidates.some(item => item.name === 'Aria' && item.source === 'character-card'));
    assert.ok(candidates.some(item => item.name === 'Tester' && item.source === 'persona'));
    assert.ok(candidates.some(item => item.name === 'Borin' && item.source.startsWith('worldbook')));
    assert.equal(candidates.some(item => item.name === 'Market'), false);
});

test('collectLibraryScanSources keeps card/persona global and can read linked worldbooks', async () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            characterId: 0,
            characters: [{ name: 'Aria', avatar: 'aria.png', data: { extensions: { world: 'Town Lore' } } }],
            name1: 'Tester',
            chatMetadata: {},
            chat: [],
            powerUserSettings: { persona_description: 'short hair, green jacket' },
            getCharacterCardFields: () => ({
                description: 'Aria has black fur and amber eyes.',
                personality: 'calm',
                scenario: 'rooftop',
                firstMessage: 'Aria waits in the rain.',
            }),
            loadWorldInfo: async () => ({
                entries: {
                    1: { key: ['Borin'], content: 'Borin is a tall wolf with a scar over one eye.', comment: 'Borin' },
                    2: { key: ['Market'], content: 'The market sells fruit and cloth.', comment: 'Market' },
                },
            }),
        }),
    };
    const result = await collectLibraryScanSources({ scope: 'all' });
    assert.ok(result.sources.some(source => source.kind === 'card' && source.name === 'Aria'));
    assert.ok(result.sources.some(source => source.kind === 'persona' && source.name === 'Tester'));
    assert.ok(result.sources.some(source => source.name === 'Borin'));
    assert.ok(result.sources.some(source => source.name === 'Market' && source.origin === 'all'));
    assert.ok(result.mechanical.some(candidate => candidate.name === 'Borin'));
    assert.equal(result.mechanical.some(candidate => candidate.name === 'Market'), false);
    assert.equal(result.meta.scope, 'all');
    assert.ok(result.meta.totalChars > 0);
});

test('collectLibraryScanSources falls back to mechanical worldbooks when activation is unavailable', async () => {
    globalThis.SillyTavern = {
        getContext: () => ({
            characterId: 0,
            characters: [{ name: 'Aria', avatar: 'aria.png', data: { extensions: { world: 'Town Lore' } } }],
            name1: 'Tester',
            chat: [{ name: 'User', is_user: true, mes: 'Hello Aria.' }],
            chatMetadata: {},
            maxContext: 4096,
            powerUserSettings: { persona_description: 'short hair, green jacket' },
            getCharacterCardFields: () => ({ description: 'Aria has black fur and amber eyes.' }),
            loadWorldInfo: async () => ({
                entries: {
                    1: { key: ['Borin'], content: 'Borin is a tall wolf with a scar over one eye.', comment: 'Borin' },
                },
            }),
        }),
    };
    const result = await collectLibraryScanSources({ scope: 'active' });
    assert.equal(result.meta.activationFallback, true);
    assert.ok(result.mechanical.some(candidate => candidate.name === 'Borin'));
    assert.equal(result.sources.some(source => source.kind === 'worldbook'), false);
});

test('saveCharacterLibrary writes to the current character extension field', async () => {    const character = { name: 'Aria', data: { extensions: {} } };
    const writes = [];
    globalThis.SillyTavern = {
        getContext: () => ({
            characterId: 0,
            characters: [character],
            writeExtensionField: async (id, key, value) => {
                writes.push({ id, key, value });
                character.data.extensions[key] = value;
            },
        }),
    };
    const saved = await saveCharacterLibrary([entries[0]]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].key, 'imageStudio');
    assert.equal(writes[0].value.characterLibrary.length, 1);
    assert.equal(getCharacterLibrary()[0].name, 'Aria');
    assert.equal(saved[0].name, 'Aria');
});

test('mergeLibraryEntries updates existing entries without dropping their reference image', () => {
    const existing = [{ ...entries[0], referencePath: '/user/images/char/a.png', prompt: 'silver hair, red cloak', promptStyle: 'tags' }];
    const merged = mergeLibraryEntries(existing, [{ ...entries[0], appearance: 'updated fur' }]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].appearance, 'updated fur');
    assert.equal(merged[0].referencePath, '/user/images/char/a.png');
    assert.equal(merged[0].prompt, 'silver hair, red cloak');
});
