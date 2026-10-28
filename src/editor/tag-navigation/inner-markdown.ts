/**
 * Robust CommonMark-compliant emphasis scanner for text inside Inkwell formatting spans.
 *
 * Detects:
 * - ***bold & italic*** (3 asterisks or underscores)
 * - **bold** (2 asterisks or underscores)
 * - *italic* (1 asterisk or underscore)
 *
 * Strict protection:
 * - Backslash-escaped delimiters (\*, \_) are never treated as emphasis.
 * - Inline code spans (`...`) inside the span are skipped.
 * - Arithmetic or literal asterisks (surrounded by spaces or unmatched) are preserved.
 * - Delimiters must satisfy CommonMark left-flanking and right-flanking rules.
 */

export interface InnerEmphasisSpan {
	openStart: number;
	openEnd: number;
	contentStart: number;
	contentEnd: number;
	closeStart: number;
	closeEnd: number;
	kind: 'bold' | 'italic' | 'bold-italic' | 'strikethrough';
}

const PUNCTUATION_REGEX = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~\p{P}\p{S}]/u;
const WHITESPACE_REGEX = /\s/;

function isWhitespace(ch: string | undefined): boolean {
	if (!ch) return true;
	return WHITESPACE_REGEX.test(ch);
}

function isPunctuation(ch: string | undefined): boolean {
	if (!ch) return false;
	return PUNCTUATION_REGEX.test(ch);
}

function isEscaped(text: string, index: number): boolean {
	let backslashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) {
		backslashes++;
	}
	return backslashes % 2 === 1;
}

interface DelimiterToken {
	char: '*' | '_' | '~';
	start: number;
	end: number;
	length: number;
	canOpen: boolean;
	canClose: boolean;
}

/**
 * Finds all valid emphasis ranges inside `innerText`, adding `baseOffset` to all offsets.
 */
export function findInnerEmphasisSpans(
	innerText: string,
	baseOffset: number,
	allowBold = true,
): InnerEmphasisSpan[] {
	if (!innerText.includes('*') && !innerText.includes('_') && !innerText.includes('~')) {
		return [];
	}

	// 1. Identify inline code segments within innerText so they are not parsed
	const codeRanges: Array<{ from: number; to: number }> = [];
	const CODE_RE = /`+[^`\r\n]+`+/g;
	let cm: RegExpExecArray | null;
	while ((cm = CODE_RE.exec(innerText)) !== null) {
		codeRanges.push({ from: cm.index, to: cm.index + cm[0].length });
	}

	const isInsideCode = (pos: number): boolean => {
		return codeRanges.some((r) => pos >= r.from && pos < r.to);
	};

	// 2. Scan all delimiter runs (*, _, or ~)
	const tokens: DelimiterToken[] = [];
	let i = 0;
	while (i < innerText.length) {
		const ch = innerText[i];
		if ((ch === '*' || ch === '_' || ch === '~') && !isEscaped(innerText, i) && !isInsideCode(i)) {
			const start = i;
			while (i < innerText.length && innerText[i] === ch && !isEscaped(innerText, i)) {
				i++;
			}
			const end = i;
			const len = end - start;

			// Check left-flanking and right-flanking per CommonMark
			const prevChar = start > 0 ? innerText[start - 1] : undefined;
			const nextChar = end < innerText.length ? innerText[end] : undefined;

			const prevWhite = isWhitespace(prevChar);
			const prevPunct = isPunctuation(prevChar);
			const nextWhite = isWhitespace(nextChar);
			const nextPunct = isPunctuation(nextChar);

			const leftFlanking =
				!nextWhite &&
				(!nextPunct || prevWhite || prevPunct);

			const rightFlanking =
				!prevWhite &&
				(!prevPunct || nextWhite || nextPunct);

			let canOpen = leftFlanking;
			let canClose = rightFlanking;

			// For underscores, extra check: cannot open if preceded by non-punctuation/non-whitespace
			// and cannot close if followed by non-punctuation/non-whitespace (intraword rule)
			if (ch === '_') {
				if (leftFlanking && rightFlanking) {
					canOpen = prevPunct;
					canClose = nextPunct;
				}
			}

			// For tildes (strikethrough): require length >= 2 per GFM / CommonMark extension
			if (ch === '~') {
				if (len < 2) {
					canOpen = false;
					canClose = false;
				}
			}

			if (canOpen || canClose) {
				tokens.push({
					char: ch,
					start,
					end,
					length: len,
					canOpen,
					canClose,
				});
			}
		} else {
			i++;
		}
	}

	if (tokens.length < 2) {
		return [];
	}

	// 3. Match delimiters using stack
	const results: InnerEmphasisSpan[] = [];
	const stack: DelimiterToken[] = [];

	for (const tok of tokens) {
		if (tok.canClose) {
			// Search backwards in stack for matching opening delimiter of same character
			let openIdx = -1;
			for (let s = stack.length - 1; s >= 0; s--) {
				const candidate = stack[s]!;
				if (candidate.char === tok.char && candidate.canOpen) {
					if (tok.char === '~') {
						if (candidate.length >= 2 && tok.length >= 2) {
							openIdx = s;
							break;
						}
					} else {
						// Check if lengths can match (3, 2, or 1)
						if (
							(allowBold && candidate.length >= 3 && tok.length >= 3) ||
							(allowBold && candidate.length >= 2 && tok.length >= 2) ||
							(candidate.length >= 1 && tok.length >= 1)
						) {
							openIdx = s;
							break;
						}
					}
				}
			}

			if (openIdx >= 0) {
				const opener = stack[openIdx]!;
				let matchLen = 1;
				let kind: InnerEmphasisSpan['kind'] = 'italic';

				if (tok.char === '~') {
					matchLen = 2;
					kind = 'strikethrough';
				} else {
					if (allowBold && opener.length >= 3 && tok.length >= 3) {
						matchLen = 3;
						kind = 'bold-italic';
					} else if (allowBold && opener.length >= 2 && tok.length >= 2) {
						matchLen = 2;
						kind = 'bold';
					} else {
						matchLen = 1;
						kind = 'italic';
					}
				}

				const openStart = opener.end - matchLen;
				const openEnd = opener.end;
				const closeStart = tok.start;
				const closeEnd = tok.start + matchLen;
				const contentStart = openEnd;
				const contentEnd = closeStart;

				if (contentEnd > contentStart) {
					results.push({
						openStart: baseOffset + openStart,
						openEnd: baseOffset + openEnd,
						contentStart: baseOffset + contentStart,
						contentEnd: baseOffset + contentEnd,
						closeStart: baseOffset + closeStart,
						closeEnd: baseOffset + closeEnd,
						kind,
					});
				}

				// Adjust lengths of matched delimiter runs
				opener.length -= matchLen;
				opener.end -= matchLen;
				tok.length -= matchLen;
				tok.start += matchLen;

				// Remove all tokens between opener and closer (CommonMark rule)
				stack.splice(openIdx + 1);

				if (opener.length === 0) {
					stack.splice(openIdx, 1);
				}
				if (tok.length === 0) {
					continue;
				}
			}
		}

		if (tok.canOpen && tok.length > 0) {
			stack.push(tok);
		}
	}

	// Sort results by document order
	results.sort((a, b) => a.openStart - b.openStart);
	return results;
}
