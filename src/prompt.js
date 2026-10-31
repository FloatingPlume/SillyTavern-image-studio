import { get } from './store.js';
import { ctx, parseJsonLoose, stripHtml, truncate } from './util.js';

function characterFields() {
    const context = ctx();
    if (!context) return {};
    try {
        return context.getCharacterCardFields?.({ chid: context.characterId }) || {};
    } catch {
        return {};
    }
}

export function selectContextMessages(chat, { beforeIndex = null, limit = 4 } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const count = Math.max(0, Math.min(20, Math.round(Number(limit) || 0)));
    if (!count) return [];
    const end = Number.isInteger(beforeIndex) && beforeIndex >= 0
        ? Math.min(beforeIndex, list.length)
        : list.length;
    return list.slice(Math.max(0, end - count), end);
}

function recentMessages(limit = 6, { beforeIndex = null } = {}) {
    const context = ctx();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    return selectContextMessages(chat, { beforeIndex, limit })
        .map(message => `${message.name || (message.is_user ? 'User' : 'Character')}: ${stripHtml(message.mes || '')}`)
        .filter(line => line.trim())
        .join('\n');
}

function lastMessage(fromUser = false) {
    const context = ctx();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];
        if (!message?.mes) continue;
        if (fromUser && !message.is_user) continue;
        if (!fromUser && message.is_user) continue;
        return stripHtml(message.mes);
    }
    return '';
}

export function characterAppearance() {
    const fields = characterFields();
    const description = stripHtml(fields.description || '');
    const personality = stripHtml(fields.personality || '');
    return truncate([description, personality].filter(Boolean).join(', '), 1400);
}

export function expandPrompt(text, { recentCount, descriptionLimit = 1200 } = {}) {
    const context = ctx();
    const settings = get();
    const fields = characterFields();
    const char = context?.characters?.[context?.characterId] || {};
    const count = recentCount ?? settings.prompt.recentCount ?? 6;

    const replacements = {
        charDescription: truncate(stripHtml(fields.description || ''), descriptionLimit),
        charAppearance: truncate(stripHtml(fields.description || ''), descriptionLimit),
        charPersonality: truncate(stripHtml(fields.personality || ''), 600),
        charScenario: truncate(stripHtml(fields.scenario || ''), 800),
        charName: char.name || context?.name2 || '',
        userName: context?.name1 || '',
        persona: truncate(stripHtml(context?.powerUserSettings?.persona_description || ''), 600),
        scene: truncate(recentMessages(count), 1600),
        recentMessages: truncate(recentMessages(count), 1600),
        lastMessage: truncate(lastMessage(false), 800),
        lastUserMessage: truncate(lastMessage(true), 800),
        firstMessage: truncate(stripHtml(fields.firstMessage || ''), 600),
    };

    let output = String(text ?? '');
    for (const [key, value] of Object.entries(replacements)) {
        output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), value || '');
    }

    if (context?.substituteParams) {
        try {
            output = context.substituteParams(output);
        } catch { /* ignore */ }
    }

    return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildCharacterPrompt() {
    const context = ctx();
    const char = context?.characters?.[context?.characterId] || {};
    const fields = characterFields();
    const description = truncate(stripHtml(fields.description || ''), 900);
    const scene = truncate(lastMessage(false) || recentMessages(3), 500);
    const name = char.name || context?.name2 || 'character';
    return [`masterpiece, best quality, ${name}`, description, scene].filter(Boolean).join(', ');
}

const REWRITE_OUTPUT_CONTRACT = 'OUTPUT CONTRACT (highest priority): reply with exactly one JSON object and nothing else. Start with { and end with }. No markdown fences, no explanations, no roleplay continuation, no text before or after the JSON. Schema: {"positive":"...","negative":"...","characters":[]}';

