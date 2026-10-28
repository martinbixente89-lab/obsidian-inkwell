import { parseTagAttributes, SpanAttributes } from '../../format/color-spans';

/**
 * Absolute document offsets of a simple Inkwell span:
 * `spanStart` <span ...> `innerStart` text `innerEnd` </span> `spanEnd`.
 */
export interface SimpleSpan {
	spanStart: number;
	innerStart: number;
	innerEnd: number;
	spanEnd: number;
	tag?: 'span' | 'u';
	parsed?: SpanAttributes;
	rawAttrs?: string;
	isUnderlineTag?: boolean;
	/** True if strictly enclosed by ** on this line: **<span ...>...</span>** */
	enclosedInBold?: boolean;
	/** True if inner content has strictly matching **: <span ...>**texte**</span> */
	innerBold?: boolean;
	/** True if strictly enclosed by <u>...</u>: <u><span ...>...</span></u> */
	enclosedInUnderline?: boolean;
	uOpenLen?: number;
	uCloseLen?: number;
}

const SPAN_RE = /<span\b([^<>]*)>([^<>]*)<\/span>/gi;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_AND_TAG_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\r\n]+`|<span\b([^>]*)>|<\/span>|<u\b([^>]*)>|<\/u>)/gi;

/**
 * Checks whether the given attribute string belongs to an Inkwell or legacy formatting span.
 * Rejects spans with third-party attributes (id, class, onclick) or non-formatting styles (display, visibility).
 */
export function isFormattingSpan(attrs: string): { isFormatting: boolean; parsed: SpanAttributes } {
	const parsed = parseTagAttributes(attrs);
	// Reject any span with unknown/third-party attributes (id, class, onclick, etc.)
	if (Object.keys(parsed.otherAttrs).length > 0) {
		return { isFormatting: false, parsed };
	}
	// Must have data-inkwell or at least one recognized visual formatting property
	const hasFormatting =
		parsed.isInkwell ||
		Boolean(parsed.color) ||
		Boolean(parsed.highlight) ||
		Boolean(parsed.fontSize) ||
		Boolean(parsed.fontFamily) ||
		Boolean(parsed.fontWeight) ||
		Boolean(parsed.fontStyle) ||
		Boolean(parsed.textDecoration) ||
		Boolean(parsed.otherStyles['text-decoration']);

	if (!hasFormatting) {
		return { isFormatting: false, parsed };
	}

	// Must not have non-formatting / hiding styles
	if (parsed.otherStyles['display'] || parsed.otherStyles['visibility']) {
		return { isFormatting: false, parsed };
	}

	return { isFormatting: true, parsed };
}

/** True when `index` in `lineText` lies inside an inline code span (odd number of backticks before it). */
function isInInlineCode(lineText: string, index: number): boolean {
	let count = 0;
	for (let i = 0; i < index; i++) {
		if (lineText[i] === '`' && lineText[i - 1] !== '\\') count++;
	}
	return count % 2 === 1;
}

/**
 * Finds the simple formatting spans of one line.
 * Supports both Inkwell spans (with data-inkwell="1") and legacy formatting spans.
 */
