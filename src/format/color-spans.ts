/**
 * Pure text logic for Inkwell color & highlight spans (V0.3.0).
 * Decoupled from Obsidian API so it can be tested in isolation.
 *
 * Concepts:
 * - A line is parsed into segments: plain text, Inkwell-managed spans, or unmarked HTML spans.
 * - Spans managed by Inkwell carry the explicit attribute `data-inkwell="1"`.
 * - Inkwell manages two style properties: `color` and `background-color`.
 * - Applying a style preserves the other style (color + highlight coexist in a single span).
 * - Removing a style preserves the other style.
 * - When neither color nor highlight remains, `data-inkwell="1"` is removed.
 * - If no other attributes or styles remain on the span, the <span> tag is removed completely.
 * - Unmarked spans (spans without data-inkwell="1") are strictly protected:
 *   Inkwell commands refuse to modify or nest inside them without explicit adoption.
 * - Code blocks and inline code are protected: spans within them are never parsed or adopted.
 */

export interface HighlightAppearance {
	radius?: number; // border-radius in px (e.g. 0 to 12)
	thickness?: number; // band height in % (e.g. 15 to 100)
	position?: number; // vertical offset in % (e.g. 0 to 85)
}

export function isSameAppearance(
	a?: HighlightAppearance | null,
	b?: HighlightAppearance | null,
): boolean {
	const aRad = a?.radius ?? 0;
	const bRad = b?.radius ?? 0;
	const aThick = a?.thickness ?? 100;
	const bThick = b?.thickness ?? 100;
	const aPos = a?.position ?? 0;
	const bPos = b?.position ?? 0;
	return aRad === bRad && aThick === bThick && aPos === bPos;
}

export interface SpanAttributes {
	isInkwell: boolean;
	color: string | null;
	highlight: string | null;
	highlightAppearance?: HighlightAppearance | null;
	fontSize: string | null;
	fontFamily: string | null;
	fontWeight?: string | null;
	fontStyle?: string | null;
	textDecoration?: string | null;
	otherStyles: Record<string, string>;
	otherAttrs: Record<string, string>;
}

export interface Segment {
	text: string;
	isInkwell: boolean;
	isUnmarked: boolean;
	color: string | null;
	highlight: string | null;
	highlightAppearance?: HighlightAppearance | null;
	fontSize: string | null;
	fontFamily: string | null;
	fontWeight?: string | null;
	fontStyle?: string | null;
	textDecoration?: string | null;
	otherStyles: Record<string, string>;
	otherAttrs: Record<string, string>;
	raw: string | null;
}

export interface ParsedSegment extends Segment {
	rawStart: number;
	rawEnd: number;
	innerStart: number;
	contentStart: number;
}

export interface TransformResult {
	text: string;
	from: number;
	to: number;
}

/**
 * Calculates whether a color string (hex or rgb/rgba) represents a light background
 * (relative luminance > 0.45), indicating that dark text is required for contrast.
 */
export function isLightBackground(colorStr: string | null | undefined): boolean {
	if (!colorStr) return false;
	const trimmed = colorStr.trim().toLowerCase();
	if (trimmed.startsWith('#')) {
		let hex = trimmed.slice(1);
		if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
		if (hex.length >= 6) {
			const r = parseInt(hex.slice(0, 2), 16) / 255;
			const g = parseInt(hex.slice(2, 4), 16) / 255;
			const b = parseInt(hex.slice(4, 6), 16) / 255;
			const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			return lum > 0.45;
		}
	}
	const match = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (match && match[1] && match[2] && match[3]) {
		const r = parseInt(match[1], 10) / 255;
		const g = parseInt(match[2], 10) / 255;
		const b = parseInt(match[3], 10) / 255;
		const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		return lum > 0.45;
	}
	return false;
}

export type OperationType =
	| { type: 'set-color'; color: string }
	| { type: 'set-highlight'; highlight: string; appearance?: HighlightAppearance | null }
	| { type: 'set-highlight-appearance'; appearance: HighlightAppearance | null }
	| { type: 'remove-color' }
	| { type: 'remove-highlight' }
	| { type: 'remove-highlight-appearance' }
	| { type: 'set-size'; size: string }
	| { type: 'set-font-family'; fontFamily: string | null }
	| { type: 'remove-size' }
	| { type: 'remove-font-family' }
	| { type: 'set-bold' }
	| { type: 'remove-bold' }
	| { type: 'toggle-bold' }
	| { type: 'set-italic' }
	| { type: 'remove-italic' }
	| { type: 'toggle-italic' }
	| { type: 'set-underline' }
	| { type: 'remove-underline' }
	| { type: 'toggle-underline' }
	| { type: 'set-strikethrough' }
	| { type: 'remove-strikethrough' }
	| { type: 'toggle-strikethrough' }
	| { type: 'clear-all' };

export function addDecoration(current: string | null | undefined, deco: 'underline' | 'line-through'): string {
	if (!current) return deco;
	const parts = current.split(/\s+/).filter(Boolean);
	if (!parts.includes(deco)) {
		parts.push(deco);
	}
	return parts.join(' ');
}

export function removeDecoration(current: string | null | undefined, deco: 'underline' | 'line-through'): string | null {
	if (!current) return null;
	const parts = current.split(/\s+/).filter((p) => p !== deco && p !== 'none');
	return parts.length > 0 ? parts.join(' ') : null;
}

export function hasDecoration(current: string | null | undefined, deco: 'underline' | 'line-through'): boolean {
	if (!current) return false;
	return current.split(/\s+/).includes(deco);
}

/**
 * Parses a style attribute string into a key-value dictionary.
 */
export function parseStyleAttr(styleStr: string): Record<string, string> {
	const styles: Record<string, string> = {};
	const parts = styleStr.split(';');
	for (const part of parts) {
		const colon = part.indexOf(':');
		if (colon === -1) continue;
		const prop = part.slice(0, colon).trim().toLowerCase();
		const val = part.slice(colon + 1).trim();
		if (prop && val) {
			styles[prop] = val;
		}
	}
	return styles;
}

/**
 * Serializes style properties into a CSS style attribute string.
 */