export function buildRewriteMessages({
    style = 'tags',
    intent = '',
    positive = '',
    negative = '',
    targetMessage = '',
    targetIndex = null,
    libraryEntries = [],
    systemOverride = null,
    contextMessages = null,
} = {}) {
    const settings = get();
    const context = ctx();
    const char = context?.characters?.[context?.characterId] || {};
    const fields = characterFields();
    const stylePrompt = style === 'natural'
        ? 'Write one natural-language paragraph in English. Include subject, appearance, action, environment, lighting, and composition.'
        : 'Write English Danbooru-style tags separated by commas. Put quality tags at the front. Keep it under 120 tags.';

    const libraryText = (libraryEntries || [])
        .filter(entry => entry?.name && (entry.appearance || entry.outfit))
        .map(entry => `- ${entry.name}${entry.aliases?.length ? `（别名：${entry.aliases.join('、')}）` : ''}${entry.role === 'user' ? ' [用户角色]' : ''}: ${[entry.appearance, entry.outfit && `outfit: ${entry.outfit}`].filter(Boolean).join('; ')}`)
        .join('\n');
    const libraryRule = libraryText
        ? ' A character library is provided below. Select only characters actually present in the target moment, list their exact names in "characters", and treat the library appearance/outfit as authoritative. Do not repeat fixed appearance details unnecessarily; focus the prompt on scene, action, expression, clothing changes and lighting.'
        : '';
    const baseSystem = systemOverride != null ? systemOverride : (settings.prompt.rewriteSystem || '');
    const system = `${baseSystem}\n${stylePrompt}\nFocus on the target moment: extract only what is visually present or strongly implied there. Do not summarize the whole conversation, do not invent a different scene, and keep the character's established appearance and clothing consistent. Ignore dialogue formatting, UI text and speech bubbles.${libraryRule}\n${REWRITE_OUTPUT_CONTRACT}`;

    const count = contextMessages == null
        ? settings.pluginModel?.contextMessages ?? 4
        : contextMessages;
    const previous = truncate(recentMessages(count, { beforeIndex: targetIndex }), 2200);
    const user = [
        `Character name: ${char.name || context?.name2 || 'unknown'}`,
        `Character appearance: ${truncate(stripHtml(fields.description || ''), 1200) || '(not provided)'}`,
        `Personality: ${truncate(stripHtml(fields.personality || ''), 500) || '(not provided)'}`,
        `Scenario: ${truncate(stripHtml(fields.scenario || ''), 800) || '(not provided)'}`,
        previous ? `Previous messages (${count}):\n${previous}` : '',
        libraryText ? `Character library (authoritative):\n${truncate(libraryText, 3200)}` : '',
        `Target moment to illustrate: ${truncate(stripHtml(targetMessage), 1600) || '(use the latest scene)'}`,
        `What the user wants to see: ${intent || truncate(positive, 800) || 'an illustration of the current scene'}`,
        negative ? `Existing negative prompt: ${negative}` : '',
        'Keep the character visually consistent. Do not invent a different character.',
        REWRITE_OUTPUT_CONTRACT,
    ].filter(Boolean).join('\n\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export function buildQuietRewritePrompt({ style = 'tags', intent = '', positive = '', negative = '', targetMessage = '', targetIndex = null, libraryEntries = [], contextMessages = null } = {}) {
    const messages = buildRewriteMessages({ style, intent, positive, negative, targetMessage, targetIndex, libraryEntries, systemOverride: '', contextMessages });
    return `${messages[0].content}

${messages[1].content}`;
}

export function parseRewriteResult(text, fallbackNegative = '') {
    const raw = String(text ?? '').trim();
    const parsed = parseJsonLoose(raw);
    let positive = '';
    let negative = fallbackNegative;
    let characters = [];
    if (parsed && typeof parsed === 'object') {
        positive = String(parsed.positive || parsed.prompt || parsed.tags || '').trim();
        negative = String(parsed.negative || parsed.negative_prompt || fallbackNegative || '').trim();
        characters = Array.isArray(parsed.characters)
            ? parsed.characters.map(name => String(name || '').trim()).filter(Boolean)
            : [];
    }
    if (!positive) {
        positive = raw
            .replace(/^```(?:json|text)?/i, '')
            .replace(/```$/i, '')
            .trim();
        if (/^\{[\s\S]*\}$/.test(positive)) {
            const retry = parseJsonLoose(positive);
            if (retry && typeof retry === 'object') {
                positive = String(retry.positive || retry.prompt || retry.tags || '').trim();
                negative = String(retry.negative || retry.negative_prompt || negative || '').trim();
                characters = Array.isArray(retry.characters)
                    ? retry.characters.map(name => String(name || '').trim()).filter(Boolean)
                    : characters;
            }
        }
    }
    return {
        positive: positive.replace(/^["']|["']$/g, '').trim(),
        negative: negative.replace(/^["']|["']$/g, '').trim(),
        characters,
    };
}

export function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const separator = before && !before.endsWith('\n') ? '\n' : '';
    textarea.value = `${before}${separator}${text}${after}`;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const position = (before + separator + text).length;
    textarea.setSelectionRange(position, position);
    textarea.focus();
}
