import type { EditorView } from '@codemirror/view';
import { Editor, Notice } from 'obsidian';
import type InkwellPlugin from '../main';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import {
	OperationType,
	transformLine,
	transformLineWithDelimiters,
} from '../format/color-spans';
import { getLineSyntaxInfo } from '../format/syntax-helper';
import { ColorPickerModal } from '../ui/color-picker-modal';
import {
	applyLineChange,
	CapturedEditorSelection,
	captureSelectionState,
} from './selection-state';

export { captureSelectionState };
export type { CapturedEditorSelection };

/**
 * Validates that captured state is still valid, then applies the text color.
 */
export function applyColorToCapturedRange(
	editor: Editor,
	captured: CapturedEditorSelection,
	currentFilePath: string | null,
	color: string,
): boolean {
	if (captured.filePath !== currentFilePath) {
		new Notice('Note has changed. Operation cancelled.');
		return false;
	}

	if (
		captured.lineNo >= editor.lineCount() ||
		editor.getLine(captured.lineNo) !== captured.lineText
	) {
		new Notice('Content has changed. Operation cancelled.');
		return false;
	}

	if (captured.lineNo !== captured.targetToLine) {
		new Notice('Selections over several lines are not supported yet.');
		return false;
	}

	if (!captured.hasSelection) {
		new Notice('Select some text first.');
		return false;
	}

	const view = (editor as Editor & { cm?: EditorView }).cm;
	const line = captured.lineText;
	const selStart = captured.fromCh;
	const selEnd = captured.toCh;
	const op: OperationType = { type: 'set-color', color };

	if (view) {
		const lineObj = view.state.doc.line(captured.lineNo + 1);
		const syntax = getLineSyntaxInfo(view, lineObj.from, lineObj.to);

		if (syntax.wikilinks.some((w) => selEnd > w.from && selStart < w.to)) {
			new Notice('Cannot color across internal wikilinks [[...]].');
			return false;
		}

		if (syntax.links.some((l) => selEnd > l.from && selStart < l.to)) {
			new Notice('Links cannot be colored in this version.');
			return false;
		}

		const res = transformLineWithDelimiters(
			line,
			selStart,
			selEnd,
			syntax.delimiters,
			op,
		);

		if (!res.success) {
			if (res.errorReason === 'unmarked_span') {
				new Notice(
					'Cette sélection chevauche une balise HTML non gérée par Inkwell. Utilisez la commande d’adoption pour la prendre en charge.',
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

	const res = transformLine(line, selStart, selEnd, op);
	if (!res.success) {
		if (res.errorReason === 'unmarked_span') {
			new Notice(
				'Cette sélection chevauche une balise HTML non gérée par Inkwell. Utilisez la commande d’adoption pour la prendre en charge.',
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

export function setSelectionColor(
	editor: Editor,
	tracker: EmbedSelectionTracker,
	color: string | null,
	filePath: string | null,
): boolean {
	const captured = captureSelectionState(editor, tracker, filePath);

	if (color !== null) {
		return applyColorToCapturedRange(editor, captured, filePath, color);
	}

	// For removal (color === null)
	if (captured.lineNo !== captured.targetToLine) {
		new Notice('Selections over several lines are not supported yet.');
		return false;
	}

	const line = editor.getLine(captured.lineNo);
	const res = transformLine(
		line,
		captured.fromCh,
		captured.toCh,
		{ type: 'remove-color' },
	);

	if (!res.success) {
		if (res.errorReason === 'unmarked_span') {
			new Notice(
				'Cette balise n’est pas gérée par Inkwell. Utilisez la commande d’adoption pour la prendre en charge.',
			);
		} else {
			new Notice('No text color to remove here.');
		}
		return false;
	}

	if (res.result) {
		applyLineChange(editor, captured.lineNo, line, res.result);
		return true;
	}
	return false;
}

export function chooseAndApplyColor(
	plugin: InkwellPlugin,
	editor: Editor,
	tracker: EmbedSelectionTracker,
): void {
	const activeFile = plugin.app.workspace.getActiveFile();
	const captured = captureSelectionState(editor, tracker, activeFile?.path ?? null);

	if (!captured.hasSelection) {
		new Notice('Select some text first.');
		return;
	}

	if (captured.lineNo !== captured.targetToLine) {
		new Notice('Selections over several lines are not supported yet.');
		return;
	}

	new ColorPickerModal(plugin.app, plugin, captured).open();
}
