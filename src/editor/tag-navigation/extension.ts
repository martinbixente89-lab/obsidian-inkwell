import {
	ChangeSet,
	EditorSelection,
	EditorState,
	Extension,
	Prec,
	RangeSet,
	RangeSetBuilder,
	Transaction,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	KeyBinding,
	keymap,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
} from '@codemirror/view';
import { ChangeDecision, checkChange, GuardRefusal } from './edit-guard';
import { findSimpleSpans, SimpleSpan } from './simple-spans';
import { createInactiveBoldSyncPlugin } from './inactive-bold-sync';
import { buildPartialBoldTransformation } from './partial-bold';
import { createClipboardSanitizer } from './clipboard-sanitizer';
import { createLivePreviewFilterPlugin } from './live-preview-filter';
import { transformLine, OperationType } from '../../format/color-spans';

/** User events whose document changes are checked by the guard. */
const GUARDED_EVENTS = ['input', 'delete', 'move'];

const TAG_MARK = Decoration.mark({});

import { findFormattingSpansInDoc } from './simple-spans';
import { findInnerEmphasisSpans } from './inner-markdown';

/**
 * Builds the atomic ranges of the visible lines: only the opening tag
 * [spanStart, innerStart), closing tag [innerEnd, spanEnd), and hidden
 * inner Markdown delimiters. The visible content itself is never atomic.
 */
function buildTagRanges(view: EditorView, isBoldSupported = true): RangeSet<Decoration> {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	const { from, to } = view.viewport ?? { from: 0, to: doc.length };
	const allSpans = findFormattingSpansInDoc(doc.toString(), isBoldSupported);

	const intervals: Array<{ from: number; to: number }> = [];
	for (const s of allSpans) {
		const openStart = s.enclosedInUnderline ? s.spanStart - (s.uOpenLen ?? 3) : s.spanStart;
		const closeEnd = s.enclosedInUnderline ? s.spanEnd + (s.uCloseLen ?? 4) : s.spanEnd;
		const openEnd = s.innerStart;
		const closeStart = s.innerEnd;

		if (openEnd > from && openStart < to) {
			intervals.push({ from: Math.max(from, openStart), to: Math.min(to, openEnd) });
		}
		if (closeEnd > from && closeStart < to) {
			intervals.push({ from: Math.max(from, closeStart), to: Math.min(to, closeEnd) });
		}

		// Inner markdown delimiter intervals (***, **, *)
		const innerText = doc.sliceString(s.innerStart, s.innerEnd);
		const innerEmphasis = findInnerEmphasisSpans(innerText, s.innerStart, isBoldSupported);
		for (const emp of innerEmphasis) {
			if (emp.openEnd > from && emp.openStart < to) {
				intervals.push({ from: Math.max(from, emp.openStart), to: Math.min(to, emp.openEnd) });
			}
			if (emp.closeEnd > from && emp.closeStart < to) {
				intervals.push({ from: Math.max(from, emp.closeStart), to: Math.min(to, emp.closeEnd) });
			}
		}
	}

	intervals.sort((a, b) => a.from - b.from || a.to - b.to);
	let lastTo = -1;
	for (const int of intervals) {
		if (int.from >= lastTo && int.to > int.from) {
			builder.add(int.from, int.to, TAG_MARK);
			lastTo = int.to;
		}
	}
	return builder.finish();
}

/**
 * Returns the evaluated decision for the changes of `tr`.
 * Exported for tests (works on a plain EditorState).
 */
export function findDecision(
	startState: EditorState,
	changes: ChangeSet,
	isBoldSupported = true,
): ChangeDecision {
	const doc = startState.doc;
	const allSpans = findFormattingSpansInDoc(doc.toString(), isBoldSupported);
	let decision: ChangeDecision = { type: 'allow' };

	changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		if (decision.type === 'no-op' || decision.type === 'rewrite' || decision.type === 'rewrite-multispan' || decision.type === 'clean-span') {
			return;
		}

		const d = checkChange(allSpans, fromA, toA, inserted.toString(), doc);
		if (d.type !== 'allow') {
			decision = d;
		}
	});
	return decision;
}

