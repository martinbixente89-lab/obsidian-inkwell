import {
	EditorSelection,
	EditorState,
	Extension,
	Prec,
	Range,
	StateField,
	Transaction,
} from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	keymap,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { editorLivePreviewField, MarkdownView, setIcon } from 'obsidian';
import type InkwellPlugin from '../main';
import { createTagNavigationExtension } from '../editor/tag-navigation/extension';
import { createSlashMenuExtension } from '../slash-menu/extension';
import { closeActiveCalloutStylePopover } from '../blocks/callout-style-popover';
import { minimalDiff } from '../utils/text-diff';
import { createColumnVisualMarkdownExtension } from '../columns/column-markdown-deco';
import { createVisualBookmarkExtension } from '../bookmark/bookmark-widget';
import { createVisualButtonExtension } from '../button/button-widget';
import { localOffsetToParentOffset } from '../columns/parser';
import {
	addTab,
	deleteTab,
	isTabsHeaderLine,
	ParsedTabsData,
	parseTabsMarkdown,
	reorderTab,
	sanitizeTabTitle,
	serializeTabsMarkdown,
} from './tab-parser';
import { tabStateStore } from './tab-state';

/**
 * Controller map per parent EditorView: maps tabBlockIndex -> VisualTabsController
 */
const tabsControllersByParentView = new WeakMap<
	EditorView,
	Map<number, VisualTabsController>
>();

export function getTabsController(
	parentView: EditorView,
	index: number,
): VisualTabsController | undefined {
	return tabsControllersByParentView.get(parentView)?.get(index);
}

function registerTabsController(
	parentView: EditorView,
	index: number,
	controller: VisualTabsController,
): void {
	let map = tabsControllersByParentView.get(parentView);
	if (!map) {
		map = new Map();
		tabsControllersByParentView.set(parentView, map);
	}
	map.set(index, controller);
}

function cleanupExcessTabsControllers(
	parentView: EditorView,
	activeCount: number,
): void {
	const map = tabsControllersByParentView.get(parentView);
	if (!map) return;
	for (const [idx, ctrl] of map.entries()) {
		if (idx >= activeCount) {
			ctrl.destroy();
			map.delete(idx);
		}
	}
}

export class VisualTabsController {
	public readonly rootEl: HTMLElement;
	public blockFrom: number;
	public blockTo: number;
	public tabBlockIndex: number;
	public parentView: EditorView;
	public readonly plugin: InkwellPlugin;

	private data: ParsedTabsData;
	private activeTabIndex = 0;
	private activeEditorView: EditorView | null = null;
	private tabBarEl!: HTMLElement;
	private tabListEl!: HTMLElement;
	private contentHostEl!: HTMLElement;
	private confirmDialogEl: HTMLElement | null = null;
	private renamingIndex: number | null = null;

	private lastRawMarkdown: string;
	private isUpdatingFromParent = false;
	private isSyncingToParent = false;

	constructor(
		rawMarkdown: string,
		blockFrom: number,
		blockTo: number,
		tabBlockIndex: number,
		parentView: EditorView,
		plugin: InkwellPlugin,
	) {
		this.lastRawMarkdown = rawMarkdown;
		this.blockFrom = blockFrom;
		this.blockTo = blockTo;
		this.tabBlockIndex = tabBlockIndex;
		this.parentView = parentView;
		this.plugin = plugin;
		this.data = parseTabsMarkdown(rawMarkdown);

		const filePath = this.getFilePath();
		this.activeTabIndex = Math.min(
			Math.max(0, tabStateStore.getActiveTabIndex(filePath, tabBlockIndex)),
			Math.max(0, this.data.tabs.length - 1),
		);

		this.rootEl = createDiv({ cls: 'inkwell-visual-tabs-root' });
		this.rootEl.setAttribute('contenteditable', 'false');

		this.buildDOM();
	}

	private getFilePath(): string {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		return leaf?.file?.path ?? 'untitled';
	}

