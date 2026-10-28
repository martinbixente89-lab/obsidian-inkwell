import type { Text } from '@codemirror/state';
import type { SimpleSpan } from './simple-spans';
import type { MultiSpanEditPlan } from './multi-span-edit';
import { planMultiSpanEdit } from './multi-span-edit';

export type GuardRefusal =
	| 'tag'
	| 'newline'
	| 'special-char'
	| 'partial-bold';

export const REFUSAL_MESSAGES: Record<GuardRefusal, string> = {
	tag: 'Inkwell : modification de balise.',
	newline: 'Inkwell : retour à la ligne.',
	'special-char': 'Inkwell : caractère spécial.',
	'partial-bold': 'Inkwell : formatage gras partiel.',
};

export type ChangeDecision =
	| { type: 'allow' }
	| { type: 'no-op' }
	| { type: 'refuse'; reason: GuardRefusal }
	| { type: 'clean-span'; span: SimpleSpan }
	| { type: 'rewrite'; changes: Array<{ from: number; to?: number; insert: string }>; newCursor?: number }
	| { type: 'rewrite-multispan'; plan: MultiSpanEditPlan };

/**
 * Checks a change against document spans and provides a transparent rewrite
 * that preserves HTML tag integrity without ever dropping user keystrokes.
 */
