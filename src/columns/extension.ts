import { Extension, Prec, Range, StateField } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
} from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import type InkwellPlugin from '../main';
import { cleanupExcessColumnControllers, ColumnLayoutWidget } from './column-widget';

let activePlugin: InkwellPlugin | null = null;

function buildColumnDecorations(
	doc: {
		lines: number;
		line: (n: number) => { from: number; to: number; text: string };
		sliceString: (from: number, to: number) => string;
	},
	plugin: InkwellPlugin,
): { decorations: DecorationSet; count: number } {
	const decorations: Range<Decoration>[] = [];
	let i = 1;
	let blockIndex = 0;

	while (i <= doc.lines) {
		const line = doc.line(i);
		const lineText = line.text;

		if (/^\s*>\s*\[!(?:multi-column|columns)(?:\|.*)?\]/i.test(lineText)) {
			const startPos = line.from;
			let endPos = line.to;
			let endLineNum = i;

			// Scan forward while lines belong to the callout (start with '>')
			for (let j = i + 1; j <= doc.lines; j++) {
				const nextLine = doc.line(j);
				if (/^\s*>/.test(nextLine.text)) {
					endPos = nextLine.to;
					endLineNum = j;
				} else {
					break;
				}
			}

			const rawMarkdown = doc.sliceString(startPos, endPos);
			decorations.push(
				Decoration.replace({
					widget: new ColumnLayoutWidget(rawMarkdown, startPos, endPos, blockIndex, plugin),
					block: true,
				}).range(startPos, endPos),
			);

			blockIndex++;
			i = endLineNum + 1;
		} else {
			i++;
		}
	}

	return {
		decorations: Decoration.set(decorations, true),
		count: blockIndex,
	};
}

function isVisualColumnsModeActive(): boolean {
	if (!activePlugin) return false;
	const mode = activePlugin.settings.columnPrototypeMode;
	return mode === 'notion' || mode === 'widget';
}

export const visualColumnsField = StateField.define<DecorationSet>({
	create(state) {
		if (!isVisualColumnsModeActive() || !activePlugin) {
			return Decoration.none;
		}
		if (state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		try {
			return buildColumnDecorations(state.doc, activePlugin).decorations;
		} catch {
			return Decoration.none;
		}
	},
	update(decorations, tr) {
		if (!isVisualColumnsModeActive() || !activePlugin) {
			return Decoration.none;
		}
		if (tr.state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		if (tr.docChanged || decorations === Decoration.none) {
			try {
				return buildColumnDecorations(tr.state.doc, activePlugin).decorations;
			} catch {
				return Decoration.none;
			}
		}
		return decorations.map(tr.changes);
	},
	provide: (f) => [
		Prec.highest(EditorView.decorations.from(f)),
		EditorView.atomicRanges.of((view) => {
			if (isVisualColumnsModeActive() && activePlugin) {
				const count = buildColumnDecorations(view.state.doc, activePlugin).count;
				cleanupExcessColumnControllers(view, count);
			}
			return view.state.field(f, false) ?? Decoration.none;
		}),
	],
});

export function createVisualColumnsExtension(plugin: InkwellPlugin): Extension {
	activePlugin = plugin;
	return visualColumnsField;
}
