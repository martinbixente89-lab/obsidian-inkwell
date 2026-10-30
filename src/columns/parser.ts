export interface ColumnLineMapEntry {
	/** 0-based line index inside the column's local document */
	localLine: number;
	/** 0-based line index relative to the start of the multi-column block in the parent document */
	blockRelativeLine: number;
	/** Character offset of the start of this raw line relative to blockFrom */
	lineOffsetInBlock: number;
	/** Exact character length of the quote prefix on this line (e.g. '> > ' = 4, '> >' = 3, '>> ' = 3) */
	prefixLength: number;
	/** Character length of the line content after stripping the prefix */
	contentLength: number;
}

export interface ColumnSliceData {
	/** Paragraph blocks in this column (split by blank lines, for legacy callers) */
	blocks: string[];
	/** Raw multi-line text inside this column */
	text: string;
	/** Line-by-line source map back to the parent multi-column callout block */
	map: ColumnLineMapEntry[];
}

export interface MultiColumnData {
	/** Percentage ratios for each column, always summing to 100 (length === columns.length) */
	ratios: number[];
	/** Array of N columns (N >= 2) */
	columns?: ColumnSliceData[];
	/** Backwards-compatible properties for 2-column callers */
	col1: string[];
	col2: string[];
	col1Text?: string;
	col2Text?: string;
	col1Map?: ColumnLineMapEntry[];
	col2Map?: ColumnLineMapEntry[];
	colTag?: 'col' | 'column';
}

/** Minimum usable width in pixels for a single column in the editor */
export const MIN_USABLE_COLUMN_WIDTH_PX = 120;
/** Inter-column divider width in pixels in Notion mode */
export const COLUMN_DIVIDER_WIDTH_PX = 36;
/** Minimum percentage ratio per column */
export const MIN_COLUMN_RATIO_PERCENT = 10;

/**
 * Computes balanced integer ratios for `count` columns that sum to exactly 100%.
 * Examples:
 * - 2 -> [50, 50]
 * - 3 -> [34, 33, 33]
 * - 4 -> [25, 25, 25, 25]
 * - 5 -> [20, 20, 20, 20, 20]
 */
export function getBalancedRatios(count: number): number[] {
	const safeCount = Math.max(1, Math.floor(count));
	if (safeCount === 1) return [100];
	const base = Math.floor(100 / safeCount);
	const remainder = 100 - base * safeCount;
	const ratios: number[] = [];
	for (let i = 0; i < safeCount; i++) {
		ratios.push(i < remainder ? base + 1 : base);
	}
	return ratios;
}

/**
 * Normalizes an array of `rawRatios` for `count` columns so that:
 * 1. There are exactly `count` integer ratios.
 * 2. Each ratio is >= `minRatio`.
 * 3. The sum of all ratios is strictly 100%.
 */
export function normalizeRatiosTo100(
	rawRatios: number[],
	count: number,
	minRatio = MIN_COLUMN_RATIO_PERCENT,
): number[] {
	const safeCount = Math.max(1, Math.floor(count));
	if (safeCount === 1) return [100];

	const effectiveMin = Math.min(minRatio, Math.floor(100 / safeCount));
	const sanitized: number[] = [];
	for (let i = 0; i < safeCount; i++) {
		const val = rawRatios[i];
		sanitized.push(
			typeof val === 'number' && !isNaN(val) && val > 0 ? val : 100 / safeCount,
		);
	}

	const totalRaw = sanitized.reduce((acc, v) => acc + v, 0);
	if (totalRaw <= 0) {
		return getBalancedRatios(safeCount);
	}

	const scaled = sanitized.map((v) =>
		Math.max(effectiveMin, Math.round((v / totalRaw) * 100)),
	);
	let diff = 100 - scaled.reduce((acc, v) => acc + v, 0);

	// Adjust largest/smallest elements until sum is strictly 100
	let guard = 0;
	while (diff !== 0 && guard < 200) {
		guard++;
		if (diff > 0) {
			// Add 1 to the column that was rounded down the most or first column
			let bestIdx = 0;
			for (let i = 1; i < safeCount; i++) {
				if ((scaled[i] ?? 0) < (scaled[bestIdx] ?? 0)) {
					bestIdx = i;
				}
			}
			scaled[bestIdx] = (scaled[bestIdx] ?? 0) + 1;
			diff--;
		} else {
			// Subtract 1 from the largest column above effectiveMin
			let largestIdx = -1;
			for (let i = 0; i < safeCount; i++) {
				const cur = scaled[i] ?? 0;
				if (cur > effectiveMin && (largestIdx === -1 || cur > (scaled[largestIdx] ?? 0))) {
					largestIdx = i;
				}
			}
			if (largestIdx === -1) break;
			scaled[largestIdx] = (scaled[largestIdx] ?? 0) - 1;
			diff++;
		}
	}

	return scaled;
}

