import type { ColumnLineMapEntry } from '../columns/parser';

export interface TabSlice {
	/** Title of the tab displayed in the tab bar */
	title: string;
	/** Raw multiline Markdown text contained inside this tab */
	text: string;
	/** Line-by-line source map back to the parent tab block */
	map: ColumnLineMapEntry[];
}

export interface ParsedTabsData {
	rawMarkdown: string;
	tabs: TabSlice[];
}

const TABS_HEADER_REGEX = /^\s*>\s*\[!tabs(?:\|([^\]]*))?\]/i;
const TAB_SUBHEADER_REGEX = /^\s*>\s*>\s*\[!tab(?:\|([^\]]*))?\](?:[ \t]+(.*))?$/i;

/**
 * Checks whether a line starts a tabbed block container (`> [!tabs]`).
 */
export function isTabsHeaderLine(lineText: string): boolean {
	return TABS_HEADER_REGEX.test(lineText);
}

/**
 * Checks whether a line starts an individual tab (`> > [!tab|Title]` or `> > [!tab] Title`).
 */
export function isTabSubheaderLine(
	lineText: string,
): { isTab: boolean; title: string } {
	const match = TAB_SUBHEADER_REGEX.exec(lineText);
	if (!match) {
		return { isTab: false, title: '' };
	}
	const pipeTitle = (match[1] ?? '').trim();
	const spaceTitle = (match[2] ?? '').trim();
	const title = spaceTitle || pipeTitle || 'Onglet';
	return { isTab: true, title };
}

/**
 * Cleans and sanitizes a tab title so it fits on a single callout header line.
 * Preserves accents, quotes, punctuation, brackets, pipes, and special characters.
 */
