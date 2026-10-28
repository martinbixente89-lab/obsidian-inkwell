import {
	Decoration,
	DecorationSet,
	EditorView,
	WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, EditorState } from '@codemirror/state';
import { findFormattingSpansInDoc, SimpleSpan } from './simple-spans';
import { isLightBackground } from '../../format/color-spans';
import { findUnderlineRanges } from '../../format/markdown-formats';
import { findInnerEmphasisSpans } from './inner-markdown';

export class EntityCharWidget extends WidgetType {
	constructor(readonly char: string) {
		super();
	}
	toDOM(): HTMLElement {
		return createSpan({ cls: 'inkwell-entity-char', text: this.char });
	}
	eq(other: EntityCharWidget): boolean {
		return this.char === other.char;
	}
}

export const HIDE_TAG = Decoration.replace({});
export const UNDERLINE_MARK = Decoration.mark({
	attributes: { style: 'text-decoration: underline;' },
});


interface DecoEntry {
	from: number;
	to: number;
	deco: Decoration;
	isReplace?: boolean;
}

/**
 * Builds CSS style string and class names for a formatted span.
 */
function buildSpanStyles(s: SimpleSpan): { markAttributes: Record<string, string>; isBold: boolean } {
	const parsed = s.parsed;
	const isBold = Boolean(s.enclosedInBold || s.innerBold || parsed?.fontWeight === 'bold' || parsed?.fontWeight === '700');
	const isItalic = Boolean(parsed?.fontStyle === 'italic');
	const isUnderline = Boolean(
		s.enclosedInUnderline ||
		s.isUnderlineTag ||
		parsed?.textDecoration?.includes('underline') ||
		parsed?.otherStyles['text-decoration']?.includes('underline'),
	);
	const isStrikethrough = Boolean(
		parsed?.textDecoration?.includes('line-through') ||
		parsed?.otherStyles['text-decoration']?.includes('line-through'),
	);

	let styleAttr = '';
	if (parsed?.color) styleAttr += `color: ${parsed.color};`;
	if (parsed?.highlight) {
		const app = parsed.highlightAppearance;
		const thick = app?.thickness ?? 100;
		const pos = app?.position ?? 0;
		const radius = app?.radius ?? 0;

		if (thick < 100 || pos > 0) {
			const clampedThick = Math.max(10, Math.min(100, thick));
			const clampedPos = Math.max(0, Math.min(100 - clampedThick, pos));
			styleAttr += `background-image: linear-gradient(to top, transparent ${clampedPos}%, ${parsed.highlight} ${clampedPos}%, ${parsed.highlight} ${clampedPos + clampedThick}%, transparent ${clampedPos + clampedThick}%);`;
			if (radius > 0) styleAttr += `border-radius: ${radius}px;`;
			styleAttr += '-webkit-box-decoration-break: clone; box-decoration-break: clone;';
		} else if (radius > 0) {
			styleAttr += `background-color: ${parsed.highlight}; border-radius: ${radius}px; -webkit-box-decoration-break: clone; box-decoration-break: clone;`;
		} else {
			styleAttr += `background-color: ${parsed.highlight};`;
		}
	}
	if (parsed?.fontSize) styleAttr += `font-size: ${parsed.fontSize};`;
	if (parsed?.fontFamily) styleAttr += `font-family: ${parsed.fontFamily};`;
	if (isBold) styleAttr += 'font-weight: bold;';
	if (isItalic) styleAttr += 'font-style: italic;';
	const decorations: string[] = [];
	if (isUnderline) decorations.push('underline');
	if (isStrikethrough) decorations.push('line-through');
	if (decorations.length > 0) {
		styleAttr += `text-decoration: ${decorations.join(' ')};`;
	}

	if (parsed?.otherStyles) {
		for (const [k, v] of Object.entries(parsed.otherStyles)) {
			if (
				k !== 'color' &&
				k !== 'background-color' &&
				k !== 'background-image' &&
				k !== 'border-radius' &&
				k !== 'box-decoration-break' &&
				k !== '-webkit-box-decoration-break' &&
				k !== 'font-size' &&
				k !== 'font-family' &&
				k !== 'font-weight' &&
				k !== 'font-style' &&
				k !== 'text-decoration'
			) {
				styleAttr += `${k}: ${v};`;
			}
		}
	}

	const isLightHl = isLightBackground(parsed?.highlight);
	const needsDarkText = isLightHl && !parsed?.color;

	const markAttributes: Record<string, string> = {};
	if (styleAttr) markAttributes['style'] = styleAttr;
	const classes: string[] = [];
	if (isBold) classes.push('cm-strong');
	if (isItalic) classes.push('cm-em');
	if (isUnderline) classes.push('cm-underline');
	if (isStrikethrough) classes.push('cm-strikethrough');
	if (needsDarkText) {
		classes.push('inkwell-highlight-light');
		markAttributes['data-inkwell'] = '1';
	}
	if (classes.length > 0) markAttributes['class'] = classes.join(' ');

	return { markAttributes, isBold };
}