/**
 * Redistributes column ratios proportionally when one or more empty columns are removed,
 * ensuring the remaining columns preserve their relative proportions and sum to 100%.
 */
export function redistributeRatiosAfterRemoval(
	oldRatios: number[],
	keptIndices: number[],
): number[] {
	if (keptIndices.length === 0) return [];
	if (keptIndices.length === 1) return [100];
	const keptRaw = keptIndices.map((idx) => oldRatios[idx] ?? 100 / keptIndices.length);
	return normalizeRatiosTo100(keptRaw, keptIndices.length);
}

/**
 * Checks whether adding one more column to a group with `currentColCount` columns
 * is possible given the available container width in pixels (`availableWidthPx`).
 */
export function canAddColumnToGroup(
	currentColCount: number,
	availableWidthPx?: number,
): { allowed: boolean; maxColumnsForWidth: number; reason?: string } {
	const nextCount = currentColCount + 1;
	const maxByRatio = Math.floor(100 / MIN_COLUMN_RATIO_PERCENT); // 10 columns max by 10% minimum ratio

	if (typeof availableWidthPx === 'number' && availableWidthPx > 0) {
		const maxForWidth = Math.max(
			2,
			Math.floor(
				(availableWidthPx + COLUMN_DIVIDER_WIDTH_PX) /
					(MIN_USABLE_COLUMN_WIDTH_PX + COLUMN_DIVIDER_WIDTH_PX),
			),
		);
		const effectiveMax = Math.min(maxByRatio, maxForWidth);
		if (nextCount > effectiveMax) {
			return {
				allowed: false,
				maxColumnsForWidth: effectiveMax,
				reason: `Largeur insuffisante pour ${nextCount} colonnes (min. ${MIN_USABLE_COLUMN_WIDTH_PX} px par colonne).`,
			};
		}
		return {
			allowed: true,
			maxColumnsForWidth: effectiveMax,
		};
	}

	if (nextCount > maxByRatio) {
		return {
			allowed: false,
			maxColumnsForWidth: maxByRatio,
			reason: `Nombre maximal de colonnes atteint (${maxByRatio}).`,
		};
	}

	return {
		allowed: true,
		maxColumnsForWidth: maxByRatio,
	};
}

function toBlocks(lines: string[]): string[] {
	const text = lines.join('\n').trim();
	if (!text) return [];
	return text.split(/\n\n+/).filter((b) => b.trim().length > 0);
}

/**
 * Parses a multi-column callout block (2 or more columns) into structured data
 * and exact line-by-line source maps.
 */