export function findSimpleSpansInLine(
	lineText: string,
	lineFrom: number,
	allowBold = true,
	requireInkwell = true,
): SimpleSpan[] {
	const spans: SimpleSpan[] = [];
	SPAN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SPAN_RE.exec(lineText)) !== null) {
		const attrs = m[1] ?? '';
		const inner = m[2] ?? '';
		if (inner.length === 0) continue;
		const { isFormatting, parsed } = isFormattingSpan(attrs);
		if (!isFormatting) continue;
		if (requireInkwell && !parsed.isInkwell) continue;
		if (isInInlineCode(lineText, m.index)) continue;
		const spanStart = lineFrom + m.index;
		const innerStart = spanStart + m[0].length - inner.length - '</span>'.length;
		const spanEnd = spanStart + m[0].length;
		const innerEnd = innerStart + inner.length;

		const spanStartRel = m.index;
		const spanEndRel = m.index + m[0].length;

		const textBeforeSpan = lineText.slice(0, spanStartRel);
		const textAfterSpan = lineText.slice(spanEndRel);
		const uOpenMatch = textBeforeSpan.match(/<u\b[^>]*>$/i);
		const uCloseMatch = textAfterSpan.match(/^<\/u>/i);
		const enclosedInUnderline = Boolean(uOpenMatch && uCloseMatch);
		const uOpenLen = uOpenMatch ? uOpenMatch[0].length : 0;
		const uCloseLen = uCloseMatch ? uCloseMatch[0].length : 0;

		// Pair ** delimiter runs on this line outside inline code
		const boldDelims: number[] = [];
		const BOLD_RE = /\*\*/g;
		let bm: RegExpExecArray | null;
		while ((bm = BOLD_RE.exec(lineText)) !== null) {
			if (isInInlineCode(lineText, bm.index)) continue;
			const beforeStar = bm.index > 0 && lineText[bm.index - 1] === '*';
			const afterStar = bm.index + 2 < lineText.length && lineText[bm.index + 2] === '*';
			if (!beforeStar && !afterStar) {
				boldDelims.push(bm.index);
			}
		}

		const openBoldTarget = enclosedInUnderline ? spanStartRel - uOpenLen - 2 : spanStartRel - 2;
		const closeBoldTarget = enclosedInUnderline ? spanEndRel + uCloseLen : spanEndRel;

		const openIdx = boldDelims.indexOf(openBoldTarget);
		const closeIdx = boldDelims.indexOf(closeBoldTarget);
		const enclosedInBold =
			openIdx !== -1 &&
			closeIdx !== -1 &&
			openIdx % 2 === 0 &&
			closeIdx === openIdx + 1;

		const isInnerBold =
			inner.startsWith('**') &&
			inner.endsWith('**') &&
			inner.length >= 5 &&
			inner[2] !== '*' &&
			inner[inner.length - 3] !== '*' &&
			inner.slice(2, -2).trim().length > 0;

		// When bold combinations are not enabled, strictly skip any bold-wrapped or bold-containing spans
		if (!allowBold && (enclosedInBold || isInnerBold || inner.includes('**'))) {
			continue;
		}

		spans.push({
			spanStart,
			innerStart,
			innerEnd,
			spanEnd,
			...(enclosedInBold ? { enclosedInBold: true } : {}),
			...(isInnerBold ? { innerBold: true } : {}),
			...(enclosedInUnderline ? { enclosedInUnderline: true, uOpenLen, uCloseLen } : {}),
		});
	}
	return spans;
}

/** Minimal line access, satisfied by CodeMirror's `Text`. */
export interface LineSource {
	lines: number;
	line(n: number): { from: number; text: string; number: number };
}

/**
 * Returns, for each line number in [fromLine, toLine], whether it is inside a
 * fenced code block. Scans from the top of the document (prototype: O(lines)).
 */
export function fencedLines(doc: LineSource, fromLine: number, toLine: number): Set<number> {
	const inside = new Set<number>();
	let fence: string | null = null;
	for (let n = 1; n <= Math.min(toLine, doc.lines); n++) {
		const text = doc.line(n).text;
		const f = FENCE_RE.exec(text);
		const wasInside = fence !== null;
		if (f && f[1]) {
			const marker = f[1];
			if (fence === null) fence = marker;
			else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
		}
		// Fence lines themselves and lines between fences are code.
		if ((wasInside || fence !== null || f) && n >= fromLine) inside.add(n);
	}
	return inside;
}

/** Simple spans of the lines [fromLine, toLine], excluding fenced code blocks. */
export function findSimpleSpans(
	doc: LineSource,
	fromLine: number,
	toLine: number,
	allowBold = true,
	requireInkwell = false,
): SimpleSpan[] {
	const code = fencedLines(doc, fromLine, toLine);
	const spans: SimpleSpan[] = [];
	for (let n = fromLine; n <= toLine; n++) {
		if (code.has(n)) continue;
		const line = doc.line(n);
		if (!line.text.includes('<span')) continue;
		spans.push(...findSimpleSpansInLine(line.text, line.from, allowBold, requireInkwell));
	}
	return spans;
}

interface StackItem {
	tag: 'span' | 'u' | 'ignore';
	spanStart: number;
	innerStart: number;
	parsed?: SpanAttributes;
	rawAttrs?: string;
	absorbed?: boolean;
	enclosedInUnderline?: boolean;
	uOpenLen?: number;
}

/**
 * Stack-based scanner finding all formatting spans across a document string.
 * Supports:
 * - Nested spans (outer and inner)
 * - Multi-line spans
 * - Inkwell spans and legacy formatting spans without data-inkwell
 * - Standalone <u>...</u> underline tags
 * Strictly ignores:
 * - Fenced code blocks (``` and ~~~)
 * - Inline code (`...`)
 * - Spans with unknown/third-party attributes (id, class, onclick) or non-formatting styles
 */
