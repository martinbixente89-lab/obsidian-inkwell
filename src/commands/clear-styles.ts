import { Editor, Notice } from 'obsidian';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import { transformLine } from '../format/color-spans';
import {
	applyLineChange,
	captureSelectionState,
} from './selection-state';

/**
 * Removes both text color and highlight from the selection or the span under cursor,
 * preserving markdown, other styles, and other HTML attributes.
 */
export function clearInkwellFormatting(
	editor: Editor,
	tracker: EmbedSelectionTracker,
	filePath: string | null,
): boolean {
	const captured = captureSelectionState(editor, tracker, filePath);

	if (captured.lineNo !== captured.targetToLine) {
		new Notice('Selections over several lines are not supported yet.');
		return false;
	}

	const line = editor.getLine(captured.lineNo);
	const res = transformLine(
		line,
		captured.fromCh,
		captured.toCh,
		{ type: 'clear-all' },
	);

	if (!res.success) {
		if (res.errorReason === 'unmarked_span') {
			new Notice(
				'Cette balise n’est pas gérée par Inkwell. Utilisez la commande d’adoption pour la prendre en charge.',
			);
		} else {
			new Notice('No Inkwell formatting to clear here.');
		}
		return false;
	}

	if (res.result) {
		applyLineChange(editor, captured.lineNo, line, res.result);
		return true;
	}
	return false;
}