export interface TagNavigationOptions {
	/** True when the editor extension is active. */
	isActive: (state: EditorState) => boolean;
	/** Optional live preview detection check. */
	isLivePreview?: (state: EditorState) => boolean;
	/** True if the experimental color + bold combination is enabled. */
	isBoldSupported?: () => boolean;
	/** Called when a user edit is refused. */
	onRefuse: (reason: GuardRefusal) => void;
}

export type BoldToggleDecision =
	| { type: 'rewrite'; changes: Array<{ from: number; to?: number; insert: string }>; span: SimpleSpan }
	| { type: 'rewrite-partial'; changes: Array<{ from: number; to?: number; insert: string }>; selection: EditorSelection }
	| { type: 'refuse-partial' }
	| null;

/**
 * Detects if a transaction corresponds to toggling bold on a simple span:
 * - Full visible span: rewrites to canonical outer bold wrap or unwrap.
 * - Eligible partial selection: rewrites to partitioned spans.
 * - Otherwise: refuses the transaction to avoid degraded formatting.
 */
export function evaluateBoldToggle(
	startState: EditorState,
	changes: ChangeSet,
	isBoldSupported = true,
): BoldToggleDecision {
	if (!isBoldSupported) {
		return null;
	}

	const changesList: Array<{ fromA: number; toA: number; inserted: string }> = [];
	changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
		changesList.push({ fromA, toA, inserted: ins.toString() });
	});

	const isTwoAsterisksPair =
		changesList.length === 2 &&
		changesList[0]!.fromA === changesList[0]!.toA &&
		changesList[0]!.inserted === '**' &&
		changesList[1]!.fromA === changesList[1]!.toA &&
		changesList[1]!.inserted === '**';

	const isFourAsterisksSingle =
		changesList.length === 1 &&
		changesList[0]!.fromA === changesList[0]!.toA &&
		changesList[0]!.inserted === '****';

	if (!isTwoAsterisksPair && !isFourAsterisksSingle) {
		return null;
	}

	const doc = startState.doc;
	const firstPos = changesList[0]!.fromA;
	const secondPos = isTwoAsterisksPair ? changesList[1]!.fromA : firstPos;
	const fromLine = doc.lineAt(firstPos).number;
	const toLine = doc.lineAt(secondPos).number;
	if (fromLine !== toLine) return null;

	const spans = findSimpleSpans(doc, fromLine, toLine, isBoldSupported);
	for (const s of spans) {
		const visStart = s.innerBold ? s.innerStart + 2 : s.innerStart;
		const visEnd = s.innerBold ? s.innerEnd - 2 : s.innerEnd;

		// Does the bold insertion fall inside or touch the inner content of this span?
		if (firstPos >= s.innerStart && secondPos <= s.innerEnd) {
			const isFullVisible = isTwoAsterisksPair && firstPos === visStart && secondPos === visEnd;
			if (isFullVisible) {
				if (s.enclosedInBold) {
					// Toggle OFF bold: remove outer **
					return {
						type: 'rewrite',
						changes: [
							{ from: s.spanStart - 2, to: s.spanStart, insert: '' },
							{ from: s.spanEnd, to: s.spanEnd + 2, insert: '' },
						],
						span: s,
					};
				} else if (s.innerBold) {
					// Toggle OFF bold: remove inner **
					return {
						type: 'rewrite',
						changes: [
							{ from: s.innerStart, to: s.innerStart + 2, insert: '' },
							{ from: s.innerEnd - 2, to: s.innerEnd, insert: '' },
						],
						span: s,
					};
				} else {
					// Toggle ON bold: wrap span in outer **
					return {
						type: 'rewrite',
						changes: [
							{ from: s.spanStart, insert: '**' },
							{ from: s.spanEnd, insert: '**' },
						],
						span: s,
					};
				}
			} else {
				// Partial selection: check if eligible for partial bold transformation
				const isReversed = startState.selection.main.anchor > startState.selection.main.head;
				const transformation = buildPartialBoldTransformation(doc, s, firstPos, secondPos, isReversed);
				if (transformation) {
					return {
						type: 'rewrite-partial',
						changes: [{
							from: transformation.replaceFrom,
							to: transformation.replaceTo,
							insert: transformation.replacement,
						}],
						selection: EditorSelection.single(transformation.newAnchor, transformation.newHead),
					};
				}
				// Strict partial selection on Cas 1 or collapsed cursor inside the span: refuse
				return { type: 'refuse-partial' };
			}
		}
	}
	return null;
}