export function findFormattingSpansInDoc(docText: string, allowBold = true): SimpleSpan[] {
	const spans: SimpleSpan[] = [];
	const stack: StackItem[] = [];
	FENCE_AND_TAG_RE.lastIndex = 0;
	let m: RegExpExecArray | null;

	while ((m = FENCE_AND_TAG_RE.exec(docText)) !== null) {
		const token = m[0];
		const idx = m.index;

		// Code blocks and inline code: skip entirely
		if (token.startsWith('`') || token.startsWith('~')) {
			continue;
		}

		const lower = token.toLowerCase();
		if (lower.startsWith('<span')) {
			const rawAttrs = m[2] ?? '';
			const { isFormatting, parsed } = isFormattingSpan(rawAttrs);
			const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
			const isEnclosedByU = Boolean(top && top.tag === 'u' && top.innerStart === idx);
			if (isEnclosedByU && top) {
				top.absorbed = true;
			}
			if (isFormatting) {
				stack.push({
					tag: 'span',
					spanStart: idx,
					innerStart: idx + token.length,
					parsed,
					rawAttrs,
					enclosedInUnderline: isEnclosedByU,
					uOpenLen: isEnclosedByU ? idx - (top?.spanStart ?? idx) : 0,
				});
			} else {
				stack.push({
					tag: 'ignore',
					spanStart: idx,
					innerStart: idx + token.length,
				});
			}
		} else if (lower === '</span>') {
			let found: StackItem | undefined;
			while (stack.length > 0) {
				const top = stack.pop()!;
				if (top.tag === 'span' || top.tag === 'ignore') {
					found = top;
					break;
				}
			}
			if (found && found.tag === 'span') {
				const innerStart = found.innerStart;
				const innerEnd = idx;
				const spanEnd = idx + token.length;
				const inner = docText.slice(innerStart, innerEnd);

				const isInnerBold =
					inner.startsWith('**') &&
					inner.endsWith('**') &&
					inner.length >= 5 &&
					inner[2] !== '*' &&
					inner[inner.length - 3] !== '*' &&
					inner.slice(2, -2).trim().length > 0;

				if (!allowBold && isInnerBold) {
					continue;
				}

				const uCloseLen = found.enclosedInUnderline ? 4 : 0;
				const outerBefore = found.enclosedInUnderline ? found.spanStart - (found.uOpenLen ?? 3) : found.spanStart;
				const outerAfter = found.enclosedInUnderline ? spanEnd + uCloseLen : spanEnd;
				const enclosedInBold =
					outerBefore >= 2 &&
					outerAfter + 2 <= docText.length &&
					docText.slice(outerBefore - 2, outerBefore) === '**' &&
					docText.slice(outerAfter, outerAfter + 2) === '**';

				if (!allowBold && (isInnerBold || enclosedInBold)) {
					continue;
				}

				spans.push({
					spanStart: found.spanStart,
					innerStart,
					innerEnd,
					spanEnd,
					tag: 'span',
					parsed: found.parsed,
					rawAttrs: found.rawAttrs,
					...(found.enclosedInUnderline
						? { enclosedInUnderline: true, uOpenLen: found.uOpenLen, uCloseLen }
						: {}),
					...(isInnerBold ? { innerBold: true } : {}),
					...(enclosedInBold ? { enclosedInBold: true } : {}),
				});
			}
		} else if (lower.startsWith('<u')) {
			stack.push({
				tag: 'u',
				spanStart: idx,
				innerStart: idx + token.length,
				absorbed: false,
			});
		} else if (lower === '</u>') {
			let found: StackItem | undefined;
			while (stack.length > 0) {
				const top = stack.pop()!;
				if (top.tag === 'u') {
					found = top;
					break;
				}
			}
			if (found && !found.absorbed) {
				spans.push({
					spanStart: found.spanStart,
					innerStart: found.innerStart,
					innerEnd: idx,
					spanEnd: idx + token.length,
					tag: 'u',
					isUnderlineTag: true,
				});
			}
		}
	}

	// Sort spans strictly in document order: by spanStart ascending, then spanEnd descending
	spans.sort((a, b) => a.spanStart - b.spanStart || b.spanEnd - a.spanEnd);
	return spans;
}