export function serializeStyleAttr(
	color: string | null,
	highlight: string | null,
	fontSize: string | null,
	fontFamily: string | null,
	otherStyles: Record<string, string>,
	highlightAppearance?: HighlightAppearance | null,
	fontWeight?: string | null,
	fontStyle?: string | null,
	textDecoration?: string | null,
): string | null {
	const parts: string[] = [];
	if (color) {
		parts.push(`color: ${color}`);
	}
	if (highlight) {
		const thick = highlightAppearance?.thickness ?? 100;
		const pos = highlightAppearance?.position ?? 0;
		const radius = highlightAppearance?.radius ?? 0;

		if (thick < 100 || pos > 0) {
			const clampedThick = Math.max(10, Math.min(100, thick));
			const clampedPos = Math.max(0, Math.min(100 - clampedThick, pos));
			parts.push(
				`background-image: linear-gradient(to top, transparent ${clampedPos}%, ${highlight} ${clampedPos}%, ${highlight} ${clampedPos + clampedThick}%, transparent ${clampedPos + clampedThick}%)`,
			);
			if (radius > 0) {
				parts.push(`border-radius: ${radius}px`);
			}
			parts.push('-webkit-box-decoration-break: clone');
			parts.push('box-decoration-break: clone');
		} else if (radius > 0) {
			parts.push(`background-color: ${highlight}`);
			parts.push(`border-radius: ${radius}px`);
			parts.push('-webkit-box-decoration-break: clone');
			parts.push('box-decoration-break: clone');
		} else {
			parts.push(`background-color: ${highlight}`);
		}
	}
	if (fontSize) {
		parts.push(`font-size: ${fontSize}`);
	}
	if (fontFamily) {
		parts.push(`font-family: ${fontFamily}`);
	}
	if (fontWeight) {
		parts.push(`font-weight: ${fontWeight}`);
	}
	if (fontStyle) {
		parts.push(`font-style: ${fontStyle}`);
	}
	if (textDecoration) {
		parts.push(`text-decoration: ${textDecoration}`);
	}
	for (const [k, v] of Object.entries(otherStyles)) {
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
			parts.push(`${k}: ${v}`);
		}
	}
	return parts.length > 0 ? parts.join('; ') + ';' : null;
}

/**
 * Parses raw HTML attributes of a <span> opening tag.
 */
export function parseTagAttributes(attrsStr: string): SpanAttributes {
	const otherAttrs: Record<string, string> = {};
	let isInkwell = false;
	let styleStr: string | null = null;

	// Regex matching key="value" or standalone keys
	const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
	let match: RegExpExecArray | null;

	while ((match = attrRegex.exec(attrsStr)) !== null) {
		const rawName = match[1];
		if (!rawName) continue;
		const name = rawName.toLowerCase();
		const val = match[2] ?? match[3] ?? match[4] ?? '';

		if (name === 'data-inkwell') {
			isInkwell = true;
		} else if (name === 'style') {
			styleStr = val;
		} else {
			otherAttrs[rawName] = val;
		}
	}

	const parsedStyles = styleStr ? parseStyleAttr(styleStr) : {};
	const color = parsedStyles['color'] ?? null;
	let highlight = parsedStyles['background-color'] ?? null;
	let highlightAppearance: HighlightAppearance | null = null;

	const bgImg = parsedStyles['background-image'];
	if (bgImg && bgImg.includes('linear-gradient')) {
		const colorMatch = bgImg.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|hsla?\([^)]+\))/);
		if (colorMatch) {
			highlight = colorMatch[1] ?? colorMatch[0];
		}
		const stops = Array.from(bgImg.matchAll(/(\d+)%/g)).map((m) => parseInt(m[1] ?? '0', 10));
		if (stops.length >= 2) {
			const sorted = Array.from(new Set(stops)).sort((a, b) => a - b);
			if (sorted.length >= 2) {
				const pos = sorted[0] ?? 0;
				const end = sorted[1] ?? 100;
				const thick = Math.max(10, Math.min(100, end - pos));
				highlightAppearance = {
					thickness: thick,
					position: pos,
				};
			}
		}
	}

	const radiusStr = parsedStyles['border-radius'];
	if (radiusStr) {
		const r = parseInt(radiusStr, 10);
		if (!isNaN(r) && r > 0) {
			highlightAppearance = {
				...(highlightAppearance ?? { thickness: 100, position: 0 }),
				radius: r,
			};
		}
	}

	const fontSize = parsedStyles['font-size'] ?? null;
	const fontFamily = parsedStyles['font-family'] ?? null;
	const fontWeight = parsedStyles['font-weight'] ?? null;
	const fontStyle = parsedStyles['font-style'] ?? null;
	const textDecoration = parsedStyles['text-decoration'] ?? null;

	const otherStyles: Record<string, string> = {};
	for (const [k, v] of Object.entries(parsedStyles)) {
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
			otherStyles[k] = v;
		}
	}

	return {
		isInkwell,
		color,
		highlight,
		highlightAppearance,
		fontSize,
		fontFamily,
		fontWeight,
		fontStyle,
		textDecoration,
		otherStyles,
		otherAttrs,
	};
}

/**
 * Builds a <span> tag or returns plain text if all formatting is removed.
 */
export function buildSpan(
	text: string,
	attrs: {
		isInkwell: boolean;
		color: string | null;
		highlight: string | null;
		highlightAppearance?: HighlightAppearance | null;
		fontSize?: string | null;
		fontFamily?: string | null;
		fontWeight?: string | null;
		fontStyle?: string | null;
		textDecoration?: string | null;
		otherStyles?: Record<string, string>;
		otherAttrs?: Record<string, string>;
	},
): string {
	const otherStyles = attrs.otherStyles ?? {};
	const otherAttrs = attrs.otherAttrs ?? {};
	const fontSize = attrs.fontSize ?? null;
	const fontFamily = attrs.fontFamily ?? null;
	const highlightAppearance = attrs.highlightAppearance ?? null;
	const fontWeight = attrs.fontWeight ?? null;
	const fontStyle = attrs.fontStyle ?? null;
	const textDecoration = attrs.textDecoration ?? null;

	const hasManagedStyles =
		attrs.color !== null ||
		attrs.highlight !== null ||
		fontSize !== null ||
		fontFamily !== null ||
		Boolean(fontWeight) ||
		Boolean(fontStyle) ||
		Boolean(textDecoration);
	const shouldBeInkwell = attrs.isInkwell && hasManagedStyles;

	const styleVal = serializeStyleAttr(
		attrs.color,
		attrs.highlight,
		fontSize,
		fontFamily,
		otherStyles,
		highlightAppearance,
		fontWeight,
		fontStyle,
		textDecoration,
	);

	const attrParts: string[] = [];

	if (shouldBeInkwell) {
		attrParts.push('data-inkwell="1"');
	}

	for (const [k, v] of Object.entries(otherAttrs)) {
		if (k.toLowerCase() === 'data-inkwell') continue;
		attrParts.push(v ? `${k}="${v}"` : k);
	}

	if (styleVal) {
		attrParts.push(`style="${styleVal}"`);
	}

	if (attrParts.length === 0) {
		// No attributes remaining: strip the span tag completely
		return text;
	}

	return `<span ${attrParts.join(' ')}>${text}</span>`;
}

