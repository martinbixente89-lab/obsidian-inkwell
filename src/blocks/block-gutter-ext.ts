import { EditorSelection, Extension, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { editorLivePreviewField, Notice, setIcon } from 'obsidian';
import type InkwellPlugin from '../main';
import { getColumnController } from '../columns/column-widget';
import { canAddColumnToGroup } from '../columns/parser';
import { registerPlusButtonSlashInsertion } from '../slash-menu/extension';
import { minimalDiff } from '../utils/text-diff';
import { getCalloutControllerAtOffset } from './callout-widget';
import {
	isOffsetInFoldedHeadingSection,
	markHeadingLineAsToggle,
} from './heading-fold';
import {
	DropZone,
	isMovableBlock,
	MovableBlock,
	parseDocumentBlocks,
} from './block-model';
import {
	BlockOperationResult,
	convertBlockKind,
	ConvertibleBlockKind,
	moveBlock,
	moveBlockRelative,
	RelativeBlockAction,
} from './block-operations';

export interface MeasuredMovableBlock {
	block: MovableBlock;
	rect: {
		top: number;
		bottom: number;
		left: number;
		right: number;
		width: number;
		height: number;
	};
	paneRect?: {
		top: number;
		bottom: number;
		left: number;
		right: number;
		width: number;
		height: number;
	};
	totalColsInGroup?: number;
	blocksInThisColumn?: number;
	availableWidthPx?: number;
	editorView: EditorView;
}

function findLineElementAtOffset(view: EditorView, offset: number): HTMLElement | null {
	try {
		const clamped = Math.max(0, Math.min(offset, view.state.doc.length));
		const domInfo = view.domAtPos(clamped);
		const node = domInfo.node;
		const el = node instanceof HTMLElement ? node : node.parentElement;
		const lineEl = el?.closest('.cm-line, .cm-embed-block');
		if (
			lineEl instanceof HTMLElement &&
			view.contentDOM.contains(lineEl) &&
			!lineEl.querySelector('.inkwell-visual-columns-root')
		) {
			return lineEl;
		}
	} catch {
		// Fallback to coordsAtPos below
	}
	return null;
}

function measureBlockInEditor(
	view: EditorView,
	block: MovableBlock,
): MeasuredMovableBlock | null {
	if (isOffsetInFoldedHeadingSection(view, block.fromOffset)) {
		return null;
	}

	if (block.kind === 'quote' && block.location.scope === 'root') {
		const calloutCtrl = getCalloutControllerAtOffset(view, block.fromOffset);
		if (calloutCtrl && calloutCtrl.rootEl.isConnected) {
			if (calloutCtrl.rootEl.classList.contains('is-folded-by-heading')) {
				return null;
			}
			const r = calloutCtrl.rootEl.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) {
				return {
					block,
					rect: {
						top: r.top,
						bottom: r.bottom,
						left: r.left,
						right: r.right,
						width: r.width,
						height: r.height,
					},
					editorView: view,
				};
			}
		}
	}

	const firstLineEl = findLineElementAtOffset(view, block.fromOffset);
	if (firstLineEl?.classList.contains('inkwell-heading-folded-line')) {
		return null;
	}

	const embeddedWidgetEl = firstLineEl?.querySelector(
		'.inkwell-visual-table-root, .inkwell-visual-math-mermaid-root, .inkwell-visual-media-root, .inkwell-visual-toc-root',
	);
	if (embeddedWidgetEl instanceof HTMLElement) {
		const rw = embeddedWidgetEl.getBoundingClientRect();
		if (rw.width > 0 && rw.height > 0) {
			return {
				block,
				rect: {
					top: rw.top,
					bottom: rw.bottom,
					left: rw.left,
					right: rw.right,
					width: rw.width,
					height: rw.height,
				},
				editorView: view,
			};
		}
	}

	const lastLineEl =
		block.toOffset === block.fromOffset
			? firstLineEl
			: findLineElementAtOffset(view, block.toOffset) ?? firstLineEl;

	if (firstLineEl && lastLineEl) {
		const r1 = firstLineEl.getBoundingClientRect();
		const r2 = lastLineEl.getBoundingClientRect();
		if (r1.width > 0 && r1.height > 0) {
			const top = Math.min(r1.top, r2.top);
			const bottom = Math.max(r1.bottom, r2.bottom);
			const left = Math.min(r1.left, r2.left);
			const right = Math.max(r1.right, r2.right);
			return {
				block,
				rect: {
					top,
					bottom,
					left,
					right,
					width: right - left,
					height: bottom - top,
				},
				editorView: view,
			};
		}
	}

	try {
		const c1 = view.coordsAtPos(Math.max(0, Math.min(block.fromOffset, view.state.doc.length)));
		const c2 = view.coordsAtPos(Math.max(0, Math.min(block.toOffset, view.state.doc.length)));
		const contentRect = view.contentDOM.getBoundingClientRect();
		if (c1 && c2 && contentRect.width > 0) {
			const top = Math.min(c1.top, c2.top);
			const bottom = Math.max(c1.bottom, c2.bottom);
			const left = contentRect.left;
			const right = contentRect.right;
			return {
				block,
				rect: {
					top,
					bottom,
					left,
					right,
					width: right - left,
					height: Math.max(20, bottom - top),
				},
				editorView: view,
			};
		}
	} catch {
		return null;
	}

	return null;
}

