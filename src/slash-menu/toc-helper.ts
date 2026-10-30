import type { App } from 'obsidian';

export interface HeadingItem {
	heading: string;
	level: number;
	lineNumber?: number;
}

/**
 * Strips inline HTML tags and Markdown emphasis markers for clean visual TOC display.
 */
export function cleanHeadingDisplayText(rawHeading: string): string {
	return rawHeading
		.replace(/<[^>]+>/g, '')
		.replace(/(\*\*|__|~~|\*|_)/g, '')
		.trim();
}

/**
 * Extracts markdown headings directly from in-memory document text, ignoring YAML frontmatter and code blocks.
 */
export function extractHeadingsFromDoc(docText: string): HeadingItem[] {
	const lines = docText.split('\n');
	const headings: HeadingItem[] = [];
	let insideCode = false;
	let startIdx = 0;

	if (lines.length > 0 && lines[0]?.trim() === '---') {
		startIdx = 1;
		while (startIdx < lines.length) {
			const t = lines[startIdx]?.trim() ?? '';
			startIdx++;
			if (t === '---' || t === '...') break;
		}
	}

	for (let i = startIdx; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const trimmed = line.trim();
		if (/^(?:\s*>\s*)*(`{3,}|~{3,})/.test(trimmed)) {
			insideCode = !insideCode;
			continue;
		}
		if (insideCode) continue;

		const match = line.match(/^(?:\s*>\s*)*(?:(#{1,6})\s+(.+))$/);
		if (match && match[1] && match[2]) {
			const headingText = match[2].trim();
			if (!headingText.startsWith('[!')) {
				headings.push({
					level: match[1].length,
					heading: headingText,
					lineNumber: i + 1,
				});
			}
		}
	}
	return headings;
}

/**
 * Builds static Markdown Table of Contents from an array of headings.
 */
export function buildTableOfContentsMarkdown(headings: HeadingItem[]): string {
	if (!headings || headings.length === 0) {
		return '<!-- Table des matières (statique : aucun titre détecté) -->\n';
	}

	const minLevel = Math.min(...headings.map((h) => h.level));
	const lines: string[] = ['<!-- Table des matières (statique) -->'];

	for (const h of headings) {
		const indentSpaces = Math.max(0, (h.level - minLevel) * 2);
		const indent = ' '.repeat(indentSpaces);
		lines.push(`${indent}- [[#${h.heading}]]`);
	}

	return lines.join('\n') + '\n';
}

/**
 * Generates Table of Contents for the active Markdown file or in-memory text.
 */
export function generateActiveNoteToc(app: App, docText?: string): string {
	if (docText) {
		const fromDoc = extractHeadingsFromDoc(docText);
		if (fromDoc.length > 0) {
			return buildTableOfContentsMarkdown(fromDoc);
		}
	}

	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		return '<!-- Table des matières (statique : note non disponible) -->\n';
	}

	const cache = app.metadataCache.getFileCache(activeFile);
	const headings =
		cache?.headings?.map((h) => ({
			heading: h.heading,
			level: h.level,
		})) ?? [];

	return buildTableOfContentsMarkdown(headings);
}
