import { ColumnLineMapEntry } from '../columns/parser';

export type CalloutFoldMode = 'none' | 'collapsed' | 'expanded';

export interface SingleCalloutData {
	calloutType: string;
	foldMode: CalloutFoldMode;
	title: string;
	bodyText: string;
	bodyMap: ColumnLineMapEntry[];
}

const CALLOUT_HEADER_REGEX = /^(\s*>\s*)\[!([a-zA-Z0-9_-]+)(?:\|[^\]]*)?\]([+-])?(?:[ \t]+(.*))?$/;

/**
 * Checks whether a line starts a single-container callout (excluding multi-column / columns).
 */
export function isSingleCalloutHeaderLine(lineText: string): boolean {
	const m = CALLOUT_HEADER_REGEX.exec(lineText);
	if (!m || !m[2]) return false;
	const typeLower = m[2].toLowerCase();
	return typeLower !== 'multi-column' && typeLower !== 'columns';
}

/**
 * Parses a single-level Obsidian callout or collapsible callout (`> [!NOTE]...` or `> [!NOTE]- ...`)
 * into structured metadata, body text without `>` prefixes, and an exact line-by-line offset map.
 */
export function parseSingleCalloutMarkdown(rawMarkdown: string): SingleCalloutData {
	const lines = rawMarkdown.split('\n');
	const firstLine = lines[0] ?? '';
	const headerMatch = CALLOUT_HEADER_REGEX.exec(firstLine);

	const calloutType = headerMatch?.[2] ?? 'NOTE';
	const foldSymbol = headerMatch?.[3] ?? '';
	const foldMode: CalloutFoldMode =
		foldSymbol === '-' ? 'collapsed' : foldSymbol === '+' ? 'expanded' : 'none';
	const title = headerMatch?.[4] ?? '';

	const bodyLines: string[] = [];
	const bodyMap: ColumnLineMapEntry[] = [];
	let charOffset = firstLine.length + 1;

	for (let i = 1; i < lines.length; i++) {
		const rawLine = lines[i] ?? '';
		const lineOffsetInBlock = charOffset;
		charOffset += rawLine.length + 1;

		const match = /^(\s*>\s?)(.*)$/.exec(rawLine);
		if (match) {
			const prefix = match[1] ?? '';
			const content = match[2] ?? '';
			bodyLines.push(content);
			bodyMap.push({
				localLine: bodyLines.length - 1,
				blockRelativeLine: i,
				lineOffsetInBlock,
				prefixLength: prefix.length,
				contentLength: content.length,
			});
		}
	}

	if (bodyLines.length === 0) {
		bodyLines.push('');
	}

	return {
		calloutType,
		foldMode,
		title,
		bodyText: bodyLines.join('\n'),
		bodyMap,
	};
}

/**
 * Serializes a single-level callout or collapsible toggle back to standard Obsidian callout Markdown.
 */
export function serializeSingleCalloutMarkdown(data: SingleCalloutData): string {
	const foldSuffix =
		data.foldMode === 'collapsed' ? '-' : data.foldMode === 'expanded' ? '+' : '';
	const trimmedTitle = data.title.trim();
	const titleSuffix = trimmedTitle.length > 0 ? ` ${data.title}` : '';
	const headerLine = `> [!${data.calloutType}]${foldSuffix}${titleSuffix}`;

	const rawBodyLines = data.bodyText.split('\n');
	const serializedBody = rawBodyLines.map((l) => (l.length > 0 ? `> ${l}` : '> '));

	return [headerLine, ...serializedBody].join('\n');
}

