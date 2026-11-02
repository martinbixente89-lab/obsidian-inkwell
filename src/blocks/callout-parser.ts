import { ColumnLineMapEntry } from '../columns/parser';

export type CalloutFoldMode = 'none' | 'collapsed' | 'expanded';

export interface CalloutCustomStyle {
	bg?: string;
	border?: boolean; // true = border active, false = border off (default: true)
	borderColor?: string;
}

export interface SingleCalloutData {
	calloutType: string;
	foldMode: CalloutFoldMode;
	title: string;
	bodyText: string;
	bodyMap: ColumnLineMapEntry[];
	style?: CalloutCustomStyle;
}

const CALLOUT_HEADER_REGEX =
	/^(\s*>\s*)\[!([a-zA-Z0-9_-]+)([+-])?(?:\|([^\]]*))?\]([+-])?(?:[ \t]+(.*))?$/;

/**
 * Checks whether a line starts a single-container callout (excluding multi-column / columns).
 */
export function isSingleCalloutHeaderLine(lineText: string): boolean {
	const m = CALLOUT_HEADER_REGEX.exec(lineText);
	if (!m || !m[2]) return false;
	const typeLower = m[2].toLowerCase();
	return (
		typeLower !== 'multi-column' &&
		typeLower !== 'columns' &&
		typeLower !== 'tabs'
	);
}

/**
 * Parses individual visual styling metadata formatted as key:value pairs
 * e.g. "bg:#1e293b,border:off,border-color:#3b82f6"
 */
export function parseCalloutMetadata(metaStr?: string): CalloutCustomStyle | undefined {
	if (!metaStr || !metaStr.trim()) return undefined;
	const parts = metaStr.split(/[,;|]/);
	const style: CalloutCustomStyle = {};
	let hasAny = false;

	for (const rawPart of parts) {
		const part = rawPart.trim();
		if (!part) continue;
		const colonIdx = part.indexOf(':');
		if (colonIdx === -1) {
			const lower = part.toLowerCase();
			if (lower === 'noborder' || lower === 'no-border') {
				style.border = false;
				hasAny = true;
			}
			continue;
		}
		const key = part.slice(0, colonIdx).trim().toLowerCase();
		const val = part.slice(colonIdx + 1).trim();
		if (!val) continue;

		if (key === 'bg' || key === 'background') {
			style.bg = val;
			hasAny = true;
		} else if (key === 'border') {
			const lowerVal = val.toLowerCase();
			if (
				lowerVal === 'none' ||
				lowerVal === '0' ||
				lowerVal === 'off' ||
				lowerVal === 'false' ||
				lowerVal === 'no' ||
				lowerVal === 'non'
			) {
				style.border = false;
				hasAny = true;
			} else if (
				lowerVal === 'solid' ||
				lowerVal === '1' ||
				lowerVal === 'on' ||
				lowerVal === 'true' ||
				lowerVal === 'yes' ||
				lowerVal === 'oui'
			) {
				style.border = true;
				hasAny = true;
			}
		} else if (key === 'border-color' || key === 'bordercolor') {
			style.borderColor = val;
			hasAny = true;
		}
	}

	return hasAny ? style : undefined;
}

/**
 * Serializes custom callout styling to standard Obsidian metadata string
 */
export function serializeCalloutMetadata(style?: CalloutCustomStyle): string {
	if (!style) return '';
	const entries: string[] = [];
	if (style.bg && style.bg.trim()) {
		entries.push(`bg:${style.bg.trim()}`);
	}
	if (style.border === false) {
		entries.push('border:off');
	}
	if (style.borderColor && style.borderColor.trim()) {
		entries.push(`border-color:${style.borderColor.trim()}`);
	}
	return entries.join(',');
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
	const foldSymbol = headerMatch?.[3] ?? headerMatch?.[5] ?? '';
	const foldMode: CalloutFoldMode =
		foldSymbol === '-' ? 'collapsed' : foldSymbol === '+' ? 'expanded' : 'none';
	const metaStr = headerMatch?.[4] ?? '';
	const style = parseCalloutMetadata(metaStr);
	const title = headerMatch?.[6] ?? '';

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
		style,
	};
}

/**
 * Serializes a single-level callout or collapsible toggle back to standard Obsidian callout Markdown.
 */
export function serializeSingleCalloutMarkdown(data: SingleCalloutData): string {
	const foldSuffix =
		data.foldMode === 'collapsed' ? '-' : data.foldMode === 'expanded' ? '+' : '';
	const metaStr = serializeCalloutMetadata(data.style);
	const metaSuffix = metaStr ? `|${metaStr}` : '';
	const trimmedTitle = data.title.trim();
	const titleSuffix = trimmedTitle.length > 0 ? ` ${data.title}` : '';
	const headerLine = `> [!${data.calloutType}${metaSuffix}]${foldSuffix}${titleSuffix}`;

	const rawBodyLines = data.bodyText.split('\n');
	const serializedBody = rawBodyLines.map((l) => (l.length > 0 ? `> ${l}` : '> '));

	return [headerLine, ...serializedBody].join('\n');
}
