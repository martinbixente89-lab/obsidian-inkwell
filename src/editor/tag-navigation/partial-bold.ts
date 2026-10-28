import type { Text } from '@codemirror/state';
import type { SimpleSpan } from './simple-spans';

export interface PartialBoldTransformation {
	replaceFrom: number;
	replaceTo: number;
	replacement: string;
	newAnchor: number;
	newHead: number;
}

/**
 * Builds a partial bold transformation on a single Inkwell simple span (plain or Cas 6 canonique).
 * Returns null if the selection is not an eligible strict partial selection.
 */
export function buildPartialBoldTransformation(
	doc: Text,
	span: SimpleSpan,
	selStart: number,
	selEnd: number,
	isReversed = false,
): PartialBoldTransformation | null {
	// Must be non-empty selection strictly inside inner content
	if (selStart >= selEnd) return null;
	if (selStart < span.innerStart || selEnd > span.innerEnd) return null;
	if (selStart === span.innerStart && selEnd === span.innerEnd) return null; // full span, not partial

	// Refuse Cas 1 historique (innerBold) or unsupported structures
	if (span.innerBold) return null;

	const prefixText = doc.sliceString(span.innerStart, selStart);
	const targetText = doc.sliceString(selStart, selEnd);
	const suffixText = doc.sliceString(selEnd, span.innerEnd);

	const openTag = doc.sliceString(span.spanStart, span.innerStart);
	const closeTag = doc.sliceString(span.innerEnd, span.spanEnd);

	let frag1 = '';
	let frag2 = '';
	let frag3 = '';
	let replaceFrom = 0;
	let replaceTo = 0;
	let targetOffsetInReplacement = 0;

	if (span.enclosedInBold) {
		// UNBOLDING target portion in Cas 6 span
		frag1 = prefixText.length > 0 ? `**${openTag}${prefixText}${closeTag}**` : '';
		frag2 = `${openTag}${targetText}${closeTag}`;
		frag3 = suffixText.length > 0 ? `**${openTag}${suffixText}${closeTag}**` : '';
		replaceFrom = span.spanStart - 2;
		replaceTo = span.spanEnd + 2;
		targetOffsetInReplacement = frag1.length + openTag.length;
	} else {
		// BOLDING target portion in plain color span
		frag1 = prefixText.length > 0 ? `${openTag}${prefixText}${closeTag}` : '';
		frag2 = `**${openTag}${targetText}${closeTag}**`;
		frag3 = suffixText.length > 0 ? `${openTag}${suffixText}${closeTag}` : '';
		replaceFrom = span.spanStart;
		replaceTo = span.spanEnd;
		targetOffsetInReplacement = frag1.length + 2 + openTag.length; // +2 for opening **
	}

	const replacement = frag1 + frag2 + frag3;
	const newSelStart = replaceFrom + targetOffsetInReplacement;
	const newSelEnd = newSelStart + targetText.length;
	const newAnchor = isReversed ? newSelEnd : newSelStart;
	const newHead = isReversed ? newSelStart : newSelEnd;

	return {
		replaceFrom,
		replaceTo,
		replacement,
		newAnchor,
		newHead,
	};
}
