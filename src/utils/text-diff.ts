export interface TextDiff {
	/** Start offset of the changed region in the old text. */
	start: number;
	/** End offset of the changed region in the old text. */
	end: number;
	/** Replacement text for [start, end). */
	insert: string;
}

/**
 * Returns the smallest single replacement turning `before` into `after`, by
 * trimming their common prefix and suffix. Keeps edits (and the cursor
 * positions of other text) as local as possible.
 */
export function minimalDiff(before: string, after: string): TextDiff {
	let start = 0;
	const maxPrefix = Math.min(before.length, after.length);
	while (start < maxPrefix && before[start] === after[start]) start++;

	let endBefore = before.length;
	let endAfter = after.length;
	while (
		endBefore > start &&
		endAfter > start &&
		before[endBefore - 1] === after[endAfter - 1]
	) {
		endBefore--;
		endAfter--;
	}
	return { start, end: endBefore, insert: after.slice(start, endAfter) };
}
