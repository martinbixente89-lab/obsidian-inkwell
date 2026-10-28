import { Editor, Notice } from 'obsidian';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import { transformLine, OperationType } from '../format/color-spans';
import {
	applyLineChange,
	captureSelectionState,
} from './selection-state';

export type InlineFormatType = 'bold' | 'italic' | 'underline' | 'strikethrough';

/**
 * Toggles an inline format (bold, italic, underline, strikethrough)
 * using unified HTML representation (<span data-inkwell="1" style="...">).
 */
export function toggleSelectionFormat(
	editor: Editor,
	tracker: EmbedSelectionTracker,
	format: InlineFormatType,
	filePath: string | null = null,
): boolean {
	const captured = captureSelectionState(editor, tracker, filePath);

	if (captured.lineNo !== captured.targetToLine) {
		new Notice('Selections over several lines are not supported yet.');
		return false;
	}

	const line = editor.getLine(captured.lineNo);
	let opType: OperationType['type'];
	switch (format) {
		case 'bold':
			opType = 'toggle-bold';
			break;
		case 'italic':
			opType = 'toggle-italic';
			break;
		case 'underline':
			opType = 'toggle-underline';
			break;
		case 'strikethrough':
			opType = 'toggle-strikethrough';
			break;
	}

	const res = transformLine(
		line,
		captured.fromCh,
		captured.toCh,
		{ type: opType },
	);

	if (!res.success) {
		if (res.errorReason === 'unmarked_span') {
			new Notice(
				'Cette balise n’est pas gérée par Inkwell. Utilisez la commande d’adoption pour la prendre en charge.',
			);
		}
		return false;
	}

	if (res.result) {
		applyLineChange(editor, captured.lineNo, line, res.result);
		return true;
	}
	return false;
}