	private buildDOM(): void {
		this.rootEl.empty();

		// Header bar with tab list and add button
		this.tabBarEl = this.rootEl.createDiv({ cls: 'inkwell-tabs-bar' });
		this.tabListEl = this.tabBarEl.createDiv({ cls: 'inkwell-tabs-list' });
		this.tabListEl.setAttribute('role', 'tablist');

		this.renderTabItems();

		const addBtn = this.tabBarEl.createEl('button', {
			cls: 'inkwell-tab-add-btn',
			type: 'button',
			title: 'Ajouter un onglet',
			attr: {
				'aria-label': 'Ajouter un onglet',
			},
		});
		setIcon(addBtn, 'plus');
		addBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onAddTab();
		});

		// Content area hosting the active tab sub-editor
		this.contentHostEl = this.rootEl.createDiv({
			cls: 'inkwell-tabs-content',
		});
		this.mountActiveTabEditor();
	}

	private renderTabItems(): void {
		this.tabListEl.empty();

		for (let i = 0; i < this.data.tabs.length; i++) {
			const tab = this.data.tabs[i]!;
			const isActive = i === this.activeTabIndex;

			const tabItem = this.tabListEl.createDiv({
				cls: `inkwell-tab-item ${isActive ? 'is-active' : ''}`,
				attr: {
					role: 'tab',
					'aria-selected': isActive ? 'true' : 'false',
					tabindex: isActive ? '0' : '-1',
				},
			});

			if (this.renamingIndex === i) {
				// Inline rename input
				const renameInput = tabItem.createEl('input', {
					cls: 'inkwell-tab-rename-input',
					type: 'text',
					value: tab.title,
				});
				renameInput.addEventListener('click', (e) => e.stopPropagation());
				renameInput.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.commitRename(i, renameInput.value);
					} else if (e.key === 'Escape') {
						e.preventDefault();
						this.cancelRename();
					}
				});
				renameInput.addEventListener('blur', () => {
					this.commitRename(i, renameInput.value);
				});
				window.requestAnimationFrame(() => {
					renameInput.focus();
					renameInput.select();
				});
			} else {
				// Tab label
				tabItem.createSpan({
					cls: 'inkwell-tab-label',
					text: tab.title,
				});

				tabItem.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (this.activeTabIndex !== i) {
						this.selectTab(i);
					}
				});

				tabItem.addEventListener('dblclick', (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.startRename(i);
				});

				// Keyboard navigation between tabs
				tabItem.addEventListener('keydown', (e) => {
					if (e.key === 'ArrowRight' && i < this.data.tabs.length - 1) {
						e.preventDefault();
						this.selectTab(i + 1);
					} else if (e.key === 'ArrowLeft' && i > 0) {
						e.preventDefault();
						this.selectTab(i - 1);
					} else if (e.key === 'F2') {
						e.preventDefault();
						this.startRename(i);
					} else if (e.key === 'Delete' || e.key === 'Backspace') {
						if (e.metaKey || e.ctrlKey) {
							e.preventDefault();
							this.promptDeleteTab(i);
						}
					}
				});

				// Discreet action buttons on hover / focus
				const actions = tabItem.createDiv({
					cls: 'inkwell-tab-item-actions',
				});

				// Move Left button
				if (i > 0) {
					const moveLeftBtn = actions.createEl('button', {
						cls: 'inkwell-tab-move-btn',
						type: 'button',
						title: 'Déplacer l’onglet vers la gauche',
						attr: { 'aria-label': 'Déplacer vers la gauche' },
					});
					setIcon(moveLeftBtn, 'chevron-left');
					moveLeftBtn.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.onReorderTab(i, i - 1);
					});
				}

				// Move Right button
				if (i < this.data.tabs.length - 1) {
					const moveRightBtn = actions.createEl('button', {
						cls: 'inkwell-tab-move-btn',
						type: 'button',
						title: 'Déplacer l’onglet vers la droite',
						attr: { 'aria-label': 'Déplacer vers la droite' },
					});
					setIcon(moveRightBtn, 'chevron-right');
					moveRightBtn.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						this.onReorderTab(i, i + 1);
					});
				}

				// Delete button (✕)
				const deleteBtn = actions.createEl('button', {
					cls: 'inkwell-tab-delete-btn',
					type: 'button',
					title: 'Fermer / supprimer l’onglet',
					attr: { 'aria-label': 'Supprimer l’onglet' },
				});
				setIcon(deleteBtn, 'x');
				deleteBtn.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					this.promptDeleteTab(i);
				});
			}
		}
	}

	private mountActiveTabEditor(): void {
		if (this.activeEditorView) {
			this.activeEditorView.destroy();
			this.activeEditorView = null;
		}
		this.contentHostEl.empty();

		const activeTab = this.data.tabs[this.activeTabIndex];
		const initialText = activeTab?.text ?? '';

		this.activeEditorView = this.createSubEditor(initialText, this.contentHostEl);
	}

	private createSubEditor(initialText: string, parentEl: HTMLElement): EditorView {
		const state = EditorState.create({
			doc: initialText,
			extensions: [
				EditorView.lineWrapping,
				createTagNavigationExtension({
					isActive: () => true,
					isLivePreview: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
				createColumnVisualMarkdownExtension(),
				createSlashMenuExtension(this.plugin),
				createVisualBookmarkExtension(this.plugin),
				createVisualButtonExtension(this.plugin, true),
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
								return this.exitAbove();
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
								return this.exitBelow();
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
							return this.exitBelow();
						},
					},
				]),
				EditorView.updateListener.of((update) => this.onSubEditorUpdate(update)),
			],
		});

		return new EditorView({
			state,
			parent: parentEl,
		});
	}

	private onSubEditorUpdate(update: ViewUpdate): void {
		if (update.docChanged && !this.isUpdatingFromParent) {
			const activeTab = this.data.tabs[this.activeTabIndex];
			if (activeTab) {
				activeTab.text = update.view.state.doc.toString();
			}

			let userEvent = 'input.type';
			for (const tr of update.transactions) {
				const ue = tr.annotation(Transaction.userEvent);
				if (ue) {
					userEvent = ue;
					break;
				}
			}
			this.syncDataToParent(userEvent);
		}

		if (
			update.selectionSet ||
			update.docChanged ||
			(update.focusChanged && update.view.hasFocus)
		) {
			this.syncSelectionToTracker();
		}
	}

	private syncSelectionToTracker(): void {
		if (!this.activeEditorView) return;
		const sel = this.activeEditorView.state.selection.main;
		const activeTab = this.data.tabs[this.activeTabIndex];
		if (!activeTab || activeTab.map.length === 0) return;

		const bodyText = this.activeEditorView.state.doc.toString();
		const parentFrom = localOffsetToParentOffset(
			activeTab.map,
			bodyText,
			sel.from,
			this.blockFrom,
		);
		const parentTo = localOffsetToParentOffset(
			activeTab.map,
			bodyText,
			sel.to,
			this.blockFrom,
		);

		this.plugin.tracker.setExternalWidgetSelection(
			this.parentView,
			parentFrom,
			parentTo,
		);
		this.plugin.toolbarManager?.update();
	}

	private syncDataToParent(userEvent: string): void {
		const newRaw = serializeTabsMarkdown(this.data.tabs);
		this.data = parseTabsMarkdown(newRaw);
		this.commitRawMarkdownChange(newRaw, userEvent);
	}

	private commitRawMarkdownChange(newRawMarkdown: string, userEvent: string): void {
		const oldRawMarkdown = this.lastRawMarkdown;
		if (newRawMarkdown === oldRawMarkdown) return;

		const diff = minimalDiff(oldRawMarkdown, newRawMarkdown);
		this.lastRawMarkdown = newRawMarkdown;
		this.blockTo = this.blockFrom + newRawMarkdown.length;

		let mappedParentHead = this.blockFrom;
		const activeTab = this.data.tabs[this.activeTabIndex];
		if (this.activeEditorView && activeTab && activeTab.map.length > 0) {
			const localHead = this.activeEditorView.state.selection.main.head;
			mappedParentHead = localOffsetToParentOffset(
				activeTab.map,
				this.activeEditorView.state.doc.toString(),
				localHead,
				this.blockFrom,
			);
		}

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

	public selectTab(newIndex: number): void {
		if (newIndex < 0 || newIndex >= this.data.tabs.length) return;
		if (newIndex === this.activeTabIndex && this.activeEditorView) return;

		closeActiveCalloutStylePopover();

		// Save current editor text before switching
		if (this.activeEditorView && this.data.tabs[this.activeTabIndex]) {
			this.data.tabs[this.activeTabIndex]!.text =
				this.activeEditorView.state.doc.toString();
		}

		this.activeTabIndex = newIndex;
		tabStateStore.setActiveTabIndex(
			this.getFilePath(),
			this.tabBlockIndex,
			newIndex,
		);

		this.renderTabItems();
		this.mountActiveTabEditor();
		this.activeEditorView?.focus();
	}

	private onAddTab(): void {
		// Save current editor text before adding
		if (this.activeEditorView && this.data.tabs[this.activeTabIndex]) {
			this.data.tabs[this.activeTabIndex]!.text =
				this.activeEditorView.state.doc.toString();
		}

		const updatedTabs = addTab(this.data.tabs);
		this.data.tabs = updatedTabs.map((t) => ({
			title: t.title,
			text: t.text,
			map: [],
		}));

		const newIndex = this.data.tabs.length - 1;
		this.activeTabIndex = newIndex;
		tabStateStore.setActiveTabIndex(
			this.getFilePath(),
			this.tabBlockIndex,
			newIndex,
		);

		this.syncDataToParent('input.tab.add');
		this.renderTabItems();
		this.mountActiveTabEditor();
		this.activeEditorView?.focus();
	}

	private startRename(index: number): void {
		this.renamingIndex = index;
		this.renderTabItems();
	}

	private commitRename(index: number, newTitle: string): void {
		this.renamingIndex = null;
		const safeTitle = sanitizeTabTitle(newTitle);
		const targetTab = this.data.tabs[index];
		if (targetTab) {
			targetTab.title = safeTitle;
		}
		this.syncDataToParent('input.tab.rename');
		this.renderTabItems();
	}

	private cancelRename(): void {
		this.renamingIndex = null;
		this.renderTabItems();
	}

	private onReorderTab(fromIndex: number, toIndex: number): void {
		if (this.activeEditorView && this.data.tabs[this.activeTabIndex]) {
			this.data.tabs[this.activeTabIndex]!.text =
				this.activeEditorView.state.doc.toString();
		}

		const currentActiveTab = this.data.tabs[this.activeTabIndex];
		const reordered = reorderTab(this.data.tabs, fromIndex, toIndex);

		this.data.tabs = reordered.map((t) => ({
			title: t.title,
			text: t.text,
			map: [],
		}));

		// Keep active tab tracking the same logical tab
		if (currentActiveTab) {
			const foundIdx = this.data.tabs.findIndex(
				(t) => t.title === currentActiveTab.title,
			);
			if (foundIdx >= 0) {
				this.activeTabIndex = foundIdx;
			}
		}

		tabStateStore.setActiveTabIndex(
			this.getFilePath(),
			this.tabBlockIndex,
			this.activeTabIndex,
		);

		this.syncDataToParent('input.tab.reorder');
		this.renderTabItems();
	}

	public promptDeleteTab(index: number): void {
		const targetTab = this.data.tabs[index];
		if (!targetTab) return;

		// Prevent deleting the very last remaining tab (must keep at least 1 tab)
		if (this.data.tabs.length <= 1) {
			return;
		}

		const hasContent = targetTab.text.trim().length > 0;
		if (!hasContent) {
			// Direct deletion without confirmation if empty
			this.executeDeleteTab(index);
			return;
		}

		// Non-empty tab: require explicit confirmation
		this.showDeleteConfirmation(index, targetTab.title);
	}

	private showDeleteConfirmation(index: number, tabTitle: string): void {
		if (this.confirmDialogEl) {
			this.confirmDialogEl.remove();
			this.confirmDialogEl = null;
		}

		this.confirmDialogEl = this.rootEl.createDiv({
			cls: 'inkwell-tab-confirm-dialog',
		});

		this.confirmDialogEl.createDiv({
			cls: 'inkwell-tab-confirm-msg',
			text: `Supprimer l’onglet « ${tabTitle} » et tout son contenu ?`,
		});

		const buttonsRow = this.confirmDialogEl.createDiv({
			cls: 'inkwell-tab-confirm-actions',
		});

		const deleteBtn = buttonsRow.createEl('button', {
			cls: 'inkwell-tab-confirm-delete mod-warning',
			type: 'button',
			text: 'Supprimer',
		});
		deleteBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.closeConfirmDialog();
			this.executeDeleteTab(index);
		});

		const cancelBtn = buttonsRow.createEl('button', {
			cls: 'inkwell-tab-confirm-cancel',
			type: 'button',
			text: 'Annuler',
		});
		cancelBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.closeConfirmDialog();
		});

		deleteBtn.focus();
	}

	private closeConfirmDialog(): void {
		if (this.confirmDialogEl) {
			this.confirmDialogEl.remove();
			this.confirmDialogEl = null;
		}
	}

	private executeDeleteTab(index: number): void {
		const updated = deleteTab(this.data.tabs, index);
		this.data.tabs = updated.map((t) => ({
			title: t.title,
			text: t.text,
			map: [],
		}));

		// Adjust active tab index if needed
		if (this.activeTabIndex >= this.data.tabs.length) {
			this.activeTabIndex = Math.max(0, this.data.tabs.length - 1);
		} else if (this.activeTabIndex === index) {
			this.activeTabIndex = Math.min(index, this.data.tabs.length - 1);
		}

		tabStateStore.setActiveTabIndex(
			this.getFilePath(),
			this.tabBlockIndex,
			this.activeTabIndex,
		);

		this.syncDataToParent('input.tab.delete');
		this.renderTabItems();
		this.mountActiveTabEditor();
		this.activeEditorView?.focus();
	}

	public onParentDocUpdated(): void {
		if (this.isSyncingToParent) return;
		const doc = this.parentView.state.doc;
		const safeFrom = Math.min(this.blockFrom, doc.length);
		const safeTo = Math.min(this.blockTo, doc.length);
		if (safeFrom >= safeTo) return;

		const currentRaw = doc.sliceString(safeFrom, safeTo);
		if (currentRaw === this.lastRawMarkdown) return;

		this.updateFromParent(currentRaw, safeFrom, safeTo, this.parentView);
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

		if (newRawMarkdown === this.lastRawMarkdown) return;
		this.lastRawMarkdown = newRawMarkdown;

		const oldParsed = this.data;
		this.data = parseTabsMarkdown(newRawMarkdown);

		if (this.activeTabIndex >= this.data.tabs.length) {
			this.activeTabIndex = Math.max(0, this.data.tabs.length - 1);
		}

		// Check if tabs structure changed (added/removed/renamed)
		const structureChanged =
			oldParsed.tabs.length !== this.data.tabs.length ||
			oldParsed.tabs.some((t, idx) => t.title !== this.data.tabs[idx]?.title);

		if (structureChanged) {
			this.renderTabItems();
		}

		if (this.activeEditorView) {
			const oldActiveText = this.activeEditorView.state.doc.toString();
			const newActiveText = this.data.tabs[this.activeTabIndex]?.text ?? '';

			if (oldActiveText !== newActiveText) {
				const diff = minimalDiff(oldActiveText, newActiveText);
				this.isUpdatingFromParent = true;
				try {
					this.activeEditorView.dispatch({
						changes: {
							from: diff.start,
							to: diff.end,
							insert: diff.insert,
						},
					});
				} finally {
					this.isUpdatingFromParent = false;
				}
			}
		}
	}

	private runParentUndo(): void {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf?.editor) {
			leaf.editor.undo();
			this.activeEditorView?.focus();
		}
	}

	private runParentRedo(): void {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf?.editor) {
			leaf.editor.redo();
			this.activeEditorView?.focus();
		}
	}

	public exitAbove(): boolean {
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

	public exitBelow(): boolean {
		this.plugin.tracker.clearExternalWidgetSelection();
		this.plugin.toolbarManager?.hide();
		const nextPos = Math.min(this.blockTo + 1, this.parentView.state.doc.length);
		this.parentView.dispatch({
			selection: EditorSelection.cursor(nextPos),
			scrollIntoView: true,
		});
		this.parentView.focus();
		return true;
	}

	public destroy(): void {
		closeActiveCalloutStylePopover();
		if (this.activeEditorView) {
			this.activeEditorView.destroy();
			this.activeEditorView = null;
		}
		if (this.confirmDialogEl) {
			this.confirmDialogEl.remove();
			this.confirmDialogEl = null;
		}
	}
}

