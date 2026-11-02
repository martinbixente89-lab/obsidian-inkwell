import {
	ChangeSet,
	EditorSelection,
	EditorState,
	Prec,
	Transaction,
} from '@codemirror/state';
import {
	EditorView,
	keymap,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { MarkdownView } from 'obsidian';
import type InkwellPlugin from '../main';
import { createTagNavigationExtension } from '../editor/tag-navigation/extension';
import { createSlashMenuExtension } from '../slash-menu/extension';
import { minimalDiff } from '../utils/text-diff';
import {
	isOffsetInFoldedHeadingSection,
	onHeadingFoldChange,
} from '../blocks/heading-fold';
import { createColumnVisualMarkdownExtension } from './column-markdown-deco';
import { closeActiveCalloutStylePopover } from '../blocks/callout-style-popover';
import { createVisualBookmarkExtension } from '../bookmark/bookmark-widget';
import {
	ColumnLineMapEntry,
	getBalancedRatios,
	localOffsetToParentOffset,
	MIN_COLUMN_RATIO_PERCENT,
	MultiColumnData,
	normalizeRatiosTo100,
	parentOffsetToLocalOffset,
	parseMultiColumnMarkdown,
	serializeMultiColumnMarkdown,
} from './parser';

const controllersByDom = new WeakMap<HTMLElement, ColumnWidgetController>();
const controllersByParentView = new WeakMap<EditorView, Map<number, ColumnWidgetController>>();

export function getColumnController(
	parentView: EditorView,
	blockIndex: number,
): ColumnWidgetController | undefined {
	return controllersByParentView.get(parentView)?.get(blockIndex);
}

export function getColumnControllerAtOffset(
	parentView: EditorView,
	fromOffset: number,
): ColumnWidgetController | undefined {
	const map = controllersByParentView.get(parentView);
	if (!map) return undefined;
	for (const ctrl of map.values()) {
		if (ctrl.blockFrom === fromOffset && ctrl.rootEl.isConnected) {
			return ctrl;
		}
	}
	return undefined;
}

export function cleanupExcessColumnControllers(parentView: EditorView, activeBlockCount: number): void {
	const map = controllersByParentView.get(parentView);
	if (!map) return;
	for (const [idx, ctrl] of map.entries()) {
		if (idx >= activeBlockCount) {
			ctrl.destroy();
			map.delete(idx);
		}
	}
}

export class ColumnWidgetController {
	public readonly rootEl: HTMLElement;
	public blockFrom: number;
	public blockTo: number;
	public blockIndex: number;
	public parentView: EditorView;
	public readonly plugin: InkwellPlugin;

	private data: MultiColumnData;
	private lastRawMarkdown: string;
	private containerEl!: HTMLElement;
	private colViews: EditorView[] = [];
	private panes: HTMLElement[] = [];
	private ratioBadge!: HTMLElement;
	private activeColIndex = 0;
	private isUpdatingFromParent = false;
	private isSyncingToParent = false;
	private cleanupResizeListeners: Array<() => void> = [];
	private unsubscribeFoldChange: (() => void) | null = null;

	constructor(
		rawMarkdown: string,
		blockFrom: number,
		blockTo: number,
		blockIndex: number,
		parentView: EditorView,
		plugin: InkwellPlugin,
	) {
		this.lastRawMarkdown = rawMarkdown;
		this.blockFrom = blockFrom;
		this.blockTo = blockTo;
		this.blockIndex = blockIndex;
		this.parentView = parentView;
		this.plugin = plugin;
		this.data = parseMultiColumnMarkdown(rawMarkdown);

		this.rootEl = document.createElement('div');
		this.rootEl.className = 'inkwell-visual-columns-root';
		if (this.plugin.settings.columnPrototypeMode === 'notion') {
			this.rootEl.classList.add('is-notion-mode');
		}
		this.rootEl.setAttribute('contenteditable', 'false');

		// Stop parent editor from stealing mouse/key events inside the widget
		const stopBubble = (e: Event) => e.stopPropagation();
		this.rootEl.addEventListener('keydown', stopBubble);
		this.rootEl.addEventListener('keyup', stopBubble);
		this.rootEl.addEventListener('keypress', stopBubble);

		this.buildChromeDOM();
		this.rebuildColumnsInContainer();
		this.updateHeadingFoldVisibility();

		this.unsubscribeFoldChange = onHeadingFoldChange(() => {
			this.updateHeadingFoldVisibility();
		});
	}

	public updateHeadingFoldVisibility(): void {
		const isFolded = isOffsetInFoldedHeadingSection(
			this.parentView,
			this.blockFrom,
			this.plugin,
		);
		this.rootEl.classList.toggle('is-folded-by-heading', isFolded);
	}

	public getColumnCount(): number {
		return this.colViews.length;
	}

	public getColumnView(colIdx: number): EditorView | undefined {
		return this.colViews[colIdx];
	}

	public getContainerWidthPx(): number {
		const w = this.containerEl?.getBoundingClientRect().width ?? 0;
		if (w > 0) return w;
		return this.parentView.contentDOM.getBoundingClientRect().width;
	}

	private getColumnMap(colIdx: number): ColumnLineMapEntry[] {
		return this.data.columns?.[colIdx]?.map ?? [];
	}

	private getColumnText(colIdx: number): string {
		return this.data.columns?.[colIdx]?.text ?? '';
	}

	private buildChromeDOM(): void {
		// 1. Header bar (used in legacy 'widget' mode; hidden via CSS in 'notion' mode)
		const header = document.createElement('div');
		header.className = 'inkwell-col-header';

		this.ratioBadge = document.createElement('span');
		this.ratioBadge.className = 'inkwell-col-ratio-badge';
		this.updateRatioBadgeText();
		header.appendChild(this.ratioBadge);

		const headerActions = document.createElement('div');
		headerActions.className = 'inkwell-col-header-actions';

		const resetRatioBtn = document.createElement('button');
		resetRatioBtn.type = 'button';
		resetRatioBtn.className = 'inkwell-col-btn';
		resetRatioBtn.textContent = '= Équilibrer';
		resetRatioBtn.title = 'Répartir les largeurs de manière équilibrée (total 100%)';
		resetRatioBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.commitRatioChange(getBalancedRatios(this.colViews.length));
		});
		headerActions.appendChild(resetRatioBtn);

		const exitTopBtn = document.createElement('button');
		exitTopBtn.type = 'button';
		exitTopBtn.className = 'inkwell-col-btn inkwell-col-btn-exit-top';
		exitTopBtn.textContent = '↵ Écrire sous les colonnes';
		exitTopBtn.title = 'Sortir du conteneur et placer le curseur en dessous (Échap)';
		exitTopBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.exitColumnsBelow();
		});
		headerActions.appendChild(exitTopBtn);

		header.appendChild(headerActions);
		this.rootEl.appendChild(header);

		// 2. Side-by-side columns flex container
		this.containerEl = document.createElement('div');
		this.containerEl.className = 'inkwell-col-container';
		this.rootEl.appendChild(this.containerEl);

		// 3. Footer exit bar (hidden in 'notion' mode)
		const footer = document.createElement('div');
		footer.className = 'inkwell-col-footer';
		const exitBottomBtn = document.createElement('button');
		exitBottomBtn.type = 'button';
		exitBottomBtn.className = 'inkwell-col-btn-exit';
		exitBottomBtn.textContent =
			'Cliquer ici ou appuyer sur Échap pour écrire en dessous des colonnes';
		exitBottomBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.exitColumnsBelow();
		});
		footer.appendChild(exitBottomBtn);
		this.rootEl.appendChild(footer);
	}

	private rebuildColumnsInContainer(): void {
		this.clearColumnInstances();

		const slices = this.data.columns ?? [
			{ blocks: this.data.col1, text: this.data.col1Text ?? '', map: this.data.col1Map ?? [] },
			{ blocks: this.data.col2, text: this.data.col2Text ?? '', map: this.data.col2Map ?? [] },
		];
		const colCount = Math.max(2, slices.length);
		const ratios = normalizeRatiosTo100(this.data.ratios, colCount);
		this.data.ratios = ratios;

		this.containerEl.dataset.colCount = String(colCount);

		for (let cIdx = 0; cIdx < colCount; cIdx++) {
			const pane = document.createElement('div');
			pane.className = 'inkwell-col-pane';
			pane.dataset.colIndex = String(cIdx);
			pane.style.flex = `${ratios[cIdx]!} 1 0%`;

			const host = document.createElement('div');
			host.className = 'inkwell-col-editor-host';
			host.dataset.colIndex = String(cIdx);
			pane.appendChild(host);

			const view = this.createColumnEditorView(cIdx, slices[cIdx]?.text ?? '', host);

			pane.addEventListener('mousedown', (e) => {
				if (e.target === pane) {
					e.preventDefault();
					e.stopPropagation();
					view.focus();
					view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
				}
			});

			this.panes.push(pane);
			this.colViews.push(view);
			this.containerEl.appendChild(pane);

			// Add inter-column resizer handle between adjacent columns (cIdx and cIdx + 1)
			if (cIdx < colCount - 1) {
				const divider = document.createElement('div');
				divider.className = 'inkwell-col-divider';
				divider.dataset.dividerIndex = String(cIdx);
				divider.title = 'Glisser pour ajuster la largeur entre ces deux colonnes';

				const handle = document.createElement('div');
				handle.className = 'inkwell-col-divider-handle';
				const pill = document.createElement('span');
				pill.className = 'inkwell-col-divider-pill';
				pill.textContent = `${Math.round(ratios[cIdx]!)}% | ${Math.round(ratios[cIdx + 1]!)}%`;

				divider.appendChild(handle);
				divider.appendChild(pill);
				this.containerEl.appendChild(divider);

				this.setupPairResizerEvents(divider, cIdx, this.containerEl);
			}
		}

		this.updateRatioBadgeText();
	}

	private clearColumnInstances(): void {
		for (const cleanup of this.cleanupResizeListeners) {
			cleanup();
		}
		this.cleanupResizeListeners = [];
		for (const v of this.colViews) {
			v.destroy();
		}
		this.colViews = [];
		this.panes = [];
		if (this.containerEl) {
			while (this.containerEl.firstChild) {
				this.containerEl.removeChild(this.containerEl.firstChild);
			}
		}
	}

	private createColumnEditorView(
		colIdx: number,
		initialText: string,
		parentEl: HTMLElement,
	): EditorView {
		const state = EditorState.create({
			doc: initialText,
			extensions: [
				EditorView.lineWrapping,
				createTagNavigationExtension({
					isActive: () => true,
					isLivePreview: () => true,
					isBoldSupported: () => true,
					onRefuse: () => { },
				}),
				createColumnVisualMarkdownExtension(),
				createSlashMenuExtension(this.plugin),
				createVisualBookmarkExtension(this.plugin),
				Prec.highest(
					keymap.of([
						{
							key: 'Mod-z',
							run: () => {
								this.runParentUndo();
								return true;
							},
						},
						{
							key: 'Mod-Shift-z',
							run: () => {
								this.runParentRedo();
								return true;
							},
						},
						{
							key: 'Mod-y',
							run: () => {
								this.runParentRedo();
								return true;
							},
						},
						{
							key: 'ArrowUp',
							run: (view) => {
								const sel = view.state.selection.main;
								if (!sel.empty) return false;
								const line = view.state.doc.lineAt(sel.head);
								if (line.number === 1) {
									return this.exitColumnsAbove();
								}
								return false;
							},
						},
						{
							key: 'ArrowDown',
							run: (view) => {
								const sel = view.state.selection.main;
								if (!sel.empty) return false;
								const line = view.state.doc.lineAt(sel.head);
								if (line.number === view.state.doc.lines) {
									this.exitColumnsBelow();
									return true;
								}
								return false;
							},
						},
						{
							key: 'Escape',
							run: () => {
								if (this.plugin.toolbarManager?.isVisible()) {
									this.plugin.toolbarManager.hide();
									return true;
								}
								this.exitColumnsBelow();
								return true;
							},
						},
						{
							key: 'Mod-Enter',
							run: () => {
								this.exitColumnsBelow();
								return true;
							},
						},
					]),
				),
				EditorView.updateListener.of((update: ViewUpdate) => {
					this.onColumnEditorUpdate(colIdx, update);
				}),
			],
		});

		const view = new EditorView({
			state,
			parent: parentEl,
		});

		(parentEl as unknown as { cmViewRef?: EditorView }).cmViewRef = view;
		view.contentDOM.setAttribute('aria-label', `Colonne ${colIdx + 1}`);
		view.dom.addEventListener('mousedown', (e) => {
			e.stopPropagation();
			this.activeColIndex = colIdx;
		});

		return view;
	}

	private onColumnEditorUpdate(colIdx: number, update: ViewUpdate): void {
		if (update.focusChanged && update.view.hasFocus) {
			this.activeColIndex = colIdx;
		}

		if (update.docChanged && !this.isUpdatingFromParent) {
			this.activeColIndex = colIdx;
			this.syncToParent(colIdx, update);
		}

		if (
			update.selectionSet ||
			update.docChanged ||
			(update.focusChanged && update.view.hasFocus)
		) {
			this.syncSelectionToTracker(colIdx);
		}
	}

	private syncToParent(colIdx: number, update: ViewUpdate): void {
		const updatedSlices = this.colViews.map((v) => ({
			blocks: [],
			text: v.state.doc.toString(),
			map: [],
		}));

		this.data.columns = updatedSlices;
		if (updatedSlices[0]) this.data.col1Text = updatedSlices[0].text;
		if (updatedSlices[1]) this.data.col2Text = updatedSlices[1].text;

		const newRawMarkdown = serializeMultiColumnMarkdown(this.data);
		this.data = parseMultiColumnMarkdown(newRawMarkdown);

		const oldRawMarkdown = this.lastRawMarkdown;
		if (newRawMarkdown === oldRawMarkdown) return;

		const diff = minimalDiff(oldRawMarkdown, newRawMarkdown);
		this.lastRawMarkdown = newRawMarkdown;
		this.blockTo = this.blockFrom + newRawMarkdown.length;

		let userEvent = 'input.type';
		for (const tr of update.transactions) {
			const ue = tr.annotation(Transaction.userEvent);
			if (ue) {
				userEvent = ue;
				break;
			}
		}

		const activeView = this.colViews[colIdx];
		if (!activeView) return;
		const localHead = activeView.state.selection.main.head;
		const colMap = this.getColumnMap(colIdx);
		const mappedParentHead = localOffsetToParentOffset(
			colMap,
			activeView.state.doc.toString(),
			localHead,
			this.blockFrom,
		);

		this.isSyncingToParent = true;
		try {
			this.parentView.dispatch({
				changes: {
					from: this.blockFrom + diff.start,
					to: this.blockFrom + diff.end,
					insert: diff.insert,
				},
				selection: EditorSelection.cursor(mappedParentHead),
				annotations: Transaction.userEvent.of(userEvent),
			});
		} finally {
			this.isSyncingToParent = false;
		}
	}

	public syncSelectionToTracker(colIdx: number): void {
		const colView = this.colViews[colIdx];
		if (!colView) return;
		const sel = colView.state.selection.main;
		const colText = colView.state.doc.toString();
		const colMap = this.getColumnMap(colIdx);

		const parentFrom = localOffsetToParentOffset(colMap, colText, sel.from, this.blockFrom);
		const parentTo = localOffsetToParentOffset(colMap, colText, sel.to, this.blockFrom);

		this.plugin.tracker.setExternalWidgetSelection(this.parentView, parentFrom, parentTo);
		this.plugin.toolbarManager?.update();
	}

	public updateFromParent(
		newRawMarkdown: string,
		newFrom: number,
		newTo: number,
		parentView: EditorView,
	): void {
		this.blockFrom = newFrom;
		this.blockTo = newTo;
		this.parentView = parentView;
		this.updateHeadingFoldVisibility();
		this.rootEl.classList.toggle(
			'is-notion-mode',
			this.plugin.settings.columnPrototypeMode === 'notion',
		);

		if (this.isSyncingToParent || newRawMarkdown === this.lastRawMarkdown) {
			return;
		}

		this.lastRawMarkdown = newRawMarkdown;
		this.data = parseMultiColumnMarkdown(newRawMarkdown);

		const nextColCount = this.data.columns?.length ?? 2;
		if (nextColCount !== this.colViews.length) {
			// Column count changed (e.g. 2 -> 3, 3 -> 4, or 3 -> 2): rebuild column panes cleanly
			this.rebuildColumnsInContainer();
			return;
		}

		// Same number of columns: update ratios & each EditorView in-place
		for (let cIdx = 0; cIdx < this.panes.length; cIdx++) {
			const r = this.data.ratios[cIdx] ?? 100 / this.panes.length;
			this.panes[cIdx]!.style.flex = `${r} 1 0%`;
		}
		this.updateRatioBadgeText();

		const pSel = parentView.state.selection.main;

		this.isUpdatingFromParent = true;
		try {
			for (let colIdx = 0; colIdx < this.colViews.length; colIdx++) {
				const colView = this.colViews[colIdx]!;
				const oldColText = colView.state.doc.toString();
				const newColText = this.getColumnText(colIdx);
				const colMap = this.getColumnMap(colIdx);

				const mappedAnchor = parentOffsetToLocalOffset(
					colMap,
					newColText,
					pSel.anchor,
					this.blockFrom,
				);
				const mappedHead = parentOffsetToLocalOffset(
					colMap,
					newColText,
					pSel.head,
					this.blockFrom,
				);

				if (oldColText !== newColText) {
					const diff = minimalDiff(oldColText, newColText);
					let newLocalSelection: EditorSelection;

					if (mappedAnchor !== null && mappedHead !== null) {
						newLocalSelection = EditorSelection.single(mappedAnchor, mappedHead);
						this.activeColIndex = colIdx;
					} else {
						const cs = ChangeSet.of(
							{ from: diff.start, to: diff.end, insert: diff.insert },
							oldColText.length,
						);
						newLocalSelection = colView.state.selection.map(cs);
					}

					colView.dispatch({
						changes: {
							from: diff.start,
							to: diff.end,
							insert: diff.insert,
						},
						selection: newLocalSelection,
					});

					if (mappedAnchor !== null && mappedHead !== null) {
						this.plugin.tracker.setExternalWidgetSelection(
							parentView,
							Math.min(pSel.anchor, pSel.head),
							Math.max(pSel.anchor, pSel.head),
						);
						if (mappedAnchor !== mappedHead) {
							colView.focus();
						}
					}
				}
			}
		} finally {
			this.isUpdatingFromParent = false;
		}
	}

	/**
	 * Attaches drag-to-resize behavior on the divider between adjacent columns `leftIdx` and `leftIdx + 1`.
	 * Adjusts only that pair so their sum remains constant and all N columns always total 100%.
	 */
	private setupPairResizerEvents(
		divider: HTMLElement,
		leftIdx: number,
		container: HTMLElement,
	): void {
		const rightIdx = leftIdx + 1;
		let isDragging = false;
		let startX = 0;
		let startLeft = this.data.ratios[leftIdx] ?? 50;
		let startRight = this.data.ratios[rightIdx] ?? 50;
		let curLeft = startLeft;
		let curRight = startRight;

		const onMouseMove = (e: MouseEvent) => {
			if (!isDragging) return;
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0) return;

			const pairSum = startLeft + startRight;
			const minRatio = Math.min(MIN_COLUMN_RATIO_PERCENT, Math.floor(pairSum / 2));
			const deltaX = e.clientX - startX;
			const deltaPercent = (deltaX / rect.width) * 100;

			curLeft = Math.max(
				minRatio,
				Math.min(pairSum - minRatio, Math.round(startLeft + deltaPercent)),
			);
			curRight = pairSum - curLeft;

			if (this.panes[leftIdx]) {
				this.panes[leftIdx].style.flex = `${curLeft} 1 0%`;
			}
			if (this.panes[rightIdx]) {
				this.panes[rightIdx].style.flex = `${curRight} 1 0%`;
			}

			const previewRatios = [...this.data.ratios];
			previewRatios[leftIdx] = curLeft;
			previewRatios[rightIdx] = curRight;
			this.ratioBadge.textContent = previewRatios.map((r) => `${Math.round(r)}%`).join(' / ');

			const pill = divider.querySelector('.inkwell-col-divider-pill');
			if (pill) {
				pill.textContent = `${curLeft}% | ${curRight}%`;
			}
		};

		const onMouseUp = () => {
			if (!isDragging) return;
			isDragging = false;
			divider.classList.remove('is-dragging');
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);

			if (curLeft !== startLeft || curRight !== startRight) {
				const nextRatios = [...this.data.ratios];
				nextRatios[leftIdx] = curLeft;
				nextRatios[rightIdx] = curRight;
				this.commitRatioChange(nextRatios);
			}
		};

		divider.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			isDragging = true;
			startX = e.clientX;
			startLeft = this.data.ratios[leftIdx] ?? 50;
			startRight = this.data.ratios[rightIdx] ?? 50;
			curLeft = startLeft;
			curRight = startRight;
			divider.classList.add('is-dragging');
			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mouseup', onMouseUp);
		});

		this.cleanupResizeListeners.push(() => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		});
	}

	private commitRatioChange(newRatios: number[]): void {
		const normalized = normalizeRatiosTo100(newRatios, this.colViews.length);
		this.data.ratios = normalized;
		for (let i = 0; i < this.panes.length; i++) {
			this.panes[i]!.style.flex = `${normalized[i]!} 1 0%`;
		}
		this.updateRatioBadgeText();

		const newRawMarkdown = serializeMultiColumnMarkdown(this.data);
		this.data = parseMultiColumnMarkdown(newRawMarkdown);

		const oldRawMarkdown = this.lastRawMarkdown;
		if (newRawMarkdown === oldRawMarkdown) return;

		const diff = minimalDiff(oldRawMarkdown, newRawMarkdown);
		this.lastRawMarkdown = newRawMarkdown;
		this.blockTo = this.blockFrom + newRawMarkdown.length;

		this.isSyncingToParent = true;
		try {
			this.parentView.dispatch({
				changes: {
					from: this.blockFrom + diff.start,
					to: this.blockFrom + diff.end,
					insert: diff.insert,
				},
				annotations: Transaction.userEvent.of('input.resize'),
			});
		} finally {
			this.isSyncingToParent = false;
		}
	}

	private runParentUndo(): void {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf?.editor) {
			leaf.editor.undo();
			const safeIdx = Math.min(this.activeColIndex, Math.max(0, this.colViews.length - 1));
			this.colViews[safeIdx]?.focus();
		}
	}

	private runParentRedo(): void {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf?.editor) {
			leaf.editor.redo();
			const safeIdx = Math.min(this.activeColIndex, Math.max(0, this.colViews.length - 1));
			this.colViews[safeIdx]?.focus();
		}
	}

	public exitColumnsAbove(): boolean {
		if (this.blockFrom <= 0) return false;
		this.plugin.tracker.clearExternalWidgetSelection();
		this.plugin.toolbarManager?.hide();
		const prevPos = Math.max(0, this.blockFrom - 1);
		this.parentView.dispatch({
			selection: EditorSelection.cursor(prevPos),
			scrollIntoView: true,
		});
		this.parentView.focus();
		return true;
	}

	public exitColumnsBelow(): void {
		this.plugin.tracker.clearExternalWidgetSelection();
		this.plugin.toolbarManager?.hide();

		const doc = this.parentView.state.doc;
		if (this.blockTo >= doc.length) {
			this.parentView.dispatch({
				changes: { from: doc.length, to: doc.length, insert: '\n\n' },
				selection: EditorSelection.cursor(doc.length + 2),
				scrollIntoView: true,
			});
		} else {
			const nextPos = Math.min(doc.length, this.blockTo + 1);
			this.parentView.dispatch({
				selection: EditorSelection.cursor(nextPos),
				scrollIntoView: true,
			});
		}
		this.parentView.focus();
	}

	private updateRatioBadgeText(): void {
		if (!this.ratioBadge) return;
		this.ratioBadge.textContent = this.data.ratios
			.map((r) => `${Math.round(r)}%`)
			.join(' / ');
	}

	public destroy(): void {
		closeActiveCalloutStylePopover();
		if (this.unsubscribeFoldChange) {
			this.unsubscribeFoldChange();
			this.unsubscribeFoldChange = null;
		}
		this.clearColumnInstances();
	}
}

