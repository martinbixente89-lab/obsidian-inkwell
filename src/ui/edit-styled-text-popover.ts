import { Editor, Notice } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	analyzeStyledSpanTarget,
	StyledSpanTarget,
} from '../editor/styled-text-target';
import { encodeHtmlEntities } from '../utils/html-entities';

export interface EditStyledTextCapture {
	filePath: string;
	editor: Editor;
	lineNo: number;
	originalLineText: string;
	target: StyledSpanTarget;
}

export class EditStyledTextPopover {
	private plugin: InkwellPlugin;
	private popoverEl: HTMLElement | null = null;
	private capture: EditStyledTextCapture | null = null;
	private outsideClickListener: ((e: MouseEvent) => void) | null = null;
	private activeFileChangeListener: (() => void) | null = null;

	constructor(plugin: InkwellPlugin) {
		this.plugin = plugin;
	}

	public isOpen(): boolean {
		return this.popoverEl !== null;
	}

	/**
	 * Tente d'ouvrir la bulle « Modifier le passage entier » sur l'éditeur actif.
	 */
	public open(editor: Editor, anchorEl?: HTMLElement | null): boolean {
		this.close(false);

		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('Aucun fichier actif.');
			return false;
		}

		const cursor = editor.getCursor();
		const selection = editor.listSelections()[0];
		const from = selection ? selection.anchor : cursor;
		const to = selection ? selection.head : cursor;

		// Si multi-lignes, refuser
		if (from.line !== to.line) {
			new Notice('La sélection s’étend sur plusieurs lignes. Veuillez cibler un seul passage.');
			return false;
		}

		const lineNo = from.line;
		const lineText = editor.getLine(lineNo);
		const fromCh = from.ch;
		const toCh = to.ch;

		const analysis = analyzeStyledSpanTarget(lineText, fromCh, toCh);
		if (!analysis.success || !analysis.target) {
			new Notice(analysis.reason ?? 'Ciblage impossible.');
			return false;
		}

		this.capture = {
			filePath: activeFile.path,
			editor,
			lineNo,
			originalLineText: lineText,
			target: analysis.target,
		};