export class VisualTabsWidget extends WidgetType {
	constructor(
		public readonly rawMarkdown: string,
		public readonly blockFrom: number,
		public readonly blockTo: number,
		public readonly tabBlockIndex: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	override eq(other: VisualTabsWidget): boolean {
		return (
			other.blockFrom === this.blockFrom &&
			other.blockTo === this.blockTo &&
			other.tabBlockIndex === this.tabBlockIndex &&
			other.rawMarkdown === this.rawMarkdown
		);
	}

	override toDOM(view: EditorView): HTMLElement {
		let ctrl = getTabsController(view, this.tabBlockIndex);
		if (ctrl) {
			ctrl.updateFromParent(this.rawMarkdown, this.blockFrom, this.blockTo, view);
			return ctrl.rootEl;
		}

		ctrl = new VisualTabsController(
			this.rawMarkdown,
			this.blockFrom,
			this.blockTo,
			this.tabBlockIndex,
			view,
			this.plugin,
		);
		registerTabsController(view, this.tabBlockIndex, ctrl);
		return ctrl.rootEl;
	}

	override ignoreEvent(): boolean {
		return false;
	}

	override destroy(): void {
		// Individual controller destruction handled by cleanupExcessTabsControllers
	}
}

let activeTabsPlugin: InkwellPlugin | null = null;

function buildTabsDecorations(
	doc: {
		lines: number;
		line: (n: number) => { from: number; to: number; text: string };
		sliceString: (from: number, to: number) => string;
	},
	plugin: InkwellPlugin,
): { decorations: DecorationSet; count: number } {
	const decorations: Range<Decoration>[] = [];
	let i = 1;
	let tabBlockIndex = 0;

	while (i <= doc.lines) {
		const line = doc.line(i);
		const lineText = line.text;

		if (isTabsHeaderLine(lineText)) {
			const startPos = line.from;
			let endPos = line.to;
			let endLineNum = i;

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
					widget: new VisualTabsWidget(
						rawMarkdown,
						startPos,
						endPos,
						tabBlockIndex,
						plugin,
					),
					block: true,
				}).range(startPos, endPos),
			);

