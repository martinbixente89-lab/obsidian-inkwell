/**
 * Adapted from Obsidian-MultiColumn-Layout by Zheyuan (Max) Kong (MIT License)
 * Copyright (c) 2025 Zheyuan (Max) Kong
 * https://github.com/MaxMiksa/Obsidian-MultiColumn-Layout
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

import { EditorSelection, Prec, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';

export interface ColumnContext {
	prefixBare: string;       // e.g. ">>" or "> >"
	prefixWithSpace: string;  // e.g. "> > "
	colDepth: number;
	colHeaderLineNumber: number;
}

/**
 * Searches upwards to check if current line is inside a multi-column callout.
 */
export function getColumnContext(view: EditorView): ColumnContext | null {
	const pos = view.state.selection.main.head;
	const doc = view.state.doc;
	const currentLine = doc.lineAt(pos);
	const minLine = Math.max(1, currentLine.number - 200);

	for (let lineNum = currentLine.number; lineNum >= minLine; lineNum--) {
		const text = doc.line(lineNum).text;
		const match = /^(\s*)(>+)\s*\[!(?:col|column)(?:[^\]]*)\]/i.exec(text);
		if (!match) continue;

		const colDepth = match[2]?.length ?? 0;
		// Must be inside an enclosing multi-column container (> [!multi-column])
		let hasContainer = false;
		for (let cLine = lineNum - 1; cLine >= Math.max(1, lineNum - 100); cLine--) {
			const cText = doc.line(cLine).text;
			if (/^(\s*)(>+)\s*\[!multi-column(?:[^\]]*)\]/i.test(cText)) {
				hasContainer = true;
				break;
			}
		}

		if (!hasContainer) continue;

		// Build quote prefix: "> > " or ">> "
		const barePrefix = match[2]?.includes(' ') ? match[2] : match[2]?.split('').join(' ') ?? '> >';
		return {
			prefixBare: barePrefix,
			prefixWithSpace: `${barePrefix} `,
			colDepth,
			colHeaderLineNumber: lineNum,
		};
	}

	return null;
}

/**
 * Finds the end of the entire multi-column callout block to allow clean exit.
 */
export function findMultiColumnEnd(view: EditorView, startLineNum: number): number {
	const doc = view.state.doc;
	let endLine = startLineNum;

	for (let i = startLineNum; i <= doc.lines; i++) {
		const line = doc.line(i);
		if (/^\s*>/.test(line.text)) {
			endLine = i;
		} else {
			break;
		}
	}

	return endLine;
}

function handleEnterInColumn(view: EditorView): boolean {
	const ctx = getColumnContext(view);
	if (!ctx) return false;

	const range = view.state.selection.main;
	const doc = view.state.doc;
	const currentLine = doc.lineAt(range.head);
	const lineText = currentLine.text;

	// Check if the current line is an empty quote line (e.g. "> > " or "> >")
	const isCurrentEmptyQuote = /^(\s*>)+\s*$/.test(lineText);

	if (isCurrentEmptyQuote) {
		// Check the previous line: if previous line was ALSO an empty quote line,
		// then two consecutive empty Enters mean the user wants to exit under the columns.
		const prevLine = currentLine.number > 1 ? doc.line(currentLine.number - 1) : null;
		const isPrevEmptyQuote = prevLine ? /^(\s*>)+\s*$/.test(prevLine.text) : false;

		if (isPrevEmptyQuote) {
			// Exit under the multi-column container!
			const endLineNum = findMultiColumnEnd(view, ctx.colHeaderLineNumber);
			const endLine = doc.line(endLineNum);
			const exitPos = endLine.to;

			// Replace the empty quote line with a clean newline after container
			view.dispatch({
				changes: [
					{ from: currentLine.from, to: currentLine.to + (currentLine.number < doc.lines ? 1 : 0), insert: '' },
				],
			});

			const updatedDoc = view.state.doc;
			const newExitPos = Math.min(exitPos, updatedDoc.length);
			view.dispatch({
				changes: { from: newExitPos, to: newExitPos, insert: '\n' },
				selection: EditorSelection.cursor(newExitPos + 1),
			});
			return true;
		}

		// First empty Enter: keep inside column with a blank paragraph line (> > )
		const insertText = `\n${ctx.prefixWithSpace}`;
		view.dispatch({
			changes: { from: range.from, to: range.to, insert: insertText },
			selection: EditorSelection.cursor(range.from + insertText.length),
			annotations: Transaction.userEvent.of('input.enter'),
		});
		return true;
	}

	// Normal line with content: insert newline with the column prefix
	const insertText = `\n${ctx.prefixWithSpace}`;
	view.dispatch({
		changes: { from: range.from, to: range.to, insert: insertText },
		selection: EditorSelection.cursor(range.from + insertText.length),
		annotations: Transaction.userEvent.of('input.enter'),
	});
	return true;
}

function handleShiftEnterInColumn(view: EditorView): boolean {
	const ctx = getColumnContext(view);
	if (!ctx) return false;

	// Shift+Enter explicitly exits out of the container to a normal line below
	const endLineNum = findMultiColumnEnd(view, ctx.colHeaderLineNumber);
	const endLine = view.state.doc.line(endLineNum);
	const insertPos = endLine.to;

	view.dispatch({
		changes: { from: insertPos, to: insertPos, insert: '\n' },
		selection: EditorSelection.cursor(insertPos + 1),
	});
	return true;
}

export function createColumnKeymapExtension(): Extension {
	const bindings: KeyBinding[] = [
		{
			key: 'Enter',
			run: (view) => handleEnterInColumn(view),
		},
		{
			key: 'Shift-Enter',
			run: (view) => handleShiftEnterInColumn(view),
		},
	];

	return Prec.highest(keymap.of(bindings));
}

