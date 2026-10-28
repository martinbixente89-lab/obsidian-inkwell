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
import { FontFamilyModal } from '../ui/font-family-modal';
import {
	applyLineChange,
	CapturedEditorSelection,
	captureSelectionState,
} from './selection-state';

/**
 * Validates that captured state is still valid, then applies the font family (or removes it if null).
 */
export function applyFontFamilyToCapturedRange(
	editor: Editor,
	captured: CapturedEditorSelection,
	currentFilePath: string | null,
	fontFamily: string | null,
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
	const op: OperationType =
		fontFamily !== null
			? { type: 'set-font-family', fontFamily }
			: { type: 'remove-font-family' };

	if (view) {
		const lineObj = view.state.doc.line(captured.lineNo + 1);
		const syntax = getLineSyntaxInfo(view, lineObj.from, lineObj.to);

		if (syntax.wikilinks.some((w) => selEnd > w.from && selStart < w.to)) {
			new Notice('Cannot format across internal wikilinks [[...]].');
			return false;
		}

		if (syntax.links.some((l) => selEnd > l.from && selStart < l.to)) {
			new Notice('Links cannot be modified in this version.');
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
			if (res.errorReason === 'markdown_prefix') {
				new Notice('Cannot format Markdown heading, list, or checkbox markers.');
			} else if (res.errorReason === 'unmarked_span') {
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
		if (res.errorReason === 'markdown_prefix') {
			new Notice('Cannot format Markdown heading, list, or checkbox markers.');
		} else if (res.errorReason === 'unmarked_span') {
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

export function setSelectionFontFamily(
	editor: Editor,
	tracker: EmbedSelectionTracker,
	fontFamily: string | null,
	filePath: string | null,
): boolean {
	const captured = captureSelectionState(editor, tracker, filePath);
	if (!captured.hasSelection) {
		new Notice('Select some text first.');
		return false;
	}
	return applyFontFamilyToCapturedRange(editor, captured, filePath, fontFamily);
}

export function chooseAndApplyFontFamily(
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

	new FontFamilyModal(plugin.app, plugin, captured).open();
}