			tabBlockIndex++;
			i = endLineNum + 1;
		} else {
			i++;
		}
	}

	return {
		decorations: Decoration.set(decorations, true),
		count: tabBlockIndex,
	};
}

export const visualTabsField = StateField.define<DecorationSet>({
	create(state) {
		if (!activeTabsPlugin) {
			return Decoration.none;
		}
		if (state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		try {
			return buildTabsDecorations(state.doc, activeTabsPlugin).decorations;
		} catch {
			return Decoration.none;
		}
	},
	update(decorations, tr) {
		if (!activeTabsPlugin) {
			return Decoration.none;
		}
		if (tr.state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		if (tr.docChanged || decorations === Decoration.none) {
			try {
				return buildTabsDecorations(tr.state.doc, activeTabsPlugin).decorations;
			} catch {
				return Decoration.none;
			}
		}
		return decorations.map(tr.changes);
	},
	provide: (f) => [
		Prec.highest(EditorView.decorations.from(f)),
		EditorView.atomicRanges.of((view) => {
			if (activeTabsPlugin) {
				const count = buildTabsDecorations(view.state.doc, activeTabsPlugin).count;
				cleanupExcessTabsControllers(view, count);
			}
			return view.state.field(f, false) ?? Decoration.none;
		}),
	],
});

export function createVisualTabsExtension(plugin: InkwellPlugin): Extension {
	activeTabsPlugin = plugin;
	return [
		visualTabsField,
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const map = tabsControllersByParentView.get(update.view);
				if (map) {
					for (const ctrl of map.values()) {
						ctrl.onParentDocUpdated();
					}
				}
			}
		}),
	];
}