export function sanitizeTabTitle(title: string): string {
	const sanitized = title
		.replace(/[\r\n]+/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.trim();
	return sanitized || 'Onglet';
}

/**
 * Parses raw multi-line Markdown of a `> [!tabs]` block into individual tab slices.
 */
export function parseTabsMarkdown(rawMarkdown: string): ParsedTabsData {
	const rawLines = rawMarkdown.split('\n');
	if (rawLines.length === 0 || !isTabsHeaderLine(rawLines[0]!)) {
		return { rawMarkdown, tabs: [] };
	}

	let lineOffset = 0;
	const tabDrafts: {
		title: string;
		bodyLines: string[];
		map: ColumnLineMapEntry[];
	}[] = [];

	let currentTab: {
		title: string;
		bodyLines: string[];
		map: ColumnLineMapEntry[];
	} | null = null;

	for (let i = 0; i < rawLines.length; i++) {
		const rawLine = rawLines[i]!;
		const currentLineOffset = lineOffset;
		lineOffset += rawLine.length + 1; // +1 for '\n'

		if (i === 0) {
			// Container header line `> [!tabs]`
			continue;
		}

		// Check if this line is an individual tab header: `> > [!tab|Title]`
		const subHeader = isTabSubheaderLine(rawLine);
		if (subHeader.isTab) {
			currentTab = {
				title: subHeader.title,
				bodyLines: [],
				map: [],
			};
			tabDrafts.push(currentTab);
			continue;
		}

		// If no tab opened yet, skip preamble lines (e.g. `>` right after container header)
		if (!currentTab) {
			continue;
		}

		// Level-1 separator line (only a single '>' with optional whitespace): separates tabs
		if (/^\s*>\s*$/.test(rawLine)) {
			continue;
		}

		// Check for line prefix inside a tab: `> > ` or `>> ` or `> >` or `>>`
		const prefixMatch = /^(\s*>\s*>\s?)(.*)$/.exec(rawLine);
		if (prefixMatch) {
			const prefix = prefixMatch[1]!;
			const content = prefixMatch[2]!;
			const localLineIndex = currentTab.bodyLines.length;

			currentTab.map.push({
				localLine: localLineIndex,
				blockRelativeLine: i,
				lineOffsetInBlock: currentLineOffset,
				prefixLength: prefix.length,
				contentLength: content.length,
			});
			currentTab.bodyLines.push(content);
		}
	}

	// Guarantee at least two default tabs if none parsed
	if (tabDrafts.length === 0) {
		return {
			rawMarkdown,
			tabs: [
				{ title: 'Onglet 1', text: '', map: [] },
				{ title: 'Onglet 2', text: '', map: [] },
			],
		};
	}

	const tabs: TabSlice[] = tabDrafts.map((d) => ({
		title: d.title,
		text: d.bodyLines.join('\n'),
		map: d.map,
	}));

	return {
		rawMarkdown,
		tabs,
	};
}

/**
 * Serializes tab slices into standard Markdown `> [!tabs]` callout block.
 */
export function serializeTabsMarkdown(
	tabs: { title: string; text?: string }[],
): string {
	const safeTabs = tabs.length > 0 ? tabs : [
		{ title: 'Onglet 1', text: '' },
		{ title: 'Onglet 2', text: '' },
	];

	const lines: string[] = ['> [!tabs]', '>'];

	for (let t = 0; t < safeTabs.length; t++) {
		const tab = safeTabs[t]!;
		const safeTitle = sanitizeTabTitle(tab.title);
		lines.push(`> > [!tab] ${safeTitle}`);

		const bodyText = tab.text ?? '';
		const bodyLines = bodyText.split('\n');

		for (const bLine of bodyLines) {
			if (bLine.length > 0) {
				lines.push(`> > ${bLine}`);
			} else {
				lines.push('> > ');
			}
		}

		if (t < safeTabs.length - 1) {
			lines.push('>');
		}
	}

	return lines.join('\n');
}

/**
 * Adds a new tab with an optional title.
 */
export function addTab(
	tabs: { title: string; text?: string }[],
	newTitle?: string,
): { title: string; text: string }[] {
	const nextNum = tabs.length + 1;
	const title = newTitle?.trim() || `Onglet ${nextNum}`;
	return [
		...tabs.map((t) => ({ title: t.title, text: t.text ?? '' })),
		{ title: sanitizeTabTitle(title), text: '' },
	];
}

/**
 * Renames a tab by index.
 */
export function renameTab(
	tabs: { title: string; text?: string }[],
	index: number,
	newTitle: string,
): { title: string; text: string }[] {
	if (index < 0 || index >= tabs.length) {
		return tabs.map((t) => ({ title: t.title, text: t.text ?? '' }));
	}
	const safeTitle = sanitizeTabTitle(newTitle);
	return tabs.map((t, i) =>
		i === index
			? { title: safeTitle, text: t.text ?? '' }
			: { title: t.title, text: t.text ?? '' },
	);
}

/**
 * Reorders tabs by moving a tab from one index to another.
 */
export function reorderTab(
	tabs: { title: string; text?: string }[],
	fromIndex: number,
	toIndex: number,
): { title: string; text: string }[] {
	if (
		fromIndex < 0 ||
		fromIndex >= tabs.length ||
		toIndex < 0 ||
		toIndex >= tabs.length ||
		fromIndex === toIndex
	) {
		return tabs.map((t) => ({ title: t.title, text: t.text ?? '' }));
	}
	const result = tabs.map((t) => ({ title: t.title, text: t.text ?? '' }));
	const [moved] = result.splice(fromIndex, 1);
	if (moved) {
		result.splice(toIndex, 0, moved);
	}
	return result;
}

/**
 * Deletes a tab by index.
 */
export function deleteTab(
	tabs: { title: string; text?: string }[],
	index: number,
): { title: string; text: string }[] {
	if (index < 0 || index >= tabs.length) {
		return tabs.map((t) => ({ title: t.title, text: t.text ?? '' }));
	}
	const result = tabs.map((t) => ({ title: t.title, text: t.text ?? '' }));
	result.splice(index, 1);
	return result;
}
