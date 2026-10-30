import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { Component, MarkdownRenderer, MarkdownView, setIcon, TFile } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	buildTableOfContentsMarkdown,
	cleanHeadingDisplayText,
	extractHeadingsFromDoc,
} from '../slash-menu/toc-helper';
import {
	isTableDelimiterLine,
	ParsedMarkdownTable,
	ParsedMediaEmbed,
	parseMarkdownTable,
	parseStandaloneMediaEmbedLine,
	serializeMarkdownTable,
} from './block-model';

export {
	isTableDelimiterLine,
	parseMarkdownTable,
	parseStandaloneMediaEmbedLine,
	serializeMarkdownTable,
};
export type { ParsedMarkdownTable, ParsedMediaEmbed };

/* ==========================================================================
   1. Interactive Cell-by-Cell Table Widget (Tableaux éditables en cellules)
   ========================================================================== */

class VisualTableController {
	public readonly rootEl: HTMLElement;
	private rawMarkdown: string;
	private from: number;
	private to: number;
	public readonly tableIndex: number;
	private view: EditorView;
	private data: ParsedMarkdownTable;
	private isRawMode = false;
	private isDispatching = false;
	private headerInputs: HTMLInputElement[] = [];
	private bodyInputs: HTMLInputElement[][] = [];
	private rawTextarea: HTMLTextAreaElement | null = null;

	constructor(
		rawMarkdown: string,
		from: number,
		to: number,
		tableIndex: number,
		view: EditorView,
	) {
		this.rawMarkdown = rawMarkdown;
		this.from = from;
		this.to = to;
		this.tableIndex = tableIndex;
		this.view = view;
		this.data = parseMarkdownTable(rawMarkdown);

		this.rootEl = document.createElement('div');
		this.rootEl.className = 'inkwell-visual-table-root';
		this.rootEl.setAttribute('contenteditable', 'false');

		const stopBubble = (e: Event) => e.stopPropagation();
		this.rootEl.addEventListener('keydown', stopBubble);
		this.rootEl.addEventListener('keyup', stopBubble);
		this.rootEl.addEventListener('keypress', stopBubble);
		this.rootEl.addEventListener('mousedown', (e) => e.stopPropagation());

		this.buildDOM();
	}

	private buildDOM(): void {
		while (this.rootEl.firstChild) {
			this.rootEl.removeChild(this.rootEl.firstChild);
		}
		this.headerInputs = [];
		this.bodyInputs = [];
		this.rawTextarea = null;

		// Top toolbar for table actions + source toggle
		const toolbar = document.createElement('div');
		toolbar.className = 'inkwell-visual-table-toolbar';

		if (!this.isRawMode) {
			const addRowBtn = document.createElement('button');
			addRowBtn.type = 'button';
			addRowBtn.className = 'inkwell-visual-table-action-btn';
			addRowBtn.textContent = '+ Ligne';
			addRowBtn.title = 'Ajouter une ligne au tableau';
			addRowBtn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.addRow();
			});
			toolbar.appendChild(addRowBtn);