export function parseMultiColumnMarkdown(markdown: string): MultiColumnData {
	const lines = markdown.split('\n');
	let headerRatios: number[] = [];
	let detectedColTag: 'col' | 'column' = 'col';

	// 1. Check ratios in outer header: > [!multi-column|40-60] or > [!multi-column|34-33-33]
	const headerMatch = lines[0]?.match(/\[!(?:multi-column|columns)(?:\|([\d-]+))?\]/i);
	if (headerMatch && headerMatch[1]) {
		const parts = headerMatch[1]
			.split('-')
			.map((s) => parseInt(s, 10))
			.filter((n) => !isNaN(n) && n >= 5);
		if (parts.length >= 2) {
			headerRatios = parts;
		}
	}

	interface RawColAccumulator {
		lines: string[];
		map: ColumnLineMapEntry[];
		explicitRatio?: number;
	}

	const rawCols: RawColAccumulator[] = [];
	let currentColIdx = -1;
	let commentRatios: number[] = [];

	let charOffset = (lines[0]?.length ?? 0) + 1;

	for (let i = 1; i < lines.length; i++) {
		const rawLine = lines[i] ?? '';
		const lineOffsetInBlock = charOffset;
		charOffset += rawLine.length + 1;

		// Check for HTML comment ratio metadata: <!-- inkwell-cols: 60,40 --> or <!-- inkwell-cols: 34,33,33 -->
		const commentMatch = rawLine.match(/<!--\s*inkwell-cols:\s*([\d,\s]+)\s*-->/i);
		if (commentMatch && commentMatch[1]) {
			const parts = commentMatch[1]
				.split(',')
				.map((s) => parseInt(s.trim(), 10))
				.filter((n) => !isNaN(n) && n >= 5);
			if (parts.length >= 2) {
				commentRatios = parts;
			}
			continue;
		}

		// Check for column start: '> > [!col|50]', '>> [!col|33]', '> > [!column]', etc.
		const colHeaderMatch = /^(\s*>\s*>\s*)\[!(column|col)(?:\|(\d+))?[^\]]*\]\s*$/i.exec(rawLine);
		if (colHeaderMatch) {
			const tag = (colHeaderMatch[2] ?? 'col').toLowerCase();
			if (tag === 'column') {
				detectedColTag = 'column';
			}
			let explicitRatio: number | undefined;
			if (colHeaderMatch[3]) {
				const parsedRatio = parseInt(colHeaderMatch[3], 10);
				if (!isNaN(parsedRatio) && parsedRatio >= 5 && parsedRatio <= 95) {
					explicitRatio = parsedRatio;
				}
			}
			rawCols.push({
				lines: [],
				map: [],
				explicitRatio,
			});
			currentColIdx = rawCols.length - 1;
			continue;
		}

		// Level-1 separator line (only a single '>' with optional whitespace): separates columns
		if (/^\s*>\s*$/.test(rawLine)) {
			continue;
		}

		// Column content line (two '>' markers: '> > ...' or '>> ...' or '> >')
		const contentMatch = /^(\s*>\s*>\s?)(.*)$/.exec(rawLine);
		if (contentMatch && currentColIdx >= 0) {
			const prefix = contentMatch[1] ?? '';
			const content = contentMatch[2] ?? '';
			const colAcc = rawCols[currentColIdx]!;

			colAcc.lines.push(content);
			colAcc.map.push({
				localLine: colAcc.lines.length - 1,
				blockRelativeLine: i,
				lineOffsetInBlock,
				prefixLength: prefix.length,
				contentLength: content.length,
			});
		}
	}

	// Ensure at least 2 columns for any multi-column callout block
	while (rawCols.length < 2) {
		rawCols.push({ lines: [''], map: [] });
	}

	for (const colAcc of rawCols) {
		if (colAcc.lines.length === 0) {
			colAcc.lines.push('');
		}
	}

	const colCount = rawCols.length;
	let candidateRatios: number[] = [];

	if (rawCols.some((c) => c.explicitRatio !== undefined)) {
		if (colCount === 2) {
			const r1 = rawCols[0]?.explicitRatio;
			const r2 = rawCols[1]?.explicitRatio;
			if (r1 !== undefined && r2 !== undefined) {
				candidateRatios = [r1, r2];
			} else if (r1 !== undefined) {
				candidateRatios = [r1, Math.max(10, 100 - r1)];
			} else if (r2 !== undefined) {
				candidateRatios = [Math.max(10, 100 - r2), r2];
			}
		} else {
			const defaultEach = 100 / colCount;
			candidateRatios = rawCols.map((c) => c.explicitRatio ?? defaultEach);
		}
	} else if (commentRatios.length === colCount) {
		candidateRatios = commentRatios;
	} else if (headerRatios.length === colCount) {
		candidateRatios = headerRatios;
	} else {
		candidateRatios = getBalancedRatios(colCount);
	}

	const ratios = normalizeRatiosTo100(candidateRatios, colCount);

	const columns: ColumnSliceData[] = rawCols.map((c) => ({
		blocks: toBlocks(c.lines),
		text: c.lines.join('\n'),
		map: c.map,
	}));

	return {
		ratios,
		columns,
		col1: columns[0]!.blocks,
		col2: columns[1]!.blocks,
		col1Text: columns[0]!.text,
		col2Text: columns[1]!.text,
		col1Map: columns[0]!.map,
		col2Map: columns[1]!.map,
		colTag: detectedColTag,
	};
}

/**
 * Serializes multi-column data (2 or more columns) back to Obsidian callout Markdown,
 * preserving all lines (including empty lines) and ensuring ratios sum to 100%.
 */