/**
 * Collects decoration entries (tag hiding and mark styling) for formatting spans.
 */
function collectDecoEntries(
	view: EditorView,
	active: boolean,
	isBoldSupported = true,
	isLivePreviewCheck?: (s: EditorState) => boolean,
): { replaceEntries: DecoEntry[]; markEntries: DecoEntry[] } {
	const replaceEntries: DecoEntry[] = [];
	const markEntries: DecoEntry[] = [];
	if (!active) return { replaceEntries, markEntries };

	const doc = view.state.doc;
	const docText = doc.toString();
	if (!docText.includes('<span') && !docText.includes('<u')) {
		return { replaceEntries, markEntries };
	}

	const allSpans = findFormattingSpansInDoc(docText, isBoldSupported);
	if (allSpans.length === 0) return { replaceEntries, markEntries };

	let targetFrom = 0;
	let targetTo = doc.length;
	if (view.viewport) {
		targetFrom = view.viewport.from;
		targetTo = view.viewport.to;
	}

	const coveredUnderlineRanges = new Set<string>();

	for (const s of allSpans) {
		if (s.spanEnd < targetFrom || s.spanStart > targetTo) continue;

		if (s.isUnderlineTag) {
			// Standalone <u>...</u> tag
			replaceEntries.push({ from: s.spanStart, to: s.innerStart, deco: HIDE_TAG, isReplace: true });
			if (s.innerEnd > s.innerStart) {
				markEntries.push({ from: s.innerStart, to: s.innerEnd, deco: UNDERLINE_MARK });
			}
			replaceEntries.push({ from: s.innerEnd, to: s.spanEnd, deco: HIDE_TAG, isReplace: true });
			coveredUnderlineRanges.add(`${s.spanStart}:${s.spanEnd}`);
			continue;
		}

		const { markAttributes } = buildSpanStyles(s);
		const textMark = Object.keys(markAttributes).length > 0 ? Decoration.mark({ attributes: markAttributes }) : null;

		const openStart = s.enclosedInUnderline ? s.spanStart - (s.uOpenLen ?? 3) : s.spanStart;
		const closeEnd = s.enclosedInUnderline ? s.spanEnd + (s.uCloseLen ?? 4) : s.spanEnd;

		if (s.enclosedInUnderline) {
			coveredUnderlineRanges.add(`${openStart}:${closeEnd}`);
		}

		// 1. Hide opening tag(s) and closing tag(s)
		replaceEntries.push({ from: openStart, to: s.innerStart, deco: HIDE_TAG, isReplace: true });
		replaceEntries.push({ from: s.innerEnd, to: closeEnd, deco: HIDE_TAG, isReplace: true });

		// 2. Base style for entire inner content
		if (textMark && s.innerEnd > s.innerStart) {
			markEntries.push({ from: s.innerStart, to: s.innerEnd, deco: textMark });
		}

		// 3. Inner markdown emphasis (bold, italic, bold-italic)
		const innerText = docText.slice(s.innerStart, s.innerEnd);
		const innerEmphasis = findInnerEmphasisSpans(innerText, s.innerStart, isBoldSupported);

		for (const emp of innerEmphasis) {
			replaceEntries.push({ from: emp.openStart, to: emp.openEnd, deco: HIDE_TAG, isReplace: true });
			replaceEntries.push({ from: emp.closeStart, to: emp.closeEnd, deco: HIDE_TAG, isReplace: true });
			let empCls = '';
			let empStyle = '';
			if (emp.kind === 'strikethrough') {
				empCls = 'cm-strikethrough';
				empStyle = 'text-decoration: line-through;';
			} else if (emp.kind === 'bold') {
				empCls = 'cm-strong';
				empStyle = 'font-weight: bold;';
			} else if (emp.kind === 'italic') {
				empCls = 'cm-em';
				empStyle = 'font-style: italic;';
			} else if (emp.kind === 'bold-italic') {
				empCls = 'cm-strong cm-em';
				empStyle = 'font-weight: bold; font-style: italic;';
			}
			markEntries.push({
				from: emp.contentStart,
				to: emp.contentEnd,
				deco: Decoration.mark({ class: empCls, attributes: { style: empStyle } }),
			});
		}

		// Replace HTML entities (&lt;, &gt;, &amp;) inside span content with visual character widgets
		const visStart = s.innerStart;
		const visEnd = s.innerEnd;
		const innerContent = docText.slice(visStart, visEnd);
		if (innerContent.includes('&')) {
			const entityRegex = /&(lt|gt|amp|quot|apos);/g;
			let em: RegExpExecArray | null;
			while ((em = entityRegex.exec(innerContent)) !== null) {
				const entFrom = visStart + em.index;
				const entTo = entFrom + em[0].length;
				const decoded = em[1] === 'lt' ? '<' : em[1] === 'gt' ? '>' : em[1] === 'amp' ? '&' : em[1] === 'quot' ? '"' : "'";
				replaceEntries.push({
					from: entFrom,
					to: entTo,
					deco: Decoration.replace({ widget: new EntityCharWidget(decoded) }),
					isReplace: true,
				});
			}
		}
	}

	// Also check any standalone <u> in the target range not covered by spans
	if (docText.includes('<u')) {
		const uRanges = findUnderlineRanges(docText);
		for (const u of uRanges) {
			if (u.to < targetFrom || u.from > targetTo) continue;

			const isCovered = Array.from(coveredUnderlineRanges).some((key) => {
				const [sFrom, sTo] = key.split(':').map(Number);
				return u.from === sFrom && u.to === sTo;
			});

			if (!isCovered && u.innerTo > u.innerFrom) {
				replaceEntries.push({ from: u.from, to: u.innerFrom, deco: HIDE_TAG, isReplace: true });
				markEntries.push({ from: u.innerFrom, to: u.innerTo, deco: UNDERLINE_MARK });
				replaceEntries.push({ from: u.innerTo, to: u.to, deco: HIDE_TAG, isReplace: true });
			}
		}
	}

	return { replaceEntries, markEntries };
}

