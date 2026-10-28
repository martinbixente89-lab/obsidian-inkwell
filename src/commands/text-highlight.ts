import type { EditorView } from '@codemirror/view';
import { Editor, Notice } from 'obsidian';
import type InkwellPlugin from '../main';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import {
	HighlightAppearance,
	OperationType,
	transformLine,
	transformLineWithDelimiters,
} from '../format/color-spans';
import { getLineSyntaxInfo } from '../format/syntax-helper';
import { HighlightPickerModal } from '../ui/highlight-picker-modal';
import {
	applyLineChange,
	CapturedEditorSelection,
	captureSelectionState,
} from './selection-state';

/**
 * Validates that captured state is still valid, then applies the highlight with optional appearance.
 */
export function applyHighlightToCapturedRange(
	editor: Editor,
	captured: CapturedEditorSelection,
	currentFilePath: string | null,
	highlight: string,
	appearance?: HighlightAppearance | null,
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
	const op: OperationType = {
		type: 'set-highlight',
		highlight,
		appearance: appearance ?? undefined,
	};

	if (view) {
		const lineObj = view.state.doc.line(captured.lineNo + 1);
		const syntax = getLineSyntaxInfo(view, lineObj.from, lineObj.to);

		if (syntax.wikilinks.some((w) => selEnd > w.from && selStart < w.to)) {
			new Notice('Cannot highlight across internal wikilinks [[...]].');
			return false;
		}

		if (syntax.links.some((l) => selEnd > l.from && selStart < l.to)) {
			new Notice('Links cannot be highlighted in this version.');
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

/**
 * Removes custom appearance (radius, thickness, position) while preserving highlight color.
 */
export function removeHighlightAppearanceFromCapturedRange(
	editor: Editor,
	captured: CapturedEditorSelection,
	currentFilePath: string | null,
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

	const view = (editor as Editor & { cm?: EditorView }).cm;
	const line = captured.lineText;
	const selStart = captured.fromCh;
	const selEnd = captured.toCh;
	const op: OperationType = { type: 'remove-highlight-appearance' };

	if (view) {
		const lineObj = view.state.doc.line(captured.lineNo + 1);
		const syntax = getLineSyntaxInfo(view, lineObj.from, lineObj.to);
		const res = transformLineWithDelimiters(
			line,
			selStart,
			selEnd,
			syntax.delimiters,
			op,
		);
		if (!res.success) return false;
		if (res.result) {
			applyLineChange(editor, captured.lineNo, line, res.result);
			return true;
		}
		return false;
	}

	const res = transformLine(line, selStart, selEnd, op);
	if (res.success && res.result) {
		applyLineChange(editor, captured.lineNo, line, res.result);
		return true;
	}
	return false;
}

export function setSelectionHighlight(
	editor: Editor,
	tracker: EmbedSelectionTracker,
	highlight: string | null,
	filePath: string | null,
): boolean {
	const captured = captureSelectionState(editor, tracker, filePath);

	if (highlight !== null) {
		return applyHighlightToCapturedRange(editor, captured, filePath, highlight);
	}

	// For removal (highlight === null)
	if (captured.lineNo !== captured.targetToLine) {
		new Notice('Selections over several lines are not supported yet.');
		return false;
	}

	const line = editor.getLine(captured.lineNo);
	const res = transformLine(
		line,
		captured.fromCh,
		captured.toCh,
		{ type: 'remove-highlight' },
	);

	if (!res.success) {
		if (res.errorReason === 'unmarked_span') {
			new Notice(
				'Cette balise n’est pas gérée par Inkwell. Utilisez la commande d’adoption pour la prendre en charge.',
			);
		} else {
			new Notice('No highlight to remove here.');
		}
		return false;
	}

	if (res.result) {
		applyLineChange(editor, captured.lineNo, line, res.result);
		return true;
	}
	return false;
}

export function chooseAndApplyHighlight(
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

	new HighlightPickerModal(plugin.app, plugin, captured).open();
}
