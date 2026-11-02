import { parseMultiColumnMarkdown } from '../columns/parser';

export type DropZone = 'before' | 'after' | 'left' | 'right';

export type MovableBlockKind =
	| 'paragraph'
	| 'heading'
	| 'list'
	| 'quote'
	| 'hr'
	| 'code'
	| 'table'
	| 'math'
	| 'media'
	| 'tabs';

export type UnsupportedReason =
	| 'frontmatter'
	| 'math'
	| 'table'
	| 'image'
	| 'html';

export interface RootBlockLocation {
	scope: 'root';
	blockIndex: number;
}

export interface ColumnBlockLocation {
	scope: 'column';
	parentBlockIndex: number;
	colIndex: number;
	innerBlockIndex: number;
}

export type BlockLocation = RootBlockLocation | ColumnBlockLocation;

export interface MovableBlock {
	id: string;
	kind: MovableBlockKind;
	headingLevel?: number;
	location: BlockLocation;
	/** 0-based start line in the containing document (parent doc for root, column doc for column) */
	fromLine: number;
	/** 0-based end line (inclusive) in the containing document */
	toLine: number;
	/** Character start offset in the containing document */
	fromOffset: number;
	/** Character end offset in the containing document */
	toOffset: number;
	/** Raw Markdown text of this block (without trailing newline) */
	markdown: string;
}

export interface UnsupportedBlock {
	id: string;
	kind: 'unsupported';
	reason: UnsupportedReason;
	location: BlockLocation;
	fromLine: number;
	toLine: number;
	fromOffset: number;
	toOffset: number;
	markdown: string;
}

export type InnerColumnBlock = MovableBlock | UnsupportedBlock;

export interface MultiColumnContainerBlock {
	id: string;
	kind: 'multi-column';
	location: RootBlockLocation;
	/** 0-based index among multi-column widgets in the document */
	multiColumnWidgetIndex: number;
	fromLine: number;
	toLine: number;
	fromOffset: number;
	toOffset: number;
	markdown: string;
	ratios: number[];
	colTag: 'col' | 'column';
	/** Array of inner block arrays for each column (length >= 2) */
	columns: InnerColumnBlock[][];
	/** Backwards-compatible references to the first two columns */
	col1Blocks: InnerColumnBlock[];
	col2Blocks: InnerColumnBlock[];
}

export type DocumentBlock = MovableBlock | UnsupportedBlock | MultiColumnContainerBlock;

interface LineInfo {
	index: number;
	text: string;
	from: number;
	to: number;
}

function computeLines(docText: string): LineInfo[] {
	const rawLines = docText.split('\n');
	const result: LineInfo[] = [];
	let offset = 0;
	for (let i = 0; i < rawLines.length; i++) {
		const text = rawLines[i] ?? '';
		const from = offset;
		const to = offset + text.length;
		result.push({ index: i, text, from, to });
		offset = to + 1;
	}
	return result;
}

function isHorizontalRuleLine(trimmed: string): boolean {
	return /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed);
}

function isListItemLine(rawText: string): boolean {
	return /^\s*(?:[-*+]|\d+\.)\s+/.test(rawText);
}

function isQuoteOrCalloutLine(rawText: string): boolean {
	return /^\s*>/.test(rawText);
}

function isStandaloneMediaLine(trimmed: string): boolean {
	return /^!\[[^\]]*\]\([^)]+\)\s*$/.test(trimmed) || /^!\[\[[^\]]+\]\]\s*$/.test(trimmed);
}

/**
 * Checks whether a single non-empty line is a standalone unsupported line type.
 */
function classifySingleLineUnsupported(trimmed: string): UnsupportedReason | null {
	// Block-level raw HTML tags (not inline Inkwell <span> or <u>)
	if (
		/^<(?:div|table|thead|tbody|tr|td|pre|iframe|svg|img|video|audio|blockquote|ul|ol|li|hr|section|article|aside|details|summary)\b/i.test(
			trimmed,
		)
	) {
		return 'html';
	}
	return null;
}

/**
 * Segments a column's local Markdown text into inner blocks:
 * Movable complete units (Paragraph, Heading H1-H6, Complete List, Quote/Callout/Toggle, HR, Code Block, Math, Table, Media)
 * or Unsupported (Raw HTML).
 */
