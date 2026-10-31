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
        prompt: String(entry?.prompt || '').trim(),
        promptStyle: ['tags', 'natural', 'manual'].includes(entry?.promptStyle) ? entry.promptStyle : '',
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

function cardFields() {
    const context = ctx();
    if (!context) return {};
    try {
        return context.getCharacterCardFields?.({ chid: context.characterId }) || {};
    } catch {
        return {};
    }
}

function buildCardCandidate() {
    const context = ctx();
    const character = currentCharacter();
    if (!context || !character) return null;
    const fields = cardFields();
    const appearance = stripHtml(fields.description || '');
    if (!appearance) return null;
    const name = character.name || '当前角色';
    return normalizeLibraryEntry({
        id: `card:${character.avatar || name}`,
        name,
        aliases: [name],
        role: 'character',
        appearance: truncate(appearance, 2400),
        notes: [stripHtml(fields.personality || ''), stripHtml(fields.scenario || '')].filter(Boolean).join(' · '),
        source: 'character-card',
    });
}

function buildPersonaCandidate() {
    const context = ctx();
    if (!context) return null;
    const persona = stripHtml(context.powerUserSettings?.persona_description || cardFields().persona || '');
    if (!persona) return null;
    const name = context.name1 || 'User';
    return normalizeLibraryEntry({
        id: `persona:${name}`,
        name,
        aliases: [name],
        role: 'user',
        appearance: truncate(persona, 2400),
        notes: '来自酒馆用户设定',
        source: 'persona',
    });
}

function buildCardSource() {
    const context = ctx();
    const character = currentCharacter();
    if (!context || !character) return null;
    const fields = cardFields();
    const name = character.name || context.name2 || '当前角色';
    const sections = [
        `角色名：${name}`,
        stripHtml(fields.description || '') ? `描述：${truncate(stripHtml(fields.description), 3200)}` : '',
        stripHtml(fields.personality || '') ? `性格：${truncate(stripHtml(fields.personality), 1000)}` : '',
        stripHtml(fields.scenario || '') ? `场景：${truncate(stripHtml(fields.scenario), 1200)}` : '',
        stripHtml(fields.firstMessage || '') ? `开场白：${truncate(stripHtml(fields.firstMessage), 1200)}` : '',
    ].filter(Boolean);
    if (sections.length <= 1) return null;
    return {
        id: `card:${character.avatar || name}`,
        kind: 'card',
        name,
        title: name,
        aliases: [name],
        role: 'character',
        source: 'character-card',
        content: sections.join('\n'),
    };
}

