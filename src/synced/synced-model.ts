export interface SyncedBlockReference {
	/** Starting character position of the callout in the document */
	from: number;
	/** Ending character position of the callout in the document */
	to: number;
	/** Title of the synced block displayed in header */
	title: string;
	/** Optional persistent sync ID from callout metadata (e.g. `id:sync-123`) */
	syncId?: string;
	/** Target file link path from the transclusion link, e.g. `_synced/Note de cadrage.md` */
	targetPath: string;
	/** Full raw Markdown lines of the synced block reference */
	rawMarkdown: string;
}

export interface ParsedSourceContent {
	/** Persistent sync ID extracted from YAML frontmatter if present */
	syncId: string | null;
	/** Body text of the source note without the frontmatter block */
	body: string;
}

const SYNCED_HEADER_REGEX = /^\s*>\s*\[!synced(?:\|([^\]]*))?\](?:[ \t]+(.*))?$/i;
const EMBED_LINE_REGEX = /^\s*>\s*!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]\s*$/;

/**
 * Checks whether a line starts a synced block callout (`> [!synced]`).
 */
export function isSyncedHeaderLine(lineText: string): boolean {
	return SYNCED_HEADER_REGEX.test(lineText);
}

/**
 * Parses a synced callout header line.
 */
export function parseSyncedHeader(lineText: string): {
	isSynced: boolean;
	title: string;
	syncId?: string;
} {
	const match = SYNCED_HEADER_REGEX.exec(lineText);
	if (!match) {
		return { isSynced: false, title: '' };
	}
	const metaStr = (match[1] ?? '').trim();
	const title = (match[2] ?? '').trim();

	let syncId: string | undefined;
	if (metaStr) {
		const idMatch = /(?:^|[,;])\s*id:([a-zA-Z0-9_-]+)/i.exec(metaStr);
		if (idMatch && idMatch[1]) {
			syncId = idMatch[1];
		} else if (/^[a-zA-Z0-9_-]+$/.test(metaStr) && !metaStr.includes(':')) {
			syncId = metaStr;
		}
	}

	return {
		isSynced: true,
		title: title || 'Bloc synchronisé',
		syncId,
	};
}

/**
 * Extracts the target path from an inner embed line (`> ![[_synced/Note.md]]`).
 */
export function parseSyncedEmbedLine(lineText: string): string | null {
	const match = EMBED_LINE_REGEX.exec(lineText);
	if (!match || !match[1]) {
		return null;
	}
	return match[1].trim();
}

/**
 * Serializes a synced block reference using the confirmed format:
 * ```markdown
 * > [!synced|id:sync-xyz] Titre
 * > ![[_synced/Titre.md]]
 * ```
 */
export function serializeSyncedReference(
	targetPath: string,
	title: string,
	syncId?: string,
): string {
	const cleanTitle = title.replace(/[\r\n]/g, ' ').trim() || 'Bloc synchronisé';
	const meta = syncId ? `|id:${syncId}` : '';
	return `> [!synced${meta}] ${cleanTitle}\n> ![[${targetPath}]]`;
}

/**
 * Separates YAML frontmatter from the Markdown body in a source file.
 */
export function extractSourceContent(rawFileText: string): ParsedSourceContent {
	const trimmed = rawFileText.trimStart();
	if (!trimmed.startsWith('---')) {
		return { syncId: null, body: rawFileText };
	}

	const endIdx = rawFileText.indexOf('\n---', 3);
	if (endIdx === -1) {
		return { syncId: null, body: rawFileText };
	}

	const frontmatterText = rawFileText.slice(0, endIdx + 4);
	const rest = rawFileText.slice(endIdx + 4);
	const body = rest.startsWith('\n') ? rest.slice(1) : rest;

	let syncId: string | null = null;
	const idMatch = /^inkwell-sync-id:\s*([a-zA-Z0-9_-]+)/m.exec(frontmatterText);
	if (idMatch && idMatch[1]) {
		syncId = idMatch[1].trim();
	}

	return { syncId, body };
}

/**
 * Formats a source note with frontmatter if a persistent sync ID exists.
 */
export function formatSourceContent(
	syncId: string | null,
	bodyText: string,
): string {
	if (!syncId) {
		return bodyText;
	}
	const cleanBody = bodyText.replace(/^\n+/, '');
	return `---\ninkwell-sync-id: ${syncId}\n---\n${cleanBody}`;
}

/**
 * Generates a stable, unique sync identifier.
 */
export function generateSyncId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return `sync-${timestamp}-${random}`;
}

/**
 * Scans lines of a callout block to parse a synced block reference.
 */
export function parseSyncedBlockFromLines(
	lines: string[],
	startOffset: number,
): SyncedBlockReference | null {
	if (lines.length === 0) return null;
	const firstLine = lines[0];
	if (!firstLine) return null;
	const headerInfo = parseSyncedHeader(firstLine);
	if (!headerInfo.isSynced) return null;

	let targetPath: string | null = null;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const parsed = parseSyncedEmbedLine(line);
		if (parsed) {
			targetPath = parsed;
			break;
		}
	}

	if (!targetPath) return null;

	const rawMarkdown = lines.join('\n');
	return {
		from: startOffset,
		to: startOffset + rawMarkdown.length,
		title: headerInfo.title,
		syncId: headerInfo.syncId,
		targetPath,
		rawMarkdown,
	};
}