			const addColBtn = document.createElement('button');
			addColBtn.type = 'button';
			addColBtn.className = 'inkwell-visual-table-action-btn';
			addColBtn.textContent = '+ Colonne';
			addColBtn.title = 'Ajouter une colonne au tableau';
			addColBtn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this.addColumn();
			});
			toolbar.appendChild(addColBtn);

			if (this.data.rows.length > 1) {
				const delRowBtn = document.createElement('button');
				delRowBtn.type = 'button';
				delRowBtn.className = 'inkwell-visual-table-action-btn';
				delRowBtn.textContent = '− Ligne';
				delRowBtn.title = 'Supprimer la dernière ligne';
				delRowBtn.addEventListener('mousedown', (e) => {
					e.preventDefault();
					this.removeLastRow();
				});
				toolbar.appendChild(delRowBtn);
			}

			if (this.data.headers.length > 1) {
				const delColBtn = document.createElement('button');
				delColBtn.type = 'button';
				delColBtn.className = 'inkwell-visual-table-action-btn';
				delColBtn.textContent = '− Colonne';
				delColBtn.title = 'Supprimer la dernière colonne';
				delColBtn.addEventListener('mousedown', (e) => {
					e.preventDefault();
					this.removeLastColumn();
				});
				toolbar.appendChild(delColBtn);
			}
		}

		const rawBtn = document.createElement('button');
		rawBtn.type = 'button';
		rawBtn.className = 'inkwell-visual-table-source-btn';
		rawBtn.title = this.isRawMode
			? 'Revenir au tableau visuel'
			: 'Afficher / modifier le Markdown brut du tableau';
		setIcon(rawBtn, 'code-2');
		rawBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			this.isRawMode = !this.isRawMode;
			this.buildDOM();
		});
		toolbar.appendChild(rawBtn);
		this.rootEl.appendChild(toolbar);

		if (this.isRawMode) {
			const area = document.createElement('textarea');
			area.className = 'inkwell-visual-table-raw-area';
			area.value = this.rawMarkdown;
			area.rows = Math.max(3, this.rawMarkdown.split('\n').length);
			area.addEventListener('input', () => {
				const nextRaw = area.value;
				this.data = parseMarkdownTable(nextRaw);
				this.commitRawMarkdown(nextRaw);
			});
			this.rootEl.appendChild(area);
			this.rawTextarea = area;
			return;
		}

		const tableEl = document.createElement('table');
		tableEl.className = 'inkwell-visual-table';

		// Header row
		const thead = document.createElement('thead');
		const trHead = document.createElement('tr');
		this.data.headers.forEach((hText, colIdx) => {
			const th = document.createElement('th');
			const align = this.data.alignments[colIdx];
			if (align) th.style.textAlign = align;

			const input = document.createElement('input');
			input.type = 'text';
			input.className = 'inkwell-visual-table-cell-input is-header-cell';
			input.value = hText;
			input.placeholder = `Colonne ${colIdx + 1}`;
			if (align) input.style.textAlign = align;

			input.addEventListener('input', () => {
				this.data.headers[colIdx] = input.value;
				this.commitTableData();
			});
			input.addEventListener('keydown', (e) => {
				this.handleCellKeyDown(e, -1, colIdx);
			});

			th.appendChild(input);
			trHead.appendChild(th);
			this.headerInputs.push(input);
		});
		thead.appendChild(trHead);
		tableEl.appendChild(thead);

		// Body rows
		const tbody = document.createElement('tbody');
		this.data.rows.forEach((rowCells, rowIdx) => {
			const tr = document.createElement('tr');
			const rowInputs: HTMLInputElement[] = [];

			for (let colIdx = 0; colIdx < this.data.headers.length; colIdx++) {
				const td = document.createElement('td');
				const align = this.data.alignments[colIdx];
				if (align) td.style.textAlign = align;

				const input = document.createElement('input');
				input.type = 'text';
				input.className = 'inkwell-visual-table-cell-input';
				input.value = rowCells[colIdx] ?? '';
				input.placeholder = '…';
				if (align) input.style.textAlign = align;

				input.addEventListener('input', () => {
					let targetRow = this.data.rows[rowIdx];
					if (!targetRow) {
						targetRow = [];
						this.data.rows[rowIdx] = targetRow;
					}
					targetRow[colIdx] = input.value;
					this.commitTableData();
				});
				input.addEventListener('keydown', (e) => {
					this.handleCellKeyDown(e, rowIdx, colIdx);
				});

				td.appendChild(input);
				tr.appendChild(td);
				rowInputs.push(input);
			}

			tbody.appendChild(tr);
			this.bodyInputs.push(rowInputs);
		});
		tableEl.appendChild(tbody);

		this.rootEl.appendChild(tableEl);
	}

	private handleCellKeyDown(e: KeyboardEvent, rowIdx: number, colIdx: number): void {
		const colCount = this.data.headers.length;
		const rowCount = this.data.rows.length;

		if (e.key === 'Tab') {
			e.preventDefault();
			if (!e.shiftKey) {
				// Next cell
				if (colIdx + 1 < colCount) {
					this.focusCell(rowIdx, colIdx + 1);
				} else if (rowIdx + 1 < rowCount) {
					this.focusCell(rowIdx + 1, 0);
				} else {
					this.addRow(true);
				}
			} else {
				// Previous cell
				if (colIdx - 1 >= 0) {
					this.focusCell(rowIdx, colIdx - 1);
				} else if (rowIdx - 1 >= -1) {
					this.focusCell(rowIdx - 1, colCount - 1);
				}
			}
		} else if (e.key === 'Enter' || e.key === 'ArrowDown') {
			e.preventDefault();
			if (rowIdx + 1 < rowCount) {
				this.focusCell(rowIdx + 1, colIdx);
			} else if (e.key === 'Enter') {
				this.addRow(true, colIdx);
			}
		} else if (e.key === 'ArrowUp') {
			if (rowIdx > -1) {
				e.preventDefault();
				this.focusCell(rowIdx - 1, colIdx);
			}
		}
	}

	public focusCell(rowIdx: number, colIdx: number): void {
		if (rowIdx === -1) {
			const target = this.headerInputs[colIdx];
			if (target) {
				target.focus();
				target.select();
			}
		} else {
			const target = this.bodyInputs[rowIdx]?.[colIdx];
			if (target) {
				target.focus();
				target.select();
			}
		}
	}

	private addRow(focusNewRow = false, targetCol = 0): void {
		const colCount = this.data.headers.length;
		this.data.rows.push(Array.from({ length: colCount }, () => ''));
		this.commitTableData();
		this.buildDOM();
		if (focusNewRow) {
			const lastRowIdx = this.data.rows.length - 1;
			window.requestAnimationFrame(() => {
				this.focusCell(lastRowIdx, targetCol);
			});
		}
	}

	private addColumn(): void {
		const nextColNum = this.data.headers.length + 1;
		this.data.headers.push(`Colonne ${nextColNum}`);
		this.data.alignments.push(null);
		for (const r of this.data.rows) {
			r.push('');
		}
		this.commitTableData();
		this.buildDOM();
		window.requestAnimationFrame(() => {
			this.focusCell(-1, nextColNum - 1);
		});
	}

	private removeLastRow(): void {
		if (this.data.rows.length <= 1) return;
		this.data.rows.pop();
		this.commitTableData();
		this.buildDOM();
	}

	private removeLastColumn(): void {
		if (this.data.headers.length <= 1) return;
		this.data.headers.pop();
		this.data.alignments.pop();
		for (const r of this.data.rows) {
			r.pop();
		}
		this.commitTableData();
		this.buildDOM();
	}

	private commitTableData(): void {
		const nextRaw = serializeMarkdownTable(this.data);
		this.commitRawMarkdown(nextRaw);
	}

	private commitRawMarkdown(nextRaw: string): void {
		if (nextRaw === this.rawMarkdown) return;
		const oldLen = this.rawMarkdown.length;
		this.rawMarkdown = nextRaw;
		const safeFrom = Math.max(0, Math.min(this.from, this.view.state.doc.length));
		const safeTo = Math.max(safeFrom, Math.min(this.from + oldLen, this.view.state.doc.length));
		this.to = safeFrom + nextRaw.length;

		this.isDispatching = true;
		try {
			this.view.dispatch({
				changes: { from: safeFrom, to: safeTo, insert: nextRaw },
				userEvent: 'input.type',
			});
		} finally {
			this.isDispatching = false;
		}
	}

	public updateFromView(newRaw: string, newFrom: number, newTo: number, view: EditorView): void {
		this.from = newFrom;
		this.to = newTo;
		this.view = view;
		if (this.isDispatching || newRaw === this.rawMarkdown) return;

		this.rawMarkdown = newRaw;
		this.data = parseMarkdownTable(newRaw);

		if (this.isRawMode && this.rawTextarea) {
			this.rawTextarea.value = newRaw;
			return;
		}

		if (
			this.headerInputs.length !== this.data.headers.length ||
			this.bodyInputs.length !== this.data.rows.length
		) {
			this.buildDOM();
			return;
		}

		for (let c = 0; c < this.data.headers.length; c++) {
			const inp = this.headerInputs[c];
			if (inp && inp.value !== this.data.headers[c]) {
				inp.value = this.data.headers[c]!;
			}
		}
		for (let r = 0; r < this.data.rows.length; r++) {
			for (let c = 0; c < this.data.headers.length; c++) {
				const inp = this.bodyInputs[r]?.[c];
				const val = this.data.rows[r]?.[c] ?? '';
				if (inp && inp.value !== val) {
					inp.value = val;
				}
			}
		}
	}
}