function buildPersonaSource() {
    const context = ctx();
    if (!context) return null;
    const persona = stripHtml(context.powerUserSettings?.persona_description || cardFields().persona || '');
    if (!persona) return null;
    const name = context.name1 || 'User';
    return {
        id: `persona:${name}`,
        kind: 'persona',
        name,
        title: name,
        aliases: [name],
        role: 'user',
        source: 'persona',
        content: `用户角色名：${name}\n描述：${truncate(persona, 2000)}`,
    };
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

function worldEntryItems(bookName, data) {
    const entries = data?.entries;
    if (!entries || typeof entries !== 'object') return [];
    return Object.entries(entries)
        .map(([entryId, entry]) => ({ bookName, entryId, entry }))
        .filter(item => item.entry && !item.entry.disable && stripHtml(item.entry.content || '').length >= 20);
}

function worldbookKeys(entry) {
    return [...(entry?.key || []), ...(entry?.keysecondary || [])]
        .map(key => String(key || '').trim())
        .filter(Boolean);
}

function mechanicalWorldCandidates(items, limit = 40) {
    const result = [];
    for (const item of items) {
        const entry = item.entry;
        const content = stripHtml(entry?.content || '');
        if (!content || content.length < 20 || !APPEARANCE_PATTERN.test(content)) continue;
        const book = String(item.bookName || entry.world || '世界书');
        const keys = worldbookKeys(entry);
        const name = String(entry.comment || keys[0] || `${book} 条目 ${result.length + 1}`).trim();
        result.push(normalizeLibraryEntry({
            id: `worldbook:${book}:${entry.uid ?? name}`,
            name,
            aliases: keys,
            role: 'npc',
            appearance: truncate(content, 2400),
            notes: `来自世界书「${book}」`,
            source: `worldbook:${book}`,
        }, result.length));
        if (result.length >= limit) break;
    }
    return result;
}

function worldEntryCandidates(bookName, data) {
    return mechanicalWorldCandidates(worldEntryItems(bookName, data));
}

function worldbookSource(entry, bookName, origin = 'all') {
    const content = stripHtml(entry?.content || '');
    if (!content || content.length < 20) return null;
    const book = String(entry.world || bookName || '世界书');
    const keys = worldbookKeys(entry);
    const name = String(entry.comment || keys[0] || `${book} 条目 ${entry.uid ?? ''}`).trim();
    const originLabel = origin === 'active' ? '当前对话激活' : '整本扫描';
    return {
        id: `worldbook:${book}:${entry.uid ?? name}`,
        kind: 'worldbook',
        name,
        title: name,
        aliases: keys,
        role: 'npc',
        source: `worldbook:${book}`,
        origin,
        content: [`世界书条目「${name}」（${originLabel}${keys.length ? `；关键词：${keys.join('、')}` : ''}）`, truncate(content, 1800)].join('\n'),
    };
}

function worldEntryPriority(entry, content) {
    let score = 0;
    if (APPEARANCE_PATTERN.test(content)) score += 3;
    if (/(角色|人物|少女|少年|女孩|男孩|女性|男性|老人|孩子|精灵|兽人|恶魔|天使|character|person|woman|man|girl|boy|species|race)/i.test(content)) score += 2;
    const comment = String(entry?.comment || '');
    if (comment && !/(地点|区域|城市|国家|组织|势力|物品|道具|事件|历史|世界|设定|location|city|faction|item|event|lore|world)/i.test(comment)) score += 1;
    return score;
}

async function activatedWorldEntries() {
    const context = ctx();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    if (!chat.length) return [];
    if (typeof window === 'undefined') return [];
    try {
        const worldInfo = await import('/scripts/world-info.js');
        if (typeof worldInfo.checkWorldInfo !== 'function') return [];
        const messages = chat
            .filter(message => message?.mes && !message.is_system)
            .map(message => `${message.name || (message.is_user ? context.name1 : context.name2) || ''}: ${stripHtml(message.mes)}`)
            .reverse();
        const fields = cardFields();
        const globalScanData = {
            personaDescription: stripHtml(fields.persona || context.powerUserSettings?.persona_description || ''),
            characterDescription: stripHtml(fields.description || ''),
            characterPersonality: stripHtml(fields.personality || ''),
            characterDepthPrompt: stripHtml(fields.charDepthPrompt || ''),
            scenario: stripHtml(fields.scenario || ''),
            creatorNotes: stripHtml(fields.creatorNotes || ''),
            trigger: 'normal',
        };
        const result = await worldInfo.checkWorldInfo(messages, Number(context.maxContext) || 4096, true, globalScanData);
        return [...(result?.allActivatedEntries || [])]
            .filter(entry => entry && !entry.disable && stripHtml(entry.content || '').length >= 20);
    } catch (error) {
        console.warn('[画坊] 读取当前对话激活的世界书失败，将回退机械扫描', error);
        return [];
    }
}

async function loadLinkedWorldEntries() {
    const context = ctx();
    const items = [];
    for (const bookName of worldBookNames()) {
        try {
            const data = await context.loadWorldInfo?.(bookName);
            items.push(...worldEntryItems(bookName, data));
        } catch (error) {
            console.warn(`[画坊] 读取世界书失败：${bookName}`, error);
        }
    }
    return items;
}

const SOURCE_BUDGET = 18_000;

function applySourceBudget(sources) {
    const result = [];
    let total = 0;
    let omitted = 0;
    for (const source of sources) {
        if (!source?.content) continue;
        const remaining = SOURCE_BUDGET - total;
        if (remaining < 200) {
            omitted += 1;
            continue;
        }
        const content = source.content.length > remaining
            ? truncate(source.content, remaining)
            : source.content;
        result.push({ ...source, content });
        total += content.length;
    }
    return { sources: result, totalChars: total, omitted };
}

function dedupeCandidates(candidates) {
    const seen = new Set();
    return candidates.filter(candidate => {
        const key = `${candidate.name}\u0000${candidate.source}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Collect text for AI extraction and mechanical fallback.
 * `active` uses SillyTavern's own world-info activation for the current chat;
 * `all` reads the linked character/chat worldbooks.
 */
export async function collectLibraryScanSources({ scope = 'active' } = {}) {
    const context = ctx();
    if (!context) throw new Error('酒馆未就绪');
    const sources = [buildCardSource(), buildPersonaSource()].filter(Boolean);
    const mechanical = [buildCardCandidate(), buildPersonaCandidate()].filter(Boolean);
    const meta = {
        scope: scope === 'all' ? 'all' : 'active',
        activated: 0,
        worldbookSources: 0,
        scannedBooks: 0,
        omittedSources: 0,
        totalChars: 0,
        mechanicalFallback: false,
        activationFallback: false,
    };

    if (meta.scope === 'active') {
        const activated = await activatedWorldEntries();
        meta.activated = activated.length;
        if (activated.length) {
            const baseSourceCount = sources.length;
            for (const entry of activated) {
                const source = worldbookSource(entry, entry.world || '世界书', 'active');
                if (source) sources.push(source);
            }
            meta.worldbookSources = sources.length - baseSourceCount;
            mechanical.push(...mechanicalWorldCandidates(activated.map(entry => ({
                entry,
                entryId: entry.uid,
                bookName: entry.world || '世界书',
            }))));
        } else {
            const linked = await loadLinkedWorldEntries();
            meta.scannedBooks = worldBookNames().length;
            meta.mechanicalFallback = true;
            meta.activationFallback = true;
            mechanical.push(...mechanicalWorldCandidates(linked));
        }
    } else {
        const linked = await loadLinkedWorldEntries();
        meta.scannedBooks = new Set(linked.map(item => String(item.entry.world || item.bookName))).size;
        meta.mechanicalFallback = true;
        mechanical.push(...mechanicalWorldCandidates(linked));
        const ranked = [...linked].sort((left, right) =>
            worldEntryPriority(right.entry, stripHtml(right.entry.content || ''))
            - worldEntryPriority(left.entry, stripHtml(left.entry.content || '')));
        const selected = ranked.slice(0, 24);
        meta.omittedSources += Math.max(0, ranked.length - selected.length);
        for (const item of selected) {
            const source = worldbookSource(item.entry, item.bookName, 'all');
            if (source) sources.push(source);
        }
        meta.worldbookSources = selected.length;
    }

    const budgeted = applySourceBudget(sources);
    meta.omittedSources += budgeted.omitted;
    meta.totalChars = budgeted.totalChars;
    return {
        sources: budgeted.sources,
        mechanical: dedupeCandidates(mechanical),
        meta,
    };
}

export function libraryEntriesFromScan(characters, sources) {
    const sourceList = sources || [];
    const sourceMap = new Map(sourceList.map(source => [source.id, source]));
    return (characters || []).map((character, index) => {
        const refs = (character.sourceIds || []).map(id => {
            const direct = sourceMap.get(id);
            if (direct) return direct;
            const ordinal = /^S?(\d+)$/i.exec(String(id || '').trim());
            return ordinal ? sourceList[Number(ordinal[1]) - 1] || null : null;
        }).filter(Boolean);
        const primary = refs[0] || null;
        const role = primary?.kind === 'persona'
            ? 'user'
            : primary?.kind === 'card'
                ? 'character'
                : character.role;
        const sourceLabels = [...new Set(refs.map(ref => {
            const kind = ref.kind === 'persona' ? '用户设定' : ref.kind === 'card' ? '角色卡' : '世界书';
            return `${kind}「${ref.title || ref.name}」`;
        }))];
        const notes = [
            character.notes,
            sourceLabels.length ? `AI 提炼自：${sourceLabels.join('、')}` : 'AI 提炼',
        ].filter(Boolean).join(' · ');
        return normalizeLibraryEntry({
            name: character.name,
            aliases: character.aliases,
            role,
            appearance: truncate(character.appearance, 2400),
            outfit: truncate(character.outfit, 1200),
            notes: truncate(notes, 800),
            source: primary?.source || 'ai-scan',
        }, index);
    });
}

export async function scanCharacterCandidates() {
    const context = ctx();
    if (!context) throw new Error('酒馆未就绪');
    const candidates = [buildCardCandidate(), buildPersonaCandidate()].filter(Boolean);
    const books = worldBookNames();
    for (const bookName of books) {
        try {
            const data = await context.loadWorldInfo?.(bookName);
            candidates.push(...worldEntryCandidates(bookName, data));
        } catch (error) {
            console.warn(`[画坊] 读取世界书失败：${bookName}`, error);
        }
    }
    return dedupeCandidates(candidates);
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
        .filter(entry => entry.name && (entry.prompt || entry.appearance || entry.outfit))
        .map(entry => {
            const details = entry.prompt || [entry.appearance, entry.outfit ? `服装：${entry.outfit}` : ''].filter(Boolean).join('，');
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
                prompt: entry.prompt || existing.prompt,
                promptStyle: entry.prompt ? entry.promptStyle : existing.promptStyle,
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