/**
 * Builds separate DecorationSets for tag hiding (replace) and text styling (mark).
 */
export function buildSplitTagDecorations(
	view: EditorView,
	active: boolean,
	isBoldSupported = true,
	isLivePreviewCheck?: (s: EditorState) => boolean,
): { replaceSet: DecorationSet; markSet: DecorationSet } {
	const { replaceEntries, markEntries } = collectDecoEntries(view, active, isBoldSupported, isLivePreviewCheck);

	// Sort replace entries: strictly disjoint tag substrings
	replaceEntries.sort((a, b) => a.from - b.from || a.to - b.to);
	const replaceBuilder = new RangeSetBuilder<Decoration>();
	let lastTo = -1;
	for (const e of replaceEntries) {
		if (e.from >= lastTo) {
			replaceBuilder.add(e.from, e.to, e.deco);
			lastTo = e.to;
		}
	}

	// Sort mark entries: from ascending, then outer before inner (to descending)
	markEntries.sort((a, b) => a.from - b.from || b.to - a.to);
	const markBuilder = new RangeSetBuilder<Decoration>();
	for (const e of markEntries) {
		markBuilder.add(e.from, e.to, e.deco);
	}

	return {
		replaceSet: replaceBuilder.finish(),
		markSet: markBuilder.finish(),
	};
}

/**
 * Builds unified tag decorations for direct backwards-compatibility with tests.
 */
export function buildUnfoldedTagDecorations(
	view: EditorView,
	active: boolean,
	isBoldSupported = true,
	isLivePreviewCheck?: (s: EditorState) => boolean,
): DecorationSet {
	const { replaceEntries, markEntries } = collectDecoEntries(view, active, isBoldSupported, isLivePreviewCheck);
	const allEntries = [...replaceEntries, ...markEntries];

	// Sort strictly: from ascending, then outer before inner
	allEntries.sort((a, b) => a.from - b.from || b.to - a.to);

	const builder = new RangeSetBuilder<Decoration>();
	let lastReplaceTo = -1;
	for (const e of allEntries) {
		if (e.isReplace) {
			if (e.from >= lastReplaceTo) {
				builder.add(e.from, e.to, e.deco);
				lastReplaceTo = e.to;
			}
		} else {
			builder.add(e.from, e.to, e.deco);
		}
	}
	return builder.finish();
}