export function parseColumnInnerBlocks(
	colText: string,
	parentBlockIndex: number,
	colIndex: number,
): InnerColumnBlock[] {
	const lines = computeLines(colText);
	const blocks: InnerColumnBlock[] = [];
	let i = 0;

	const nextId = () => `col-${parentBlockIndex}-${colIndex}-b${blocks.length}`;

	while (i < lines.length) {
		const line = lines[i]!;
		const trimmed = line.text.trim();

		// Skip blank separator lines
		if (trimmed.length === 0) {
			i++;
			continue;
		}

		// 1. Fenced code block (``` or ~~~) -> Movable complete code block unit
		const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
		if (fenceMatch && fenceMatch[1]) {
			const fence = fenceMatch[1];
			const startLine = i;
			i++;
			while (i < lines.length && !lines[i]!.text.trim().startsWith(fence)) {
				i++;
			}
			if (i < lines.length) i++;
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextId(),
				kind: 'code',
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: colText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 2. Math block ($$) -> Movable complete math block unit
		if (trimmed.startsWith('$$')) {
			const startLine = i;
			if (trimmed === '$$' || !trimmed.slice(2).includes('$$')) {
				i++;
				while (i < lines.length && !lines[i]!.text.trim().includes('$$')) {
					i++;
				}
				if (i < lines.length) i++;
			} else {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextId(),
				kind: 'math',
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: colText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 2b. Markdown table -> Movable complete table block unit
		const isColTableStart =
			/^\|/.test(trimmed) ||
			(trimmed.includes('|') &&
				i + 1 < lines.length &&
				/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1]!.text));
		if (isColTableStart) {
			const startLine = i;
			i++;
			while (i < lines.length && lines[i]!.text.trim().includes('|')) {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextId(),
				kind: 'table',
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: colText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 2c. Standalone Media Embed (![[...]] or ![...](...)) -> Movable media block unit
		if (isStandaloneMediaLine(trimmed)) {
			blocks.push({
				id: nextId(),
				kind: 'media',
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: i,
				toLine: i,
				fromOffset: line.from,
				toOffset: line.to,
				markdown: line.text,
			});
			i++;
			continue;
		}

		// 3. Heading H1 to H6 (single-line block)
		const headingMatch = /^(#{1,6})\s*(.*)$/.exec(line.text);
		if (headingMatch && headingMatch[1] && /^#{1,6}(?:\s|$)/.test(line.text)) {
			blocks.push({
				id: nextId(),
				kind: 'heading',
				headingLevel: headingMatch[1].length,
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: i,
				toLine: i,
				fromOffset: line.from,
				toOffset: line.to,
				markdown: line.text,
			});
			i++;
			continue;
		}

		// 4. Horizontal rule (---, ***, ___) -> Movable single-line block
		if (isHorizontalRuleLine(trimmed)) {
			blocks.push({
				id: nextId(),
				kind: 'hr',
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: i,
				toLine: i,
				fromOffset: line.from,
				toOffset: line.to,
				markdown: line.text,
			});
			i++;
			continue;
		}

		// 5. Complete List block (bullet, numbered, or task list including indented items)
		if (isListItemLine(line.text)) {
			const startLine = i;
			i++;
			while (i < lines.length && isListItemLine(lines[i]!.text)) {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextId(),
				kind: 'list',
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: colText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 6. Quote, Callout, or Collapsible Toggle block (> ...)
		if (isQuoteOrCalloutLine(line.text)) {
			const startLine = i;
			i++;
			while (i < lines.length && isQuoteOrCalloutLine(lines[i]!.text)) {
				if (/^\s*>\s*\[!/.test(lines[i]!.text)) {
					break;
				}
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextId(),
				kind: 'quote',
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: colText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 7. Unsupported structures (tables, standalone images, block html)
		const unsupportedReason = classifySingleLineUnsupported(trimmed);
		if (unsupportedReason) {
			const startLine = i;
			i++;
			while (i < lines.length) {
				const nextTrimmed = lines[i]!.text.trim();
				if (nextTrimmed.length === 0) break;
				const nextReason = classifySingleLineUnsupported(nextTrimmed);
				if (nextReason === unsupportedReason) {
					i++;
				} else {
					break;
				}
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextId(),
				kind: 'unsupported',
				reason: unsupportedReason,
				location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: colText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 8. Paragraph block: one or more consecutive plain-text lines
		const startLine = i;
		i++;
		while (i < lines.length) {
			const nextLine = lines[i]!;
			const nextTrimmed = nextLine.text.trim();
			if (nextTrimmed.length === 0) break;
			if (/^#{1,6}(?:\s|$)/.test(nextLine.text)) break;
			if (/^(`{3,}|~{3,})/.test(nextTrimmed)) break;
			if (nextTrimmed.startsWith('$$')) break;
			if (isHorizontalRuleLine(nextTrimmed)) break;
			if (isListItemLine(nextLine.text)) break;
			if (isQuoteOrCalloutLine(nextLine.text)) break;
			if (isStandaloneMediaLine(nextTrimmed)) break;
			if (classifySingleLineUnsupported(nextTrimmed) !== null) break;
			if (
				nextTrimmed.includes('|') &&
				i + 1 < lines.length &&
				/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1]!.text)
			) {
				break;
			}
			i++;
		}
		const endLine = i - 1;
		const fromOffset = lines[startLine]!.from;
		const toOffset = lines[endLine]!.to;
		blocks.push({
			id: nextId(),
			kind: 'paragraph',
			location: { scope: 'column', parentBlockIndex, colIndex, innerBlockIndex: blocks.length },
			fromLine: startLine,
			toLine: endLine,
			fromOffset,
			toOffset,
			markdown: colText.slice(fromOffset, toOffset),
		});
	}

	return blocks;
}

/**
 * Segments a full Obsidian Markdown document into top-level blocks:
 * Movable complete units (Paragraph, Heading H1-H6, Complete List, Quote/Callout/Toggle, HR, Code Block, Math, Table, Media),
 * MultiColumnContainer with parsed inner column blocks, or Unsupported.
 */
export function parseDocumentBlocks(docText: string): DocumentBlock[] {
	const lines = computeLines(docText);
	const blocks: DocumentBlock[] = [];
	let i = 0;
	let multiColWidgetIdx = 0;

	const nextRootId = () => `root-b${blocks.length}`;

	// 0. Check YAML frontmatter at line 0
	if (lines.length > 0 && lines[0]!.text.trim() === '---') {
		let endFm = 1;
		while (
			endFm < lines.length &&
			lines[endFm]!.text.trim() !== '---' &&
			lines[endFm]!.text.trim() !== '...'
		) {
			endFm++;
		}
		if (endFm < lines.length) {
			const toOffset = lines[endFm]!.to;
			blocks.push({
				id: nextRootId(),
				kind: 'unsupported',
				reason: 'frontmatter',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: 0,
				toLine: endFm,
				fromOffset: 0,
				toOffset,
				markdown: docText.slice(0, toOffset),
			});
			i = endFm + 1;
		}
	}

	while (i < lines.length) {
		const line = lines[i]!;
		const trimmed = line.text.trim();

		// Skip blank lines
		if (trimmed.length === 0) {
			i++;
			continue;
		}

		// 1. Multi-column container block: > [!multi-column...] or > [!columns...]
		if (/^\s*>\s*\[!(?:multi-column|columns)(?:\|.*)?\]/i.test(line.text)) {
			const startLine = i;
			i++;
			while (i < lines.length && /^\s*>/.test(lines[i]!.text)) {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			const rawMd = docText.slice(fromOffset, toOffset);
			const parsed = parseMultiColumnMarkdown(rawMd);
			const blockIndex = blocks.length;

			const rawSlices = parsed.columns ?? [
				{ blocks: parsed.col1, text: parsed.col1Text ?? '', map: parsed.col1Map ?? [] },
				{ blocks: parsed.col2, text: parsed.col2Text ?? '', map: parsed.col2Map ?? [] },
			];
			const columns: InnerColumnBlock[][] = rawSlices.map((slice, cIdx) =>
				parseColumnInnerBlocks(slice.text ?? '', blockIndex, cIdx),
			);

			blocks.push({
				id: nextRootId(),
				kind: 'multi-column',
				location: { scope: 'root', blockIndex },
				multiColumnWidgetIndex: multiColWidgetIdx++,
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: rawMd,
				ratios: parsed.ratios,
				colTag: parsed.colTag ?? 'col',
				columns,
				col1Blocks: columns[0] ?? [],
				col2Blocks: columns[1] ?? [],
			});
			continue;
		}

		// 1b. Tabs container block: > [!tabs...] -> Movable complete tabs block unit
		if (/^\s*>\s*\[!tabs(?:\|.*)?\]/i.test(line.text)) {
			const startLine = i;
			i++;
			while (i < lines.length && /^\s*>/.test(lines[i]!.text)) {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			const rawMd = docText.slice(fromOffset, toOffset);

			blocks.push({
				id: nextRootId(),
				kind: 'tabs',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: rawMd,
			});
			continue;
		}

		// 2. Fenced code block (``` or ~~~) -> Movable complete code block unit
		const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
		if (fenceMatch && fenceMatch[1]) {
			const fence = fenceMatch[1];
			const startLine = i;
			i++;
			while (i < lines.length && !lines[i]!.text.trim().startsWith(fence)) {
				i++;
			}
			if (i < lines.length) i++;
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextRootId(),
				kind: 'code',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: docText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 3. Math block ($$) -> Movable complete math block unit
		if (trimmed.startsWith('$$')) {
			const startLine = i;
			if (trimmed === '$$' || !trimmed.slice(2).includes('$$')) {
				i++;
				while (i < lines.length && !lines[i]!.text.trim().includes('$$')) {
					i++;
				}
				if (i < lines.length) i++;
			} else {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextRootId(),
				kind: 'math',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: docText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 4. Markdown table -> Movable complete table block unit
		const isTableStart =
			/^\|/.test(trimmed) ||
			(trimmed.includes('|') &&
				i + 1 < lines.length &&
				/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1]!.text));
		if (isTableStart) {
			const startLine = i;
			i++;
			while (i < lines.length && lines[i]!.text.trim().includes('|')) {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextRootId(),
				kind: 'table',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: docText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 4b. Standalone Media Embed (![[...]] or ![...](...)) -> Movable media block unit
		if (isStandaloneMediaLine(trimmed)) {
			blocks.push({
				id: nextRootId(),
				kind: 'media',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: i,
				toLine: i,
				fromOffset: line.from,
				toOffset: line.to,
				markdown: line.text,
			});
			i++;
			continue;
		}

		// 5. Heading H1 to H6 (always a single-line distinct block)
		const headingMatch = /^(#{1,6})\s*(.*)$/.exec(line.text);
		if (headingMatch && headingMatch[1] && /^#{1,6}(?:\s|$)/.test(line.text)) {
			blocks.push({
				id: nextRootId(),
				kind: 'heading',
				headingLevel: headingMatch[1].length,
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: i,
				toLine: i,
				fromOffset: line.from,
				toOffset: line.to,
				markdown: line.text,
			});
			i++;
			continue;
		}

		// 6. Horizontal Rule (---, ***, ___) -> Movable single-line block
		if (isHorizontalRuleLine(trimmed)) {
			blocks.push({
				id: nextRootId(),
				kind: 'hr',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: i,
				toLine: i,
				fromOffset: line.from,
				toOffset: line.to,
				markdown: line.text,
			});
			i++;
			continue;
		}

		// 7. Complete List block (bullet, numbered, or task list) -> Movable complete unit
		if (isListItemLine(line.text)) {
			const startLine = i;
			i++;
			while (i < lines.length && isListItemLine(lines[i]!.text)) {
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextRootId(),
				kind: 'list',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: docText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 8. Quote, Callout, or Collapsible Toggle block (> ...) -> Movable complete unit
		if (isQuoteOrCalloutLine(line.text)) {
			const startLine = i;
			i++;
			while (i < lines.length && isQuoteOrCalloutLine(lines[i]!.text)) {
				if (/^\s*>\s*\[!/.test(lines[i]!.text)) {
					break;
				}
				i++;
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextRootId(),
				kind: 'quote',
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: docText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 9. Other unsupported structures (block html)
		const unsupportedReason = classifySingleLineUnsupported(trimmed);
		if (unsupportedReason) {
			const startLine = i;
			i++;
			while (i < lines.length) {
				const nextTrimmed = lines[i]!.text.trim();
				if (nextTrimmed.length === 0) break;
				if (/^\s*>\s*\[!(?:multi-column|columns|tabs)/i.test(lines[i]!.text)) break;
				const nextReason = classifySingleLineUnsupported(nextTrimmed);
				if (nextReason === unsupportedReason) {
					i++;
				} else {
					break;
				}
			}
			const endLine = i - 1;
			const fromOffset = lines[startLine]!.from;
			const toOffset = lines[endLine]!.to;
			blocks.push({
				id: nextRootId(),
				kind: 'unsupported',
				reason: unsupportedReason,
				location: { scope: 'root', blockIndex: blocks.length },
				fromLine: startLine,
				toLine: endLine,
				fromOffset,
				toOffset,
				markdown: docText.slice(fromOffset, toOffset),
			});
			continue;
		}

		// 10. Paragraph block: one or more consecutive plain-text lines
		const startLine = i;
		i++;
		while (i < lines.length) {
			const nextLine = lines[i]!;
			const nextTrimmed = nextLine.text.trim();
			if (nextTrimmed.length === 0) break;
			if (/^#{1,6}(?:\s|$)/.test(nextLine.text)) break;
			if (/^\s*>\s*\[!(?:multi-column|columns|tabs)/i.test(nextLine.text)) break;
			if (/^(`{3,}|~{3,})/.test(nextTrimmed)) break;
			if (nextTrimmed.startsWith('$$')) break;
			if (isHorizontalRuleLine(nextTrimmed)) break;
			if (isListItemLine(nextLine.text)) break;
			if (isQuoteOrCalloutLine(nextLine.text)) break;
			if (isStandaloneMediaLine(nextTrimmed)) break;
			if (classifySingleLineUnsupported(nextTrimmed) !== null) break;
			if (
				nextTrimmed.includes('|') &&
				i + 1 < lines.length &&
				/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1]!.text)
			) {
				break;
			}
			i++;
		}
		const endLine = i - 1;
		const fromOffset = lines[startLine]!.from;
		const toOffset = lines[endLine]!.to;
		blocks.push({
			id: nextRootId(),
			kind: 'paragraph',
			location: { scope: 'root', blockIndex: blocks.length },
			fromLine: startLine,
			toLine: endLine,
			fromOffset,
			toOffset,
			markdown: docText.slice(fromOffset, toOffset),
		});
	}

	return blocks;
}

/**
 * Finds a block (either top-level or inside a column) by its unique ID.
 */
export function findBlockById(
	blocks: DocumentBlock[],
	id: string,
): { block: DocumentBlock | InnerColumnBlock; parentMultiCol?: MultiColumnContainerBlock } | null {
	for (const b of blocks) {
		if (b.id === id) {
			return { block: b };
		}
		if (b.kind === 'multi-column') {
			for (const col of b.columns) {
				for (const cb of col) {
					if (cb.id === id) return { block: cb, parentMultiCol: b };
				}
			}
		}
	}
	return null;
}

/**
 * Checks whether a block is a movable block unit.
 */
export function isMovableBlock(b: DocumentBlock | InnerColumnBlock): b is MovableBlock {
	return (
		b.kind === 'paragraph' ||
		b.kind === 'heading' ||
		b.kind === 'list' ||
		b.kind === 'quote' ||
		b.kind === 'hr' ||
		b.kind === 'code' ||
		b.kind === 'table' ||
		b.kind === 'math' ||
		b.kind === 'media' ||
		b.kind === 'tabs'
	);
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv', 'm4v']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac']);

export interface ParsedMarkdownTable {
	headers: string[];
	alignments: Array<'left' | 'center' | 'right' | null>;
	rows: string[][];
}

export function isTableDelimiterLine(lineText: string): boolean {
	const trimmed = lineText.trim();
	if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
	const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
	const cells = inner.split('|');
	if (cells.length === 0) return false;
	return cells.every((c) => /^\s*:?-{2,}:?\s*$/.test(c));
}

function splitTableCells(lineText: string): string[] {
	const trimmed = lineText.trim();
	const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
	const result: string[] = [];
	let current = '';
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i]!;
		if (ch === '\\' && i + 1 < inner.length && inner[i + 1] === '|') {
			current += '|';
			i++;
		} else if (ch === '|') {
			result.push(current.trim());
			current = '';
		} else {
			current += ch;
		}
	}
	result.push(current.trim());
	return result;
}

export function parseMarkdownTable(rawTable: string): ParsedMarkdownTable {
	const lines = rawTable.split('\n').filter((l) => l.trim().length > 0);
	const headerLine = lines[0] ?? '| Colonne 1 | Colonne 2 |';
	const delimLine = lines[1] ?? '| --- | --- |';

	const headers = splitTableCells(headerLine);
	const colCount = Math.max(1, headers.length);

	const delimCells = splitTableCells(delimLine);
	const alignments: Array<'left' | 'center' | 'right' | null> = [];
	for (let c = 0; c < colCount; c++) {
		const d = (delimCells[c] ?? '---').trim();
		if (d.startsWith(':') && d.endsWith(':')) alignments.push('center');
		else if (d.endsWith(':')) alignments.push('right');
		else if (d.startsWith(':')) alignments.push('left');
		else alignments.push(null);
	}

	const rows: string[][] = [];
	for (let r = 2; r < lines.length; r++) {
		const rawCells = splitTableCells(lines[r]!);
		const row: string[] = [];
		for (let c = 0; c < colCount; c++) {
			row.push(rawCells[c] ?? '');
		}
		rows.push(row);
	}

	if (rows.length === 0) {
		rows.push(Array.from({ length: colCount }, () => ''));
	}

	return { headers, alignments, rows };
}

function escapeTableCell(val: string): string {
	return val.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function serializeMarkdownTable(table: ParsedMarkdownTable): string {
	const colCount = Math.max(1, table.headers.length);
	const headerCells = table.headers.map((h) => escapeTableCell(h));
	const headerLine = `| ${headerCells.join(' | ')} |`;

	const delimCells: string[] = [];
	for (let c = 0; c < colCount; c++) {
		const align = table.alignments[c] ?? null;
		if (align === 'center') delimCells.push(':---:');
		else if (align === 'right') delimCells.push('---:');
		else if (align === 'left') delimCells.push(':---');
		else delimCells.push('---');
	}
	const delimLine = `| ${delimCells.join(' | ')} |`;

	const bodyLines = table.rows.map((row) => {
		const cells: string[] = [];
		for (let c = 0; c < colCount; c++) {
			cells.push(escapeTableCell(row[c] ?? ''));
		}
		return `| ${cells.join(' | ')} |`;
	});

	return [headerLine, delimLine, ...bodyLines].join('\n');
}

export interface ParsedMediaEmbed {
	raw: string;
	target: string;
	aliasOrSize: string;
	kind: 'image' | 'video' | 'audio' | 'file';
}

export function parseStandaloneMediaEmbedLine(lineText: string): ParsedMediaEmbed | null {
	const trimmed = lineText.trim();
	const wikiMatch = /^!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(trimmed);
	if (wikiMatch && wikiMatch[1]) {
		const target = wikiMatch[1].trim();
		const aliasOrSize = (wikiMatch[2] ?? '').trim();
		const ext = (target.split('.').pop() ?? '').toLowerCase();
		let kind: ParsedMediaEmbed['kind'] = 'file';
		if (IMAGE_EXTS.has(ext)) kind = 'image';
		else if (VIDEO_EXTS.has(ext)) kind = 'video';
		else if (AUDIO_EXTS.has(ext)) kind = 'audio';
		return { raw: trimmed, target, aliasOrSize, kind };
	}

	const mdMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
	if (mdMatch && mdMatch[2]) {
		const target = mdMatch[2].trim();
		const aliasOrSize = (mdMatch[1] ?? '').trim();
		const ext = (target.split('.').pop() ?? '').toLowerCase();
		let kind: ParsedMediaEmbed['kind'] = 'image';
		if (VIDEO_EXTS.has(ext)) kind = 'video';
		else if (AUDIO_EXTS.has(ext)) kind = 'audio';
		else if (!IMAGE_EXTS.has(ext) && !target.startsWith('http') && !target.startsWith('data:')) {
			kind = 'file';
		}
		return { raw: trimmed, target, aliasOrSize, kind };
	}

	return null;
}