		this.createDOM(anchorEl);
		return true;
	}

	private createDOM(anchorEl?: HTMLElement | null): void {
		if (!this.capture) return;

		const doc = activeWindow.document;
		const popover = doc.createElement('div');
		popover.className = 'inkwell-toolbar-popover inkwell-edit-text-popover';
		popover.setAttribute('role', 'dialog');
		popover.setAttribute('aria-label', 'Modifier le passage entier');

		// Empêcher les clics dans la bulle de fermer la bulle
		popover.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});

		// 1. Titre informatif
		const title = doc.createElement('div');
		title.className = 'inkwell-edit-title';
		title.textContent = 'Modifier le passage entier';
		popover.appendChild(title);

		// 2. Champ de saisie
		const input = doc.createElement('input');
		input.type = 'text';
		input.className = 'inkwell-edit-input';
		input.value = this.capture.target.visibleText;
		popover.appendChild(input);

		// 3. Boutons d'action
		const actions = doc.createElement('div');
		actions.className = 'inkwell-edit-actions';

		const btnCancel = doc.createElement('button');
		btnCancel.className = 'inkwell-edit-btn-cancel';
		btnCancel.textContent = 'Annuler';
		btnCancel.addEventListener('click', (e) => {
			e.preventDefault();
			this.close(true);
		});
		actions.appendChild(btnCancel);

		const btnApply = doc.createElement('button');
		btnApply.className = 'inkwell-edit-btn-apply mod-cta';
		btnApply.textContent = 'Appliquer';
		btnApply.addEventListener('click', (e) => {
			e.preventDefault();
			this.apply(input.value);
		});
		actions.appendChild(btnApply);

		popover.appendChild(actions);

		// Gestion clavier avec protection stricte de la composition IME (Japonais / accents)
		input.addEventListener('keydown', (e) => {
			const isComposing = e.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229;
			if (e.key === 'Enter') {
				if (isComposing) {
					// En cours de composition IME : ne pas déclencher Appliquer
					return;
				}
				e.preventDefault();
				this.apply(input.value);
			} else if (e.key === 'Escape') {
				if (isComposing) {
					// En cours de composition IME : Échap annule la composition sans fermer la bulle
					return;
				}
				e.preventDefault();
				this.close(true);
			}
		});

		doc.body.appendChild(popover);
		this.popoverEl = popover;

		// Positionnement
		this.positionPopover(popover, anchorEl);

		// Focus et sélection immédiate du texte
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 10);

		// Écouteur clic extérieur (ferme sans voler le focus)
		this.outsideClickListener = (e: MouseEvent) => {
			const target = e.target as Node | null;
			if (popover && target && !popover.contains(target)) {
				this.close(false);
			}
		};
		doc.addEventListener('mousedown', this.outsideClickListener, true);

		// Surveillance changement de fichier actif
		this.activeFileChangeListener = () => {
			this.close(false);
		};
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', this.activeFileChangeListener),
		);
	}

	private positionPopover(popover: HTMLElement, anchorEl?: HTMLElement | null): void {
		const margin = 8;
		let anchorRect: DOMRect | null = null;

		if (anchorEl) {
			anchorRect = anchorEl.getBoundingClientRect();
		} else if (this.capture) {
			const ed = this.capture.editor as unknown as {
				cursorCoords?: (flag: boolean, mode: string) => { left: number; bottom: number } | null;
			};
			const coords = typeof ed.cursorCoords === 'function' ? ed.cursorCoords(true, 'window') : null;
			if (coords) {
				anchorRect = new DOMRect(coords.left, coords.bottom, 2, 16);
			}
		}

		if (!anchorRect) {
			popover.setCssProps({ top: '100px', left: '100px' });
			return;
		}

		const popoverRect = popover.getBoundingClientRect();
		let top = anchorRect.bottom + margin;
		let left = anchorRect.left;

		// Si débordement en bas, afficher au-dessus
		if (top + popoverRect.height > window.innerHeight - margin) {
			top = Math.max(margin, anchorRect.top - popoverRect.height - margin);
		}

		// Clamping horizontal
		if (left + popoverRect.width > window.innerWidth - margin) {
			left = window.innerWidth - popoverRect.width - margin;
		}
		left = Math.max(margin, left);

		popover.setCssProps({ top: `${top}px`, left: `${left}px` });
	}

	public apply(newVisibleText: string): boolean {
		if (!this.capture) return false;

		const { filePath, editor, lineNo, originalLineText, target } = this.capture;

		// 1. Contrôle d'identité du fichier
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (!activeFile || activeFile.path !== filePath) {
			new Notice('Le fichier actif a changé. Action annulée pour protéger vos données.');
			this.close(false);
			return false;
		}

		// 2. Contrôle de concurrence sur le contenu de la ligne
		const currentLineText = editor.getLine(lineNo);
		if (currentLineText !== originalLineText) {
			new Notice('La note a été modifiée entre-temps. Action annulée pour protéger vos données.');
			this.close(false);
			return false;
		}

		// 3. Texte inchangé : pas de transaction inutile
		if (newVisibleText === target.visibleText) {
			// Sélectionner le texte visible sans les balises
			editor.setSelection(
				{ line: lineNo, ch: target.innerStart },
				{ line: lineNo, ch: target.innerEnd },
			);
			this.close(true);
			return true;
		}

		// 4. Champ vidé : supprimer le span s'il ne possède que data-inkwell et color
		if (newVisibleText.trim() === '') {
			editor.transaction({
				changes: [
					{
						from: { line: lineNo, ch: target.spanStart },
						to: { line: lineNo, ch: target.spanEnd },
						text: '',
					},
				],
				selection: {
					from: { line: lineNo, ch: target.spanStart },
					to: { line: lineNo, ch: target.spanStart },
				},
			});
			this.close(true);
			return true;
		}

		// 5. Remplacement avec encodage des entités
		const encoded = encodeHtmlEntities(newVisibleText);
		const replacement = `${target.openTag}${encoded}${target.closeTag}`;

		const newInnerStart = target.spanStart + target.openTag.length;
		const newInnerEnd = newInnerStart + encoded.length;

		editor.transaction({
			changes: [
				{
					from: { line: lineNo, ch: target.spanStart },
					to: { line: lineNo, ch: target.spanEnd },
					text: replacement,
				},
			],
			selection: {
				from: { line: lineNo, ch: newInnerStart },
				to: { line: lineNo, ch: newInnerEnd },
			},
		});

		this.close(true);
		return true;
	}

	public cancel(): void {
		this.close(true);
	}

	public close(restoreFocus: boolean): void {
		const doc = activeWindow.document;
		if (this.outsideClickListener) {
			doc.removeEventListener('mousedown', this.outsideClickListener, true);
			this.outsideClickListener = null;
		}

		if (this.popoverEl) {
			this.popoverEl.remove();
			this.popoverEl = null;
		}

		const editor = this.capture?.editor;
		this.capture = null;

		if (restoreFocus && editor) {
			editor.focus();
		}
	}
}
