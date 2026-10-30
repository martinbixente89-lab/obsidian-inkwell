import {
	ChangeSet,
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
import { minimalDiff } from '../utils/text-diff';
import { createColumnVisualMarkdownExtension } from '../columns/column-markdown-deco';
import { localOffsetToParentOffset, parentOffsetToLocalOffset } from '../columns/parser';
import {
	isSingleCalloutHeaderLine,
	parseSingleCalloutMarkdown,
	serializeSingleCalloutMarkdown,
	SingleCalloutData,
} from './callout-parser';
import {
	isOffsetInFoldedHeadingSection,
	onHeadingFoldChange,
} from './heading-fold';
import {
	buildTableOfContentsMarkdown,
	cleanHeadingDisplayText,
	extractHeadingsFromDoc,
} from '../slash-menu/toc-helper';

const calloutControllersByDom = new WeakMap<HTMLElement, VisualCalloutController>();
const calloutControllersByParentView = new WeakMap<
	EditorView,
	Map<number, VisualCalloutController>
>();

export function getCalloutControllerByIndex(
	parentView: EditorView,
	calloutIndex: number,
): VisualCalloutController | undefined {
	return calloutControllersByParentView.get(parentView)?.get(calloutIndex);
}

export function getCalloutControllerAtOffset(
	parentView: EditorView,
	fromOffset: number,
): VisualCalloutController | undefined {
	const map = calloutControllersByParentView.get(parentView);
	if (!map) return undefined;
	for (const ctrl of map.values()) {
		if (ctrl.blockFrom === fromOffset && ctrl.rootEl.isConnected) {
			return ctrl;
		}
	}
	return undefined;
}

export function cleanupExcessCalloutControllers(
	parentView: EditorView,
	activeCount: number,
): void {
	const map = calloutControllersByParentView.get(parentView);
	if (!map) return;
	for (const [idx, ctrl] of map.entries()) {
		if (idx >= activeCount) {
			ctrl.destroy();
			map.delete(idx);
		}
	}
}

export class VisualCalloutController {
	public readonly rootEl: HTMLElement;
	public blockFrom: number;
	public blockTo: number;
	public calloutIndex: number;
	public parentView: EditorView;
	public readonly plugin: InkwellPlugin;

	private data: SingleCalloutData;
	private lastRawMarkdown: string;
	private isUpdatingFromParent = false;
	private isSyncingToParent = false;
	private isRawSourceMode = false;

	private visualContainerEl!: HTMLElement;
	private rawSourceContainerEl!: HTMLElement;
	private foldBtnEl: HTMLButtonElement | null = null;
	private titleInputEl: HTMLInputElement | null = null;
	private bodyWrapperEl!: HTMLElement;
	private bodyHostEl!: HTMLElement;
	private bodyView: EditorView | null = null;
	private rawSourceView: EditorView | null = null;
	private tocListEl: HTMLElement | null = null;
	private unsubscribeFoldChange: (() => void) | null = null;

	constructor(
		rawMarkdown: string,
		blockFrom: number,
		blockTo: number,
		calloutIndex: number,
		parentView: EditorView,
		plugin: InkwellPlugin,
	) {
		this.lastRawMarkdown = rawMarkdown;
		this.blockFrom = blockFrom;
		this.blockTo = blockTo;
		this.calloutIndex = calloutIndex;
		this.parentView = parentView;
		this.plugin = plugin;
		this.data = parseSingleCalloutMarkdown(rawMarkdown);

		this.rootEl = document.createElement('div');
		this.rootEl.className = 'inkwell-visual-callout-root';
		this.rootEl.setAttribute('contenteditable', 'false');

		const stopBubble = (e: Event) => e.stopPropagation();
		this.rootEl.addEventListener('keydown', stopBubble);
		this.rootEl.addEventListener('keyup', stopBubble);
		this.rootEl.addEventListener('keypress', stopBubble);

		this.buildDOM();
		this.updateHeadingFoldVisibility();

		this.unsubscribeFoldChange = onHeadingFoldChange(() => {
			this.updateHeadingFoldVisibility();
		});

		// If the parent editor's cursor was just placed inside this callout (e.g., via /encadré or /menu dépliant),
		// focus the body editor immediately on mount.
		const pSel = this.parentView.state.selection.main;
		if (pSel.empty && pSel.head >= this.blockFrom && pSel.head <= this.blockTo) {
			window.requestAnimationFrame(() => {
				if (!this.rootEl.isConnected) return;
				if (this.data.foldMode !== 'collapsed' && this.bodyView) {
					const localPos =
						parentOffsetToLocalOffset(
							this.data.bodyMap,
							this.data.bodyText,
							pSel.head,
							this.blockFrom,
						) ?? this.bodyView.state.doc.length;
					this.bodyView.focus();
					this.bodyView.dispatch({ selection: EditorSelection.cursor(localPos) });
				} else if (this.titleInputEl) {
					this.titleInputEl.focus();
				}
			});
		}
	}

	public updateHeadingFoldVisibility(): void {
		const isFolded = isOffsetInFoldedHeadingSection(
			this.parentView,
			this.blockFrom,
			this.plugin,
		);
		this.rootEl.classList.toggle('is-folded-by-heading', isFolded);
	}

	public onParentDocUpdated(): void {
		this.updateHeadingFoldVisibility();
		if (this.data.calloutType.toLowerCase() === 'toc') {
			this.refreshDynamicTocList();
		}
	}

	public getBodyView(): EditorView | null {
		return this.bodyView;
	}

	private buildDOM(): void {
		this.destroyEditors();
		this.tocListEl = null;
		while (this.rootEl.firstChild) {
			this.rootEl.removeChild(this.rootEl.firstChild);
		}

		const isToc = this.data.calloutType.toLowerCase() === 'toc';
		const isToggle = !isToc && (this.data.foldMode === 'collapsed' || this.data.foldMode === 'expanded');
		this.rootEl.dataset.calloutKind = isToc ? 'toc' : isToggle ? 'toggle' : 'callout';
		this.rootEl.dataset.foldMode = this.data.foldMode;
		this.rootEl.classList.toggle('is-toc-block', isToc);
		this.rootEl.classList.toggle('is-toggle-block', isToggle);
		this.rootEl.classList.toggle('is-callout-block', !isToggle && !isToc);
		this.rootEl.classList.toggle('is-collapsed', this.data.foldMode === 'collapsed');

		// Top-right discreet source toggle button (</>)
		const sourceBtn = document.createElement('button');
		sourceBtn.type = 'button';
		sourceBtn.className = 'inkwell-visual-callout-source-btn';
		sourceBtn.title = this.isRawSourceMode
			? 'Revenir à l’édition visuelle'
			: 'Afficher / modifier le balisage Markdown (source)';
		sourceBtn.setAttribute('aria-label', sourceBtn.title);
		setIcon(sourceBtn, 'code-2');
		sourceBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.toggleRawSourceMode();
		});
		this.rootEl.appendChild(sourceBtn);

		if (this.isRawSourceMode) {
			this.rawSourceContainerEl = document.createElement('div');
			this.rawSourceContainerEl.className = 'inkwell-visual-callout-raw-source';
			this.rootEl.appendChild(this.rawSourceContainerEl);
			this.rawSourceView = this.createRawSourceEditor(
				this.lastRawMarkdown,
				this.rawSourceContainerEl,
			);
			return;
		}

		this.visualContainerEl = document.createElement('div');
		this.visualContainerEl.className = 'inkwell-visual-callout-inner';
		this.rootEl.appendChild(this.visualContainerEl);

		if (isToc) {
			// --- Dynamic Table of Contents Block (Table des matières dynamique) ---
			const tocHeader = document.createElement('div');
			tocHeader.className = 'inkwell-visual-toc-header';

			const iconEl = document.createElement('span');
			iconEl.className = 'inkwell-visual-toc-icon';
			setIcon(iconEl, 'list');
			tocHeader.appendChild(iconEl);

			const titleSpan = document.createElement('span');
			titleSpan.className = 'inkwell-visual-toc-title';
			titleSpan.textContent = this.data.title.trim() || 'Table des matières';
			tocHeader.appendChild(titleSpan);

			const badgeSpan = document.createElement('span');
			badgeSpan.className = 'inkwell-visual-toc-badge';
			badgeSpan.textContent = 'Dynamique';
			badgeSpan.title =
				'S’actualise automatiquement à l’ajout, au renommage et à la suppression d’un titre.';
			tocHeader.appendChild(badgeSpan);

			const freezeBtn = document.createElement('button');
			freezeBtn.type = 'button';
			freezeBtn.className = 'inkwell-visual-toc-freeze-btn';
			freezeBtn.textContent = 'Convertir en statique';
			freezeBtn.title =
				'Remplace ce bloc dynamique par une liste statique de liens internes [[#Titre]]';
			freezeBtn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.convertDynamicTocToStaticList();
			});
			tocHeader.appendChild(freezeBtn);

			this.visualContainerEl.appendChild(tocHeader);

			this.tocListEl = document.createElement('div');
			this.tocListEl.className = 'inkwell-visual-toc-list';
			this.visualContainerEl.appendChild(this.tocListEl);
			this.refreshDynamicTocList();
			return;
		}

		if (isToggle) {
			// --- Collapsible Toggle Block (Menu dépliant) ---
			const headerRow = document.createElement('div');
			headerRow.className = 'inkwell-visual-toggle-header-row';

			this.foldBtnEl = document.createElement('button');
			this.foldBtnEl.type = 'button';
			this.foldBtnEl.className = 'inkwell-visual-toggle-btn';
			this.foldBtnEl.setAttribute(
				'aria-label',
				this.data.foldMode === 'collapsed'
					? 'Déplier le menu dépliant'
					: 'Replier le menu dépliant',
			);
			this.foldBtnEl.setAttribute(
				'aria-expanded',
				this.data.foldMode === 'collapsed' ? 'false' : 'true',
			);
			setIcon(
				this.foldBtnEl,
				this.data.foldMode === 'collapsed' ? 'chevron-right' : 'chevron-down',
			);
			this.foldBtnEl.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.toggleFoldState();
			});
			headerRow.appendChild(this.foldBtnEl);

			this.titleInputEl = document.createElement('input');
			this.titleInputEl.type = 'text';
			this.titleInputEl.className = 'inkwell-visual-toggle-title-input';
			this.titleInputEl.value = this.data.title;
			this.titleInputEl.placeholder = 'Titre du menu dépliant…';
			this.titleInputEl.addEventListener('input', () => {
				this.data.title = this.titleInputEl?.value ?? '';
				this.syncDataToParent('input.type');
			});
			this.titleInputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					if (this.data.foldMode === 'collapsed') {
						this.toggleFoldState();
					}
					requestAnimationFrame(() => {
						this.bodyView?.focus();
					});
				} else if (e.key === 'ArrowDown' && this.data.foldMode !== 'collapsed') {
					e.preventDefault();
					this.bodyView?.focus();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					this.exitBelow();
				}
			});
			headerRow.appendChild(this.titleInputEl);
			this.visualContainerEl.appendChild(headerRow);

			this.bodyWrapperEl = document.createElement('div');
			this.bodyWrapperEl.className = 'inkwell-visual-toggle-body-wrap';
			if (this.data.foldMode === 'collapsed') {
				this.bodyWrapperEl.classList.add('is-collapsed');
			}
			this.bodyHostEl = document.createElement('div');
			this.bodyHostEl.className = 'inkwell-visual-callout-editor-host';
			this.bodyWrapperEl.appendChild(this.bodyHostEl);
			this.visualContainerEl.appendChild(this.bodyWrapperEl);

			this.bodyView = this.createBodyEditor(this.data.bodyText, this.bodyHostEl);
		} else {
			// --- Sober Visual Callout Box (Encadré) ---
			const boxRow = document.createElement('div');
			boxRow.className = 'inkwell-visual-callout-box-row';

			const iconEl = document.createElement('div');
			iconEl.className = 'inkwell-visual-callout-icon';
			setIcon(iconEl, this.resolveCalloutIcon(this.data.calloutType));
			boxRow.appendChild(iconEl);

			const contentCol = document.createElement('div');
			contentCol.className = 'inkwell-visual-callout-content-col';

			if (this.data.title.trim().length > 0) {
				this.titleInputEl = document.createElement('input');
				this.titleInputEl.type = 'text';
				this.titleInputEl.className = 'inkwell-visual-callout-title-input';
				this.titleInputEl.value = this.data.title;
				this.titleInputEl.placeholder = 'Titre de l’encadré…';
				this.titleInputEl.addEventListener('input', () => {
					this.data.title = this.titleInputEl?.value ?? '';
					this.syncDataToParent('input.type');
				});
				this.titleInputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === 'ArrowDown') {
						e.preventDefault();
						this.bodyView?.focus();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						this.exitBelow();
					}
				});
				contentCol.appendChild(this.titleInputEl);
			}

			this.bodyWrapperEl = document.createElement('div');
			this.bodyWrapperEl.className = 'inkwell-visual-callout-body-wrap';
			this.bodyHostEl = document.createElement('div');
			this.bodyHostEl.className = 'inkwell-visual-callout-editor-host';
			this.bodyWrapperEl.appendChild(this.bodyHostEl);
			contentCol.appendChild(this.bodyWrapperEl);

			boxRow.appendChild(contentCol);
			this.visualContainerEl.appendChild(boxRow);

			this.bodyView = this.createBodyEditor(this.data.bodyText, this.bodyHostEl);
		}
	}

	private resolveCalloutIcon(type: string): string {
		const lower = type.toLowerCase();
		if (lower === 'warning' || lower === 'caution' || lower === 'attention') {
			return 'alert-triangle';
		}
		if (lower === 'tip' || lower === 'hint' || lower === 'important') {
			return 'lightbulb';
		}
		if (lower === 'info' || lower === 'todo') {
			return 'info';
		}
		if (lower === 'check' || lower === 'success' || lower === 'done') {
			return 'check-circle';
		}
		return 'message-square';
	}

	public toggleFoldState(): void {
		if (this.data.foldMode === 'collapsed') {
			this.data.foldMode = 'expanded';
		} else if (this.data.foldMode === 'expanded') {
			this.data.foldMode = 'collapsed';
		} else {
			return;
		}

		const isCollapsed = this.data.foldMode === 'collapsed';
		this.rootEl.dataset.foldMode = this.data.foldMode;
		this.rootEl.classList.toggle('is-collapsed', isCollapsed);
		if (this.bodyWrapperEl) {
			this.bodyWrapperEl.classList.toggle('is-collapsed', isCollapsed);
		}
		if (this.foldBtnEl) {
			this.foldBtnEl.setAttribute(
				'aria-label',
				isCollapsed ? 'Déplier le menu dépliant' : 'Replier le menu dépliant',
			);
			this.foldBtnEl.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
			this.foldBtnEl.empty();
			setIcon(this.foldBtnEl, isCollapsed ? 'chevron-right' : 'chevron-down');
		}

		this.syncDataToParent('input.toggle.fold');

		if (!isCollapsed && this.bodyView) {
			this.bodyView.focus();
		}
	}

	private toggleRawSourceMode(): void {
		this.isRawSourceMode = !this.isRawSourceMode;
		this.buildDOM();
		if (this.isRawSourceMode && this.rawSourceView) {
			this.rawSourceView.focus();
		} else if (this.bodyView) {
			this.bodyView.focus();
		}
	}

	private createBodyEditor(initialText: string, parentEl: HTMLElement): EditorView {
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
									if (this.titleInputEl) {
										this.titleInputEl.focus();
										return true;
									}
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
									this.exitBelow();
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
								this.exitBelow();
								return true;
							},
						},
						{
							key: 'Mod-Enter',
							run: () => {
								this.exitBelow();
								return true;
							},
						},
					]),
				),
				EditorView.updateListener.of((update: ViewUpdate) => {
					this.onBodyEditorUpdate(update);
				}),
			],
		});

		const view = new EditorView({
			state,
			parent: parentEl,
		});

		(parentEl as unknown as { cmViewRef?: EditorView }).cmViewRef = view;
		view.contentDOM.setAttribute(
			'aria-label',
			this.data.foldMode === 'none' ? 'Contenu de l’encadré' : 'Contenu du menu dépliant',
		);
		view.dom.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});

		return view;
	}

	private createRawSourceEditor(initialRaw: string, parentEl: HTMLElement): EditorView {
		const state = EditorState.create({
			doc: initialRaw,
			extensions: [
				EditorView.lineWrapping,
				Prec.highest(
					keymap.of([
						{
							key: 'Escape',
							run: () => {
								this.toggleRawSourceMode();
								return true;
							},
						},
					]),
				),
				EditorView.updateListener.of((update: ViewUpdate) => {
					if (update.docChanged && !this.isUpdatingFromParent) {
						const newRaw = update.view.state.doc.toString();
						this.commitRawMarkdownChange(newRaw, 'input.type');
					}
				}),
			],
		});

		return new EditorView({
			state,
			parent: parentEl,
		});
	}

	private onBodyEditorUpdate(update: ViewUpdate): void {
		if (update.docChanged && !this.isUpdatingFromParent) {
			this.data.bodyText = update.view.state.doc.toString();
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

	private syncDataToParent(userEvent: string): void {
		const newRaw = serializeSingleCalloutMarkdown(this.data);
		this.data = parseSingleCalloutMarkdown(newRaw);
		this.commitRawMarkdownChange(newRaw, userEvent);
	}

	private commitRawMarkdownChange(newRawMarkdown: string, userEvent: string): void {
		const oldRawMarkdown = this.lastRawMarkdown;
		if (newRawMarkdown === oldRawMarkdown) return;

		const diff = minimalDiff(oldRawMarkdown, newRawMarkdown);
		this.lastRawMarkdown = newRawMarkdown;
		this.blockTo = this.blockFrom + newRawMarkdown.length;

		let mappedParentHead = this.blockFrom;
		if (this.bodyView) {
			const localHead = this.bodyView.state.selection.main.head;
			mappedParentHead = localOffsetToParentOffset(
				this.data.bodyMap,
				this.bodyView.state.doc.toString(),
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

	private syncSelectionToTracker(): void {
		if (!this.bodyView) return;
		const sel = this.bodyView.state.selection.main;
		const bodyText = this.bodyView.state.doc.toString();
		const parentFrom = localOffsetToParentOffset(
			this.data.bodyMap,
			bodyText,
			sel.from,
			this.blockFrom,
		);
		const parentTo = localOffsetToParentOffset(
			this.data.bodyMap,
			bodyText,
			sel.to,
			this.blockFrom,
		);

		this.plugin.tracker.setExternalWidgetSelection(this.parentView, parentFrom, parentTo);
		this.plugin.toolbarManager?.update();
	}

	public refreshDynamicTocList(): void {
		if (!this.tocListEl) return;
		while (this.tocListEl.firstChild) {
			this.tocListEl.removeChild(this.tocListEl.firstChild);
		}

		const docText = this.parentView.state.doc.toString();
		const headings = extractHeadingsFromDoc(docText);

		if (headings.length === 0) {
			const emptyEl = document.createElement('div');
			emptyEl.className = 'inkwell-visual-toc-empty';
			emptyEl.textContent =
				'Aucun titre dans cette note. Ajoutez un titre (H1 à H6) pour qu’il apparaisse automatiquement ici.';
			this.tocListEl.appendChild(emptyEl);
			return;
		}

		const minLevel = Math.min(...headings.map((h) => h.level));
		for (const item of headings) {
			const rowBtn = document.createElement('button');
			rowBtn.type = 'button';
			rowBtn.className = `inkwell-visual-toc-item is-level-${item.level}`;
			const indentPx = Math.max(0, (item.level - minLevel) * 16);
			rowBtn.style.paddingLeft = `${8 + indentPx}px`;

			const bulletSpan = document.createElement('span');
			bulletSpan.className = 'inkwell-visual-toc-bullet';
			bulletSpan.textContent = '•';
			rowBtn.appendChild(bulletSpan);

			const textSpan = document.createElement('span');
			textSpan.className = 'inkwell-visual-toc-item-text';
			textSpan.textContent = cleanHeadingDisplayText(item.heading) || item.heading;
			rowBtn.appendChild(textSpan);

			const levelBadge = document.createElement('span');
			levelBadge.className = 'inkwell-visual-toc-level-tag';
			levelBadge.textContent = `H${item.level}`;
			rowBtn.appendChild(levelBadge);

			rowBtn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (item.lineNumber && item.lineNumber <= this.parentView.state.doc.lines) {
					const targetLine = this.parentView.state.doc.line(item.lineNumber);
					this.parentView.dispatch({
						selection: EditorSelection.cursor(targetLine.to),
						scrollIntoView: true,
					});
					this.parentView.focus();
				}
			});

			this.tocListEl.appendChild(rowBtn);
		}
	}

	private convertDynamicTocToStaticList(): void {
		const docText = this.parentView.state.doc.toString();
		const headings = extractHeadingsFromDoc(docText);
		const staticMarkdown = buildTableOfContentsMarkdown(headings).trimEnd();
		this.commitRawMarkdownChange(staticMarkdown, 'input.type');
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

		if (this.data.calloutType.toLowerCase() === 'toc') {
			this.refreshDynamicTocList();
		}

		if (this.isSyncingToParent || newRawMarkdown === this.lastRawMarkdown) {
			return;
		}

		const prevFoldMode = this.data.foldMode;
		const prevTitle = this.data.title;
		this.lastRawMarkdown = newRawMarkdown;
		this.data = parseSingleCalloutMarkdown(newRawMarkdown);

		const wasToggle = prevFoldMode === 'collapsed' || prevFoldMode === 'expanded';
		const isToggle = this.data.foldMode === 'collapsed' || this.data.foldMode === 'expanded';

		if (wasToggle !== isToggle || ( !isToggle && Boolean(prevTitle.trim()) !== Boolean(this.data.title.trim()) )) {
			this.buildDOM();
			return;
		}

		// Update fold state UI if changed via Undo/Redo
		if (prevFoldMode !== this.data.foldMode) {
			const isCollapsed = this.data.foldMode === 'collapsed';
			this.rootEl.dataset.foldMode = this.data.foldMode;
			this.rootEl.classList.toggle('is-collapsed', isCollapsed);
			this.bodyWrapperEl?.classList.toggle('is-collapsed', isCollapsed);
			if (this.foldBtnEl) {
				this.foldBtnEl.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
				this.foldBtnEl.empty();
				setIcon(this.foldBtnEl, isCollapsed ? 'chevron-right' : 'chevron-down');
			}
		}

		if (this.titleInputEl && this.titleInputEl.value !== this.data.title) {
			this.titleInputEl.value = this.data.title;
		}

		if (this.bodyView) {
			const oldBody = this.bodyView.state.doc.toString();
			const newBody = this.data.bodyText;
			if (oldBody !== newBody) {
				const diff = minimalDiff(oldBody, newBody);
				const pSel = parentView.state.selection.main;
				const mappedAnchor = parentOffsetToLocalOffset(
					this.data.bodyMap,
					newBody,
					pSel.anchor,
					this.blockFrom,
				);
				const mappedHead = parentOffsetToLocalOffset(
					this.data.bodyMap,
					newBody,
					pSel.head,
					this.blockFrom,
				);

				let newSelection: EditorSelection;
				if (mappedAnchor !== null && mappedHead !== null) {
					newSelection = EditorSelection.single(mappedAnchor, mappedHead);
				} else {
					const cs = ChangeSet.of(
						{ from: diff.start, to: diff.end, insert: diff.insert },
						oldBody.length,
					);
					newSelection = this.bodyView.state.selection.map(cs);
				}

				this.isUpdatingFromParent = true;
				try {
					this.bodyView.dispatch({
						changes: {
							from: diff.start,
							to: diff.end,
							insert: diff.insert,
						},
						selection: newSelection,
					});
					if (mappedAnchor !== null && mappedHead !== null) {
						this.plugin.tracker.setExternalWidgetSelection(
							parentView,
							Math.min(pSel.anchor, pSel.head),
							Math.max(pSel.anchor, pSel.head),
						);
						if (mappedAnchor !== mappedHead) {
							this.bodyView.focus();
						}
					}
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
			this.bodyView?.focus();
		}
	}

	private runParentRedo(): void {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf?.editor) {
			leaf.editor.redo();
			this.bodyView?.focus();
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

	public exitBelow(): void {
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

	private destroyEditors(): void {
		if (this.bodyView) {
			this.bodyView.destroy();
			this.bodyView = null;
		}
		if (this.rawSourceView) {
			this.rawSourceView.destroy();
			this.rawSourceView = null;
		}
	}

	public destroy(): void {
		if (this.unsubscribeFoldChange) {
			this.unsubscribeFoldChange();
			this.unsubscribeFoldChange = null;
		}
		this.destroyEditors();
	}
}

export class VisualCalloutWidget extends WidgetType {
	constructor(
		public readonly rawMarkdown: string,
		public readonly from: number,
		public readonly to: number,
		public readonly calloutIndex: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	eq(other: VisualCalloutWidget): boolean {
		return (
			other.calloutIndex === this.calloutIndex &&
			other.rawMarkdown === this.rawMarkdown &&
			other.from === this.from &&
			other.to === this.to
		);
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const ctrl = calloutControllersByDom.get(dom);
		if (!ctrl || ctrl.calloutIndex !== this.calloutIndex) return false;
		ctrl.updateFromParent(this.rawMarkdown, this.from, this.to, view);
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		let viewMap = calloutControllersByParentView.get(view);
		if (!viewMap) {
			viewMap = new Map<number, VisualCalloutController>();
			calloutControllersByParentView.set(view, viewMap);
		}

		const existing = viewMap.get(this.calloutIndex);
		if (existing && !existing.rootEl.isConnected) {
			existing.updateFromParent(this.rawMarkdown, this.from, this.to, view);
			return existing.rootEl;
		}
		if (existing && existing.rootEl.isConnected) {
			existing.destroy();
			viewMap.delete(this.calloutIndex);
		}

		const ctrl = new VisualCalloutController(
			this.rawMarkdown,
			this.from,
			this.to,
			this.calloutIndex,
			view,
			this.plugin,
		);
		calloutControllersByDom.set(ctrl.rootEl, ctrl);
		viewMap.set(this.calloutIndex, ctrl);
		return ctrl.rootEl;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

let activeCalloutsPlugin: InkwellPlugin | null = null;

function buildCalloutDecorations(
	doc: {
		lines: number;
		line: (n: number) => { from: number; to: number; text: string };
		sliceString: (from: number, to: number) => string;
	},
	plugin: InkwellPlugin,
): { decorations: DecorationSet; count: number } {
	const decorations: Range<Decoration>[] = [];
	let i = 1;
	let calloutIndex = 0;

	while (i <= doc.lines) {
		const line = doc.line(i);
		const lineText = line.text;

		// Skip multi-column callout blocks altogether
		if (/^\s*>\s*\[!(?:multi-column|columns)(?:\|.*)?\]/i.test(lineText)) {
			i++;
			while (i <= doc.lines && /^\s*>/.test(doc.line(i).text)) {
				i++;
			}
			continue;
		}

		if (isSingleCalloutHeaderLine(lineText)) {
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
					widget: new VisualCalloutWidget(
						rawMarkdown,
						startPos,
						endPos,
						calloutIndex,
						plugin,
					),
					block: true,
				}).range(startPos, endPos),
			);

			calloutIndex++;
			i = endLineNum + 1;
		} else {
			i++;
		}
	}

	return {
		decorations: Decoration.set(decorations, true),
		count: calloutIndex,
	};
}

function isNotionVisualModeActive(): boolean {
	return activeCalloutsPlugin?.settings.columnPrototypeMode === 'notion';
}

export const visualCalloutsField = StateField.define<DecorationSet>({
	create(state) {
		if (!isNotionVisualModeActive() || !activeCalloutsPlugin) {
			return Decoration.none;
		}
		if (state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		try {
			return buildCalloutDecorations(state.doc, activeCalloutsPlugin).decorations;
		} catch {
			return Decoration.none;
		}
	},
	update(decorations, tr) {
		if (!isNotionVisualModeActive() || !activeCalloutsPlugin) {
			return Decoration.none;
		}
		if (tr.state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		if (tr.docChanged || decorations === Decoration.none) {
			try {
				return buildCalloutDecorations(tr.state.doc, activeCalloutsPlugin).decorations;
			} catch {
				return Decoration.none;
			}
		}
		return decorations.map(tr.changes);
	},
	provide: (f) => [
		Prec.highest(EditorView.decorations.from(f)),
		EditorView.atomicRanges.of((view) => {
			if (isNotionVisualModeActive() && activeCalloutsPlugin) {
				const count = buildCalloutDecorations(view.state.doc, activeCalloutsPlugin).count;
				cleanupExcessCalloutControllers(view, count);
			}
			return view.state.field(f, false) ?? Decoration.none;
		}),
	],
});

export function createVisualCalloutsExtension(plugin: InkwellPlugin): Extension {
	activeCalloutsPlugin = plugin;
	return [
		visualCalloutsField,
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const map = calloutControllersByParentView.get(update.view);
				if (map) {
					for (const ctrl of map.values()) {
						ctrl.onParentDocUpdated();
					}
				}
			}
		}),
	];
}

