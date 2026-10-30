import { ctx, stripHtml, truncate, uid } from './util.js';

export const LIBRARY_FIELD = 'imageStudio';
const APPEARANCE_PATTERN = /(外貌|外观|长相|发型|头发|眼睛|瞳色|肤色|毛色|毛发|体型|身高|服装|穿着|衣服|披风|尾巴|耳朵|犄角|特征|伤疤|纹身|appearance|hair|eyes|eye|fur|skin|outfit|clothes|clothing|tail|ears|height|build|scar|tall|short)/i;

export function normalizeLibraryEntry(entry, index = 0) {
    const source = entry?.source || 'manual';
    return {
        id: String(entry?.id || uid(`char-${index}`)),
        name: String(entry?.name || '未命名角色').trim(),
        aliases: Array.isArray(entry?.aliases)
            ? entry.aliases.map(alias => String(alias).trim()).filter(Boolean)
            : String(entry?.aliases || '').split(/[,，]/).map(alias => alias.trim()).filter(Boolean),
        role: ['character', 'user', 'npc'].includes(entry?.role) ? entry.role : 'character',
        appearance: String(entry?.appearance || '').trim(),
        outfit: String(entry?.outfit || '').trim(),
        notes: String(entry?.notes || '').trim(),
        referencePath: String(entry?.referencePath || '').trim(),
        referenceName: String(entry?.referenceName || '').trim(),
        source,
        updatedAt: Number(entry?.updatedAt || Date.now()),
    };
}

export function currentCharacter() {
    const context = ctx();
    if (!context || context.characterId == null) return null;
    return context.characters?.[context.characterId] || null;
}

export function getCharacterLibrary() {
    const character = currentCharacter();
    const entries = character?.data?.extensions?.[LIBRARY_FIELD]?.characterLibrary;
    return Array.isArray(entries) ? entries.map(normalizeLibraryEntry) : [];
}

export async function saveCharacterLibrary(entries) {
    const context = ctx();
    const character = currentCharacter();
    if (!context || !character) throw new Error('当前没有打开角色卡');
    if (typeof context.writeExtensionField !== 'function') throw new Error('当前酒馆版本不支持角色卡扩展字段');
    const normalized = (entries || []).map(normalizeLibraryEntry);
    const existing = character.data?.extensions?.[LIBRARY_FIELD] || {};
    await context.writeExtensionField(context.characterId, LIBRARY_FIELD, {
        ...existing,
        characterLibrary: normalized,
        updatedAt: Date.now(),
    });
    return normalized;
}

function worldBookNames() {
    const context = ctx();
    const names = new Set();
    const character = currentCharacter();
    const primary = character?.data?.extensions?.world;
    if (primary) names.add(String(primary));
    const chatWorld = context?.chatMetadata?.world_info;
    if (chatWorld) names.add(String(chatWorld));
    return [...names];
}

function worldEntryCandidates(bookName, data) {
    const entries = data?.entries;
    if (!entries || typeof entries !== 'object') return [];
    const result = [];
    let index = 0;
    for (const [entryId, entry] of Object.entries(entries)) {
        if (!entry || entry.disable) continue;
        const content = stripHtml(entry.content || '');
        if (!content || content.length < 20 || !APPEARANCE_PATTERN.test(content)) continue;
        const keys = [...(entry.key || []), ...(entry.keysecondary || [])]
            .map(key => String(key || '').trim())
            .filter(Boolean);
        const name = String(entry.comment || keys[0] || `${bookName} 条目 ${index + 1}`).trim();
        result.push(normalizeLibraryEntry({
            id: `worldbook:${bookName}:${entryId}`,
            name,
            aliases: keys,
            role: 'npc',
            appearance: truncate(content, 2400),
            notes: `来自世界书「${bookName}」`,
            source: `worldbook:${bookName}`,
        }, index));
        index += 1;
        if (result.length >= 40) break;
    }
    return result;
}

