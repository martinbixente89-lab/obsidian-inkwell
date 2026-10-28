import { Editor, Notice } from 'obsidian';
import { CapturedEditorSelection } from './selection-state';
import { transformHeading } from '../format/heading';

export { getLineHeadingLevel, transformHeading } from '../format/heading';

/**
 * Applies a heading level (1 to 6) or removes heading (null) on the line of the captured selection.
 * Preserves the target selection across the transformation.
 */
export function applyHeadingToCapturedRange(
	editor: Editor,
	captured: CapturedEditorSelection,
	currentFilePath: string | null,
	level: number | null,
): boolean {
	if (captured.filePath !== currentFilePath) {
		new Notice('La note a changé. Opération annulée.');
		return false;
	}

	if (captured.lineNo >= editor.lineCount()) {
		new Notice('Le contenu a changé. Opération annulée.');
		return false;
	}

	const lineText = editor.getLine(captured.lineNo);
	const { newLine, delta } = transformHeading(lineText, level);

	if (newLine === lineText) {
		return true;
	}

	const cursorFrom = editor.getCursor('from');
	const cursorTo = editor.getCursor('to');
	const oldFromCh = cursorFrom.line === captured.lineNo ? cursorFrom.ch : captured.fromCh;
	const oldToCh = cursorTo.line === captured.lineNo ? cursorTo.ch : captured.toCh;
	const newFromCh = Math.max(0, oldFromCh + delta);
	const newToCh = Math.max(newFromCh, oldToCh + delta);

	editor.transaction({
		changes: [
			{
				from: { line: captured.lineNo, ch: 0 },
				to: { line: captured.lineNo, ch: lineText.length },
				text: newLine,
			},
		],
		selection: {
			from: { line: captured.lineNo, ch: newFromCh },
			to: { line: captured.lineNo, ch: newToCh },
		},
	});

	return true;
}
