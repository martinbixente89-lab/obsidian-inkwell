import { Editor, Notice } from 'obsidian';
import { fixInvertedMarkdownSpans } from '../format/color-spans';

/**
 * On-demand command to fix legacy passages formatted as <span style="...">**text**</span>
 * into **<span style="...">text</span>**. Modifies only the active note and is undoable in 1 step.
 */
export function fixLegacySpansInNote(editor: Editor): void {
	let changesCount = 0;
	const changes: Array<{
		from: { line: number; ch: number };
		to: { line: number; ch: number };
		text: string;
	}> = [];

	for (let i = 0; i < editor.lineCount(); i++) {
		const line = editor.getLine(i);
		const fixed = fixInvertedMarkdownSpans(line);
		if (fixed !== null) {
			changesCount++;
			changes.push({
				from: { line: i, ch: 0 },
				to: { line: i, ch: line.length },
				text: fixed,
			});
		}
	}

	if (changesCount === 0) {
		new Notice('No legacy inverted formatting found in this note.');
		return;
	}

	editor.transaction({
		changes,
	});
	new Notice(`Fixed ${changesCount} line(s) with inverted formatting.`);
}