export const rewriteBoldToggle = evaluateBoldToggle;

/** Transaction filter refusing unsafe user edits around simple spans and rewriting deletions of entire inner content. */
export function createEditGuard(options: TagNavigationOptions): Extension {
	return EditorState.transactionFilter.of((tr) => {
		if (!tr.docChanged) return tr;
		if (!GUARDED_EVENTS.some((e) => tr.isUserEvent(e))) return tr;
		if (!options.isActive(tr.startState)) return tr;

		const isBoldSupported = options.isBoldSupported?.() === true;
		// 1. Check if this is a toggle-bold transaction on an Inkwell span
		const boldDecision = evaluateBoldToggle(tr.startState, tr.changes, isBoldSupported);
		if (boldDecision) {
			if (boldDecision.type === 'refuse-partial') {
				options.onRefuse('partial-bold');
				return [];
			}
			if (boldDecision.type === 'rewrite-partial') {
				return {
					changes: boldDecision.changes,
					selection: boldDecision.selection,
					userEvent: tr.annotation(Transaction.userEvent),
					scrollIntoView: tr.scrollIntoView,
				};
			}
			const changeSet = ChangeSet.of(boldDecision.changes, tr.startState.doc.length);
			return {
				changes: boldDecision.changes,
				selection: tr.startState.selection.map(changeSet),
				userEvent: tr.annotation(Transaction.userEvent),
				scrollIntoView: tr.scrollIntoView,
			};
		}

		// 2. Evaluate normal decision
		const decision = findDecision(tr.startState, tr.changes, isBoldSupported);
		if (decision.type === 'no-op') {
			return {
				changes: [],
				selection: tr.startState.selection,
				userEvent: tr.annotation(Transaction.userEvent),
			};
		}
		if (decision.type === 'rewrite') {
			return {
				changes: decision.changes,
				selection: typeof decision.newCursor === 'number' ? EditorSelection.cursor(decision.newCursor) : undefined,
				userEvent: tr.annotation(Transaction.userEvent),
				scrollIntoView: tr.scrollIntoView,
			};
		}
		if (decision.type === 'refuse') {
			options.onRefuse(decision.reason);
			return [];
		}
		if (decision.type === 'clean-span') {
			const s = decision.span;
			let cleanFrom = s.spanStart;
			let cleanTo = s.spanEnd;
			if (s.enclosedInUnderline) {
				cleanFrom -= s.uOpenLen ?? 3;
				cleanTo += s.uCloseLen ?? 4;
			}
			if (s.enclosedInBold) {
				cleanFrom -= 2;
				cleanTo += 2;
			}
			return {
				changes: { from: cleanFrom, to: cleanTo, insert: '' },
				selection: EditorSelection.cursor(cleanFrom),
				userEvent: tr.annotation(Transaction.userEvent),
				scrollIntoView: tr.scrollIntoView,
			};
		}
		if (decision.type === 'rewrite-multispan') {
			const plan = decision.plan;
			return {
				changes: { from: plan.rangeStart, to: plan.rangeEnd, insert: plan.replacement },
				selection: EditorSelection.cursor(plan.newCursor),
				userEvent: tr.annotation(Transaction.userEvent),
				scrollIntoView: tr.scrollIntoView,
			};
		}
		return tr;
	});
}

import { buildSplitTagDecorations } from './unfolded-decorations';

/**
 * Executes an inline format (bold, italic, underline, strikethrough) on the CodeMirror view
 * using Inkwell's unified HTML representation.
 */
export function executeInlineFormatOnView(
	view: EditorView,
	isActive: (state: EditorState) => boolean,
	format: 'bold' | 'italic' | 'underline' | 'strikethrough',
): boolean {
	if (!isActive(view.state)) return false;
	const sel = view.state.selection.main;
	const doc = view.state.doc;
	const line = doc.lineAt(sel.from);
	if (line.number !== doc.lineAt(sel.to).number) return false;

	const lineText = line.text;
	const fromCh = sel.from - line.from;
	const toCh = sel.to - line.from;

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

	const res = transformLine(lineText, fromCh, toCh, { type: opType });
	if (!res.success || !res.result) return false;

	const tr = view.state.update({
		changes: [
			{
				from: line.from,
				to: line.to,
				insert: res.result.text,
			},
		],
		selection: EditorSelection.single(
			line.from + res.result.from,
			line.from + res.result.to,
		),
		userEvent: 'input',
	});
	view.dispatch(tr);
	return true;
}