export async function scanCharacterCandidates() {
    const context = ctx();
    if (!context) throw new Error('酒馆未就绪');
    const candidates = [];
    const character = currentCharacter();
    if (character) {
        const fields = context.getCharacterCardFields?.({ chid: context.characterId }) || {};
        const name = character.name || '当前角色';
        const appearance = stripHtml(fields.description || '');
        if (appearance) {
            candidates.push(normalizeLibraryEntry({
                id: `card:${character.avatar || name}`,
                name,
                aliases: [name],
                role: 'character',
                appearance: truncate(appearance, 2400),
                notes: [stripHtml(fields.personality || ''), stripHtml(fields.scenario || '')].filter(Boolean).join(' · '),
                source: 'character-card',
            }));
        }
    }
    const persona = stripHtml(context.powerUserSettings?.persona_description || '');
    if (persona) {
        const name = context.name1 || 'User';
        candidates.push(normalizeLibraryEntry({
            id: `persona:${name}`,
            name,
            aliases: [name],
            role: 'user',
            appearance: truncate(persona, 2400),
            notes: '来自酒馆用户设定',
            source: 'persona',
        }));
    }
    const books = worldBookNames();
    for (const bookName of books) {
        try {
            const data = await context.loadWorldInfo?.(bookName);
            candidates.push(...worldEntryCandidates(bookName, data));
        } catch (error) {
            console.warn(`[画坊] 读取世界书失败：${bookName}`, error);
        }
    }
    const seen = new Set();
    return candidates.filter(candidate => {
        const key = `${candidate.name}\u0000${candidate.source}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function matchPresentCharacters(entries, text) {
    const haystack = String(text || '').toLowerCase();
    if (!haystack) return [];
    return entries.filter(entry => {
        const names = [entry.name, ...(entry.aliases || [])].filter(Boolean);
        return names.some(name => {
            const needle = name.toLowerCase();
            return needle.length >= 2 && haystack.includes(needle);
        });
    });
}

export function matchCharacterNames(entries, names) {
    const wanted = new Set((names || []).map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
    if (!wanted.size) return [];
    return entries.filter(entry => {
        const candidates = [entry.name, ...(entry.aliases || [])].map(name => name.toLowerCase());
        return candidates.some(name => wanted.has(name));
    });
}

export function defaultPresentCharacters(entries) {
    const selected = [];
    const persona = entries.find(entry => entry.role === 'user');
    const character = entries.find(entry => entry.source === 'character-card')
        || entries.find(entry => entry.role === 'character');
    if (character) selected.push(character);
    if (persona) selected.push(persona);
    return selected;
}

export function composeCharacterContext(entries) {
    return (entries || [])
        .filter(entry => entry.name && (entry.appearance || entry.outfit))
        .map(entry => {
            const aliases = entry.aliases?.length ? `（别名：${entry.aliases.join('、')}）` : '';
            return `- ${entry.name}${aliases}${entry.role === 'user' ? ' [用户角色]' : ''}：${[entry.appearance, entry.outfit && `服装：${entry.outfit}`].filter(Boolean).join('；')}`;
        })
        .join('\n');
}

export function composeFinalPrompt(scene, entries, style = 'tags') {
    const base = String(scene || '').trim();
    const characterBlocks = (entries || [])
        .filter(entry => entry.name && (entry.appearance || entry.outfit))
        .map(entry => {
            const details = [entry.appearance, entry.outfit ? `服装：${entry.outfit}` : ''].filter(Boolean).join('，');
            return style === 'natural'
                ? `${entry.name}：${details}`
                : `${entry.name}，${details}`;
        });
    if (style === 'natural') {
        return truncate([
            base,
            characterBlocks.length ? `角色设定：\n${characterBlocks.join('\n')}` : '',
        ].filter(Boolean).join('\n\n'), 6000);
    }
    return truncate([
        'masterpiece, best quality',
        base,
        ...characterBlocks,
    ].filter(Boolean).join(', '), 6000);
}

export function mergeLibraryEntries(existing, incoming) {
    const result = existing.map(normalizeLibraryEntry);
    for (const entry of incoming.map(normalizeLibraryEntry)) {
        const index = result.findIndex(item => item.name.toLowerCase() === entry.name.toLowerCase());
        if (index >= 0) {
            const existing = result[index];
            result[index] = {
                ...entry,
                id: existing.id,
                referencePath: entry.referencePath || existing.referencePath,
                referenceName: entry.referenceName || existing.referenceName,
                updatedAt: Date.now(),
            };
        } else {
            result.push({ ...entry, id: entry.id || uid('char'), updatedAt: Date.now() });
        }
    }
    return result;
}
