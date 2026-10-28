/**
 * Detects the Markdown heading level of a line (1 to 6), or returns null if not a heading.
 */
export function getLineHeadingLevel(lineText: string): number | null {
	const match = lineText.match(/^([ \t]*)(#{1,6})[ \t]+/);
	return match && match[2] ? match[2].length : null;
}

/**
 * Transforms a line into a Markdown heading level (1 to 6) or into normal text (level: null).
 * Replaces existing heading markers cleanly without accumulating.
 * Returns the new line and the length difference (delta).
 */
export function transformHeading(
	lineText: string,
	level: number | null,
): { newLine: string; delta: number } {
	const headingMatch = lineText.match(/^([ \t]*)(#{1,6})[ \t]+(.*)$/);

	if (level === null) {
		// Remove heading level: return normal text
		if (!headingMatch) {
			return { newLine: lineText, delta: 0 };
		}
		const indent = headingMatch[1] ?? '';
		const content = headingMatch[3] ?? '';
		const newLine = `${indent}${content}`;
		return { newLine, delta: newLine.length - lineText.length };
	}

	// Setting heading level 1 to 6
	const clampedLevel = Math.max(1, Math.min(6, Math.round(level)));
	const prefix = '#'.repeat(clampedLevel) + ' ';

	if (headingMatch) {
		const indent = headingMatch[1] ?? '';
		const content = headingMatch[3] ?? '';
		const newLine = `${indent}${prefix}${content}`;
		return { newLine, delta: newLine.length - lineText.length };
	}

	// Line is not currently a heading
	const indentMatch = lineText.match(/^([ \t]*)(.*)$/);
	const indent = indentMatch ? indentMatch[1] : '';
	const content = indentMatch ? indentMatch[2] : lineText;
	const newLine = `${indent}${prefix}${content}`;
	return { newLine, delta: newLine.length - lineText.length };
}