/**
 * Toggles bold formatting using unified HTML representation (<span data-inkwell="1" style="...">).
 */
export function toggleBoldOnInkwellSpan(
	view: EditorView,
	isActive: (state: EditorState) => boolean,
	_isBoldSupported?: () => boolean,
): boolean {
	return executeInlineFormatOnView(view, isActive, 'bold');
}

/** Keymap binding Mod-b, Mod-i, and Mod-u to Inkwell's unified HTML formatting. */
export function createInlineFormatKeymap(options: TagNavigationOptions): Extension {
	const bindings: KeyBinding[] = [
		{
			key: 'Mod-b',
			run(view: EditorView): boolean {
				return executeInlineFormatOnView(view, options.isActive, 'bold');
			},
		},
		{
			key: 'Mod-i',
			run(view: EditorView): boolean {
				return executeInlineFormatOnView(view, options.isActive, 'italic');
			},
		},
		{
			key: 'Mod-u',
			run(view: EditorView): boolean {
				return executeInlineFormatOnView(view, options.isActive, 'underline');
			},
		},
	];
	return Prec.highest(keymap.of(bindings));
}

export function createBoldToggleKeymap(options: TagNavigationOptions): Extension {
	return createInlineFormatKeymap(options);
}

/** Full experimental extension: atomic tags + tag hiding on active line + edit guard + bold shortcut. */
export function createTagNavigationExtension(options: TagNavigationOptions): Extension {
	const isBold = () => options.isBoldSupported?.() === true;

	class TagRangesPlugin implements PluginValue {
		ranges: RangeSet<Decoration>;
		constructor(view: EditorView) {
			this.ranges = options.isActive(view.state) ? buildTagRanges(view, isBold()) : Decoration.none;
		}
		update(u: ViewUpdate): void {
			const active = options.isActive(u.state);
			if (!active) {
				this.ranges = Decoration.none;
				return;
			}
			if (
				u.docChanged ||
				u.viewportChanged ||
				active !== options.isActive(u.startState)
			) {
				this.ranges = buildTagRanges(u.view, isBold());
			}
		}
	}
	const tagRanges = ViewPlugin.fromClass(TagRangesPlugin);

	class TagDecoPlugin implements PluginValue {
		replaceSet: RangeSet<Decoration>;
		markSet: RangeSet<Decoration>;
		constructor(view: EditorView) {
			const { replaceSet, markSet } = buildSplitTagDecorations(view, options.isActive(view.state), isBold(), options.isLivePreview);
			this.replaceSet = replaceSet;
			this.markSet = markSet;
		}
		update(u: ViewUpdate): void {
			const active = options.isActive(u.state);
			if (!active) {
				this.replaceSet = Decoration.none;
				this.markSet = Decoration.none;
				return;
			}
			if (
				u.docChanged ||
				u.selectionSet ||
				u.viewportChanged ||
				active !== options.isActive(u.startState)
			) {
				const { replaceSet, markSet } = buildSplitTagDecorations(u.view, active, isBold(), options.isLivePreview);
				this.replaceSet = replaceSet;
				this.markSet = markSet;
			}
		}
	}
	const tagDecoPlugin: ViewPlugin<TagDecoPlugin> = ViewPlugin.fromClass(TagDecoPlugin);

	const replaceFacet = EditorView.decorations.of((view) => view.plugin(tagDecoPlugin)?.replaceSet ?? Decoration.none);
	const markFacet = EditorView.decorations.of((view) => view.plugin(tagDecoPlugin)?.markSet ?? Decoration.none);

	return [
		tagRanges,
		EditorView.atomicRanges.of((view) => view.plugin(tagRanges)?.ranges ?? Decoration.none),
		createLivePreviewFilterPlugin(isBold),
		tagDecoPlugin,
		replaceFacet,
		markFacet,
		createInactiveBoldSyncPlugin(options),
		createClipboardSanitizer(options),
		createEditGuard(options),
		createInlineFormatKeymap(options),
	];
}

