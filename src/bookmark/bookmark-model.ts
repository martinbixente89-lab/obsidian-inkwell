/**
 * Model and serialization helpers for bookmark cards.
 *
 * Stored as:
 * > [!bookmark] [Titre du site](https://exemple.fr)
 * > Description du lien sur une ou plusieurs lignes.
 */

export interface BookmarkData {
	url: string;
	title: string;
	description: string;
}

/**
 * Escapes unescaped square brackets in a markdown link title.
 */
export function escapeMarkdownTitle(title: string): string {
	return title
		.replace(/\\\[/g, '[')
		.replace(/\\\]/g, ']')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
}

/**
 * Unescapes square brackets in a markdown link title.
 */
export function unescapeMarkdownTitle(title: string): string {
	return title.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
}

/**
 * Escapes parentheses in a URL using percent-encoding (%28, %29)
 * so that standard markdown [title](url) does not break when URLs contain parentheses.
 */
export function escapeMarkdownUrl(url: string): string {
	const trimmed = url.trim();
	return trimmed
		.replace(/\\([()])/g, '$1')
		.replace(/\(/g, '%28')
		.replace(/\)/g, '%29');
}

/**
 * Decodes percent-encoded or backslash-escaped parentheses in a URL for display and editing.
 */
export function unescapeMarkdownUrl(url: string): string {
	return url
		.replace(/%28/gi, '(')
		.replace(/%29/gi, ')')
		.replace(/\\([()])/g, '$1');
}

/**
 * Extracts the domain / host from a URL for compact display.
 */
export function extractDomain(url: string): string {
	try {
		const parsed = new URL(url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`);
		return parsed.hostname.replace(/^www\./i, '');
	} catch {
		const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/:]+)/i);
		return match && match[1] ? match[1] : '';
	}
}

/**
 * Serializes a bookmark data structure into a markdown callout block.
 */
export function serializeBookmark(data: BookmarkData): string {
	const rawTitle = data.title.trim() || data.url.trim() || 'Lien';
	const escapedTitle = escapeMarkdownTitle(rawTitle);
	const escapedUrl = escapeMarkdownUrl(data.url.trim());

	let md = `> [!bookmark] [${escapedTitle}](${escapedUrl})`;

	if (data.description && data.description.trim()) {
		const lines = data.description.trim().split(/\r?\n/);
		for (const line of lines) {
			md += `\n> ${line}`;
		}
	}

	return md;
}

/**
 * Parses a markdown bookmark callout block into structured data.
 */
export function parseBookmark(markdown: string): BookmarkData | null {
	if (!markdown) return null;
	const lines = markdown.split(/\r?\n/);
	if (lines.length === 0) return null;

	const firstLine = lines[0] ?? '';
	const headerMatch = firstLine.match(/^\s*>\s*\[!bookmark\]\s*(.*)$/i);
	if (!headerMatch) return null;

	const linkPart = (headerMatch[1] ?? '').trim();
	if (!linkPart) return null;

	let title = '';
	let url = '';
	let parsedLink = false;

	if (linkPart.startsWith('[')) {
		let i = 1;
		let depth = 1;
		let escaped = false;
		const titleChars: string[] = [];

		while (i < linkPart.length) {
			const char = linkPart[i];
			if (escaped) {
				titleChars.push(char ?? '');
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
				titleChars.push(char);
			} else if (char === '[') {
				depth++;
				titleChars.push(char);
			} else if (char === ']') {
				depth--;
				if (depth === 0) {
					i++;
					break;
				} else {
					titleChars.push(char);
				}
			} else {
				titleChars.push(char ?? '');
			}
			i++;
		}

		title = unescapeMarkdownTitle(titleChars.join(''));

		const remaining = linkPart.slice(i).trim();
		if (remaining.startsWith('(') && remaining.endsWith(')')) {
			const rawUrl = remaining.slice(1, -1);
			url = unescapeMarkdownUrl(rawUrl);
			parsedLink = true;
		}
	}

	if (!parsedLink) {
		const fallback = linkPart.match(/^\[(.*)\]\((.*)\)$/);
		if (fallback && fallback[1] !== undefined && fallback[2] !== undefined) {
			title = unescapeMarkdownTitle(fallback[1]);
			url = unescapeMarkdownUrl(fallback[2]);
			parsedLink = true;
		} else {
			return null;
		}
	}

	const descLines: string[] = [];
	for (let j = 1; j < lines.length; j++) {
		const line = lines[j] ?? '';
		const m = line.match(/^\s*>\s?(.*)$/);
		if (m && m[1] !== undefined) {
			descLines.push(m[1]);
		}
	}

	const description = descLines.join('\n').trim();

	return {
		url,
		title,
		description,
	};
}

/**
 * Converts a bookmark block into a simple standard markdown link [Titre](URL).
 */
export function convertBookmarkToSimpleLink(data: BookmarkData): string {
	const rawTitle = data.title.trim() || data.url.trim() || 'Lien';
	const escapedTitle = escapeMarkdownTitle(rawTitle);
	const escapedUrl = escapeMarkdownUrl(data.url.trim());
	return `[${escapedTitle}](${escapedUrl})`;
}
