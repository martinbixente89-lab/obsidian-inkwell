import type { EditorView } from '@codemirror/view';
import { Editor, EditorPosition } from 'obsidian';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import { minimalDiff } from '../utils/text-diff';

function normalizeEnd(editor: Editor, from: EditorPosition, to: EditorPosition): EditorPosition {
	if (to.line === from.line + 1 && to.ch === 0) {
		return { line: from.line, ch: editor.getLine(from.line).length };
	}
	return to;
}

function getTargetRange(
	editor: Editor,
	tracker: EmbedSelectionTracker,
): { from: EditorPosition; to: EditorPosition } {
	const view = (editor as Editor & { cm?: EditorView }).cm;
	const widgetSelection = view ? tracker.getSelection(view) : null;
	if (widgetSelection) {
		const p1 = editor.offsetToPos(widgetSelection.from);
		const p2 = editor.offsetToPos(widgetSelection.to);
		if (p1.line > p2.line || (p1.line === p2.line && p1.ch > p2.ch)) {
			return { from: p2, to: p1 };
		}
		return { from: p1, to: p2 };
	}
	const p1 = editor.getCursor('from');
	const p2 = editor.getCursor('to');
	if (p1.line > p2.line || (p1.line === p2.line && p1.ch > p2.ch)) {
		return { from: p2, to: p1 };
	}
	return { from: p1, to: p2 };
}

export interface CapturedEditorSelection {
	editor: Editor;
	filePath: string | null;
	lineNo: number;
	targetToLine: number;
	lineText: string;
	fromCh: number;
	toCh: number;
	hasSelection: boolean;
}

export function captureSelectionState(
	editor: Editor,
	tracker: EmbedSelectionTracker,
	filePath: string | null,
): CapturedEditorSelection {
	const target = getTargetRange(editor, tracker);
	const from = target.from;
	const to = normalizeEnd(editor, from, target.to);
	const hasSelection = from.line !== to.line || from.ch !== to.ch;
	const lineText = editor.getLine(from.line);

	return {
		editor,
		filePath,
		lineNo: from.line,
		targetToLine: to.line,
		lineText,
		fromCh: Math.min(from.ch, to.ch),
		toCh: Math.max(from.ch, to.ch),
		hasSelection,
	};
}

export function applyLineChange(
	editor: Editor,
	lineNo: number,
	oldLine: string,
	result: { text: string; from: number; to: number },
): void {
	const diff = minimalDiff(oldLine, result.text);
	editor.transaction({
		changes: [
			{
				from: { line: lineNo, ch: diff.start },
				to: { line: lineNo, ch: diff.end },
				text: diff.insert,
			},
		],
		selection: {
			from: { line: lineNo, ch: result.from },
			to: { line: lineNo, ch: result.to },
		},
	});
}
