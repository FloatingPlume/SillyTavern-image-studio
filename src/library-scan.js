import { parseJsonLoose } from './util.js';

const VALID_ROLES = new Set(['character', 'user', 'npc']);
const MAX_CHARACTERS = 30;

export const LIBRARY_SCAN_SYSTEM = `You maintain a reusable visual character library for an image generation app.
Extract characters that have a recognizable visual identity from the provided sources.

For each distinct character return:
- name: the canonical name used in the source
- aliases: other names or nicknames explicitly used in the source
- role: "user" for the user persona, "character" for the main card character, otherwise "npc"
- appearance: permanent physical traits (species, build, hair/fur, eyes, skin, face, ears, tail, horns, scars, tattoos, apparent age)
- outfit: default clothing and accessories; omit transient scene props
- notes: short stable role/relationship or visual notes
- sourceIds: the exact ids printed in brackets for the sources that describe this character

Rules:
- Use only information present in the sources. Never invent details.
- Skip locations, factions, items, events, lore, and characters without a physical description.
- Merge duplicate names and aliases into one character. Prefer the most complete description.
- Write a character sheet, not an image prompt.
- Return JSON only: {"characters":[...]}`;

function sourceKindLabel(kind) {
    if (kind === 'persona') return '用户设定';
    if (kind === 'card') return '角色卡';
    return '世界书';
}

export function buildLibraryScanMessages({ sources = [], existingNames = [] } = {}) {
    const usable = (sources || []).filter(source => source?.id && source?.content);
    const names = [...new Set((existingNames || []).map(name => String(name || '').trim()).filter(Boolean))].slice(0, 60);
    const user = [
        names.length ? `Already in the character library (you may return them if the sources add missing details): ${names.join('、')}` : '',
        `Sources: ${usable.length}`,
        ...usable.map(source => [
            `[${source.id}] ${sourceKindLabel(source.kind)}「${source.title || source.name || ''}」`,
            source.content,
        ].join('\n')),
        'Return only the JSON object. Use the exact source ids in sourceIds. OUTPUT CONTRACT (highest priority): start with { and end with }, no markdown fences, no commentary, no text before or after the JSON. Schema: {"characters":[{"name":"...","aliases":[],"role":"npc","appearance":"...","outfit":"...","notes":"...","sourceIds":[]}]}',
    ].filter(Boolean).join('\n\n');
    return [
        { role: 'system', content: LIBRARY_SCAN_SYSTEM },
        { role: 'user', content: user },
    ];
}

function normalizeStringList(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    return String(value || '').split(/[,，、]/).map(item => item.trim()).filter(Boolean);
}

function normalizeRole(value, fallback = 'npc') {
    return VALID_ROLES.has(value) ? value : fallback;
}

function normalizeCharacter(item) {
    if (!item || typeof item !== 'object') return null;
    const name = String(item.name || '').trim();
    if (!name) return null;
    const appearance = String(item.appearance || item.visual || '').trim();
    const outfit = String(item.outfit || item.clothing || '').trim();
    if (!appearance && !outfit) return null;
    return {
        name,
        aliases: normalizeStringList(item.aliases).filter(alias => alias.toLowerCase() !== name.toLowerCase()),
        role: normalizeRole(item.role),
        appearance,
        outfit,
        notes: String(item.notes || item.note || '').trim(),
        sourceIds: normalizeStringList(item.sourceIds || item.sources),
    };
}

function mergeCharacter(into, incoming) {
    into.aliases = [...new Set([...into.aliases, ...incoming.aliases])];
    into.sourceIds = [...new Set([...into.sourceIds, ...incoming.sourceIds])];
    if ((incoming.appearance || '').length > (into.appearance || '').length) into.appearance = incoming.appearance;
    if ((incoming.outfit || '').length > (into.outfit || '').length) into.outfit = incoming.outfit;
    if (incoming.notes && !into.notes.includes(incoming.notes)) {
        into.notes = [into.notes, incoming.notes].filter(Boolean).join(' · ');
    }
    if (into.role === 'npc' && incoming.role !== 'npc') into.role = incoming.role;
}

export function parseLibraryScanResult(text) {
    const parsed = parseJsonLoose(String(text || '').trim());
    const list = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.characters) ? parsed.characters
            : Array.isArray(parsed?.data) ? parsed.data
                : [];
    const byName = new Map();
    for (const raw of list.slice(0, MAX_CHARACTERS * 2)) {
        const character = normalizeCharacter(raw);
        if (!character) continue;
        const key = character.name.toLowerCase();
        const existing = byName.get(key);
        if (existing) mergeCharacter(existing, character);
        else byName.set(key, character);
    }
    return [...byName.values()].slice(0, MAX_CHARACTERS);
}

export const CHARACTER_PROMPT_SYSTEM = `You convert character sheets into compact image-generation prompt fragments.
Return a separate prompt fragment for every character in the input.

Style rules:
- tags: English Danbooru-style tags separated by commas. Include species, body type, hair/fur, eyes, skin, face, ears, tail, horns, scars, tattoos, apparent age, and default outfit. Do not include the character name, quality tags, scene, pose, lighting, camera, or artist names.
- natural: one concise English sentence describing only permanent appearance and default outfit. Do not include the character name or scene.

Rules:
- Use only the supplied appearance/outfit/notes. Never invent details.
- Do not merge different characters.
- OUTPUT CONTRACT (highest priority): your entire reply must be one JSON object starting with { and ending with }. No markdown fences, no commentary, no roleplay, no text before or after the JSON.
- Schema: {"characters":[{"name":"exact input name","prompt":"..."}]}`;

function promptStyleInstruction(style) {
    return style === 'natural'
        ? 'Write one concise English sentence per character.'
        : 'Write English Danbooru-style comma-separated tags per character.';
}

export function buildCharacterPromptMessages({ entries = [], style = 'tags' } = {}) {
    const usable = (entries || []).filter(entry => entry?.name && (entry.appearance || entry.outfit));
    const characterBlocks = usable.map(entry => [
        `[${entry.name}]`,
        `appearance: ${entry.appearance || '(none)'}`,
        `outfit: ${entry.outfit || '(none)'}`,
    ].filter(Boolean).join('\n'));
    const user = [
        promptStyleInstruction(style),
        `Characters: ${usable.length}`,
        ...characterBlocks,
        'Return exactly one JSON object. Preserve every input name exactly in the name field.',
    ].join('\n\n');
    return [
        { role: 'system', content: CHARACTER_PROMPT_SYSTEM },
        { role: 'user', content: user },
    ];
}

export function parseCharacterPromptResult(text) {
    const parsed = parseJsonLoose(String(text || '').trim());
    const list = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.characters) ? parsed.characters
            : [];
    const byName = new Map();
    for (const item of list.slice(0, MAX_CHARACTERS)) {
        if (!item || typeof item !== 'object') continue;
        const name = String(item.name || '').trim();
        const prompt = String(item.prompt || item.positive || item.tags || '').trim();
        if (!name || !prompt) continue;
        byName.set(name.toLowerCase(), { name, prompt });
    }
    return [...byName.values()];
}
