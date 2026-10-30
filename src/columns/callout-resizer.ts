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

import { App, MarkdownView } from 'obsidian';

export class CalloutColumnResizer {
	constructor(private readonly app: App) {}

	attachResizers(rootEl: HTMLElement): void {
		const containers = rootEl.querySelectorAll<HTMLElement>(
			'div.callout[data-callout="multi-column"] > .callout-content',
		);

		containers.forEach((content) => {
			// Find column callouts
			const cols = Array.from(content.children).filter(
				(child): child is HTMLElement =>
					child instanceof HTMLElement &&
					(child.matches('div.callout[data-callout="col"]') ||
						child.matches('div.callout[data-callout="column"]')),
			);

			if (cols.length < 2) return;

			// Apply ratio from data-callout-metadata for 2 or more columns in Reading Mode
			cols.forEach((col) => {
				const meta = col.getAttribute('data-callout-metadata');
				if (meta && /^\d+$/.test(meta)) {
					col.style.flex = `${meta} 1 0%`;
				}
			});

			if (cols.length !== 2) return;

			// If resizer already exists, remove it before re-adding
			content.querySelectorAll(':scope > .inkwell-callout-resizer').forEach((r) => r.remove());

			const resizer = document.createElement('div');
			resizer.className = 'inkwell-callout-resizer';
			resizer.title = 'Glisser pour redimensionner les colonnes';
			const handle = document.createElement('div');
			handle.className = 'inkwell-callout-resizer-handle';
			resizer.appendChild(handle);

			// Insert between column 1 and column 2
			content.insertBefore(resizer, cols[1] ?? null);

			resizer.addEventListener('mousedown', (e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();

				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const editor = view?.editor;
				if (!editor) return;

				const containerRect = content.getBoundingClientRect();
				const totalWidth = Math.max(1, containerRect.width);

				const col1 = cols[0];
				const col2 = cols[1];
				if (!col1 || !col2) return;

				let leftPct = Math.round((col1.getBoundingClientRect().width / totalWidth) * 100);
				leftPct = Math.max(20, Math.min(80, leftPct));

				resizer.addClass('is-dragging');

				const onMouseMove = (moveEvent: MouseEvent) => {
					const mouseX = moveEvent.clientX - containerRect.left;
					let pct = Math.round((mouseX / totalWidth) * 100);
					pct = Math.max(20, Math.min(80, pct));
					const rightPct = 100 - pct;

					col1.style.flex = `0 0 ${pct}%`;
					col2.style.flex = `0 0 ${rightPct}%`;
					leftPct = pct;
				};

				const onMouseUp = () => {
					window.removeEventListener('mousemove', onMouseMove);
					window.removeEventListener('mouseup', onMouseUp);
					resizer.removeClass('is-dragging');

					// Commit ratio to note in a single editor transaction so Cmd+Z undoes it in 1 action
					const cmView = (view.editor as unknown as { cm?: { dispatch: (tr: { changes: Array<{ from: number; to: number; insert: string }> }) => void; state: { doc: { line: (n: number) => { from: number; to: number; text: string } } } } }).cm;
					if (cmView) {
						this.writeBackRatio(editor, cmView, leftPct, 100 - leftPct);
					}
				};

				window.addEventListener('mousemove', onMouseMove);
				window.addEventListener('mouseup', onMouseUp);
			});
		});
	}

	writeBackRatio(
		editor: {
			lineCount: () => number;
			getLine: (n: number) => string;
		},
		view: {
			dispatch: (tr: { changes: Array<{ from: number; to: number; insert: string }> }) => void;
			state: { doc: { line: (n: number) => { from: number; to: number; text: string } } };
		},
		r1: number,
		r2: number,
	): void {
		const totalLines = editor.lineCount();
		const changes: Array<{ from: number; to: number; insert: string }> = [];
		let colIndex = 0;

		for (let i = 0; i < totalLines; i++) {
			const line = editor.getLine(i);
			if (/^(\s*(?:>\s*)+)\[!(?:col|column)(?:\|[^\]]*)?\]/i.test(line)) {
				colIndex++;
				const prefix = line.match(/^(\s*(?:>\s*)+)\[!(?:col|column)/i)?.[1]?.trimEnd() ?? '> >';
				const ratio = colIndex === 1 ? r1 : r2;
				const newLine = `${prefix} [!col|${ratio}]`;
				const cmLine = view.state.doc.line(i + 1);

				changes.push({
					from: cmLine.from,
					to: cmLine.to,
					insert: newLine,
				});

				if (colIndex >= 2) break;
			}
		}

		if (changes.length > 0) {
			view.dispatch({ changes });
		}
	}
}