export class ColumnLayoutWidget extends WidgetType {
	constructor(
		public readonly rawMarkdown: string,
		public readonly from: number,
		public readonly to: number,
		public readonly blockIndex: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	eq(other: ColumnLayoutWidget): boolean {
		return (
			other.blockIndex === this.blockIndex &&
			other.rawMarkdown === this.rawMarkdown &&
			other.from === this.from &&
			other.to === this.to
		);
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const ctrl = controllersByDom.get(dom);
		if (!ctrl || ctrl.blockIndex !== this.blockIndex) return false;
		ctrl.updateFromParent(this.rawMarkdown, this.from, this.to, view);
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		let viewMap = controllersByParentView.get(view);
		if (!viewMap) {
			viewMap = new Map<number, ColumnWidgetController>();
			controllersByParentView.set(view, viewMap);
		}

		const existing = viewMap.get(this.blockIndex);
		if (existing && !existing.rootEl.isConnected) {
			existing.updateFromParent(this.rawMarkdown, this.from, this.to, view);
			return existing.rootEl;
		}
		if (existing && existing.rootEl.isConnected) {
			existing.destroy();
			viewMap.delete(this.blockIndex);
		}

		const ctrl = new ColumnWidgetController(
			this.rawMarkdown,
			this.from,
			this.to,
			this.blockIndex,
			view,
			this.plugin,
		);
		controllersByDom.set(ctrl.rootEl, ctrl);
		viewMap.set(this.blockIndex, ctrl);
		return ctrl.rootEl;
	}

	ignoreEvent(): boolean {
		return true;
	}
}
