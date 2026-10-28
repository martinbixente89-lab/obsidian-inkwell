/**
 * Markdown & HTML inline text formatting engine for Inkwell (Gras, Italique, Souligné, Barré).
 *
 * Serialization hierarchy:
 *   Markdown delimiters (**, *, ~~) -> <u> -> <span data-inkwell="1"> -> inner text
 */

import { parseLine, hasDecoration } from './color-spans';

export type FormatType = 'bold' | 'italic' | 'strikethrough' | 'underline';
export type FormatState = 'none' | 'all' | 'mixed';

export interface FormattingStateMap {
	bold: FormatState;
	italic: FormatState;
	strikethrough: FormatState;
	underline: FormatState;
}

export interface FormatRange {
	type: FormatType;
	from: number;
	to: number;
	innerFrom: number;
	innerTo: number;
	rawDelimStart: string;
	rawDelimEnd: string;
	attrs?: Record<string, string>;
}

/**
 * Finds regions on a line that are inside inline code (`...`) or escaped.
 */
function findExcludedRanges(line: string): Array<{ from: number; to: number }> {
	const ranges: Array<{ from: number; to: number }> = [];

	// Inline code
	const codeRegex = /`([^`]+)`/g;
	let match: RegExpExecArray | null;
	while ((match = codeRegex.exec(line)) !== null) {
		ranges.push({ from: match.index, to: match.index + match[0].length });
	}

	// Backslash escapes: \* \_ \~ \<
	const escRegex = /\\([*_~<\\>])/g;
	while ((match = escRegex.exec(line)) !== null) {
		ranges.push({ from: match.index, to: match.index + match[0].length });
	}

	return ranges;
}

function isInsideExcluded(pos: number, excluded: Array<{ from: number; to: number }>): boolean {
	return excluded.some((r) => pos >= r.from && pos < r.to);
}

/**
 * Parses all <u>...</u> tags on a line, preserving attributes if any.
 */
export function findUnderlineRanges(line: string): FormatRange[] {
	const ranges: FormatRange[] = [];
	const excluded = findExcludedRanges(line);
	const uRegex = /<u\b([^>]*)>([\s\S]*?)<\/u>/gi;
	let match: RegExpExecArray | null;

	while ((match = uRegex.exec(line)) !== null) {
		const start = match.index;
		const fullLen = match[0].length;
		const end = start + fullLen;
		if (isInsideExcluded(start, excluded)) continue;

		const attrsStr = match[1] ?? '';
		const openTagLen = `<u${attrsStr}>`.length;
		const closeTagLen = '</u>'.length;

		const attrs: Record<string, string> = {};
		if (attrsStr.trim()) {
			const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
			let aMatch: RegExpExecArray | null;
			while ((aMatch = attrRegex.exec(attrsStr)) !== null) {
				const k = aMatch[1];
				if (k) attrs[k.toLowerCase()] = aMatch[2] ?? aMatch[3] ?? aMatch[4] ?? '';
			}
		}

		ranges.push({
			type: 'underline',
			from: start,
			to: end,
			innerFrom: start + openTagLen,
			innerTo: end - closeTagLen,
			rawDelimStart: `<u${attrsStr}>`,
			rawDelimEnd: '</u>',
			attrs,
		});
	}

	if (line.includes('<span')) {
		const parsed = parseLine(line);
		for (const seg of parsed) {
			if (
				hasDecoration(seg.textDecoration, 'underline') ||
				hasDecoration(seg.otherStyles['text-decoration'], 'underline')
			) {
				ranges.push({
					type: 'underline',
					from: seg.rawStart,
					to: seg.rawEnd,
					innerFrom: seg.innerStart,
					innerTo: seg.innerStart + seg.text.length,
					rawDelimStart: '',
					rawDelimEnd: '',
				});
			}
		}
	}

	return ranges;
}

/**
 * Parses strikethrough (~~...~~) on a line.
 */
export function findStrikethroughRanges(line: string): FormatRange[] {
	const ranges: FormatRange[] = [];
	const excluded = findExcludedRanges(line);
	const regex = /~~((?:\\~|[^~])+)~~/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(line)) !== null) {
		const start = match.index;
		const fullLen = match[0].length;
		const end = start + fullLen;
		if (isInsideExcluded(start, excluded)) continue;

		ranges.push({
			type: 'strikethrough',
			from: start,
			to: end,
			innerFrom: start + 2,
			innerTo: end - 2,
			rawDelimStart: '~~',
			rawDelimEnd: '~~',
		});
	}

	if (line.includes('<span')) {
		const parsed = parseLine(line);
		for (const seg of parsed) {
			if (
				hasDecoration(seg.textDecoration, 'line-through') ||
				hasDecoration(seg.otherStyles['text-decoration'], 'line-through')
			) {
				ranges.push({
					type: 'strikethrough',
					from: seg.rawStart,
					to: seg.rawEnd,
					innerFrom: seg.innerStart,
					innerTo: seg.innerStart + seg.text.length,
					rawDelimStart: '',
					rawDelimEnd: '',
				});
			}
		}
	}

	return ranges;
}

/**
 * Parses bold (**...** or __...__) on a line, including inside triple delimiters.
 */
export function findBoldRanges(line: string): FormatRange[] {
	const ranges: FormatRange[] = [];
	const excluded = findExcludedRanges(line);

	// 1. Triple delimiters (bold + italic)
	const tripleRegex = /(\*{3}|_{3})((?:[^\\]|\\.)+?)\1/g;
	let match: RegExpExecArray | null;
	while ((match = tripleRegex.exec(line)) !== null) {
		const start = match.index;
		const fullLen = match[0].length;
		const end = start + fullLen;
		if (isInsideExcluded(start, excluded)) continue;

		const isUnderscore = match[1]?.startsWith('_');
		const delim = isUnderscore ? '__' : '**';
		ranges.push({
			type: 'bold',
			from: start,
			to: end,
			innerFrom: start + delim.length,
			innerTo: end - delim.length,
			rawDelimStart: delim,
			rawDelimEnd: delim,
		});
	}

	// 2. Standard double delimiters (** and __)
	const regex = /(?<!\*)\*{2}(?!\*)((?:[^\\]|\\.)+?)(?<!\*)\*{2}(?!\*)|(?<!_)_{2}(?!_)((?:[^\\]|\\.)+?)(?<!_)_{2}(?!_)/g;
	while ((match = regex.exec(line)) !== null) {
		const start = match.index;
		const fullLen = match[0].length;
		const end = start + fullLen;
		if (isInsideExcluded(start, excluded)) continue;

		const isUnderscore = match[0].startsWith('__');
		const delim = isUnderscore ? '__' : '**';
		ranges.push({
			type: 'bold',
			from: start,
			to: end,
			innerFrom: start + delim.length,
			innerTo: end - delim.length,
			rawDelimStart: delim,
			rawDelimEnd: delim,
		});
	}

	if (line.includes('<span')) {
		const parsed = parseLine(line);
		for (const seg of parsed) {
			if (seg.fontWeight === 'bold' || seg.fontWeight === '700') {
				ranges.push({
					type: 'bold',
					from: seg.rawStart,
					to: seg.rawEnd,
					innerFrom: seg.innerStart,
					innerTo: seg.innerStart + seg.text.length,
					rawDelimStart: '',
					rawDelimEnd: '',
				});
			}
		}
	}

	return ranges;
}

/**
 * Parses italic (*...* or _..._) on a line, including inside triple delimiters.
 */
export function findItalicRanges(line: string): FormatRange[] {
	const ranges: FormatRange[] = [];
	const excluded = findExcludedRanges(line);

	// 1. Triple delimiters (bold + italic)
	const tripleRegex = /(\*{3}|_{3})((?:[^\\]|\\.)+?)\1/g;
	let match: RegExpExecArray | null;
	while ((match = tripleRegex.exec(line)) !== null) {
		const start = match.index;
		const fullLen = match[0].length;
		const end = start + fullLen;
		if (isInsideExcluded(start, excluded)) continue;

		const isUnderscore = match[1]?.startsWith('_');
		const delim = isUnderscore ? '_' : '*';
		ranges.push({
			type: 'italic',
			from: start + (isUnderscore ? 2 : 2),
			to: end - (isUnderscore ? 2 : 2),
			innerFrom: start + 3,
			innerTo: end - 3,
			rawDelimStart: delim,
			rawDelimEnd: delim,
		});
	}

	// 2. Standard single delimiters (* and _)
	const regex = /(?<!\*)\*(?!\*)((?:\\\*|[^*])+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)((?:\\_|[^\\])+?)(?<!_)_(?!_)/g;
	while ((match = regex.exec(line)) !== null) {
		const start = match.index;
		const fullLen = match[0].length;
		const end = start + fullLen;
		if (isInsideExcluded(start, excluded)) continue;

		const isUnderscore = match[0].startsWith('_');
		const delim = isUnderscore ? '_' : '*';
		ranges.push({
			type: 'italic',
			from: start,
			to: end,
			innerFrom: start + 1,
			innerTo: end - 1,
			rawDelimStart: delim,
			rawDelimEnd: delim,
		});
	}

	if (line.includes('<span')) {
		const parsed = parseLine(line);
		for (const seg of parsed) {
			if (seg.fontStyle === 'italic') {
				ranges.push({
					type: 'italic',
					from: seg.rawStart,
					to: seg.rawEnd,
					innerFrom: seg.innerStart,
					innerTo: seg.innerStart + seg.text.length,
					rawDelimStart: '',
					rawDelimEnd: '',
				});
			}
		}
	}

	return ranges;
}

/**
 * Computes coverage state ('none' | 'all' | 'mixed') for a requested format across [from, to].
 */
export function computeFormatState(
	ranges: FormatRange[],
	from: number,
	to: number,
	line?: string,
): FormatState {
	if (from >= to) return 'none';

	// Collect all sub-intervals covered by the format within [from, to]
	let coveredLen = 0;
	for (const r of ranges) {
		const overlapStart = Math.max(from, r.from);
		const overlapEnd = Math.min(to, r.to);
		if (overlapEnd > overlapStart) {
			coveredLen += overlapEnd - overlapStart;
		}
	}

	const selLen = to - from;
	if (coveredLen === 0) return 'none';
	if (coveredLen >= selLen) return 'all';

	// If line is provided, check whether uncovered positions are only formatting delimiters / tags
	if (line) {
		const isCovered = new Uint8Array(to - from);
		for (const r of ranges) {
			const start = Math.max(from, r.from);
			const end = Math.min(to, r.to);
			for (let i = start; i < end; i++) {
				isCovered[i - from] = 1;
			}
		}

		let inTag = false;
		let hasUncoveredContent = false;
		for (let i = from; i < to; i++) {
			const ch = line[i];
			if (ch === '<') inTag = true;
			if (inTag) {
				if (ch === '>') inTag = false;
				continue;
			}
			if (isCovered[i - from] === 1) continue;

			// Formatting delimiters of other styles (bold/italic/strike)
			if (ch === '*' || ch === '_' || ch === '~') continue;

			hasUncoveredContent = true;
			break;
		}

		if (!hasUncoveredContent) {
			return 'all';
		}
	}

	return 'mixed';
}

export interface DelimInterval {
	from: number;
	to: number;
}

/**
 * Finds all Markdown delimiter intervals (**, *, ~~) on the line.
 */
export function findMarkdownDelimiterIntervals(line: string): DelimInterval[] {
	const intervals: DelimInterval[] = [];
	const bolds = findBoldRanges(line);
	for (const r of bolds) {
		intervals.push({ from: r.from, to: r.innerFrom });
		intervals.push({ from: r.innerTo, to: r.to });
	}
	const italics = findItalicRanges(line);
	for (const r of italics) {
		intervals.push({ from: r.from, to: r.innerFrom });
		intervals.push({ from: r.innerTo, to: r.to });
	}
	const strikes = findStrikethroughRanges(line);
	for (const r of strikes) {
		intervals.push({ from: r.from, to: r.innerFrom });
		intervals.push({ from: r.innerTo, to: r.to });
	}

	// Also protect any raw delimiter character runs (*, _, ~) outside code
	const delimRegex = /[*~_]+/g;
	let dMatch: RegExpExecArray | null;
	while ((dMatch = delimRegex.exec(line)) !== null) {
		intervals.push({ from: dMatch.index, to: dMatch.index + dMatch[0].length });
	}

	if (intervals.length === 0) return [];
	intervals.sort((a, b) => a.from - b.from);
	const first = intervals[0];
	if (!first) return [];
	const merged: DelimInterval[] = [first];
	for (let i = 1; i < intervals.length; i++) {
		const prev = merged[merged.length - 1];
		const curr = intervals[i];
		if (!prev || !curr) continue;
		if (curr.from <= prev.to) {
			prev.to = Math.max(prev.to, curr.to);
		} else {
			merged.push(curr);
		}
	}
	return merged;
}

/**
 * Partitions [from, to] into sub-ranges that do not intersect any Markdown delimiter.
 */
export function partitionRangeOutsideDelimiters(
	from: number,
	to: number,
	delims: DelimInterval[],
): Array<{ from: number; to: number }> {
	const subRanges: Array<{ from: number; to: number }> = [];
	let currentFrom = from;

	for (const d of delims) {
		if (d.to <= currentFrom) continue;
		if (d.from >= to) break;

		if (currentFrom < d.from) {
			subRanges.push({ from: currentFrom, to: Math.min(d.from, to) });
		}
		currentFrom = Math.max(currentFrom, d.to);
		if (currentFrom >= to) break;
	}

	if (currentFrom < to) {
		subRanges.push({ from: currentFrom, to });
	}

	return subRanges.filter((r) => r.to > r.from);
}

/**
 * Ensures range bounds do not slice open any HTML tag (<...>).
 */
export function adjustBoundsOutsideHtmlTags(
	line: string,
	rawFrom: number,
	rawTo: number,
): { from: number; to: number } {
	let from = Math.min(rawFrom, rawTo);
	let to = Math.max(rawFrom, rawTo);

	const tagRegex = /<[^>]+>/g;
	let match: RegExpExecArray | null;

	while ((match = tagRegex.exec(line)) !== null) {
		const tagStart = match.index;
		const tagEnd = tagStart + match[0].length;

		// If from falls strictly inside the tag, snap it to the tag boundary
		if (from > tagStart && from < tagEnd) {
			from = tagStart;
		}

		// If to falls strictly inside the tag, snap it to the tag end
		if (to > tagStart && to < tagEnd) {
			to = tagEnd;
		}
	}

	return { from, to };
}

/**
 * Computes formatting states for all 4 styles on a line range.
 */
export function analyzeSelectionFormatting(
	line: string,
	from: number,
	to: number,
): FormattingStateMap {
	const min = Math.min(from, to);
	const max = Math.max(from, to);

	const boldRanges = findBoldRanges(line);
	const italicRanges = findItalicRanges(line);
	const strikeRanges = findStrikethroughRanges(line);
	const uRanges = findUnderlineRanges(line);

	return {
		bold: computeFormatState(boldRanges, min, max, line),
		italic: computeFormatState(italicRanges, min, max, line),
		strikethrough: computeFormatState(strikeRanges, min, max, line),
		underline: computeFormatState(uRanges, min, max, line),
	};
}

/**
 * Applies or removes a format on a line range.
 * If currentState is 'none' or 'mixed': applies format across the entire selection.
 * If currentState is 'all': removes format across the entire selection.
 */
export function toggleFormat(
	line: string,
	rawFrom: number,
	rawTo: number,
	format: FormatType,
): { success: boolean; line: string; newFrom: number; newTo: number } {
	const adjusted = adjustBoundsOutsideHtmlTags(line, rawFrom, rawTo);
	const from = adjusted.from;
	const to = adjusted.to;
	if (from === to) return { success: false, line, newFrom: from, newTo: to };

	const analysis = analyzeSelectionFormatting(line, from, to);
	const currentState = analysis[format];
	const action = currentState === 'all' ? 'remove' : 'apply';

	const delimMap: Record<FormatType, { start: string; end: string }> = {
		bold: { start: '**', end: '**' },
		italic: { start: '*', end: '*' },
		strikethrough: { start: '~~', end: '~~' },
		underline: { start: '<u>', end: '</u>' },
	};
	const delim = delimMap[format];

	let getRanges: (l: string) => FormatRange[];
	switch (format) {
		case 'bold':
			getRanges = findBoldRanges;
			break;
		case 'italic':
			getRanges = findItalicRanges;
			break;
		case 'strikethrough':
			getRanges = findStrikethroughRanges;
			break;
		case 'underline':
			getRanges = findUnderlineRanges;
			break;
	}

	if (action === 'apply') {
		// Special handling for underline: never enclose markdown delimiters inside <u>
		if (format === 'underline') {
			const delims = findMarkdownDelimiterIntervals(line);
			const subRanges = partitionRangeOutsideDelimiters(from, to, delims);
			if (subRanges.length === 0) {
				return { success: false, line, newFrom: from, newTo: to };
			}

			// Sort right-to-left
			subRanges.sort((a, b) => b.from - a.from);

			let currentLine = line;
			let totalAddedLen = 0;

			for (const sub of subRanges) {
				let subFrom = sub.from;
				let subTo = sub.to;

				// Expand to enclose an Inkwell span if sub covers its inner content
				const before = currentLine.slice(0, subFrom);
				const after = currentLine.slice(subTo);
				const spanOpenMatch = before.match(/<span\b[^>]*data-inkwell="1"[^>]*>$/i);
				const spanCloseMatch = after.match(/^<\/span>/i);
				if (spanOpenMatch && spanCloseMatch) {
					subFrom -= spanOpenMatch[0].length;
					subTo += spanCloseMatch[0].length;
				}

				// Clean existing <u> tags inside this subsegment to prevent <u><u>
				let subSegment = currentLine.slice(subFrom, subTo);
				subSegment = subSegment.replace(/<\/?u\b[^>]*>/gi, '');

				currentLine =
					currentLine.slice(0, subFrom) +
					'<u>' +
					subSegment +
					'</u>' +
					currentLine.slice(subTo);

				const subAdded = 7 + (subSegment.length - (subTo - subFrom));
				totalAddedLen += subAdded;
			}

			return {
				success: true,
				line: currentLine,
				newFrom: from,
				newTo: to + totalAddedLen,
			};
		}

		let expandedFrom = from;
		let expandedTo = to;
		const existingRanges = getRanges(line);
		for (const r of existingRanges) {
			if (r.to >= from && r.from <= to) {
				expandedFrom = Math.min(expandedFrom, r.from);
				expandedTo = Math.max(expandedTo, r.to);
			}
		}

		// Check if [expandedFrom, expandedTo] encloses or covers the inner text of an Inkwell span
		const before = line.slice(0, expandedFrom);
		const after = line.slice(expandedTo);
		const spanOpenMatch = before.match(/<span\b[^>]*data-inkwell="1"[^>]*>$/i);
		const spanCloseMatch = after.match(/^<\/span>/i);
		if (format === 'bold' && spanOpenMatch && spanCloseMatch) {
			expandedFrom -= spanOpenMatch[0].length;
			expandedTo += spanCloseMatch[0].length;
		}

		// If applying Markdown (bold, italic, strikethrough) inside an existing <u>:
		// Split <u> cleanly so markdown delimiters remain strictly OUTSIDE <u>:
		const uRanges = findUnderlineRanges(line);
		for (const u of uRanges) {
			if (from >= u.innerFrom && to <= u.innerTo) {
				const left = line.slice(u.innerFrom, from);
				const mid = line.slice(from, to);
				const right = line.slice(to, u.innerTo);

				let cleanMid = mid;
				if (format === 'bold') cleanMid = cleanMid.replace(/\*\*|__/g, '');
				else if (format === 'italic') cleanMid = cleanMid.replace(/(?<!\*)\*(?!\*)|(?<!_)_(?!_)/g, '');
				else if (format === 'strikethrough') cleanMid = cleanMid.replace(/~~/g, '');

				const leftU = left ? `<u>${left}</u>` : '';
				const midU = `${delim.start}<u>${cleanMid}</u>${delim.end}`;
				const rightU = right ? `<u>${right}</u>` : '';

				const newLine = line.slice(0, u.from) + leftU + midU + rightU + line.slice(u.to);
				const newStart = u.from + leftU.length;
				const newEnd = newStart + midU.length;

				return {
					success: true,
					line: newLine,
					newFrom: newStart,
					newTo: newEnd,
				};
			}
		}

		const beforeU = line.slice(0, expandedFrom);
		const afterU = line.slice(expandedTo);
		const uOpenMatch = beforeU.match(/<u\b[^>]*>$/i);
		const uCloseMatch = afterU.match(/^<\/u>/i);
		if (uOpenMatch && uCloseMatch) {
			expandedFrom -= uOpenMatch[0].length;
			expandedTo += uCloseMatch[0].length;
		}

		// Trim leading and trailing whitespace so markdown delimiters adhere to words for strikethrough
		// (CommonMark GFM extension requires ~~ delimiters to not be followed or preceded by whitespace)
		if (format === 'strikethrough') {
			while (expandedFrom < expandedTo && /\s/.test(line[expandedFrom]!)) {
				expandedFrom++;
			}
			while (expandedTo > expandedFrom && /\s/.test(line[expandedTo - 1]!)) {
				expandedTo--;
			}

			if (expandedFrom >= expandedTo) {
				return { success: false, line, newFrom: from, newTo: to };
			}
		}

		// Clean any existing partial delimiters of THIS format inside [expandedFrom, expandedTo]
		let targetSegment = line.slice(expandedFrom, expandedTo);

		if (format === 'bold') {
			targetSegment = targetSegment.replace(/\*\*|__/g, '');
		} else if (format === 'italic') {
			targetSegment = targetSegment.replace(/(?<!\*)\*(?!\*)|(?<!_)_(?!_)/g, '');
		} else if (format === 'strikethrough') {
			targetSegment = targetSegment.replace(/~~/g, '');
		} else if (format === 'underline') {
			targetSegment = targetSegment.replace(/<\/?u\b[^>]*>/gi, '');
		}

		const newLine =
			line.slice(0, expandedFrom) +
			delim.start +
			targetSegment +
			delim.end +
			line.slice(expandedTo);

		const addedLen = delim.start.length + delim.end.length;
		const lenDiff = targetSegment.length - (expandedTo - expandedFrom);
		const newFrom = expandedFrom;
		const newTo = expandedTo + addedLen + lenDiff;

		return { success: true, line: newLine, newFrom, newTo };
	} else {
		const ranges = getRanges(line).filter((r) => r.to > from && r.from < to);
		if (ranges.length === 0) {
			return { success: false, line, newFrom: from, newTo: to };
		}

		// Sort right to left for replacement
		ranges.sort((a, b) => b.from - a.from);

		function hasVisibleText(text: string): boolean {
			return text.replace(/<[^>]+>/g, '').trim().length > 0;
		}

		function getEnclosingHtmlTags(inner: string): { openTags: string; closeTags: string; innerText: string } {
			let current = inner;
			let openTags = '';
			let closeTags = '';

			while (true) {
				const match = current.match(/^<([a-zA-Z0-9]+)\b([^>]*)>([\s\S]*)<\/\1>$/);
				if (!match) break;
				openTags += `<${match[1]}${match[2]}>`;
				closeTags = `</${match[1]}>` + closeTags;
				current = match[3] ?? '';
			}

			return { openTags, closeTags, innerText: current };
		}

		let newFrom = from;
		let newTo = to;

		let currentLine = line;
		for (const r of ranges) {
			const inner = currentLine.slice(r.innerFrom, r.innerTo);
			const { openTags, closeTags, innerText } = getEnclosingHtmlTags(inner);
			const visFrom = r.innerFrom + openTags.length;

			const hasVisibleBefore = hasVisibleText(currentLine.slice(r.innerFrom, from));
			const hasVisibleAfter = hasVisibleText(currentLine.slice(to, r.innerTo));

			// Case 1: selection covers the entire visible content of [r.from, r.to]
			if (!hasVisibleBefore && !hasVisibleAfter) {
				currentLine = currentLine.slice(0, r.from) + inner + currentLine.slice(r.to);
				newFrom = Math.max(r.from, from - r.rawDelimStart.length);
				newTo = Math.max(newFrom, to - r.rawDelimStart.length);
			} else {
				const relFrom = Math.max(0, from - visFrom);
				const relTo = Math.min(innerText.length, to - visFrom);
				const leftText = innerText.slice(0, relFrom);
				const midText = innerText.slice(relFrom, relTo);
				const rightText = innerText.slice(relTo);

				// Case 2: partial selection inside [r.from, r.to]
				if (leftText.trim().length > 0 && rightText.trim().length > 0) {
					const leftWsMatch = leftText.match(/\s+$/);
					const leftWs = leftWsMatch ? leftWsMatch[0] : '';
					const leftClean = leftWs ? leftText.slice(0, -leftWs.length) : leftText;
					const leftPart = r.rawDelimStart + openTags + leftClean + closeTags + r.rawDelimEnd + leftWs;

					const midPart = openTags + midText + closeTags;

					const rightWsMatch = rightText.match(/^\s+/);
					const rightWs = rightWsMatch ? rightWsMatch[0] : '';
					const rightClean = rightWs ? rightText.slice(rightWs.length) : rightText;
					const rightPart = rightWs + r.rawDelimStart + openTags + rightClean + closeTags + r.rawDelimEnd;

					currentLine =
						currentLine.slice(0, r.from) +
						leftPart +
						midPart +
						rightPart +
						currentLine.slice(r.to);

					newFrom = r.from + leftPart.length;
					newTo = newFrom + midPart.length;
				}
				// Case 3: selection starts before / at start and ends inside [r.from, r.to]
				else if (leftText.trim().length === 0 && rightText.trim().length > 0) {
					const midPart = openTags + midText + closeTags;

					const rightWsMatch = rightText.match(/^\s+/);
					const rightWs = rightWsMatch ? rightWsMatch[0] : '';
					const rightClean = rightWs ? rightText.slice(rightWs.length) : rightText;
					const rightPart = rightWs + r.rawDelimStart + openTags + rightClean + closeTags + r.rawDelimEnd;

					currentLine =
						currentLine.slice(0, r.from) +
						midPart +
						rightPart +
						currentLine.slice(r.to);

					newFrom = r.from;
					newTo = r.from + midPart.length;
				}
				// Case 4: selection starts inside and ends after / at end of [r.from, r.to]
				else if (leftText.trim().length > 0 && rightText.trim().length === 0) {
					const leftWsMatch = leftText.match(/\s+$/);
					const leftWs = leftWsMatch ? leftWsMatch[0] : '';
					const leftClean = leftWs ? leftText.slice(0, -leftWs.length) : leftText;
					const leftPart = r.rawDelimStart + openTags + leftClean + closeTags + r.rawDelimEnd + leftWs;

					const midPart = openTags + midText + closeTags;

					currentLine =
						currentLine.slice(0, r.from) +
						leftPart +
						midPart +
						currentLine.slice(r.to);

					newFrom = r.from + leftPart.length;
					newTo = newFrom + midPart.length;
				}
			}
		}

		// Final safety check: never produce markdown delimiter inside <u> or unbalanced tags
		if (
			/<u>[^\n<]*(\*\*|\*|~~)[^\n<]*<\/u>/.test(currentLine) ||
			(currentLine.match(/<u\b/g) || []).length !== (currentLine.match(/<\/u>/g) || []).length
		) {
			return { success: false, line, newFrom: from, newTo: to };
		}

		return {
			success: true,
			line: currentLine,
			newFrom: Math.min(newFrom, currentLine.length),
			newTo: Math.min(newTo, currentLine.length),
		};
	}
}