export function checkChange(
	spans: readonly SimpleSpan[],
	fromA: number,
	toA: number,
	inserted: string,
	doc?: Text,
): ChangeDecision {
	const insStr = inserted.toString();

	// Check multi-span edits first if selection spans across multiple characters or has newline
	if (doc && (fromA < toA || /[\r\n]/.test(insStr))) {
		const multi = planMultiSpanEdit(doc, spans, fromA, toA, insStr);
		if (multi && multi.type === 'apply') {
			return { type: 'rewrite-multispan', plan: multi.plan };
		}
	}

	for (let i = 0; i < spans.length; i++) {
		const s = spans[i]!;

		// A change covering the whole span (tags included) is allowed as is.
		if (fromA <= s.spanStart && toA >= s.spanEnd) continue;
		// Change completely outside this span.
		if (toA < s.spanStart || fromA > s.spanEnd) continue;

		const visStart = s.innerBold ? s.innerStart + 2 : s.innerStart;
		const visEnd = s.innerBold ? s.innerEnd - 2 : s.innerEnd;
		const openStart = s.enclosedInUnderline
			? s.spanStart - (s.uOpenLen ?? 3)
			: s.enclosedInBold
				? s.spanStart - 2
				: s.spanStart;
		const closeEnd = s.enclosedInUnderline
			? s.spanEnd + (s.uCloseLen ?? 4)
			: s.enclosedInBold
				? s.spanEnd + 2
				: s.spanEnd;

		// Case A: Backspace at visual start of span
		if (fromA === visStart - 1 && toA === visStart && insStr.length === 0) {
			if (openStart === 0) {
				return { type: 'no-op' };
			}
			// Check if immediately preceded by another span
			const prevSpan = spans[i - 1];
			const prevCloseEnd = prevSpan
				? prevSpan.enclosedInUnderline
					? prevSpan.spanEnd + (prevSpan.uCloseLen ?? 4)
					: prevSpan.enclosedInBold
						? prevSpan.spanEnd + 2
						: prevSpan.spanEnd
				: -1;

			if (prevSpan && prevCloseEnd === openStart) {
				const prevVisStart = prevSpan.innerBold ? prevSpan.innerStart + 2 : prevSpan.innerStart;
				const prevVisEnd = prevSpan.innerBold ? prevSpan.innerEnd - 2 : prevSpan.innerEnd;
				if (prevVisEnd - prevVisStart <= 1) {
					const prevOpenStart = prevSpan.enclosedInUnderline
						? prevSpan.spanStart - (prevSpan.uOpenLen ?? 3)
						: prevSpan.enclosedInBold
							? prevSpan.spanStart - 2
							: prevSpan.spanStart;
					return {
						type: 'rewrite',
						changes: [{ from: prevOpenStart, to: openStart, insert: '' }],
						newCursor: prevOpenStart,
					};
				} else {
					return {
						type: 'rewrite',
						changes: [{ from: prevVisEnd - 1, to: prevVisEnd, insert: '' }],
						newCursor: prevVisEnd - 1,
					};
				}
			} else {
				return {
					type: 'rewrite',
					changes: [{ from: openStart - 1, to: openStart, insert: '' }],
					newCursor: openStart - 1,
				};
			}
		}

		// Case B: Delete forward (Suppr) at visual end of span
		if (fromA === visEnd && toA === visEnd + 1 && insStr.length === 0) {
			const docLen = doc ? doc.length : closeEnd;
			if (closeEnd >= docLen) {
				return { type: 'no-op' };
			}
			const nextSpan = spans[i + 1];
			const nextOpenStart = nextSpan
				? nextSpan.enclosedInUnderline
					? nextSpan.spanStart - (nextSpan.uOpenLen ?? 3)
					: nextSpan.enclosedInBold
						? nextSpan.spanStart - 2
						: nextSpan.spanStart
				: -1;

			if (nextSpan && nextOpenStart === closeEnd) {
				const nextVisStart = nextSpan.innerBold ? nextSpan.innerStart + 2 : nextSpan.innerStart;
				const nextVisEnd = nextSpan.innerBold ? nextSpan.innerEnd - 2 : nextSpan.innerEnd;
				if (nextVisEnd - nextVisStart <= 1) {
					const nextCloseEnd = nextSpan.enclosedInUnderline
						? nextSpan.spanEnd + (nextSpan.uCloseLen ?? 4)
						: nextSpan.enclosedInBold
							? nextSpan.spanEnd + 2
							: nextSpan.spanEnd;
					return {
						type: 'rewrite',
						changes: [{ from: closeEnd, to: nextCloseEnd, insert: '' }],
						newCursor: closeEnd,
					};
				} else {
					return {
						type: 'rewrite',
						changes: [{ from: nextVisStart, to: nextVisStart + 1, insert: '' }],
						newCursor: nextVisStart,
					};
				}
			} else {
				return {
					type: 'rewrite',
					changes: [{ from: closeEnd, to: closeEnd + 1, insert: '' }],
					newCursor: visEnd,
				};
			}
		}

		// Case C: Entire visible content deleted -> clean span
		if (fromA === visStart && toA === visEnd && insStr.length === 0) {
			return { type: 'clean-span', span: s };
		}

		// Case D: Enter inside visible content -> split span
		if (fromA >= visStart && toA <= visEnd && /[\r\n]/.test(insStr) && doc) {
			const beforeText = doc.sliceString(visStart, fromA);
			const afterText = doc.sliceString(toA, visEnd);
			const rawOpenTag = doc.sliceString(s.spanStart, s.innerStart);
			let openPrefix = '';
			if (s.enclosedInBold) openPrefix += '**';
			if (s.enclosedInUnderline) openPrefix += '<u>';
			openPrefix += rawOpenTag;
			if (s.innerBold) openPrefix += '**';

			let closeTag = s.innerBold ? '**</span>' : '</span>';
			if (s.enclosedInUnderline) closeTag += '</u>';
			if (s.enclosedInBold) closeTag += '**';

			const replacement = `${openPrefix}${beforeText}${closeTag}\n${openPrefix}${afterText}${closeTag}`;
			const newCursor = openStart + `${openPrefix}${beforeText}${closeTag}\n${openPrefix}`.length;
			return {
				type: 'rewrite',
				changes: [{ from: openStart, to: closeEnd, insert: replacement }],
				newCursor,
			};
		}

		// Case E: Touches inside opening tag or closing tag (cutting into tag or masked delimiters)
		const touchesOpen = fromA < visStart && toA > s.spanStart;
		const touchesClose = fromA < s.spanEnd && toA > visEnd;
		if (touchesOpen || touchesClose) {
			return { type: 'refuse', reason: 'tag' };
		}

		// Case F: Typing inside visible content (including accents, <, >, &)
		const inContent = fromA >= visStart && toA <= visEnd;
		if (inContent) {
			if (doc && insStr.length === 0 && fromA === toA - 1) {
				// Entity single-step backspace
				const docText = doc.toString();
				const sliceBefore = docText.slice(Math.max(visStart, toA - 10), toA);
				const m = sliceBefore.match(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);$/);
				if (m) {
					const entityLen = m[0].length;
					return {
						type: 'rewrite',
						changes: [{ from: toA - entityLen, to: toA, insert: '' }],
						newCursor: toA - entityLen,
					};
				}
			}
			if (doc && insStr.length === 0 && fromA === toA && toA < visEnd) {
				// Entity single-step delete forward
				const docText = doc.toString();
				const sliceAfter = docText.slice(fromA, Math.min(visEnd, fromA + 10));
				const m = sliceAfter.match(/^&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/);
				if (m) {
					const entityLen = m[0].length;
					return {
						type: 'rewrite',
						changes: [{ from: fromA, to: fromA + entityLen, insert: '' }],
						newCursor: fromA,
					};
				}
			}
			// When typing or pasting <, >, & inside span content: encode to safe HTML entities
			// In plain text, literal '&' becomes '&amp;' so that literal '&lt;' remains '&lt;' on screen and doesn't collapse to '<'
			if (/[<>&]/.test(insStr)) {
				const encoded = insStr
					.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;');
				return {
					type: 'rewrite',
					changes: [{ from: fromA, to: toA, insert: encoded }],
					newCursor: fromA + encoded.length,
				};
			}
			return { type: 'allow' };
		}
	}

	return { type: 'allow' };
}
