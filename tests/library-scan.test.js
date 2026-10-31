import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCharacterPromptMessages, buildLibraryScanMessages, parseCharacterPromptResult, parseLibraryScanResult } from '../src/library-scan.js';
import { libraryEntriesFromScan } from '../src/character-library.js';

const sources = [
    { id: 'card:aria', kind: 'card', name: 'Aria', title: 'Aria', source: 'character-card', content: 'Aria is a silver-haired wolf girl.' },
    { id: 'worldbook:Town:1', kind: 'worldbook', name: 'Borin', title: 'Borin', source: 'worldbook:Town', content: 'Borin is a tall wolf with a scar.' },
];

test('buildLibraryScanMessages includes sources, ids and anti-invention rules', () => {
    const messages = buildLibraryScanMessages({ sources, existingNames: ['Aria'] });
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /Never invent/);
    assert.match(messages[0].content, /sourceIds/);
    assert.match(messages[1].content, /\[card:aria\]/);
    assert.match(messages[1].content, /\[worldbook:Town:1\]/);
    assert.match(messages[1].content, /Aria/);
});

test('parseLibraryScanResult parses fenced JSON and deduplicates characters', () => {
    const characters = parseLibraryScanResult('```json\n' + JSON.stringify({
        characters: [
            { name: 'Aria', role: 'character', appearance: 'silver hair', sourceIds: ['card:aria'] },
            { name: 'Aria', aliases: 'Ari', outfit: 'red cloak', sourceIds: ['worldbook:Town:1'] },
            { name: 'Market', appearance: '', outfit: '' },
            { name: '', appearance: 'ignored' },
        ],
    }) + '\n```');
    assert.equal(characters.length, 1);
    assert.equal(characters[0].name, 'Aria');
    assert.deepEqual(characters[0].aliases, ['Ari']);
    assert.equal(characters[0].appearance, 'silver hair');
    assert.equal(characters[0].outfit, 'red cloak');
    assert.deepEqual(characters[0].sourceIds, ['card:aria', 'worldbook:Town:1']);
});

test('parseLibraryScanResult accepts a root array and normalizes role', () => {
    const characters = parseLibraryScanResult(JSON.stringify([
        { name: 'Borin', appearance: 'tall wolf', role: 'not-a-role' },
    ]));
    assert.equal(characters.length, 1);
    assert.equal(characters[0].role, 'npc');
});

test('libraryEntriesFromScan maps source roles and provenance notes', () => {
    const entries = libraryEntriesFromScan([
        { name: 'Aria', role: 'npc', appearance: 'silver hair', outfit: 'red cloak', notes: 'main', sourceIds: ['card:aria'] },
        { name: 'Borin', role: 'npc', appearance: 'tall wolf', sourceIds: ['S2'] },
    ], sources);
    assert.equal(entries[0].role, 'character');
    assert.match(entries[0].notes, /AI 提炼自：角色卡「Aria」/);
    assert.equal(entries[1].role, 'npc');
    assert.match(entries[1].source, /^worldbook:Town$/);
    assert.match(entries[1].notes, /世界书「Borin」/);
    assert.equal(entries[1].outfit, '');
});

test('buildCharacterPromptMessages includes sheets and the JSON output contract', () => {
    const messages = buildCharacterPromptMessages({
        style: 'tags',
        entries: [{ name: 'Aria', appearance: 'silver hair, amber eyes', outfit: 'red cloak' }],
    });
    assert.match(messages[0].content, /Danbooru/);
    assert.match(messages[0].content, /OUTPUT CONTRACT/);
    assert.match(messages[1].content, /\[Aria\]/);
    assert.match(messages[1].content, /silver hair/);
    assert.match(messages[1].content, /red cloak/);
});

test('parseCharacterPromptResult handles fenced JSON and keeps exact names', () => {
    const characters = parseCharacterPromptResult('```json\n' + JSON.stringify({
        characters: [
            { name: 'Aria', prompt: 'silver hair, amber eyes, red cloak' },
            { name: 'Borin', tags: 'tall wolf, scar' },
            { name: 'Nobody', prompt: '' },
        ],
    }) + '\n```');
    assert.equal(characters.length, 2);
    assert.equal(characters[0].name, 'Aria');
    assert.match(characters[1].prompt, /tall wolf/);
});
