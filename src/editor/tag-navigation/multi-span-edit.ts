import { Text } from '@codemirror/state';
import type { SimpleSpan } from './simple-spans';
import type { GuardRefusal } from './edit-guard';

export interface MultiSpanEditPlan {
	rangeStart: number;
	rangeEnd: number;
	replacement: string;
	newCursor: number;
}

export type MultiSpanEditDecision =
	| { type: 'apply'; plan: MultiSpanEditPlan }
	| { type: 'refuse'; reason: GuardRefusal }
	| null;

/**
 * Plans a safe multi-span edit (deletion or replacement) across one or more
 * Inkwell simple spans and adjacent plain text.
 *
 * Ensures:
 * - Surviving text on the left stays properly wrapped in its original span.
 * - Surviving text on the right stays properly wrapped in its original span.
 * - Completely emptied spans are cleanly removed without leaving orphan tags or delimiters.
 * - Intermediate spans covered entirely are deleted cleanly.
 * - Inserted text inherits the style of the surviving left span (or right span if left is emptied).
 * - Multi-byte / special characters and newlines follow Inkwell's normal rules.
 */
export function planMultiSpanEdit(
	doc: Text,
	spans: readonly SimpleSpan[],
	fromA: number,
	toA: number,
	inserted: string,
): MultiSpanEditDecision {
	if (fromA > toA) return null;
	if (fromA === toA && !/[\r\n]/.test(inserted)) return null;

	// Find all spans intersecting [fromA, toA]
	const isCollapsed = fromA === toA;
	const intersecting = spans.filter((s) => {
		let start = s.spanStart;
		if (s.enclosedInUnderline) start -= s.uOpenLen ?? 3;
		if (s.enclosedInBold) start -= 2;

		let end = s.spanEnd;
		if (s.enclosedInUnderline) end += s.uCloseLen ?? 4;
		if (s.enclosedInBold) end += 2;

		return isCollapsed
			? fromA >= start && fromA <= end
			: toA > start && fromA < end;
	});

	if (intersecting.length === 0) return null;

	// Cas 1 historique (innerBold) is strictly protected from partial edits
	if (intersecting.some((s) => s.innerBold)) return null;

	// Check if this is an edit strictly inside a single span
	if (intersecting.length === 1) {
		const s = intersecting[0]!;
		const visStart = s.innerStart;
		const visEnd = s.innerEnd;
		// If strictly inside visible content without newlines, checkChange handles it
		if (fromA >= visStart && toA <= visEnd && !/[\r\n]/.test(inserted)) {
			return null;
		}
		// If selection does not overlap any visible content (only touches opening or closing tag), refuse
		const hasVisibleOverlap = isCollapsed
			? fromA >= visStart && fromA <= visEnd
			: toA > visStart && fromA < visEnd;
		if (!hasVisibleOverlap) {
			return null;
		}
		// If selection starts or ends inside the tag itself rather than outside or in visible text, refuse
		const sStart = s.enclosedInUnderline ? s.spanStart - (s.uOpenLen ?? 3) : s.spanStart;
		const sEnd = s.enclosedInUnderline ? s.spanEnd + (s.uCloseLen ?? 4) : s.spanEnd;
		const cutsIntoOpenTag = fromA > sStart && fromA < visStart;
		const cutsIntoCloseTag = toA > visEnd && toA < sEnd;
		if (cutsIntoOpenTag || cutsIntoCloseTag) {
			return null;
		}
	}

	const first = intersecting[0]!;
	const last = intersecting[intersecting.length - 1]!;

	const visStart1 = first.innerBold ? first.innerStart + 2 : first.innerStart;
	const visEnd1 = first.innerBold ? first.innerEnd - 2 : first.innerEnd;
	let fullStart1 = first.spanStart;
	if (first.enclosedInUnderline) fullStart1 -= first.uOpenLen ?? 3;
	if (first.enclosedInBold) fullStart1 -= 2;

	const visStartK = last.innerBold ? last.innerStart + 2 : last.innerStart;
	const visEndK = last.innerBold ? last.innerEnd - 2 : last.innerEnd;
	let fullEndK = last.spanEnd;
	if (last.enclosedInUnderline) fullEndK += last.uCloseLen ?? 4;
	if (last.enclosedInBold) fullEndK += 2;

	let rangeStart: number;
	let closeStr1 = '';
	const survivesLeft = fromA > visStart1;

	if (survivesLeft) {
		rangeStart = Math.min(fromA, visEnd1);
		let closeStr = first.innerBold ? '**</span>' : '</span>';
		if (first.enclosedInUnderline) closeStr += '</u>';
		if (first.enclosedInBold) closeStr += '**';
		closeStr1 = closeStr;
	} else {
		rangeStart = Math.min(fromA, fullStart1);
	}

	let rangeEnd: number;
	let openStrK = '';
	const survivesRight = toA < visEndK;

	if (survivesRight) {
		rangeEnd = Math.max(toA, visStartK);
		const rawOpenTag = doc.sliceString(last.spanStart, last.innerStart);
		let openStr = '';
		if (last.enclosedInBold) openStr += '**';
		if (last.enclosedInUnderline) openStr += '<u>';
		openStr += rawOpenTag;
		if (last.innerBold) openStr += '**';
		openStrK = openStr;
	} else {
		rangeEnd = Math.max(toA, fullEndK);
	}

	let replacement: string;
	if (/[\r\n]/.test(inserted)) {
		// Multi-line replacement: close surviving left span before the first newline,
		// insert multi-line plain text across lines, and reopen surviving right span after the last newline.
		const lines = inserted.split(/\r?\n/);
		const firstLine = lines[0] ?? '';
		const rest = lines.slice(1).join('\n');

		if (survivesLeft && survivesRight) {
			replacement = firstLine + closeStr1 + '\n' + rest + openStrK;
		} else if (survivesLeft) {
			replacement = firstLine + closeStr1 + '\n' + rest;
		} else if (survivesRight) {
			const middle = lines.slice(0, -1).join('\n');
			const lastLine = lines[lines.length - 1] ?? '';
			replacement = middle + '\n' + openStrK + lastLine;
		} else {
			replacement = inserted;
		}
	} else {
		// Single-line insertion / replacement:
		if (survivesLeft && survivesRight) {
			replacement = inserted + closeStr1 + openStrK;
		} else if (survivesLeft) {
			if (toA > fullEndK) {
				// Selection extended into plain text after the span: inserted belongs in plain text
				replacement = closeStr1 + inserted;
			} else {
				// Selection ended inside span: inserted inherits left span's style
				replacement = inserted + closeStr1;
			}
		} else if (survivesRight) {
			if (fromA < fullStart1) {
				// Selection started in plain text before the span: inserted belongs in plain text
				replacement = inserted + openStrK;
			} else {
				// Selection started inside span: inserted inherits right span's style
				replacement = openStrK + inserted;
			}
		} else {
			replacement = inserted;
		}
	}

	const insIdx = inserted.length > 0 ? replacement.indexOf(inserted) : 0;
	const newCursor = rangeStart + (insIdx >= 0 ? insIdx : 0) + inserted.length;

	return {
		type: 'apply',
		plan: {
			rangeStart,
			rangeEnd,
			replacement,
			newCursor,
		},
	};
}