/**
 * Measures all visible movable blocks (both top-level and inside multi-column panes)
 * for a given parent Obsidian EditorView.
 */
export function measureMovableBlocks(parentView: EditorView): MeasuredMovableBlock[] {
	const docText = parentView.state.doc.toString();
	const docBlocks = parseDocumentBlocks(docText);
	const measured: MeasuredMovableBlock[] = [];
	const rootWidthPx = parentView.contentDOM.getBoundingClientRect().width;

	for (const b of docBlocks) {
		if (isMovableBlock(b)) {
			const m = measureBlockInEditor(parentView, b);
			if (m) {
				m.availableWidthPx = rootWidthPx;
				measured.push(m);
			}
		} else if (b.kind === 'multi-column') {
			const ctrl = getColumnController(parentView, b.multiColumnWidgetIndex);
			if (!ctrl) continue;
			const totalCols = b.columns.length;
			const containerWidthPx = ctrl.getContainerWidthPx();

			for (let cIdx = 0; cIdx < totalCols; cIdx++) {
				const colView = ctrl.getColumnView(cIdx);
				if (!colView) continue;
				const colBlocks = b.columns[cIdx] ?? [];
				const paneEl = colView.dom.closest('.inkwell-col-pane');
				const rawPaneRect = paneEl
					? paneEl.getBoundingClientRect()
					: colView.dom.getBoundingClientRect();
				const paneRect = {
					top: rawPaneRect.top,
					bottom: rawPaneRect.bottom,
					left: rawPaneRect.left,
					right: rawPaneRect.right,
					width: rawPaneRect.width,
					height: rawPaneRect.height,
				};

				for (const cb of colBlocks) {
					if (isMovableBlock(cb)) {
						const m = measureBlockInEditor(colView, cb);
						if (m) {
							m.paneRect = paneRect;
							m.totalColsInGroup = totalCols;
							m.blocksInThisColumn = colBlocks.length;
							m.availableWidthPx = containerWidthPx;
							measured.push(m);
						}
					}
				}
			}
		}
	}

	return measured;
}

class BlockGutterViewPlugin {
	private gutterEl: HTMLElement;
	private plusBtn: HTMLButtonElement;
	private handleBtn: HTMLButtonElement;
	private dropIndicatorEl: HTMLElement;
	private dropLabelEl: HTMLElement;
	private dragGhostEl: HTMLElement | null = null;
	private actionMenuEl: HTMLElement | null = null;

	private hoveredMeasured: MeasuredMovableBlock | null = null;
	private isPointerDownOnHandle = false;
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private dragSource: MeasuredMovableBlock | null = null;
	private pendingDrop: {
		target: MeasuredMovableBlock;
		zone: DropZone;
		rejectedReason?: string;
	} | null = null;

	private onDocMouseMoveBound: (e: MouseEvent) => void;
	private onDocMouseUpBound: (e: MouseEvent) => void;
	private onDocKeyDownBound: (e: KeyboardEvent) => void;
	private onDocMouseDownOutsideBound: (e: MouseEvent) => void;
	private onScrollBound: () => void;
	private onResizeBound: () => void;
	private resizeObserver: ResizeObserver | null = null;

