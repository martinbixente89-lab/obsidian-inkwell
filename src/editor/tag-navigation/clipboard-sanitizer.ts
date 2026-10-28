import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { findSimpleSpans, SimpleSpan } from './simple-spans';

export interface SanitizedClipboard {
	plainText: string;
	htmlText: string;
}

interface TagInterval {
	start: number;
	end: number;
	type: 'open' | 'close';
	span: SimpleSpan;
}

/**
 * Escapes HTML entity characters in raw user text.
 */
function escapeHtmlEntities(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Sanitizes a selection slice that may cross Inkwell span boundaries or hidden tags.
 * Ensures the copied data has a well-defined behavior:
 * - text/plain contains clean text without raw Inkwell presentation tags, preserving literal '<', '>', '&'.
 * - text/html contains strictly well-formed, balanced HTML elements with properly encoded entities and bold tags.
 */
export function sanitizeSelectionClipboard(
	doc: Text,
	from: number,
	to: number,
	spans: SimpleSpan[],
): SanitizedClipboard | null {
	if (from >= to) return null;

	// Collect Inkwell tag intervals that intersect or are adjacent to [from, to]
	let leftSpan: SimpleSpan | null = null;
	let rightSpan: SimpleSpan | null = null;
	const tagIntervals: TagInterval[] = [];

	for (const s of spans) {
		const openStart = s.enclosedInUnderline ? s.spanStart - (s.uOpenLen ?? 3) : s.spanStart;
		const openEnd = s.innerStart;
		const closeStart = s.innerEnd;
		const closeEnd = s.enclosedInUnderline ? s.spanEnd + (s.uCloseLen ?? 4) : s.spanEnd;

		if (from > openStart && from < closeEnd) {
			leftSpan = s;
		}
		if (to > openStart && to < closeEnd) {
			rightSpan = s;
		}

		if (openEnd > from && openStart < to) {
			tagIntervals.push({
				start: Math.max(from, openStart),
				end: Math.min(to, openEnd),
				type: 'open',
				span: s,
			});
		}
		if (closeEnd > from && closeStart < to) {
			tagIntervals.push({
				start: Math.max(from, closeStart),
				end: Math.min(to, closeEnd),
				type: 'close',
				span: s,
			});
		}
	}

	// If the selection does not cut across or contain any Inkwell spans, let native copy proceed
	if (!leftSpan && !rightSpan && tagIntervals.length === 0) {
		return null;
	}

	// Helper to check if a segment is strictly inside a span's inner content
	const isInsideSpanContent = (start: number, end: number): boolean => {
		return spans.some((s) => start >= s.innerStart && end <= s.innerEnd);
	};

	// 1. Build clean plainText by extracting only the non-tag content (strictly preserving literal '<', '>', '&')
	tagIntervals.sort((a, b) => a.start - b.start);
	let plainText = '';
	let curPos = from;

	for (const tag of tagIntervals) {
		if (tag.start > curPos) {
			const seg = doc.sliceString(curPos, tag.start);
			plainText += isInsideSpanContent(curPos, tag.start) ? decodeHtmlEntities(seg) : seg;
		}
		curPos = Math.max(curPos, tag.end);
	}
	if (curPos < to) {
		const seg = doc.sliceString(curPos, to);
		plainText += isInsideSpanContent(curPos, to) ? decodeHtmlEntities(seg) : seg;
	}

	// 2. Build well-formed, balanced HTML representation:
	let htmlText = '';
	curPos = from;

	// If from sliced into the visible text of leftSpan, prepend opening tags
	if (leftSpan && from >= leftSpan.innerStart && from < leftSpan.innerEnd) {
		if (leftSpan.enclosedInBold) {
			htmlText += '<strong>';
		}
		if (leftSpan.enclosedInUnderline) {
			htmlText += '<u>';
		}
		const openSpan = doc.sliceString(leftSpan.spanStart, leftSpan.innerStart);
		htmlText += openSpan;
	}

	for (const tag of tagIntervals) {
		const s = tag.span;
		const openStart = s.enclosedInUnderline ? s.spanStart - (s.uOpenLen ?? 3) : s.spanStart;
		const closeEnd = s.enclosedInUnderline ? s.spanEnd + (s.uCloseLen ?? 4) : s.spanEnd;
		const isFullBold = Boolean(s.enclosedInBold && from <= openStart - 2 && to >= closeEnd + 2);

		if (tag.type === 'open') {
			const textBefore = isFullBold ? openStart - 2 : tag.start;
			if (textBefore > curPos) {
				const textSegment = doc.sliceString(curPos, textBefore);
				htmlText += formatSegmentToHtml(textSegment);
			}
			if (isFullBold) {
				htmlText += '<strong>';
			}
			if (s.enclosedInUnderline) {
				htmlText += '<u>';
			}
			const openTag = doc.sliceString(s.spanStart, s.innerStart);
			htmlText += openTag;
			curPos = Math.max(curPos, tag.end);
		} else if (tag.type === 'close') {
			if (tag.start > curPos) {
				const textSegment = doc.sliceString(curPos, tag.start);
				htmlText += formatSegmentToHtml(textSegment);
			}
			htmlText += '</span>';
			if (s.enclosedInUnderline) {
				htmlText += '</u>';
			}
			if (isFullBold) {
				htmlText += '</strong>';
				curPos = closeEnd + 2;
			} else {
				curPos = Math.max(curPos, tag.end);
			}
		}
	}
	if (curPos < to) {
		const textSegment = doc.sliceString(curPos, to);
		htmlText += formatSegmentToHtml(textSegment);
	}

	// If to sliced into the visible text of rightSpan, append closing tags
	if (rightSpan && to > rightSpan.innerStart && to <= rightSpan.innerEnd) {
		htmlText += '</span>';
		if (rightSpan.enclosedInUnderline) {
			htmlText += '</u>';
		}
		if (rightSpan.enclosedInBold) {
			htmlText += '</strong>';
		}
	}

	return {
		plainText,
		htmlText,
	};
}

/**
 * Decodes standard HTML entities into literal characters.
 */
export function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&lt;|&#x3C;/gi, '<')
		.replace(/&gt;|&#x3E;/gi, '>')
		.replace(/&quot;|&#x22;/gi, '"')
		.replace(/&amp;|&#x26;/gi, '&');
}

/**
 * Converts rich Inkwell HTML into canonical Markdown representation upon paste,
 * preventing native filters from stripping spans or inverting Cas 6 into Cas 1.
 */
export function convertInkwellHtmlToMarkdown(html: string): string {
	let res = html.replace(/<!--[\s\S]*?-->/g, '');
	res = res.replace(/<br\s*\/?>/gi, '\n');
	res = res.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '$1');

	// Pattern 1: strong + u + inkwell span (Cas 6 + underline)
	res = res.replace(
		/<(?:strong|b)>\s*<u>\s*(<span\b[^>]*\bdata-inkwell="1"[^>]*>[\s\S]*?<\/span>)\s*<\/u>\s*<\/(?:strong|b)>/gi,
		'**<u>$1</u>**',
	);

	// Pattern 2: strong + inkwell span (Cas 6 canonical)
	res = res.replace(
		/<(?:strong|b)>\s*(<span\b[^>]*\bdata-inkwell="1"[^>]*>[\s\S]*?<\/span>)\s*<\/(?:strong|b)>/gi,
		'**$1**',
	);

	// Pattern 3: u + inkwell span
	res = res.replace(
		/<u>\s*(<span\b[^>]*\bdata-inkwell="1"[^>]*>[\s\S]*?<\/span>)\s*<\/u>/gi,
		'<u>$1</u>',
	);

	// Pattern 4: inkwell span containing strong (Cas 1 inverted -> heal to Cas 6 canonical on paste)
	res = res.replace(
		/(<span\b[^>]*\bdata-inkwell="1"[^>]*>)\s*<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>\s*(<\/span>)/gi,
		'**$1$2$3**',
	);

	// Decode HTML entities
	res = decodeHtmlEntities(res);

	return res;
}

/**
 * Converts a plain Markdown text segment to properly escaped HTML (handling &, <, >, bold and newlines).
 */
function formatSegmentToHtml(segment: string): string {
	// First split by markdown bold **...**
	const parts = segment.split(/(\*\*[^*]+\*\*)/g);
	return parts
		.map((part) => {
			if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
				const inner = part.slice(2, -2);
				return `<strong>${escapeHtmlEntities(inner)}</strong>`;
			}
			return escapeHtmlEntities(part).replace(/\n/g, '<br>');
		})
		.join('');
}

/**
 * Creates DOM event handlers for copy, cut, and paste to ensure clipboard integrity
 * without leaving orphan tag fragments or degrading formats.
 */
export function createClipboardSanitizer(options: {
	isActive: (state: EditorState) => boolean;
	isBoldSupported?: () => boolean;
}) {
	return EditorView.domEventHandlers({
		copy(event: ClipboardEvent, view: EditorView): boolean {
			if (!options.isActive(view.state)) return false;
			const { from, to } = view.state.selection.main;
			if (from >= to) return false;

			const doc = view.state.doc;
			const fromLine = doc.lineAt(from).number;
			const toLine = doc.lineAt(to).number;
			const spans = findSimpleSpans(doc, fromLine, toLine, options.isBoldSupported?.() ?? true);

			const sanitized = sanitizeSelectionClipboard(doc, from, to, spans);
			if (!sanitized || !event.clipboardData) return false;

			event.clipboardData.setData('text/plain', sanitized.plainText);
			event.clipboardData.setData('text/html', sanitized.htmlText);
			event.preventDefault();
			return true;
		},
		cut(event: ClipboardEvent, view: EditorView): boolean {
			if (!options.isActive(view.state)) return false;
			const { from, to } = view.state.selection.main;
			if (from >= to) return false;

			const doc = view.state.doc;
			const fromLine = doc.lineAt(from).number;
			const toLine = doc.lineAt(to).number;
			const spans = findSimpleSpans(doc, fromLine, toLine, options.isBoldSupported?.() ?? true);

			const sanitized = sanitizeSelectionClipboard(doc, from, to, spans);
			if (!sanitized || !event.clipboardData) return false;

			event.clipboardData.setData('text/plain', sanitized.plainText);
			event.clipboardData.setData('text/html', sanitized.htmlText);

			// Perform safe deletion via transaction
			view.dispatch({
				changes: { from, to, insert: '' },
				selection: { anchor: from },
				userEvent: 'delete.cut',
			});

			event.preventDefault();
			return true;
		},
		paste(event: ClipboardEvent, view: EditorView): boolean {
			if (!options.isActive(view.state)) return false;
			if (!event.clipboardData) return false;

			const html = event.clipboardData.getData('text/html');
			if (!html || !html.includes('data-inkwell')) {
				return false;
			}

			const markdown = convertInkwellHtmlToMarkdown(html);
			if (!markdown) return false;

			view.dispatch(view.state.replaceSelection(markdown));
			event.preventDefault();
			return true;
		},
	});
}
