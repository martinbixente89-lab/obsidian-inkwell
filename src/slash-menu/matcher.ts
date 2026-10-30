import type { SlashTriggerInfo } from './types';

/**
 * Normalizes text for accent-insensitive, case-insensitive fuzzy matching.
 */
export function normalizeText(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

/**
 * Filters slash menu items or definitions based on user query.
 */
export function filterSlashItems<T extends { label: string; syntax?: string; keywords: string[] }>(
	items: T[],
	query: string,
): T[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return [...items];
	}

	const normQ = normalizeText(trimmed);

	return items.filter((item) => {
		if (normalizeText(item.label).includes(normQ)) return true;
		if (item.syntax && normalizeText(item.syntax).includes(normQ)) return true;
		return item.keywords.some((k) => normalizeText(k).includes(normQ));
	});
}

/**
 * Checks whether the given position is inside a fenced Markdown code block (``` or ~~~).
 */
export function isInsideCodeBlock(docText: string, pos: number): boolean {
	const textBefore = docText.slice(0, pos);
	const lines = textBefore.split('\n');
	// Exclude current line because we want to know if the block opened on an earlier line
	let open = false;
	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i]?.trim() ?? '';
		if (/^(`{3,}|~{3,})/.test(line)) {
			open = !open;
		}
	}
	return open;
}

/**
 * Checks whether cursor is inside inline code backticks on the current line.
 */
export function isInsideInlineCode(lineTextBefore: string): boolean {
	// Count unescaped backticks
	let count = 0;
	for (let i = 0; i < lineTextBefore.length; i++) {
		if (lineTextBefore[i] === '`' && (i === 0 || lineTextBefore[i - 1] !== '\\')) {
			count++;
		}
	}
	return count % 2 === 1;
}

/**
 * Checks whether cursor is inside an unclosed Markdown link or wiki-link on the current line.
 */
export function isInsideLink(lineTextBefore: string): boolean {
	// Check unclosed [[ ...
	const lastWikiOpen = lineTextBefore.lastIndexOf('[[');
	if (lastWikiOpen !== -1) {
		const lastWikiClose = lineTextBefore.lastIndexOf(']]');
		if (lastWikiClose < lastWikiOpen) return true;
	}

	// Check unclosed [ ... ] or ( ... ) for standard links
	const lastBracketOpen = lineTextBefore.lastIndexOf('[');
	if (lastBracketOpen !== -1) {
		const lastBracketClose = lineTextBefore.lastIndexOf(']');
		if (lastBracketClose < lastBracketOpen) return true;
	}

	return false;
}

/**
 * Checks whether cursor is inside an unclosed HTML tag on the current line.
 */
export function isInsideHtmlTag(lineTextBefore: string): boolean {
	const lastOpen = lineTextBefore.lastIndexOf('<');
	if (lastOpen !== -1) {
		const lastClose = lineTextBefore.lastIndexOf('>');
		if (lastClose < lastOpen) return true;
	}
	return false;
}

/**
 * Checks whether the current context is protected (no slash command trigger).
 */
export function isProtectedContext(docText: string, lineTextBefore: string, pos: number): boolean {
	if (isInsideCodeBlock(docText, pos)) return true;
	if (isInsideInlineCode(lineTextBefore)) return true;
	if (isInsideLink(lineTextBefore)) return true;
	if (isInsideHtmlTag(lineTextBefore)) return true;
	return false;
}

/**
 * Evaluates whether a line and cursor position triggers the slash menu.
 * Only triggers if '/' is at the beginning of an empty line (optional indentation).
 * Trailing spaces or non-whitespace before '/' immediately cancel the trigger.
 */
export function getSlashTriggerInfo(
	docText: string,
	lineFrom: number,
	lineText: number | string,
	cursorPos: number,
): SlashTriggerInfo | null {
	const text = typeof lineText === 'string' ? lineText : '';
	const offsetInLine = cursorPos - lineFrom;
	if (offsetInLine < 0 || offsetInLine > text.length) return null;

	const textBefore = text.slice(0, offsetInLine);

	// Match: start of line, optional indentation, then '/', then 0 or more non-whitespace characters
	const match = textBefore.match(/^([ \t]*)\/([^\s]*)$/);
	if (!match) {
		return null;
	}

	const indent = match[1] ?? '';
	const query = match[2] ?? '';
	const slashPos = lineFrom + indent.length;

	if (isProtectedContext(docText, textBefore, cursorPos)) {
		return null;
	}

	return {
		from: slashPos,
		to: cursorPos,
		query,
		indent,
	};
}