const tableControllersByDom = new WeakMap<HTMLElement, VisualTableController>();
const tableControllersByView = new WeakMap<EditorView, Map<number, VisualTableController>>();

export class VisualTableWidget extends WidgetType {
	constructor(
		public readonly rawMarkdown: string,
		public readonly from: number,
		public readonly to: number,
		public readonly tableIndex: number,
	) {
		super();
	}

	eq(other: VisualTableWidget): boolean {
		return (
			other.tableIndex === this.tableIndex &&
			other.rawMarkdown === this.rawMarkdown &&
			other.from === this.from &&
			other.to === this.to
		);
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const ctrl = tableControllersByDom.get(dom);
		if (!ctrl || ctrl.tableIndex !== this.tableIndex) return false;
		ctrl.updateFromView(this.rawMarkdown, this.from, this.to, view);
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		let map = tableControllersByView.get(view);
		if (!map) {
			map = new Map<number, VisualTableController>();
			tableControllersByView.set(view, map);
		}
		const existing = map.get(this.tableIndex);
		if (existing && !existing.rootEl.isConnected) {
			existing.updateFromView(this.rawMarkdown, this.from, this.to, view);
			return existing.rootEl;
		}
		const ctrl = new VisualTableController(
			this.rawMarkdown,
			this.from,
			this.to,
			this.tableIndex,
			view,
		);
		tableControllersByDom.set(ctrl.rootEl, ctrl);
		map.set(this.tableIndex, ctrl);
		return ctrl.rootEl;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/* ==========================================================================
   2. Media Embed Widget (Image, Vidéo, Audio, Fichier avec contrôles réels)
   ========================================================================== */

export class VisualMediaEmbedWidget extends WidgetType {
	private isEditingRaw = false;

	constructor(
		public readonly embed: ParsedMediaEmbed,
		public readonly lineFrom: number,
		public readonly lineTo: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	eq(other: VisualMediaEmbedWidget): boolean {
		return (
			other.embed.raw === this.embed.raw &&
			other.lineFrom === this.lineFrom &&
			other.lineTo === this.lineTo
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = `inkwell-visual-media-root is-${this.embed.kind}`;
		wrap.setAttribute('contenteditable', 'false');
		wrap.addEventListener('mousedown', (e) => e.stopPropagation());

		const renderContent = () => {
			while (wrap.firstChild) {
				wrap.removeChild(wrap.firstChild);
			}

			// Discreet source toggle button (</>)
			const srcBtn = document.createElement('button');
			srcBtn.type = 'button';
			srcBtn.className = 'inkwell-visual-media-source-btn';
			srcBtn.title = this.isEditingRaw
				? 'Revenir à l’aperçu du média'
				: 'Modifier le lien ou la taille du média';
			setIcon(srcBtn, this.isEditingRaw ? 'check' : 'code-2');
			srcBtn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.isEditingRaw = !this.isEditingRaw;
				renderContent();
			});
			wrap.appendChild(srcBtn);

			if (this.isEditingRaw) {
				const rawRow = document.createElement('div');
				rawRow.className = 'inkwell-visual-media-raw-row';
				const input = document.createElement('input');
				input.type = 'text';
				input.className = 'inkwell-visual-media-raw-input';
				input.value = this.embed.raw;
				const commit = () => {
					const nextVal = input.value.trim();
					if (nextVal && nextVal !== this.embed.raw) {
						const safeFrom = Math.max(0, Math.min(this.lineFrom, view.state.doc.length));
						const safeTo = Math.max(
							safeFrom,
							Math.min(this.lineTo, view.state.doc.length),
						);
						view.dispatch({
							changes: { from: safeFrom, to: safeTo, insert: nextVal },
							userEvent: 'input.type',
						});
					}
					this.isEditingRaw = false;
					renderContent();
				};
				input.addEventListener('keydown', (e) => {
					e.stopPropagation();
					if (e.key === 'Enter' || e.key === 'Escape') {
						e.preventDefault();
						commit();
					}
				});
				rawRow.appendChild(input);
				wrap.appendChild(rawRow);
				window.requestAnimationFrame(() => {
					input.focus();
					input.select();
				});
				return;
			}

			// Resolve file in vault if local
			const activeFile = this.plugin.app?.workspace?.getActiveFile?.();
			const sourcePath = activeFile?.path ?? '';
			let resourceUrl: string | null = null;
			let resolvedFile: TFile | null = null;

			if (
				this.embed.target.startsWith('http://') ||
				this.embed.target.startsWith('https://') ||
				this.embed.target.startsWith('data:')
			) {
				resourceUrl = this.embed.target;
			} else if (this.plugin.app?.metadataCache && this.plugin.app?.vault) {
				const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(
					this.embed.target,
					sourcePath,
				);
				if (dest instanceof TFile) {
					resolvedFile = dest;
					resourceUrl = this.plugin.app.vault.getResourcePath(dest);
				}
			}

			if (!resourceUrl) {
				const missingCard = document.createElement('div');
				missingCard.className = 'inkwell-visual-media-missing';
				const iconSpan = document.createElement('span');
				setIcon(iconSpan, 'file-question');
				missingCard.appendChild(iconSpan);
				const msgSpan = document.createElement('span');
				msgSpan.textContent = `Média introuvable dans le coffre : ${this.embed.target}`;
				missingCard.appendChild(msgSpan);
				wrap.appendChild(missingCard);
				return;
			}

			if (this.embed.kind === 'image') {
				const img = document.createElement('img');
				img.className = 'inkwell-visual-media-img';
				img.src = resourceUrl;
				img.alt = this.embed.aliasOrSize || this.embed.target;
				const numericWidth = /^\d+$/.exec(this.embed.aliasOrSize);
				if (numericWidth) {
					img.style.maxWidth = `${numericWidth[0]}px`;
				}
				wrap.appendChild(img);
			} else if (this.embed.kind === 'video') {
				const videoWrap = document.createElement('div');
				videoWrap.className = 'inkwell-visual-media-video-wrap';
				const video = document.createElement('video');
				video.className = 'inkwell-visual-media-video';
				video.controls = true;
				video.preload = 'metadata';
				video.src = resourceUrl;
				videoWrap.appendChild(video);
				const caption = document.createElement('div');
				caption.className = 'inkwell-visual-media-caption';
				caption.textContent = resolvedFile?.name ?? this.embed.target;
				videoWrap.appendChild(caption);
				wrap.appendChild(videoWrap);
			} else if (this.embed.kind === 'audio') {
				const audioCard = document.createElement('div');
				audioCard.className = 'inkwell-visual-media-audio-card';
				const header = document.createElement('div');
				header.className = 'inkwell-visual-media-audio-header';
				const iconSpan = document.createElement('span');
				iconSpan.className = 'inkwell-visual-media-audio-icon';
				setIcon(iconSpan, 'music');
				header.appendChild(iconSpan);
				const nameSpan = document.createElement('span');
				nameSpan.className = 'inkwell-visual-media-audio-name';
				nameSpan.textContent = resolvedFile?.name ?? this.embed.target;
				header.appendChild(nameSpan);
				audioCard.appendChild(header);

				const audio = document.createElement('audio');
				audio.className = 'inkwell-visual-media-audio';
				audio.controls = true;
				audio.preload = 'metadata';
				audio.src = resourceUrl;
				audioCard.appendChild(audio);
				wrap.appendChild(audioCard);
			} else {
				// Generic File Embed Card (PDF, archive, document) with Open control
				const fileCard = document.createElement('div');
				fileCard.className = 'inkwell-visual-media-file-card';

				const iconSpan = document.createElement('span');
				iconSpan.className = 'inkwell-visual-media-file-icon';
				setIcon(iconSpan, 'file-text');
				fileCard.appendChild(iconSpan);

				const infoCol = document.createElement('div');
				infoCol.className = 'inkwell-visual-media-file-info';
				const nameEl = document.createElement('div');
				nameEl.className = 'inkwell-visual-media-file-name';
				nameEl.textContent =
					this.embed.aliasOrSize || (resolvedFile?.name ?? this.embed.target);
				infoCol.appendChild(nameEl);

				if (resolvedFile) {
					const metaEl = document.createElement('div');
					metaEl.className = 'inkwell-visual-media-file-meta';
					const kb = Math.max(0.1, Math.round((resolvedFile.stat.size / 1024) * 10) / 10);
					metaEl.textContent = `${resolvedFile.extension.toUpperCase()} • ${kb} Ko`;
					infoCol.appendChild(metaEl);
				}
				fileCard.appendChild(infoCol);

				const openBtn = document.createElement('button');
				openBtn.type = 'button';
				openBtn.className = 'inkwell-visual-media-file-open-btn';
				openBtn.textContent = 'Ouvrir';
				openBtn.addEventListener('mousedown', (e) => {
					e.preventDefault();
					e.stopPropagation();
					void this.plugin.app.workspace.openLinkText(
						this.embed.target,
						sourcePath,
						false,
					);
				});
				fileCard.appendChild(openBtn);
				wrap.appendChild(fileCard);
			}
		};

		renderContent();
		return wrap;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/* ==========================================================================
   3. Math Equation ($$...$$) & Mermaid Diagram Widget (Aperçu + Édition source)
   ========================================================================== */

class VisualMathMermaidController {
	public readonly rootEl: HTMLElement;
	public readonly blockIndex: number;
	private kind: 'math' | 'mermaid';
	private rawBlock: string;
	private innerSource: string;
	private from: number;
	private to: number;
	private view: EditorView;
	private plugin: InkwellPlugin;
	private isEditingSource = false;
	private isDispatching = false;
	private previewContainerEl!: HTMLElement;
	private sourceTextarea: HTMLTextAreaElement | null = null;
	private renderComp: Component | null = null;

	constructor(
		kind: 'math' | 'mermaid',
		rawBlock: string,
		innerSource: string,
		from: number,
		to: number,
		blockIndex: number,
		view: EditorView,
		plugin: InkwellPlugin,
	) {
		this.kind = kind;
		this.rawBlock = rawBlock;
		this.innerSource = innerSource;
		this.from = from;
		this.to = to;
		this.blockIndex = blockIndex;
		this.view = view;
		this.plugin = plugin;

		this.rootEl = document.createElement('div');
		this.rootEl.className = `inkwell-visual-math-mermaid-root is-${kind}`;
		this.rootEl.setAttribute('contenteditable', 'false');

		const stopBubble = (e: Event) => e.stopPropagation();
		this.rootEl.addEventListener('keydown', stopBubble);
		this.rootEl.addEventListener('keyup', stopBubble);
		this.rootEl.addEventListener('keypress', stopBubble);
		this.rootEl.addEventListener('mousedown', (e) => e.stopPropagation());

		this.buildDOM();
	}

	private buildDOM(): void {
		while (this.rootEl.firstChild) {
			this.rootEl.removeChild(this.rootEl.firstChild);
		}
		this.sourceTextarea = null;

		const headerBar = document.createElement('div');
		headerBar.className = 'inkwell-visual-math-mermaid-header';

		const badge = document.createElement('span');
		badge.className = 'inkwell-visual-math-mermaid-badge';
		badge.textContent = this.kind === 'math' ? 'Équation (LaTeX)' : 'Diagramme Mermaid';
		headerBar.appendChild(badge);

		const toggleEditBtn = document.createElement('button');
		toggleEditBtn.type = 'button';
		toggleEditBtn.className = 'inkwell-visual-math-mermaid-edit-btn';
		toggleEditBtn.textContent = this.isEditingSource ? '✓ Terminer l’édition' : '✎ Éditer la source';
		toggleEditBtn.title = this.isEditingSource
			? 'Masquer l’éditeur de source et conserver uniquement l’aperçu'
			: this.kind === 'math'
				? 'Modifier la formule LaTeX sans afficher les délimiteurs $$'
				: 'Modifier le code du diagramme Mermaid sans afficher les délimiteurs ```';
		toggleEditBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.isEditingSource = !this.isEditingSource;
			this.buildDOM();
			if (this.isEditingSource && this.sourceTextarea) {
				this.sourceTextarea.focus();
			}
		});
		headerBar.appendChild(toggleEditBtn);
		this.rootEl.appendChild(headerBar);

		// Live Rendered Preview Container
		this.previewContainerEl = document.createElement('div');
		this.previewContainerEl.className = 'inkwell-visual-math-mermaid-preview';
		this.previewContainerEl.title = 'Cliquez pour modifier la source';
		this.previewContainerEl.addEventListener('click', (e) => {
			if (!this.isEditingSource) {
				e.preventDefault();
				e.stopPropagation();
				this.isEditingSource = true;
				this.buildDOM();
				this.sourceTextarea?.focus();
			}
		});
		this.rootEl.appendChild(this.previewContainerEl);
		this.renderPreview();

		if (this.isEditingSource) {
			const editorWrap = document.createElement('div');
			editorWrap.className = 'inkwell-visual-math-mermaid-editor-wrap';

			const area = document.createElement('textarea');
			area.className = 'inkwell-visual-math-mermaid-textarea';
			area.value = this.innerSource;
			area.rows = Math.max(2, this.innerSource.split('\n').length);
			area.placeholder =
				this.kind === 'math'
					? 'Saisissez votre équation LaTeX (ex: E = mc^2)…'
					: 'Saisissez votre diagramme Mermaid (ex: flowchart LR\n    A --> B)…';

			area.addEventListener('input', () => {
				this.innerSource = area.value;
				area.rows = Math.max(2, this.innerSource.split('\n').length);
				this.commitInnerSource();
				this.renderPreview();
			});

			area.addEventListener('keydown', (e) => {
				if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
					e.preventDefault();
					this.isEditingSource = false;
					this.buildDOM();
				}
			});

			editorWrap.appendChild(area);
			this.rootEl.appendChild(editorWrap);
			this.sourceTextarea = area;
		}
	}

	private renderPreview(): void {
		if (!this.previewContainerEl) return;
		while (this.previewContainerEl.firstChild) {
			this.previewContainerEl.removeChild(this.previewContainerEl.firstChild);
		}

		const trimmed = this.innerSource.trim();
		if (!trimmed) {
			const emptyEl = document.createElement('div');
			emptyEl.className = 'inkwell-visual-math-mermaid-empty';
			emptyEl.textContent =
				this.kind === 'math'
					? 'Équation vide — cliquez pour saisir une formule LaTeX'
					: 'Diagramme Mermaid vide — cliquez pour saisir du code Mermaid';
			this.previewContainerEl.appendChild(emptyEl);
			return;
		}

		const mdToRender =
			this.kind === 'math'
				? `$$\n${this.innerSource}\n$$`
				: `\`\`\`mermaid\n${this.innerSource}\n\`\`\``;

		const activeFile = this.plugin.app?.workspace?.getActiveFile?.();
		const sourcePath = activeFile?.path ?? '';

		if (this.plugin.app && typeof MarkdownRenderer?.render === 'function') {
			if (this.renderComp) {
				this.renderComp.unload();
			}
			this.renderComp = new Component();
			this.renderComp.load();
			void MarkdownRenderer.render(
				this.plugin.app,
				mdToRender,
				this.previewContainerEl,
				sourcePath,
				this.renderComp,
			);
		} else {
			const fallbackPre = document.createElement('pre');
			fallbackPre.textContent = this.innerSource;
			this.previewContainerEl.appendChild(fallbackPre);
		}
	}

	private commitInnerSource(): void {
		const nextRaw =
			this.kind === 'math'
				? `$$\n${this.innerSource}\n$$`
				: `\`\`\`mermaid\n${this.innerSource}\n\`\`\``;
		if (nextRaw === this.rawBlock) return;
		const oldLen = this.rawBlock.length;
		this.rawBlock = nextRaw;

		const safeFrom = Math.max(0, Math.min(this.from, this.view.state.doc.length));
		const safeTo = Math.max(safeFrom, Math.min(this.from + oldLen, this.view.state.doc.length));
		this.to = safeFrom + nextRaw.length;

		this.isDispatching = true;
		try {
			this.view.dispatch({
				changes: { from: safeFrom, to: safeTo, insert: nextRaw },
				userEvent: 'input.type',
			});
		} finally {
			this.isDispatching = false;
		}
	}

	public updateFromView(
		newRawBlock: string,
		newInnerSource: string,
		newFrom: number,
		newTo: number,
		view: EditorView,
	): void {
		this.from = newFrom;
		this.to = newTo;
		this.view = view;
		if (this.isDispatching || newRawBlock === this.rawBlock) return;

		this.rawBlock = newRawBlock;
		this.innerSource = newInnerSource;
		if (this.sourceTextarea && this.sourceTextarea.value !== newInnerSource) {
			this.sourceTextarea.value = newInnerSource;
		}
		this.renderPreview();
	}
}

const mathMermaidControllersByDom = new WeakMap<HTMLElement, VisualMathMermaidController>();
const mathMermaidControllersByView = new WeakMap<
	EditorView,
	Map<string, VisualMathMermaidController>
>();

export class VisualMathMermaidWidget extends WidgetType {
	constructor(
		public readonly kind: 'math' | 'mermaid',
		public readonly rawBlock: string,
		public readonly innerSource: string,
		public readonly from: number,
		public readonly to: number,
		public readonly blockIndex: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	eq(other: VisualMathMermaidWidget): boolean {
		return (
			other.kind === this.kind &&
			other.blockIndex === this.blockIndex &&
			other.rawBlock === this.rawBlock &&
			other.from === this.from &&
			other.to === this.to
		);
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const ctrl = mathMermaidControllersByDom.get(dom);
		if (!ctrl || ctrl.blockIndex !== this.blockIndex) return false;
		ctrl.updateFromView(this.rawBlock, this.innerSource, this.from, this.to, view);
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		let map = mathMermaidControllersByView.get(view);
		if (!map) {
			map = new Map<string, VisualMathMermaidController>();
			mathMermaidControllersByView.set(view, map);
		}
		const key = `${this.kind}-${this.blockIndex}`;
		const existing = map.get(key);
		if (existing && !existing.rootEl.isConnected) {
			existing.updateFromView(this.rawBlock, this.innerSource, this.from, this.to, view);
			return existing.rootEl;
		}
		const ctrl = new VisualMathMermaidController(
			this.kind,
			this.rawBlock,
			this.innerSource,
			this.from,
			this.to,
			this.blockIndex,
			view,
			this.plugin,
		);
		mathMermaidControllersByDom.set(ctrl.rootEl, ctrl);
		map.set(key, ctrl);
		return ctrl.rootEl;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/* ==========================================================================
   4. Dynamic Table of Contents Widget inside Columns (> [!toc])
   ========================================================================== */

export class VisualColumnTocWidget extends WidgetType {
	constructor(
		public readonly title: string,
		public readonly from: number,
		public readonly to: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	eq(other: VisualColumnTocWidget): boolean {
		return other.title === this.title && other.from === this.from && other.to === this.to;
	}

	toDOM(view: EditorView): HTMLElement {
		const card = document.createElement('div');
		card.className = 'inkwell-visual-toc-col-card';
		card.setAttribute('contenteditable', 'false');
		card.addEventListener('mousedown', (e) => e.stopPropagation());

		const header = document.createElement('div');
		header.className = 'inkwell-visual-toc-header';

		const iconEl = document.createElement('span');
		iconEl.className = 'inkwell-visual-toc-icon';
		setIcon(iconEl, 'list');
		header.appendChild(iconEl);

		const titleEl = document.createElement('span');
		titleEl.className = 'inkwell-visual-toc-title';
		titleEl.textContent = this.title.trim() || 'Table des matières';
		header.appendChild(titleEl);

		const badgeEl = document.createElement('span');
		badgeEl.className = 'inkwell-visual-toc-badge';
		badgeEl.textContent = 'Dynamique';
		header.appendChild(badgeEl);

		const freezeBtn = document.createElement('button');
		freezeBtn.type = 'button';
		freezeBtn.className = 'inkwell-visual-toc-freeze-btn';
		freezeBtn.textContent = 'Statique';
		freezeBtn.title = 'Convertir en liste statique de liens [[#Titre]]';
		freezeBtn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const leaf = this.plugin.app?.workspace?.getActiveViewOfType?.(MarkdownView);
			const fullText = leaf?.editor?.getValue?.() ?? view.state.doc.toString();
			const headings = extractHeadingsFromDoc(fullText);
			const staticMd = buildTableOfContentsMarkdown(headings).trimEnd();
			const safeFrom = Math.max(0, Math.min(this.from, view.state.doc.length));
			const safeTo = Math.max(safeFrom, Math.min(this.to, view.state.doc.length));
			view.dispatch({
				changes: { from: safeFrom, to: safeTo, insert: staticMd },
				userEvent: 'input.type',
			});
		});
		header.appendChild(freezeBtn);
		card.appendChild(header);

		const listEl = document.createElement('div');
		listEl.className = 'inkwell-visual-toc-list';
		card.appendChild(listEl);

		const leaf = this.plugin.app?.workspace?.getActiveViewOfType?.(MarkdownView);
		const fullText = leaf?.editor?.getValue?.() ?? view.state.doc.toString();
		const headings = extractHeadingsFromDoc(fullText);

		if (headings.length === 0) {
			const emptyEl = document.createElement('div');
			emptyEl.className = 'inkwell-visual-toc-empty';
			emptyEl.textContent = 'Aucun titre dans cette note.';
			listEl.appendChild(emptyEl);
		} else {
			const minLevel = Math.min(...headings.map((h) => h.level));
			for (const item of headings) {
				const rowBtn = document.createElement('button');
				rowBtn.type = 'button';
				rowBtn.className = `inkwell-visual-toc-item is-level-${item.level}`;
				const indentPx = Math.max(0, (item.level - minLevel) * 14);
				rowBtn.style.paddingLeft = `${6 + indentPx}px`;

				const bullet = document.createElement('span');
				bullet.className = 'inkwell-visual-toc-bullet';
				bullet.textContent = '•';
				rowBtn.appendChild(bullet);

				const textSpan = document.createElement('span');
				textSpan.className = 'inkwell-visual-toc-item-text';
				textSpan.textContent = cleanHeadingDisplayText(item.heading) || item.heading;
				rowBtn.appendChild(textSpan);

				rowBtn.addEventListener('mousedown', (e) => {
					e.preventDefault();
					e.stopPropagation();
					const rootCm = (leaf?.editor as unknown as { cm?: EditorView })?.cm;
					if (rootCm && item.lineNumber && item.lineNumber <= rootCm.state.doc.lines) {
						const targetLine = rootCm.state.doc.line(item.lineNumber);
						rootCm.dispatch({
							selection: EditorSelection.cursor(targetLine.to),
							scrollIntoView: true,
						});
						rootCm.focus();
					}
				});

				listEl.appendChild(rowBtn);
			}
		}

		return card;
	}

	ignoreEvent(): boolean {
		return true;
	}
}