export function serializeMultiColumnMarkdown(data: MultiColumnData): string {
	// Resolve column raw texts from either `data.columns` or legacy `col1Text`/`col2Text`/`col1`/`col2`
	let colTexts: string[];
	if (data.columns && data.columns.length >= 2) {
		colTexts = data.columns.map((c) =>
			c.text !== undefined ? c.text : c.blocks.length > 0 ? c.blocks.join('\n\n') : '',
		);
	} else {
		const col1Raw =
			data.col1Text !== undefined
				? data.col1Text
				: data.col1.length > 0
					? data.col1.join('\n\n')
					: '';
		const col2Raw =
			data.col2Text !== undefined
				? data.col2Text
				: data.col2.length > 0
					? data.col2.join('\n\n')
					: '';
		colTexts = [col1Raw, col2Raw];
	}

	const colCount = colTexts.length;
	const normalizedRatios = normalizeRatiosTo100(data.ratios, colCount);
	const balanced = getBalancedRatios(colCount);
	const isDefaultEqual =
		colCount === 2
			? normalizedRatios[0] === 50 && normalizedRatios[1] === 50
			: normalizedRatios.every((r, idx) => r === balanced[idx]);

	const ratioSuffix = isDefaultEqual ? '' : `|${normalizedRatios.join('-')}`;
	const tag = data.colTag ?? 'col';

	const lines: string[] = [`> [!multi-column${ratioSuffix}]`];

	for (let cIdx = 0; cIdx < colCount; cIdx++) {
		const r = normalizedRatios[cIdx]!;
		const colHeader = tag === 'column' ? '> > [!column]' : `> > [!col|${r}]`;
		lines.push('>');
		lines.push(colHeader);

		const colLines = (colTexts[cIdx] ?? '').split('\n');
		for (const l of colLines) {
			lines.push(l.length > 0 ? `> > ${l}` : '> > ');
		}
	}

	return lines.join('\n');
}

/**
 * Maps a local character offset inside a column's EditorView document to the exact
 * character offset in the parent Obsidian EditorView document.
 * Handles multiline documents, empty lines, and variable quote prefixes per line.
 */
export function localOffsetToParentOffset(
	map: ColumnLineMapEntry[],
	localDocText: string,
	localOffset: number,
	blockFrom: number,
): number {
	if (map.length === 0) return blockFrom;

	const localLines = localDocText.split('\n');
	const clamped = Math.max(0, Math.min(localOffset, localDocText.length));

	let pos = 0;
	let targetLine = localLines.length - 1;
	let targetCh = localLines[targetLine]?.length ?? 0;

	for (let i = 0; i < localLines.length; i++) {
		const lineLen = localLines[i]!.length;
		if (clamped <= pos + lineLen) {
			targetLine = i;
			targetCh = clamped - pos;
			break;
		}
		pos += lineLen + 1;
	}

	const entry = map[Math.min(targetLine, map.length - 1)]!;
	const safeCh = Math.max(0, Math.min(targetCh, entry.contentLength));
	return blockFrom + entry.lineOffsetInBlock + entry.prefixLength + safeCh;
}

/**
 * Maps a character offset in the parent Obsidian EditorView document back to the local
 * character offset inside a column's EditorView document, or returns null if the parent
 * offset is not inside that column's mapped lines.
 */
export function parentOffsetToLocalOffset(
	map: ColumnLineMapEntry[],
	localDocText: string,
	parentOffset: number,
	blockFrom: number,
): number | null {
	if (map.length === 0) return null;
	const relOffset = parentOffset - blockFrom;
	if (relOffset < 0) return null;

	const localLines = localDocText.split('\n');

	for (const entry of map) {
		const rawLineStart = entry.lineOffsetInBlock;
		const rawLineEnd = entry.lineOffsetInBlock + entry.prefixLength + entry.contentLength;
		if (relOffset >= rawLineStart && relOffset <= rawLineEnd) {
			const localCh = Math.max(
				0,
				Math.min(entry.contentLength, relOffset - (entry.lineOffsetInBlock + entry.prefixLength)),
			);
			let localLineStart = 0;
			for (let i = 0; i < entry.localLine && i < localLines.length; i++) {
				localLineStart += localLines[i]!.length + 1;
			}
			return localLineStart + localCh;
		}
	}

	return null;
}