/**
 * Finds regions on a line that are inside inline code (`...`).
 */
function findInlineCodeRanges(line: string): Array<{ from: number; to: number }> {
	const ranges: Array<{ from: number; to: number }> = [];
	const regex = /`([^`]+)`/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(line)) !== null) {
		ranges.push({ from: match.index, to: match.index + match[0].length });
	}
	return ranges;
}

/**
 * Splits a line into parsed segments, taking code exclusions into account.
 */
export function parseLine(line: string): ParsedSegment[] {
	const segments: ParsedSegment[] = [];
	const codeRanges = findInlineCodeRanges(line);
	const spanRegex = /<span\b([^>]*)>((?:(?!<span\b)[^])*?)<\/span>/gi;

	let rawPos = 0;
	let contentPos = 0;

	const pushPlain = (end: number) => {
		if (end <= rawPos) return;
		const text = line.slice(rawPos, end);
		segments.push({
			text,
			isInkwell: false,
			isUnmarked: false,
			color: null,
			highlight: null,
			highlightAppearance: null,
			fontSize: null,
			fontFamily: null,
			fontWeight: null,
			fontStyle: null,
			textDecoration: null,
			otherStyles: {},
			otherAttrs: {},
			raw: text,
			rawStart: rawPos,
			rawEnd: end,
			innerStart: rawPos,
			contentStart: contentPos,
		});
		contentPos += text.length;
		rawPos = end;
	};

	let match: RegExpExecArray | null;
	while ((match = spanRegex.exec(line)) !== null) {
		const start = match.index;
		const raw = match[0];
		const end = start + raw.length;

		// Check if inside inline code
		const insideCode = codeRanges.some((r) => start >= r.from && end <= r.to);
		if (insideCode) {
			continue;
		}

		pushPlain(start);

		const attrsStr = match[1] ?? '';
		const innerText = match[2] ?? '';
		const attrs = parseTagAttributes(attrsStr);
		const closingTagLen = '</span>'.length;
		const innerStart = end - closingTagLen - innerText.length;

		const hasFormatting =
			attrs.color !== null ||
			attrs.highlight !== null ||
			attrs.fontSize !== null ||
			attrs.fontFamily !== null ||
			Boolean(attrs.fontWeight) ||
			Boolean(attrs.fontStyle) ||
			Boolean(attrs.textDecoration) ||
			Boolean(attrs.otherStyles['text-decoration']);
		const isThirdParty = Object.keys(attrs.otherAttrs).length > 0;
		const isManaged = attrs.isInkwell || (hasFormatting && !isThirdParty);

		segments.push({
			text: innerText,
			isInkwell: isManaged,
			isUnmarked: !isManaged,
			color: attrs.color,
			highlight: attrs.highlight,
			highlightAppearance: attrs.highlightAppearance,
			fontSize: attrs.fontSize,
			fontFamily: attrs.fontFamily,
			fontWeight: attrs.fontWeight ?? null,
			fontStyle: attrs.fontStyle ?? null,
			textDecoration: attrs.textDecoration ?? null,
			otherStyles: attrs.otherStyles,
			otherAttrs: attrs.otherAttrs,
			raw,
			rawStart: start,
			rawEnd: end,
			innerStart,
			contentStart: contentPos,
		});

		contentPos += innerText.length;
		rawPos = end;
	}

	pushPlain(line.length);
	return segments;
}

/**
 * Converts a raw offset into a visible-text offset.
 */
export function rawToContent(segments: ParsedSegment[], pos: number): number {
	for (const seg of segments) {
		if (pos > seg.rawEnd) continue;
		const innerEnd = seg.innerStart + seg.text.length;
		const clamped = Math.min(Math.max(pos, seg.innerStart), innerEnd);
		return seg.contentStart + (clamped - seg.innerStart);
	}
	const last = segments[segments.length - 1];
	return last ? last.contentStart + last.text.length : 0;
}

/**
 * In Live Preview, Obsidian renders a whole `<span …>…</span>` as one widget.
 * Converts an offset in the widget's visible text into a raw offset of `line`.
 */
export function embedOffsetToRaw(
	line: string,
	widgetStart: number,
	visible: string,
	visibleOffset: number,
	edge: 'start' | 'end',
): number | null {
	if (widgetStart < 0 || widgetStart >= line.length) return null;

	let raw = widgetStart;
	// Skip opening tags at start of widget (e.g. <u> or <span...>)
	while (raw < line.length && line[raw] === '<') {
		const close = line.indexOf('>', raw);
		if (close === -1) break;
		raw = close + 1;
	}

	let visIdx = 0;
	while (raw < line.length && visIdx < visibleOffset) {
		if (line[raw] === '<') {
			const close = line.indexOf('>', raw);
			if (close !== -1) {
				raw = close + 1;
				continue;
			}
		}
		if (line[raw] === visible[visIdx]) {
			visIdx++;
		}
		raw++;
	}

	return raw;
}

function areStylesIdentical(a: Record<string, string>, b: Record<string, string>): boolean {
	const kA = Object.keys(a);
	const kB = Object.keys(b);
	if (kA.length !== kB.length) return false;
	return kA.every((k) => a[k] === b[k]);
}

function areAttrsIdentical(a: Record<string, string>, b: Record<string, string>): boolean {
	const kA = Object.keys(a);
	const kB = Object.keys(b);
	if (kA.length !== kB.length) return false;
	return kA.every((k) => a[k] === b[k]);
}

/**
 * Normalizes segments: drops empty text and merges adjacent segments
 * ONLY IF they share identical formatting and attributes.
 */
function normalize(segments: Segment[]): Segment[] {
	const result: Segment[] = [];
	for (const seg of segments) {
		if (seg.text === '') continue;
		const prev = result[result.length - 1];
		const canMerge =
			prev &&
			prev.isInkwell === seg.isInkwell &&
			prev.isUnmarked === seg.isUnmarked &&
			prev.color === seg.color &&
			prev.highlight === seg.highlight &&
			isSameAppearance(prev.highlightAppearance, seg.highlightAppearance) &&
			prev.fontSize === seg.fontSize &&
			prev.fontFamily === seg.fontFamily &&
			prev.fontWeight === seg.fontWeight &&
			prev.fontStyle === seg.fontStyle &&
			prev.textDecoration === seg.textDecoration &&
			areStylesIdentical(prev.otherStyles, seg.otherStyles) &&
			areAttrsIdentical(prev.otherAttrs, seg.otherAttrs) &&
			(prev.raw === null || seg.raw === null);

		if (canMerge) {
			prev.text += seg.text;
			prev.raw = null;
		} else {
			result.push({ ...seg });
		}
	}
	return result;
}

/**
 * Applies an operation to a visible text range [from, to).
 */
function splitAndTransform(
	segments: ParsedSegment[],
	from: number,
	to: number,
	op: OperationType,
	initialStyles?: LegacyAbsorptionResult,
): Segment[] {
	const result: Segment[] = [];

	for (const seg of segments) {
		const a = seg.contentStart;
		const b = a + seg.text.length;

		if (b <= from || a >= to) {
			result.push({
				text: seg.text,
				isInkwell: seg.isInkwell,
				isUnmarked: seg.isUnmarked,
				color: seg.color,
				highlight: seg.highlight,
				highlightAppearance: seg.highlightAppearance,
				fontSize: seg.fontSize,
				fontFamily: seg.fontFamily,
				fontWeight: seg.fontWeight,
				fontStyle: seg.fontStyle,
				textDecoration: seg.textDecoration,
				otherStyles: seg.otherStyles,
				otherAttrs: seg.otherAttrs,
				raw: seg.raw,
			});
			continue;
		}

		const cutStart = Math.max(from, a) - a;
		const cutEnd = Math.min(to, b) - a;

		// Slices
		const left = seg.text.slice(0, cutStart);
		const mid = seg.text.slice(cutStart, cutEnd);
		const right = seg.text.slice(cutEnd);

		if (left) {
			result.push({
				text: left,
				isInkwell: seg.isInkwell,
				isUnmarked: seg.isUnmarked,
				color: seg.color,
				highlight: seg.highlight,
				highlightAppearance: seg.highlightAppearance,
				fontSize: seg.fontSize,
				fontFamily: seg.fontFamily,
				fontWeight: seg.fontWeight,
				fontStyle: seg.fontStyle,
				textDecoration: seg.textDecoration,
				otherStyles: seg.otherStyles,
				otherAttrs: seg.otherAttrs,
				raw: null,
			});
		}

		// Compute transformed mid
		let newColor = seg.color;
		let newHighlight = seg.highlight;
		let newHighlightAppearance = seg.highlightAppearance;
		let newFontSize = seg.fontSize;
		let newFontFamily = seg.fontFamily;
		let newFontWeight = seg.fontWeight ?? (initialStyles?.initialBold ? 'bold' : null);
		let newFontStyle = seg.fontStyle ?? (initialStyles?.initialItalic ? 'italic' : null);
		let newTextDecoration = seg.textDecoration ?? null;
		if (initialStyles?.initialStrike && !hasDecoration(newTextDecoration, 'line-through')) {
			newTextDecoration = addDecoration(newTextDecoration, 'line-through');
		}
		if (initialStyles?.initialUnderline && !hasDecoration(newTextDecoration, 'underline')) {
			newTextDecoration = addDecoration(newTextDecoration, 'underline');
		}
		let isInkwell = true;

		switch (op.type) {
			case 'set-color':
				newColor = op.color;
				break;
			case 'set-highlight':
				newHighlight = op.highlight;
				if (op.appearance !== undefined) {
					newHighlightAppearance = op.appearance;
				}
				break;
			case 'set-highlight-appearance':
				if (newHighlight !== null) {
					newHighlightAppearance = op.appearance;
				}
				break;
			case 'remove-color':
				newColor = null;
				break;
			case 'remove-highlight':
				newHighlight = null;
				newHighlightAppearance = null;
				break;
			case 'remove-highlight-appearance':
				newHighlightAppearance = null;
				break;
			case 'set-size':
				newFontSize = op.size;
				break;
			case 'set-font-family':
				newFontFamily = op.fontFamily;
				break;
			case 'remove-size':
				newFontSize = null;
				break;
			case 'remove-font-family':
				newFontFamily = null;
				break;
			case 'set-bold':
				newFontWeight = 'bold';
				break;
			case 'remove-bold':
				newFontWeight = null;
				break;
			case 'set-italic':
				newFontStyle = 'italic';
				break;
			case 'remove-italic':
				newFontStyle = null;
				break;
			case 'set-underline':
				newTextDecoration = addDecoration(newTextDecoration, 'underline');
				break;
			case 'remove-underline':
				newTextDecoration = removeDecoration(newTextDecoration, 'underline');
				break;
			case 'set-strikethrough':
				newTextDecoration = addDecoration(newTextDecoration, 'line-through');
				break;
			case 'remove-strikethrough':
				newTextDecoration = removeDecoration(newTextDecoration, 'line-through');
				break;
			case 'clear-all':
				newColor = null;
				newHighlight = null;
				newHighlightAppearance = null;
				newFontSize = null;
				newFontFamily = null;
				newFontWeight = null;
				newFontStyle = null;
				newTextDecoration = null;
				break;
		}

		if (
			newColor === null &&
			newHighlight === null &&
			newFontSize === null &&
			newFontFamily === null &&
			newFontWeight === null &&
			newFontStyle === null &&
			newTextDecoration === null
		) {
			isInkwell = false;
		}

		result.push({
			text: mid,
			isInkwell,
			isUnmarked: false,
			color: newColor,
			highlight: newHighlight,
			highlightAppearance: newHighlightAppearance,
			fontSize: newFontSize,
			fontFamily: newFontFamily,
			fontWeight: newFontWeight,
			fontStyle: newFontStyle,
			textDecoration: newTextDecoration,
			otherStyles: { ...seg.otherStyles },
			otherAttrs: { ...seg.otherAttrs },
			raw: null,
		});

		if (right) {
			result.push({
				text: right,
				isInkwell: seg.isInkwell,
				isUnmarked: seg.isUnmarked,
				color: seg.color,
				highlight: seg.highlight,
				highlightAppearance: seg.highlightAppearance,
				fontSize: seg.fontSize,
				fontFamily: seg.fontFamily,
				fontWeight: seg.fontWeight,
				fontStyle: seg.fontStyle,
				textDecoration: seg.textDecoration,
				otherStyles: seg.otherStyles,
				otherAttrs: seg.otherAttrs,
				raw: null,
			});
		}
	}

	return result;
}

export interface TransformLineResult {
	success: boolean;
	result?: TransformResult;
	errorReason?: 'unmarked_span' | 'no_target' | 'no_change' | 'markdown_prefix';
}

/**
 * Returns length of heading, list item, or task list prefix on a line.
 * Heading: "# ", "## ", etc.
 * Task list: "- [ ] ", "- [x] ", "1. [ ] ", etc.
 * List item: "- ", "* ", "+ ", "1. "
 */
export function getLinePrefixLength(line: string): number {
	// Task list: e.g. "- [ ] " or "1. [x] "
	const taskMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+)/);
	if (taskMatch?.[1]) return taskMatch[1].length;

	// Standard heading: "# ", "## ", etc.
	const headingMatch = line.match(/^(#{1,6}\s+)/);
	if (headingMatch?.[1]) return headingMatch[1].length;

	// Standard list item: "- ", "* ", "+ ", "1. "
	const listMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)/);
	if (listMatch?.[1]) return listMatch[1].length;

	return 0;
}

export interface LegacyAbsorptionResult {
	cleanedLine: string;
	adjustedFrom: number;
	adjustedTo: number;
	initialBold?: boolean;
	initialItalic?: boolean;
	initialStrike?: boolean;
	initialUnderline?: boolean;
}

/**
 * Detects, absorbs, and cleans legacy markdown/HTML formatting (**, *, ~~, <u>)
 * that is targeted or enclosed by the selection, preventing HTML from being piled on top.
 */
export function absorbLegacyFormatting(
	line: string,
	rawFrom: number,
	rawTo: number,
): LegacyAbsorptionResult {
	const codeRanges = findInlineCodeRanges(line);
	let from = Math.min(rawFrom, rawTo);
	let to = Math.max(rawFrom, rawTo);
	let currentLine = line;

	let initialBold = false;
	let initialItalic = false;
	let initialStrike = false;
	let initialUnderline = false;

	const isCode = (pos: number) => codeRanges.some((r) => pos >= r.from && pos <= r.to);
	if (isCode(from) || isCode(to)) {
		return { cleanedLine: line, adjustedFrom: from, adjustedTo: to };
	}

	// 1. Check enclosed in selection: e.g. selection is "**texte**" or "~~texte~~"
	let selText = currentLine.slice(from, to);

	// Enclosed <u>...</u>
	const uEnclosed = selText.match(/^<u\b[^>]*>([\s\S]*?)<\/u>$/i);
	if (uEnclosed && !isCode(from)) {
		initialUnderline = true;
		currentLine = currentLine.slice(0, from) + uEnclosed[1] + currentLine.slice(to);
		to = from + (uEnclosed[1]?.length ?? 0);
		selText = currentLine.slice(from, to);
	}

	// Enclosed ~~...~~
	if (selText.startsWith('~~') && selText.endsWith('~~') && selText.length >= 4 && !isCode(from)) {
		initialStrike = true;
		currentLine = currentLine.slice(0, from) + selText.slice(2, -2) + currentLine.slice(to);
		to = from + selText.length - 4;
		selText = currentLine.slice(from, to);
	}

	// Enclosed ***...***
	if (selText.startsWith('***') && selText.endsWith('***') && selText.length >= 6 && !isCode(from)) {
		initialBold = true;
		initialItalic = true;
		currentLine = currentLine.slice(0, from) + selText.slice(3, -3) + currentLine.slice(to);
		to = from + selText.length - 6;
		selText = currentLine.slice(from, to);
	}

	// Enclosed **...**
	if (selText.startsWith('**') && selText.endsWith('**') && selText.length >= 4 && !isCode(from)) {
		initialBold = true;
		currentLine = currentLine.slice(0, from) + selText.slice(2, -2) + currentLine.slice(to);
		to = from + selText.length - 4;
		selText = currentLine.slice(from, to);
	}

	// Enclosed *...*
	if (
		selText.startsWith('*') &&
		selText.endsWith('*') &&
		selText.length >= 2 &&
		!selText.startsWith('**') &&
		!isCode(from)
	) {
		initialItalic = true;
		currentLine = currentLine.slice(0, from) + selText.slice(1, -1) + currentLine.slice(to);
		to = from + selText.length - 2;
		selText = currentLine.slice(from, to);
	}

	// 2. Check enclosing selection: e.g. "**" is immediately before from, and "**" is immediately after to
	// Enclosing <u>...</u>
	const beforeU = currentLine.slice(0, from);
	const afterU = currentLine.slice(to);
	const uOpenMatch = beforeU.match(/<u\b[^>]*>$/i);
	const uCloseMatch = afterU.match(/^<\/u>/i);
	if (uOpenMatch && uCloseMatch && !isCode(from - 1)) {
		initialUnderline = true;
		const openLen = uOpenMatch[0].length;
		const closeLen = uCloseMatch[0].length;
		currentLine =
			currentLine.slice(0, from - openLen) +
			currentLine.slice(from, to) +
			currentLine.slice(to + closeLen);
		from -= openLen;
		to -= openLen;
	}

	// Enclosing ~~...~~
	if (
		from >= 2 &&
		to + 2 <= currentLine.length &&
		currentLine.slice(from - 2, from) === '~~' &&
		currentLine.slice(to, to + 2) === '~~' &&
		!isCode(from - 2)
	) {
		initialStrike = true;
		currentLine =
			currentLine.slice(0, from - 2) + currentLine.slice(from, to) + currentLine.slice(to + 2);
		from -= 2;
		to -= 2;
	}

	// Enclosing ***...***
	if (
		from >= 3 &&
		to + 3 <= currentLine.length &&
		currentLine.slice(from - 3, from) === '***' &&
		currentLine.slice(to, to + 3) === '***' &&
		!isCode(from - 3)
	) {
		initialBold = true;
		initialItalic = true;
		currentLine =
			currentLine.slice(0, from - 3) + currentLine.slice(from, to) + currentLine.slice(to + 3);
		from -= 3;
		to -= 3;
	}

	// Enclosing **...**
	if (
		from >= 2 &&
		to + 2 <= currentLine.length &&
		currentLine.slice(from - 2, from) === '**' &&
		currentLine.slice(to, to + 2) === '**' &&
		!isCode(from - 2)
	) {
		initialBold = true;
		currentLine =
			currentLine.slice(0, from - 2) + currentLine.slice(from, to) + currentLine.slice(to + 2);
		from -= 2;
		to -= 2;
	}

	// Enclosing *...*
	if (
		from >= 1 &&
		to + 1 <= currentLine.length &&
		currentLine[from - 1] === '*' &&
		currentLine[to] === '*' &&
		(from < 2 || currentLine[from - 2] !== '*') &&
		(to + 1 >= currentLine.length || currentLine[to + 1] !== '*') &&
		!isCode(from - 1)
	) {
		initialItalic = true;
		currentLine =
			currentLine.slice(0, from - 1) + currentLine.slice(from, to) + currentLine.slice(to + 1);
		from -= 1;
		to -= 1;
	}

	// 3. Check if selection is on/inside a span that is enclosed in delimiters (Cas 6), or whose inner text has delimiters (Cas 1)
	const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
	let sm: RegExpExecArray | null;
	while ((sm = spanRegex.exec(currentLine)) !== null) {
		const spanStart = sm.index;
		const spanEnd = spanStart + sm[0].length;
		const openTagLen = sm[0].indexOf('>') + 1;
		const innerStart = spanStart + openTagLen;
		const innerEnd = spanEnd - '</span>'.length;
		const innerText = sm[2] ?? '';

		if (from >= innerStart && to <= innerEnd) {
			// A. Outer enclosure around the whole span (Cas 6)
			if (
				spanStart >= 2 &&
				spanEnd + 2 <= currentLine.length &&
				currentLine.slice(spanStart - 2, spanStart) === '**' &&
				currentLine.slice(spanEnd, spanEnd + 2) === '**' &&
				!isCode(spanStart - 2)
			) {
				initialBold = true;
				currentLine =
					currentLine.slice(0, spanStart - 2) +
					currentLine.slice(spanStart, spanEnd) +
					currentLine.slice(spanEnd + 2);
				from -= 2;
				to -= 2;
			} else if (
				spanStart >= 2 &&
				spanEnd + 2 <= currentLine.length &&
				currentLine.slice(spanStart - 2, spanStart) === '~~' &&
				currentLine.slice(spanEnd, spanEnd + 2) === '~~' &&
				!isCode(spanStart - 2)
			) {
				initialStrike = true;
				currentLine =
					currentLine.slice(0, spanStart - 2) +
					currentLine.slice(spanStart, spanEnd) +
					currentLine.slice(spanEnd + 2);
				from -= 2;
				to -= 2;
			}

			// B. Inner enclosure within span innerText (Cas 1)
			if (
				innerText.startsWith('**') &&
				innerText.endsWith('**') &&
				innerText.length >= 4 &&
				!isCode(innerStart)
			) {
				initialBold = true;
				const newInner = innerText.slice(2, -2);
				currentLine =
					currentLine.slice(0, innerStart) +
					newInner +
					currentLine.slice(innerEnd);
				from = Math.max(innerStart, from - 2);
				to = Math.max(from, to - 2);
			} else if (
				innerText.startsWith('~~') &&
				innerText.endsWith('~~') &&
				innerText.length >= 4 &&
				!isCode(innerStart)
			) {
				initialStrike = true;
				const newInner = innerText.slice(2, -2);
				currentLine =
					currentLine.slice(0, innerStart) +
					newInner +
					currentLine.slice(innerEnd);
				from = Math.max(innerStart, from - 2);
				to = Math.max(from, to - 2);
			}
			break;
		}
	}

	return {
		cleanedLine: currentLine,
		adjustedFrom: from,
		adjustedTo: to,
		initialBold,
		initialItalic,
		initialStrike,
		initialUnderline,
	};
}

export function isTargetFullyBold(segments: ParsedSegment[], from: number, to: number, initialBold?: boolean): boolean {
	if (initialBold) return true;
	const overlapping = segments.filter((s) => s.contentStart < to && s.contentStart + s.text.length > from);
	if (overlapping.length === 0) return false;
	return overlapping.every((s) => s.fontWeight === 'bold' || s.fontWeight === '700');
}

export function isTargetFullyItalic(segments: ParsedSegment[], from: number, to: number, initialItalic?: boolean): boolean {
	if (initialItalic) return true;
	const overlapping = segments.filter((s) => s.contentStart < to && s.contentStart + s.text.length > from);
	if (overlapping.length === 0) return false;
	return overlapping.every((s) => s.fontStyle === 'italic');
}

export function isTargetFullyUnderline(segments: ParsedSegment[], from: number, to: number, initialUnderline?: boolean): boolean {
	if (initialUnderline) return true;
	const overlapping = segments.filter((s) => s.contentStart < to && s.contentStart + s.text.length > from);
	if (overlapping.length === 0) return false;
	return overlapping.every(
		(s) =>
			hasDecoration(s.textDecoration, 'underline') ||
			hasDecoration(s.otherStyles['text-decoration'], 'underline'),
	);
}

export function isTargetFullyStrikethrough(segments: ParsedSegment[], from: number, to: number, initialStrike?: boolean): boolean {
	if (initialStrike) return true;
	const overlapping = segments.filter((s) => s.contentStart < to && s.contentStart + s.text.length > from);
	if (overlapping.length === 0) return false;
	return overlapping.every(
		(s) =>
			hasDecoration(s.textDecoration, 'line-through') ||
			hasDecoration(s.otherStyles['text-decoration'], 'line-through'),
	);
}

/**
 * Transforms a line range according to the requested Inkwell operation.
 * Checks for unmarked span conflicts before making any modifications.
 */
export function transformLine(
	line: string,
	rawFrom: number,
	rawTo: number,
	op: OperationType,
): TransformLineResult {
	const prefixLen = getLinePrefixLength(line);
	let adjustedRawFrom = rawFrom;
	let adjustedRawTo = rawTo;

	if (prefixLen > 0 && Math.min(rawFrom, rawTo) < prefixLen) {
		if (Math.max(rawFrom, rawTo) <= prefixLen) {
			return { success: false, errorReason: 'markdown_prefix' };
		}
		if (rawFrom <= rawTo) {
			adjustedRawFrom = prefixLen;
		} else {
			adjustedRawTo = prefixLen;
		}
	}

	// Absorb and clean legacy delimiters (**, *, ~~, <u>) targeting or enclosing the selection
	const absorption = absorbLegacyFormatting(line, adjustedRawFrom, adjustedRawTo);
	const lineToProcess = absorption.cleanedLine;
	const minRaw = Math.min(absorption.adjustedFrom, absorption.adjustedTo);
	const maxRaw = Math.max(absorption.adjustedFrom, absorption.adjustedTo);

	const parsed = parseLine(lineToProcess);

	let cFrom = rawToContent(parsed, minRaw);
	let cTo = rawToContent(parsed, maxRaw);

	// Unmarked span collision check:
	// If the range (or caret) intersects an unmarked span in raw or content coordinates,
	// refuse operation immediately to prevent corrupting third-party/manual HTML.
	for (const seg of parsed) {
		if (seg.isUnmarked) {
			const rawHit =
				minRaw === maxRaw
					? minRaw >= seg.rawStart && minRaw <= seg.rawEnd
					: maxRaw > seg.rawStart && minRaw < seg.rawEnd;
			const contentHit =
				cFrom === cTo
					? cFrom >= seg.contentStart && cFrom <= seg.contentStart + seg.text.length
					: cTo > seg.contentStart && cFrom < seg.contentStart + seg.text.length;

			if (rawHit || contentHit) {
				return { success: false, errorReason: 'unmarked_span' };
			}
		}
	}

	// Resolve toggle operations
	let effectiveOp: OperationType = op;
	if (op.type === 'toggle-bold') {
		const isFullyBold = isTargetFullyBold(parsed, cFrom, cTo, absorption.initialBold);
		effectiveOp = isFullyBold ? { type: 'remove-bold' } : { type: 'set-bold' };
	} else if (op.type === 'toggle-italic') {
		const isFullyItalic = isTargetFullyItalic(parsed, cFrom, cTo, absorption.initialItalic);
		effectiveOp = isFullyItalic ? { type: 'remove-italic' } : { type: 'set-italic' };
	} else if (op.type === 'toggle-underline') {
		const isFullyUnderline = isTargetFullyUnderline(parsed, cFrom, cTo, absorption.initialUnderline);
		effectiveOp = isFullyUnderline ? { type: 'remove-underline' } : { type: 'set-underline' };
	} else if (op.type === 'toggle-strikethrough') {
		const isFullyStrikethrough = isTargetFullyStrikethrough(parsed, cFrom, cTo, absorption.initialStrike);
		effectiveOp = isFullyStrikethrough ? { type: 'remove-strikethrough' } : { type: 'set-strikethrough' };
	}

	// Caret / empty selection handling
	if (cFrom === cTo) {
		if (
			effectiveOp.type === 'set-color' ||
			effectiveOp.type === 'set-highlight' ||
			effectiveOp.type === 'set-highlight-appearance' ||
			effectiveOp.type === 'set-size' ||
			effectiveOp.type === 'set-font-family'
		) {
			return { success: false, errorReason: 'no_target' };
		}
		// Look for Inkwell span under caret
		const under = parsed.find(
			(s) =>
				s.isInkwell &&
				s.contentStart <= cFrom &&
				cFrom <= s.contentStart + s.text.length,
		);
		if (!under) {
			return { success: false, errorReason: 'no_target' };
		}
		cFrom = under.contentStart;
		cTo = under.contentStart + under.text.length;
	}

	const transformedSegments = splitAndTransform(parsed, cFrom, cTo, effectiveOp, absorption);
	const normalized = normalize(transformedSegments);

	// Serialize back to line string
	let text = '';
	let contentPos = 0;
	let selFrom: number | null = null;
	let selTo: number | null = null;

	for (const seg of normalized) {
		const markup =
			seg.raw ??
			buildSpan(seg.text, {
				isInkwell: seg.isInkwell,
				color: seg.color,
				highlight: seg.highlight,
				highlightAppearance: seg.highlightAppearance,
				fontSize: seg.fontSize,
				fontFamily: seg.fontFamily,
				fontWeight: seg.fontWeight,
				fontStyle: seg.fontStyle,
				textDecoration: seg.textDecoration,
				otherStyles: seg.otherStyles,
				otherAttrs: seg.otherAttrs,
			});

		const closingLen = markup.endsWith('</span>') ? '</span>'.length : 0;
		const innerStart =
			text.length +
			(closingLen > 0 ? markup.length - closingLen - seg.text.length : 0);
		const end = contentPos + seg.text.length;

		if (selFrom === null && cFrom >= contentPos && cFrom < end) {
			selFrom = innerStart + (cFrom - contentPos);
		}
		if (selTo === null && cTo > contentPos && cTo <= end) {
			selTo = innerStart + (cTo - contentPos);
		}

		text += markup;
		contentPos = end;
	}

	if (text === line) {
		return { success: false, errorReason: 'no_change' };
	}

	return {
		success: true,
		result: {
			text,
			from: selFrom ?? text.length,
			to: selTo ?? text.length,
		},
	};
}

/**
 * Splits selection around markdown delimiters (**, *, ***)
 */
export function splitSelectionAroundDelimiters(
	from: number,
	to: number,
	delimiters: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
	const min = Math.min(from, to);
	const max = Math.max(from, to);
	if (min === max) return [];

	const intersecting = delimiters
		.filter((d) => d.to > min && d.from < max)
		.sort((a, b) => a.from - b.from);

	if (intersecting.length === 0) {
		return [{ from: min, to: max }];
	}

	const ranges: Array<{ from: number; to: number }> = [];
	let curr = min;

	for (const delim of intersecting) {
		if (delim.from > curr) {
			ranges.push({ from: curr, to: delim.from });
		}
		curr = Math.max(curr, delim.to);
	}

	if (curr < max) {
		ranges.push({ from: curr, to: max });
	}

	return ranges.filter((r) => r.to > r.from);
}

/**
 * Transforms line taking Markdown delimiters into account.
 */
export function transformLineWithDelimiters(
	line: string,
	from: number,
	to: number,
	delimiters: Array<{ from: number; to: number }>,
	op: OperationType,
): TransformLineResult {
	if (
		op.type === 'remove-color' ||
		op.type === 'remove-highlight' ||
		op.type === 'remove-highlight-appearance' ||
		op.type === 'remove-size' ||
		op.type === 'remove-font-family' ||
		op.type === 'clear-all'
	) {
		return transformLine(line, from, to, op);
	}

	const prefixLen = getLinePrefixLength(line);
	let adjustedFrom = from;
	let adjustedTo = to;

	if (prefixLen > 0 && Math.min(from, to) < prefixLen) {
		if (Math.max(from, to) <= prefixLen) {
			return { success: false, errorReason: 'markdown_prefix' };
		}
		if (from <= to) {
			adjustedFrom = prefixLen;
		} else {
			adjustedTo = prefixLen;
		}
	}

	const ranges = splitSelectionAroundDelimiters(adjustedFrom, adjustedTo, delimiters);
	if (ranges.length === 0) {
		return { success: false, errorReason: 'no_target' };
	}

	// Apply from right to left
	ranges.sort((a, b) => b.from - a.from);

	let currentLine = line;
	let lastResult: TransformResult | null = null;

	for (const r of ranges) {
		const res = transformLine(currentLine, r.from, r.to, op);
		if (!res.success) {
			return res; // Forward conflict error without partial change!
		}
		if (res.result) {
			currentLine = res.result.text;
			lastResult = res.result;
		}
	}

	if (currentLine === line) {
		return { success: false, errorReason: 'no_change' };
	}

	return {
		success: true,
		result: {
			text: currentLine,
			from: lastResult?.from ?? from,
			to: lastResult?.to ?? to,
		},
	};
}

// Backward-compatible wrappers for existing command signatures:
export function recolorLine(
	line: string,
	from: number,
	to: number,
	color: string | null,
): TransformResult | null {
	const op: OperationType =
		color !== null ? { type: 'set-color', color } : { type: 'remove-color' };
	const res = transformLine(line, from, to, op);
	return res.success ? (res.result ?? null) : null;
}

export function recolorLineWithDelimiters(
	line: string,
	from: number,
	to: number,
	delimiters: Array<{ from: number; to: number }>,
	color: string | null,
): TransformResult | null {
	const op: OperationType =
		color !== null ? { type: 'set-color', color } : { type: 'remove-color' };
	const res = transformLineWithDelimiters(line, from, to, delimiters, op);
	return res.success ? (res.result ?? null) : null;
}

/**
 * Regex matching legacy inverted spans: <span ...>**text**</span>
 */
const INVERTED_SPAN_RE =
	/<span\b([^>]*)>(\*{1,3}|_{1,3})((?:(?!\2)[^])*?)\2<\/span>/g;

export function fixInvertedMarkdownSpans(line: string): string | null {
	let hasMatch = false;
	const fixed = line.replace(
		INVERTED_SPAN_RE,
		(_match, attrs: string, delim: string, text: string) => {
			hasMatch = true;
			return `${delim}<span${attrs}>${text}</span>${delim}`;
		},
	);
	return hasMatch ? fixed : null;
}

export interface CandidateSpan {
	lineNo: number;
	rawStart: number;
	rawEnd: number;
	raw: string;
	innerText: string;
}

/**
 * Finds candidate legacy spans without data-inkwell="1" on lines,
 * skipping code blocks and inline code.
 */
export function findLegacySpansInLines(
	lines: string[],
	range?: { startLine: number; startCh: number; endLine: number; endCh: number },
): CandidateSpan[] {
	const candidates: CandidateSpan[] = [];
	let inFencedCode = false;

	const sLine = range ? range.startLine : 0;
	const eLine = range ? range.endLine : lines.length - 1;

	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const line = lines[lineIdx];
		if (line === undefined) continue;

		if (line.trim().startsWith('```')) {
			inFencedCode = !inFencedCode;
			continue;
		}
		if (inFencedCode) continue;
		if (lineIdx < sLine || lineIdx > eLine) continue;

		const codeRanges = findInlineCodeRanges(line);
		const spanRegex = /<span\b([^>]*)>((?:(?!<span\b)[^])*?)<\/span>/gi;
		let match: RegExpExecArray | null;

		while ((match = spanRegex.exec(line)) !== null) {
			const start = match.index;
			const raw = match[0];
			const end = start + raw.length;

			// Check range bounds if restricted
			if (lineIdx === sLine && range && end <= range.startCh) continue;
			if (lineIdx === eLine && range && start >= range.endCh) continue;

			// Skip if inside inline code
			if (codeRanges.some((r) => start >= r.from && end <= r.to)) {
				continue;
			}

			const attrs = parseTagAttributes(match[1] ?? '');
			// If already marked, skip
			if (attrs.isInkwell) continue;

			// Check if has color or background-color
			if (attrs.color !== null || attrs.highlight !== null) {
				candidates.push({
					lineNo: lineIdx,
					rawStart: start,
					rawEnd: end,
					raw,
					innerText: match[2] ?? '',
				});
			}
		}
	}

	return candidates;
}

/**
 * Injects data-inkwell="1" into a candidate span.
 */
export function adoptCandidateSpan(rawSpan: string): string {
	const match = /^<span\b([^>]*)>([\s\S]*?)<\/span>$/i.exec(rawSpan);
	if (!match) return rawSpan;
	const attrsStr = match[1] ?? '';
	const innerText = match[2] ?? '';

	const attrs = parseTagAttributes(attrsStr);
	attrs.isInkwell = true;

	return buildSpan(innerText, attrs);
}