	constructor(
		private readonly view: EditorView,
		private readonly plugin: InkwellPlugin,
	) {
		this.gutterEl = document.body.createDiv({
			cls: 'inkwell-block-gutter is-hidden',
		});

		this.plusBtn = this.gutterEl.createEl('button', {
			type: 'button',
			cls: 'inkwell-block-gutter-btn inkwell-block-plus-btn',
			attr: {
				'aria-label': 'Ajouter un bloc',
				title: 'Cliquez pour insérer un bloc (Alt+clic : insérer au-dessus)',
			},
		});
		setIcon(this.plusBtn, 'plus');

		this.handleBtn = this.gutterEl.createEl('button', {
			type: 'button',
			cls: 'inkwell-block-gutter-btn inkwell-block-handle-btn',
			attr: {
				'aria-label': 'Déplacer ou ouvrir les actions du bloc',
				title: 'Glisser pour déplacer ou cliquer pour les actions du bloc',
			},
		});
		setIcon(this.handleBtn, 'grip-vertical');

		this.dropIndicatorEl = document.body.createDiv({
			cls: 'inkwell-block-drop-indicator is-hidden',
		});
		this.dropLabelEl = this.dropIndicatorEl.createSpan({
			cls: 'inkwell-block-drop-label',
		});

		this.plusBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onPlusButtonClicked(e.altKey);
		});

		this.handleBtn.addEventListener('mousedown', (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			if (!this.hoveredMeasured) return;
			this.closeActionMenu();
			this.isPointerDownOnHandle = true;
			this.isDragging = false;
			this.dragStartX = e.clientX;
			this.dragStartY = e.clientY;
			this.dragSource = this.hoveredMeasured;
		});

		this.onDocMouseMoveBound = (e: MouseEvent) => this.onDocumentMouseMove(e);
		this.onDocMouseUpBound = (e: MouseEvent) => this.onDocumentMouseUp(e);
		this.onDocKeyDownBound = (e: KeyboardEvent) => this.onDocumentKeyDown(e);
		this.onDocMouseDownOutsideBound = (e: MouseEvent) => {
			if (
				this.actionMenuEl &&
				!this.actionMenuEl.contains(e.target as Node) &&
				!this.gutterEl.contains(e.target as Node)
			) {
				this.closeActionMenu();
			}
		};
		this.onScrollBound = () => {
			if (!this.isDragging) {
				this.hideGutter();
				this.closeActionMenu();
			}
		};
		this.onResizeBound = () => {
			this.onViewportOrPaneResized();
		};

		document.addEventListener('mousemove', this.onDocMouseMoveBound, { passive: true });
		document.addEventListener('mouseup', this.onDocMouseUpBound);
		document.addEventListener('keydown', this.onDocKeyDownBound, true);
		document.addEventListener('mousedown', this.onDocMouseDownOutsideBound, true);
		this.view.scrollDOM.addEventListener('scroll', this.onScrollBound, { passive: true });
		window.addEventListener('resize', this.onResizeBound, { passive: true });
		if (typeof ResizeObserver !== 'undefined') {
			this.resizeObserver = new ResizeObserver(() => {
				this.onViewportOrPaneResized();
			});
			this.resizeObserver.observe(this.view.dom);
		}
	}

	private onViewportOrPaneResized(): void {
		if (this.isDragging && this.pendingDrop) {
			const refreshed = measureMovableBlocks(this.view).find(
				(m) => m.block.id === this.pendingDrop?.target.block.id,
			);
			if (refreshed) {
				this.pendingDrop.target = refreshed;
				this.renderDropIndicator(
					refreshed,
					this.pendingDrop.zone,
					this.pendingDrop.rejectedReason,
				);
			} else {
				this.dropIndicatorEl.classList.add('is-hidden');
			}
			return;
		}
		if (this.hoveredMeasured) {
			const refreshed = measureMovableBlocks(this.view).find(
				(m) => m.block.id === this.hoveredMeasured?.block.id,
			);
			if (refreshed) {
				this.hoveredMeasured = refreshed;
				this.positionGutter(refreshed);
			} else {
				this.hideGutter();
			}
		}
	}

	update(update: ViewUpdate): void {
		if (!this.isNotionActive()) {
			this.hideGutter();
			this.closeActionMenu();
			return;
		}
		if (update.docChanged && !this.isDragging) {
			this.closeActionMenu();
		}
	}

	private isNotionActive(): boolean {
		if (this.plugin.settings.columnPrototypeMode !== 'notion') return false;
		if (this.view.state.field(editorLivePreviewField, false) === false) return false;
		return this.view.dom.isConnected;
	}

	private onDocumentMouseMove(e: MouseEvent): void {
		if (!this.isNotionActive()) {
			this.hideGutter();
			return;
		}

		// 1. Handle active or starting drag from the ⋮⋮ handle
		if (this.isPointerDownOnHandle && this.dragSource) {
			const dx = e.clientX - this.dragStartX;
			const dy = e.clientY - this.dragStartY;
			if (!this.isDragging && Math.hypot(dx, dy) >= 4) {
				this.startDragSession();
			}
			if (this.isDragging) {
				this.updateDragSession(e.clientX, e.clientY);
				return;
			}
		}

		if (this.actionMenuEl) {
			return;
		}

		// 2. Normal hover detection over the editor or gutter
		const editorRect = this.view.dom.getBoundingClientRect();
		if (
			e.clientY < editorRect.top ||
			e.clientY > editorRect.bottom ||
			e.clientX < editorRect.left - 56 ||
			e.clientX > editorRect.right
		) {
			this.hideGutter();
			return;
		}

		const gutterRect = this.gutterEl.getBoundingClientRect();
		if (
			!this.gutterEl.classList.contains('is-hidden') &&
			e.clientX >= gutterRect.left - 6 &&
			e.clientX <= gutterRect.right + 6 &&
			e.clientY >= gutterRect.top - 4 &&
			e.clientY <= gutterRect.bottom + 4
		) {
			return;
		}

		const measured = measureMovableBlocks(this.view);
		let bestMatch: MeasuredMovableBlock | null = null;

		for (const m of measured) {
			const r = m.rect;
			if (
				e.clientY >= r.top - 3 &&
				e.clientY <= r.bottom + 3 &&
				e.clientX >= r.left - 44 &&
				e.clientX <= r.right + 10
			) {
				bestMatch = m;
				break;
			}
		}

		if (!bestMatch) {
			this.hideGutter();
			return;
		}

		this.hoveredMeasured = bestMatch;
		this.positionGutter(bestMatch);
	}

	private positionGutter(target: MeasuredMovableBlock): void {
		const r = target.rect;
		const gutterWidth = 36;
		const left = Math.max(6, Math.round(r.left - gutterWidth - 2));
		const top = Math.round(r.top + Math.min(2, Math.max(0, (r.height - 22) / 2)));

		this.gutterEl.classList.remove('is-hidden');
		this.gutterEl.style.left = `${left}px`;
		this.gutterEl.style.top = `${top}px`;
		this.gutterEl.dataset.blockId = target.block.id;
		this.gutterEl.dataset.blockScope = target.block.location.scope;
	}

	private hideGutter(): void {
		this.gutterEl.classList.add('is-hidden');
		this.hoveredMeasured = null;
	}

	private startDragSession(): void {
		this.isDragging = true;
		this.gutterEl.classList.add('is-dragging');
		document.body.classList.add('inkwell-is-dragging-block');

		if (this.dragSource) {
			const rawPreview = this.dragSource.block.markdown
				.replace(/<[^>]+>/g, '')
				.replace(/^#{1,6}\s+/, '')
				.trim();
			this.dragGhostEl = document.body.createDiv({
				cls: 'inkwell-block-drag-ghost',
				text: rawPreview.length > 42 ? `${rawPreview.slice(0, 42)}…` : rawPreview || 'Bloc',
			});
		}
	}

	private updateDragSession(clientX: number, clientY: number): void {
		if (this.dragGhostEl) {
			const clampedLeft = Math.max(8, Math.min(clientX + 14, window.innerWidth - 250));
			const clampedTop = Math.max(8, Math.min(clientY + 14, window.innerHeight - 40));
			this.dragGhostEl.style.left = `${clampedLeft}px`;
			this.dragGhostEl.style.top = `${clampedTop}px`;
		}

		if (!this.dragSource) return;

		const measured = measureMovableBlocks(this.view);
		let candidate: MeasuredMovableBlock | null = null;

		for (const m of measured) {
			if (m.block.id === this.dragSource.block.id) continue;
			const r = m.rect;
			if (
				clientY >= r.top - 14 &&
				clientY <= r.bottom + 14 &&
				clientX >= r.left - 24 &&
				clientX <= r.right + 24
			) {
				candidate = m;
				break;
			}
		}

		if (!candidate) {
			this.pendingDrop = null;
			this.dropIndicatorEl.classList.add('is-hidden');
			return;
		}

		const r = candidate.rect;
		const relX = (clientX - r.left) / Math.max(1, r.width);
		const relY = (clientY - r.top) / Math.max(1, r.height);

		let zone: DropZone;
		if (relX < 0.22) {
			zone = 'left';
		} else if (relX > 0.78) {
			zone = 'right';
		} else if (relY < 0.5) {
			zone = 'before';
		} else {
			zone = 'after';
		}

		let rejectedReason: string | undefined;
		if (zone === 'left' || zone === 'right') {
			const srcLoc = this.dragSource.block.location;
			const dstLoc = candidate.block.location;

			if (dstLoc.scope === 'column') {
				const sameGroup =
					srcLoc.scope === 'column' &&
					srcLoc.parentBlockIndex === dstLoc.parentBlockIndex;
				const srcEmptiesCol =
					sameGroup && (this.dragSource.blocksInThisColumn ?? 1) <= 1;

				if (srcEmptiesCol && srcLoc.colIndex === dstLoc.colIndex) {
					// Dropping the sole block of a column onto the side of the same column is a no-op
					this.pendingDrop = null;
					this.dropIndicatorEl.classList.add('is-hidden');
					return;
				}

				const currentCols = candidate.totalColsInGroup ?? 2;
				const effectiveCols = srcEmptiesCol ? currentCols - 1 : currentCols;
				const check = canAddColumnToGroup(effectiveCols, candidate.availableWidthPx);
				if (!check.allowed) {
					rejectedReason = check.reason;
				}
			} else {
				const check = canAddColumnToGroup(1, candidate.availableWidthPx);
				if (!check.allowed) {
					rejectedReason = check.reason;
				}
			}
		}

		this.pendingDrop = { target: candidate, zone, rejectedReason };
		this.renderDropIndicator(candidate, zone, rejectedReason);
	}

	private renderDropIndicator(
		target: MeasuredMovableBlock,
		zone: DropZone,
		rejectedReason?: string,
	): void {
		const r = target.rect;
		this.dropIndicatorEl.dataset.zone = zone;

		if (zone === 'before') {
			this.dropIndicatorEl.className = 'inkwell-block-drop-indicator is-horizontal';
			this.dropIndicatorEl.style.left = `${Math.round(r.left)}px`;
			this.dropIndicatorEl.style.top = `${Math.round(r.top - 4)}px`;
			this.dropIndicatorEl.style.width = `${Math.round(r.width)}px`;
			this.dropLabelEl.textContent =
				target.block.location.scope === 'column'
					? `Déposer dans la colonne ${target.block.location.colIndex + 1} (au-dessus)`
					: 'Déposer au-dessus';
		} else if (zone === 'after') {
			this.dropIndicatorEl.className = 'inkwell-block-drop-indicator is-horizontal';
			this.dropIndicatorEl.style.left = `${Math.round(r.left)}px`;
			this.dropIndicatorEl.style.top = `${Math.round(r.bottom + 2)}px`;
			this.dropIndicatorEl.style.width = `${Math.round(r.width)}px`;
			this.dropLabelEl.textContent =
				target.block.location.scope === 'column'
					? `Déposer dans la colonne ${target.block.location.colIndex + 1} (en dessous)`
					: 'Déposer en dessous';
		} else {
			// Lateral drop: 'left' or 'right'
			const isColumnTarget = target.block.location.scope === 'column';
			const vBounds = isColumnTarget && target.paneRect ? target.paneRect : r;
			const barLeft =
				zone === 'left' ? Math.round(vBounds.left - 8) : Math.round(vBounds.right + 6);

			this.dropIndicatorEl.className = rejectedReason
				? 'inkwell-block-drop-indicator is-vertical is-rejected'
				: 'inkwell-block-drop-indicator is-vertical';
			this.dropIndicatorEl.style.left = `${barLeft}px`;
			this.dropIndicatorEl.style.top = `${Math.round(vBounds.top)}px`;
			this.dropIndicatorEl.style.height = `${Math.max(32, Math.round(vBounds.height))}px`;

			if (rejectedReason) {
				this.dropLabelEl.textContent = rejectedReason;
			} else if (isColumnTarget && target.block.location.scope === 'column') {
				const colIdx = target.block.location.colIndex;
				const nextTotal = (target.totalColsInGroup ?? 2) + 1;
				const slotNum = zone === 'left' ? colIdx + 1 : colIdx + 2;
				this.dropLabelEl.textContent =
					zone === 'left'
						? `Ajouter une colonne ici (col. ${slotNum}/${nextTotal})`
						: `Ajouter une colonne ici (col. ${slotNum}/${nextTotal})`;
			} else {
				this.dropLabelEl.textContent =
					zone === 'left' ? 'Créer une colonne à gauche' : 'Créer une colonne à droite';
			}
		}
	}

	private onDocumentMouseUp(_e: MouseEvent): void {
		if (!this.isPointerDownOnHandle) return;

		const wasDragging = this.isDragging;
		const source = this.dragSource;
		const drop = this.pendingDrop;

		this.cleanupDragVisuals();

		if (!wasDragging && source) {
			this.openActionMenu(source);
			return;
		}

		if (wasDragging && source && drop) {
			if (drop.rejectedReason) {
				new Notice(drop.rejectedReason);
				return;
			}
			const oldDoc = this.view.state.doc.toString();
			const res = moveBlock(
				oldDoc,
				source.block.id,
				drop.target.block.id,
				drop.zone,
				{ availableWidthPx: drop.target.availableWidthPx },
			);
			if (res) {
				this.applyBlockOperationResult(oldDoc, res, 'input.block.move');
			}
		}
	}

	private onDocumentKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			if (this.isDragging || this.isPointerDownOnHandle) {
				e.preventDefault();
				e.stopPropagation();
				this.cleanupDragVisuals();
			} else if (this.actionMenuEl) {
				e.preventDefault();
				e.stopPropagation();
				this.closeActionMenu();
			}
		}
	}

	private cleanupDragVisuals(): void {
		this.isPointerDownOnHandle = false;
		this.isDragging = false;
		this.dragSource = null;
		this.pendingDrop = null;
		this.gutterEl.classList.remove('is-dragging');
		document.body.classList.remove('inkwell-is-dragging-block');
		this.dropIndicatorEl.classList.add('is-hidden');
		if (this.dragGhostEl) {
			this.dragGhostEl.remove();
			this.dragGhostEl = null;
		}
	}

	private onPlusButtonClicked(insertBefore: boolean): void {
		const target = this.hoveredMeasured;
		if (!target) return;
		this.closeActionMenu();

		const edView = target.editorView;
		const block = target.block;

		if (insertBefore) {
			const insertPos = Math.max(0, Math.min(block.fromOffset, edView.state.doc.length));
			registerPlusButtonSlashInsertion(edView, insertPos, insertPos + 3, insertPos);
			edView.dispatch({
				changes: { from: insertPos, to: insertPos, insert: '/\n\n' },
				selection: EditorSelection.cursor(insertPos + 1),
				annotations: Transaction.userEvent.of('input.type'),
				scrollIntoView: true,
			});
			edView.focus();
		} else {
			const insertPos = Math.max(0, Math.min(block.toOffset, edView.state.doc.length));
			registerPlusButtonSlashInsertion(edView, insertPos, insertPos + 3, insertPos + 2);
			edView.dispatch({
				changes: { from: insertPos, to: insertPos, insert: '\n\n/' },
				selection: EditorSelection.cursor(insertPos + 3),
				annotations: Transaction.userEvent.of('input.type'),
				scrollIntoView: true,
			});
			edView.focus();
		}
	}

	private getBlockUnitLabel(block: MovableBlock): string {
		switch (block.kind) {
			case 'heading':
				return `Unité : Titre ${block.headingLevel ?? 1}`;
			case 'list':
				return 'Unité : Liste complète';
			case 'quote':
				return 'Unité : Citation / Encadré / Dépliant';
			case 'hr':
				return 'Unité : Séparateur';
			case 'code':
				return 'Unité : Bloc de code';
			case 'table':
				return 'Unité : Tableau';
			case 'math':
				return 'Unité : Équation ($$)';
			case 'media':
				return 'Unité : Média intégré';
			default:
				return 'Unité : Paragraphe';
		}
	}

	private openActionMenu(target: MeasuredMovableBlock): void {
		this.closeActionMenu();

		const menu = document.body.createDiv({
			cls: 'inkwell-block-action-menu',
		});

		const addSectionTitle = (label: string) => {
			menu.createDiv({
				cls: 'inkwell-block-menu-section',
				text: label,
			});
		};

		const addActionItem = (label: string, onClick: () => void) => {
			const item = menu.createEl('button', {
				type: 'button',
				cls: 'inkwell-block-menu-item',
				text: label,
			});
			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.closeActionMenu();
				onClick();
			});
		};

		addSectionTitle(this.getBlockUnitLabel(target.block));
		addActionItem('↑ Monter le bloc', () =>
			this.runRelativeAction(target.block.id, 'up', target.availableWidthPx),
		);
		addActionItem('↓ Descendre le bloc', () =>
			this.runRelativeAction(target.block.id, 'down', target.availableWidthPx),
		);

		if (target.block.location.scope === 'root') {
			addActionItem('◫ Mettre en colonne à gauche du voisin', () =>
				this.runRelativeAction(target.block.id, 'pair-left', target.availableWidthPx),
			);
			addActionItem('◫ Mettre en colonne à droite du voisin', () =>
				this.runRelativeAction(target.block.id, 'pair-right', target.availableWidthPx),
			);
		} else {
			const colIdx = target.block.location.colIndex;
			const totalCols = target.totalColsInGroup ?? 2;

			if (colIdx > 0) {
				addActionItem(`← Déplacer vers la colonne ${colIdx}`, () =>
					this.runRelativeAction(target.block.id, 'to-prev-col', target.availableWidthPx),
				);
			}
			if (colIdx < totalCols - 1) {
				addActionItem(`→ Déplacer vers la colonne ${colIdx + 2}`, () =>
					this.runRelativeAction(target.block.id, 'to-next-col', target.availableWidthPx),
				);
			}
			if ((target.blocksInThisColumn ?? 1) >= 2) {
				addActionItem('◫ Isoler dans une nouvelle colonne à gauche', () =>
					this.runRelativeAction(target.block.id, 'split-col-left', target.availableWidthPx),
				);
				addActionItem('◫ Isoler dans une nouvelle colonne à droite', () =>
					this.runRelativeAction(target.block.id, 'split-col-right', target.availableWidthPx),
				);
			}
			addActionItem('⤴ Remettre dans le flux normal (au-dessus)', () =>
				this.runRelativeAction(target.block.id, 'exit-above', target.availableWidthPx),
			);
			addActionItem('⤵ Remettre dans le flux normal (en dessous)', () =>
				this.runRelativeAction(target.block.id, 'exit-below', target.availableWidthPx),
			);
		}

		if (
			target.block.kind !== 'hr' &&
			target.block.kind !== 'code' &&
			target.block.kind !== 'table' &&
			target.block.kind !== 'math' &&
			target.block.kind !== 'media'
		) {
			addSectionTitle('Transformer en');
			const conversions: { label: string; kind: ConvertibleBlockKind }[] = [
				{ label: 'Texte (Paragraphe)', kind: 'paragraph' },
				{ label: 'Titre 1 (#)', kind: 'h1' },
				{ label: 'Titre 2 (##)', kind: 'h2' },
				{ label: 'Titre 3 (###)', kind: 'h3' },
				{ label: 'Titre 4 (####)', kind: 'h4' },
				{ label: 'Titre dépliant 1 (▸ #)', kind: 'toggle-h1' },
				{ label: 'Titre dépliant 2 (▸ ##)', kind: 'toggle-h2' },
				{ label: 'Titre dépliant 3 (▸ ###)', kind: 'toggle-h3' },
				{ label: 'Liste à puces (-)', kind: 'bullet-list' },
				{ label: 'Liste numérotée (1.)', kind: 'numbered-list' },
				{ label: 'Liste de tâches ([ ])', kind: 'task-list' },
				{ label: 'Citation (>)', kind: 'quote' },
				{ label: 'Encadré ([!NOTE])', kind: 'callout' },
				{ label: 'Menu dépliant (▸)', kind: 'toggle' },
			];
			for (const c of conversions) {
				addActionItem(c.label, () =>
					this.runConvertAction(target.block.id, c.kind, target.editorView),
				);
			}
		}

		this.actionMenuEl = menu;

		const handleRect = this.handleBtn.getBoundingClientRect();
		const menuRect = menu.getBoundingClientRect();
		const left = Math.max(8, Math.min(handleRect.left, window.innerWidth - menuRect.width - 12));
		const top =
			handleRect.bottom + menuRect.height + 12 <= window.innerHeight
				? handleRect.bottom + 4
				: Math.max(8, handleRect.top - menuRect.height - 4);

		menu.style.left = `${Math.round(left)}px`;
		menu.style.top = `${Math.round(top)}px`;
	}

	private closeActionMenu(): void {
		if (this.actionMenuEl) {
			this.actionMenuEl.remove();
			this.actionMenuEl = null;
		}
	}

	private runRelativeAction(
		sourceId: string,
		action: RelativeBlockAction,
		availableWidthPx?: number,
	): void {
		const oldDoc = this.view.state.doc.toString();
		const res = moveBlockRelative(oldDoc, sourceId, action, { availableWidthPx });
		if (res) {
			this.applyBlockOperationResult(oldDoc, res, 'input.block.move');
		} else if (
			action === 'pair-left' ||
			action === 'pair-right' ||
			action === 'split-col-left' ||
			action === 'split-col-right'
		) {
			new Notice(
				'Impossible d’ajouter une colonne supplémentaire à cet endroit (largeur disponible insuffisante).',
			);
		}
	}

	private runConvertAction(
		targetId: string,
		kind: ConvertibleBlockKind,
		targetEditorView?: EditorView,
	): void {
		const oldDoc = this.view.state.doc.toString();
		const res = convertBlockKind(oldDoc, targetId, kind);
		if (res) {
			this.applyBlockOperationResult(oldDoc, res, 'input.block.convert');
			if (kind === 'toggle-h1' || kind === 'toggle-h2' || kind === 'toggle-h3') {
				const edView = targetEditorView ?? this.view;
				window.requestAnimationFrame(() => {
					const pos =
						edView === this.view
							? Math.min(res.focusOffset, edView.state.doc.length)
							: Math.min(
									edView.state.selection.main.head,
									edView.state.doc.length,
								);
					markHeadingLineAsToggle(edView, pos, this.plugin);
				});
			}
		}
	}

	private applyBlockOperationResult(
		oldDoc: string,
		res: BlockOperationResult,
		userEvent: string,
	): void {
		if (res.docText === oldDoc) return;
		const diff = minimalDiff(oldDoc, res.docText);
		const safeFocus = Math.max(0, Math.min(res.focusOffset, res.docText.length));

		this.view.dispatch({
			changes: {
				from: diff.start,
				to: diff.end,
				insert: diff.insert,
			},
			selection: EditorSelection.cursor(safeFocus),
			annotations: Transaction.userEvent.of(userEvent),
		});
		this.hideGutter();
	}

	destroy(): void {
		this.cleanupDragVisuals();
		this.closeActionMenu();
		document.removeEventListener('mousemove', this.onDocMouseMoveBound);
		document.removeEventListener('mouseup', this.onDocMouseUpBound);
		document.removeEventListener('keydown', this.onDocKeyDownBound, true);
		document.removeEventListener('mousedown', this.onDocMouseDownOutsideBound, true);
		this.view.scrollDOM.removeEventListener('scroll', this.onScrollBound);
		window.removeEventListener('resize', this.onResizeBound);
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		this.gutterEl.remove();
		this.dropIndicatorEl.remove();
	}
}

export function createBlockGutterExtension(plugin: InkwellPlugin): Extension {
	return ViewPlugin.define((view) => new BlockGutterViewPlugin(view, plugin));
}
