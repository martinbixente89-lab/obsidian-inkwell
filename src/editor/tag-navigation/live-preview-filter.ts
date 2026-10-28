import { PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { EditorView, DecorationSet, Decoration } from '@codemirror/view';
import type { EditorState, Transaction } from '@codemirror/state';
import { findFormattingSpansInDoc } from './simple-spans';
import { findUnderlineRanges } from '../../format/markdown-formats';

interface LivePreviewDecoField {
	createF: (state: EditorState) => DecorationSet;
	updateF: (value: DecorationSet, tr: Transaction) => DecorationSet;
}

interface ImageSelectionManager {
	selectedImageRange: unknown;
	decorations: LivePreviewDecoField;
}

function filterInkwellEmbeds(
	decoSet: DecorationSet,
	docText: string,
	isBoldSupported: boolean,
): DecorationSet {
	if (!docText.includes('<span') && !docText.includes('<u')) return decoSet;

	const spans = findFormattingSpansInDoc(docText, isBoldSupported);
	const uRanges = docText.includes('<u') ? findUnderlineRanges(docText) : [];
	if (spans.length === 0 && uRanges.length === 0) return decoSet;

	const spanRanges = new Set<string>();
	for (const s of spans) {
		let start = s.spanStart;
		if (s.enclosedInUnderline) start -= s.uOpenLen ?? 3;
		if (s.enclosedInBold) start -= 2;
		let end = s.spanEnd;
		if (s.enclosedInUnderline) end += s.uCloseLen ?? 4;
		if (s.enclosedInBold) end += 2;
		spanRanges.add(`${start}:${end}`);
	}
	for (const u of uRanges) {
		spanRanges.add(`${u.from}:${u.to}`);
	}

	return decoSet.update({
		filter: (from: number, to: number, deco: Decoration) => {
			const spec = deco.spec as { widget?: unknown } | undefined;
			if (spec?.widget && spanRanges.has(`${from}:${to}`)) {
				return false;
			}
			return true;
		},
	});
}

/**
 * In Obsidian Live Preview, Obsidian attaches an HTML embed widget (.cm-html-embed)
 * on non-active lines containing <span> or <u> tags.
 *
 * This ViewPlugin hooks into Obsidian's internal Live Preview decoration field
 * to filter out the embed widget on Inkwell-managed spans, allowing Inkwell's
 * split decorations (hide tags + style real text) to operate without collision
 * across all visible lines. As a result, the styled text remains real editable
 * editor text, selectable and editable character by character.
 */
export class LivePreviewFilterPluginValue implements PluginValue {
	private decoField: LivePreviewDecoField | null = null;
	private origCreateF: ((state: EditorState) => DecorationSet) | null = null;
	private origUpdateF: ((value: DecorationSet, tr: Transaction) => DecorationSet) | null = null;

	constructor(
		view: EditorView,
		private readonly isBoldSupported: () => boolean,
	) {
		this.hook(view);
	}

			update(u: ViewUpdate): void {
				this.hook(u.view);
			}

			destroy(): void {
				if (this.decoField) {
					if (this.origCreateF) this.decoField.createF = this.origCreateF;
					if (this.origUpdateF) this.decoField.updateF = this.origUpdateF;
					this.decoField = null;
					this.origCreateF = null;
					this.origUpdateF = null;
				}
			}

			private hook(view: EditorView): void {
				if (this.decoField) return;

				const values: unknown = (view.state as unknown as { values?: unknown[] }).values;
				if (!Array.isArray(values)) return;

				for (const v of values) {
					if (
						v &&
						typeof v === 'object' &&
						'selectedImageRange' in v &&
						'decorations' in v
					) {
						const decoField = (v as ImageSelectionManager).decorations;
						if (decoField && typeof decoField.updateF === 'function') {
							this.decoField = decoField;
							this.origCreateF = decoField.createF;
							this.origUpdateF = decoField.updateF;

							const origCreate = decoField.createF;
							const origUpdate = decoField.updateF;
							const isBold = () => this.isBoldSupported();

							decoField.createF = function (state: EditorState): DecorationSet {
								const res = origCreate.call(this, state);
								return filterInkwellEmbeds(res, state.doc.toString(), isBold());
							};

							decoField.updateF = function (val: DecorationSet, tr: Transaction): DecorationSet {
								const res = origUpdate.call(this, val, tr);
								return filterInkwellEmbeds(res, tr.state.doc.toString(), isBold());
							};
							break;
						}
					}
		}
	}
}

export function createLivePreviewFilterPlugin(isBoldSupported = () => true): ViewPlugin<LivePreviewFilterPluginValue> {
	return ViewPlugin.define((view) => new LivePreviewFilterPluginValue(view, isBoldSupported));
}
