import {
	Editor,
	MarkdownView,
	Notice,
	setIcon,
	setTooltip,
} from 'obsidian';
import type InkwellPlugin from '../main';
import { clearInkwellFormatting } from '../commands/clear-styles';
import {
	CapturedEditorSelection,
	captureSelectionState,
} from '../commands/selection-state';
import {
	applyColorToCapturedRange,
	setSelectionColor,
} from '../commands/text-color';
import {
	applyHighlightToCapturedRange,
	removeHighlightAppearanceFromCapturedRange,
	setSelectionHighlight,
} from '../commands/text-highlight';
import { applySizeToCapturedRange } from '../commands/text-size';
import { applyFontFamilyToCapturedRange } from '../commands/font-family';
import { applyHeadingToCapturedRange, getLineHeadingLevel } from '../commands/heading';
import { loadAllCustomFonts, loadFontItemIntoDocument } from '../fonts/font-manager';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import { HighlightAppearance, parseLine, transformLine, OperationType } from '../format/color-spans';
import { getLineSyntaxInfo } from '../format/syntax-helper';
import {
	COMMON_PT_SIZES,
	HEADING_OPTIONS,
} from '../utils/constants';
import {
	analyzeSelectionFormatting,
	FormatType,
} from '../format/markdown-formats';
import { addRecentColor } from '../palette/palette-manager';
import { evaluateColorContrast, resolveEffectiveThemeBackground } from '../palette/contrast';
import {
	calculatePopoverPosition,
	calculateToolbarPosition,
	Rect,
} from './toolbar-positioning';
import {
	CustomColorPickerModal,
	SaveToPaletteConfig,
} from './custom-color-modal';
import { isFormattingSpan } from '../editor/tag-navigation/simple-spans';

export type SelectionSupportStatus =
	| { type: 'valid'; captured: CapturedEditorSelection }
	| { type: 'disabled'; reason: 'link' | 'unmarked_span'; explanation: string; captured: CapturedEditorSelection }
	| { type: 'hidden' };

export class FloatingToolbarManager {
	private plugin: InkwellPlugin;
	private tracker: EmbedSelectionTracker;
	private toolbarEl: HTMLElement | null = null;
	private popoverEl: HTMLElement | null = null;
	private activePopover: 'color' | 'highlight' | 'size' | 'font' | 'cleanup' | null = null;
	private activePaletteTab: 'palette' | 'favorites' | 'recents' = 'palette';

	private capturedSelection: CapturedEditorSelection | null = null;
	private currentEditor: Editor | null = null;
	private currentFilePath: string | null = null;

	private dismissedKey: string | null = null;
	private isMouseDown = false;
	private buttons: HTMLButtonElement[] = [];
	private formatButtons: Partial<Record<FormatType, HTMLButtonElement>> = {};
	private focusedButtonIndex = 0;
	private isDestroyed = false;

	constructor(plugin: InkwellPlugin, tracker: EmbedSelectionTracker) {
		this.plugin = plugin;
		this.tracker = tracker;
		this.buildToolbarDOM();
		this.registerListeners();
	}

	private buildToolbarDOM(): void {
		const doc = activeWindow.document;
		this.toolbarEl = doc.createElement('div');
		this.toolbarEl.className = 'inkwell-floating-toolbar is-hidden';
		this.toolbarEl.setAttribute('role', 'toolbar');
		this.toolbarEl.setAttribute('aria-label', 'Barre d’outils Inkwell');

		// Prevent mousedown from collapsing DOM selection or blurring editor
		this.toolbarEl.addEventListener('mousedown', (e) => {
			e.preventDefault();
		});

		this.toolbarEl.addEventListener('keydown', (e) => {
			this.handleToolbarKeyDown(e);
		});

		// Group 1: Text formatting (Bold, Italic, Underline, Strikethrough)
		const grpFormat = this.createGroup('Mise en forme');
		const btnBold = this.createButton(
			'lucide-bold',
			'Gras',
			() => this.executeToggleFormat('bold'),
			grpFormat,
		);
		const btnItalic = this.createButton(
			'lucide-italic',
			'Italique',
			() => this.executeToggleFormat('italic'),
			grpFormat,
		);
		const btnUnderline = this.createButton(
			'lucide-underline',
			'Souligné',
			() => this.executeToggleFormat('underline'),
			grpFormat,
		);
		const btnStrikethrough = this.createButton(
			'lucide-strikethrough',
			'Barré',
			() => this.executeToggleFormat('strikethrough'),
			grpFormat,
		);
		this.formatButtons = {
			bold: btnBold,
			italic: btnItalic,
			underline: btnUnderline,
			strikethrough: btnStrikethrough,
		};

		this.addSeparator();

		// Group 2: Inkwell styles (Color, Highlight, Size, Font)
		const grpStyles = this.createGroup('Styles');
		const btnColor = this.createButton(
			'lucide-palette',
			'Couleur du texte',
			() => this.togglePopover('color'),
			grpStyles,
		);
		const btnHighlight = this.createButton(
			'lucide-highlighter',
			'Surlignage',
			() => this.togglePopover('highlight'),
			grpStyles,
		);
		const btnSize = this.createButton(
			'lucide-type',
			'Taille / titres',
			() => this.togglePopover('size'),
			grpStyles,
		);
		const btnFontFamily = this.createButton(
			'lucide-case-sensitive',
			'Police',
			() => this.togglePopover('font'),
			grpStyles,
		);

		this.addSeparator();

		// Group 3: Contextual edit
		const grpEdit = this.createGroup('Édition');
		const btnEditText = this.createButton(
			'lucide-pencil',
			'Modifier le passage entier',
			() => {
				if (this.currentEditor) {
					this.plugin.editPopover.open(this.currentEditor, btnEditText);
				}
			},
			grpEdit,
		);

		this.addSeparator();

		// Group 4: Cleanup
		const grpCleanup = this.createGroup('Nettoyage');
		const btnCleanupMenu = this.createButton(
			'lucide-eraser',
			'Retirer un style (couleur, surlignage)',
			() => this.togglePopover('cleanup'),
			grpCleanup,
		);
		const btnClearAll = this.createButton(
			'lucide-remove-formatting',
			'Retirer tous les styles Inkwell',
			() => this.executeClearAll(),
			grpCleanup,
		);

		this.buttons = [
			btnBold,
			btnItalic,
			btnUnderline,
			btnStrikethrough,
			btnColor,
			btnHighlight,
			btnSize,
			btnFontFamily,
			btnEditText,
			btnCleanupMenu,
			btnClearAll,
		];

		this.updateRovingTabIndex(0);
		doc.body.appendChild(this.toolbarEl);
	}

	private createGroup(label: string): HTMLElement {
		const grp = activeWindow.document.createElement('div');
		grp.className = 'inkwell-toolbar-group';
		grp.setAttribute('role', 'group');
		grp.setAttribute('aria-label', label);
		this.toolbarEl?.appendChild(grp);
		return grp;
	}

	private createButton(
		iconId: string,
		title: string,
		onClick: () => void,
		container?: HTMLElement,
	): HTMLButtonElement {
		const btn = activeWindow.document.createElement('button');
		btn.className = 'inkwell-toolbar-btn';
		btn.setAttribute('type', 'button');
		btn.setAttribute('aria-label', title);
		btn.setAttribute('tabindex', '-1');
		btn.dataset.defaultTitle = title;
		setIcon(btn, iconId);
		setTooltip(btn, title);

		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!btn.disabled) {
				onClick();
			}
		});

		(container ?? this.toolbarEl)?.appendChild(btn);
		return btn;
	}

	private addSeparator(): void {
		const sep = activeWindow.document.createElement('div');
		sep.className = 'inkwell-toolbar-separator';
		sep.setAttribute('role', 'separator');
		this.toolbarEl?.appendChild(sep);
	}

	private updateRovingTabIndex(newIndex: number): void {
		this.focusedButtonIndex = Math.max(0, Math.min(newIndex, this.buttons.length - 1));
		this.buttons.forEach((btn, idx) => {
			btn.tabIndex = idx === this.focusedButtonIndex ? 0 : -1;
		});
	}

	private registerListeners(): void {
		const doc = activeWindow.document;

		const onSelectionChange = () => {
			if (this.isMouseDown) return;
			this.update();
		};

		const onMouseDown = (e: MouseEvent) => {
			this.isMouseDown = true;
			// Close popover if clicked outside both popover and toolbar
			if (
				this.popoverEl &&
				!this.popoverEl.contains(e.target as Node) &&
				!this.toolbarEl?.contains(e.target as Node)
			) {
				this.closePopover();
			}
		};

		const onMouseUp = () => {
			this.isMouseDown = false;
			this.update();
		};

		const onScroll = () => {
			if (!this.isVisible()) return;
			this.reposition();
		};

		const onResize = () => {
			if (!this.isVisible()) return;
			this.reposition();
		};

		doc.addEventListener('selectionchange', onSelectionChange);
		doc.addEventListener('mousedown', onMouseDown);
		doc.addEventListener('mouseup', onMouseUp);
		activeWindow.addEventListener('scroll', onScroll, { capture: true, passive: true });
		activeWindow.addEventListener('resize', onResize, { passive: true });

		this.plugin.register(() => {
			doc.removeEventListener('selectionchange', onSelectionChange);
			doc.removeEventListener('mousedown', onMouseDown);
			doc.removeEventListener('mouseup', onMouseUp);
			activeWindow.removeEventListener('scroll', onScroll, { capture: true });
			activeWindow.removeEventListener('resize', onResize);
		});

		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', () => this.hide()),
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => this.hide()),
		);
	}

	public isVisible(): boolean {
		return !!this.toolbarEl && !this.toolbarEl.classList.contains('is-hidden');
	}

	public focus(): void {
		if (!this.isVisible() || this.buttons.length === 0) {
			new Notice('La barre d’outils Inkwell n’est pas visible.');
			return;
		}
		const targetBtn = this.buttons[this.focusedButtonIndex] ?? this.buttons[0];
		targetBtn?.focus();
	}

	public onSettingChanged(): void {
		if (!this.plugin.settings.toolbarEnabled) {
			this.hide();
		} else {
			this.update();
		}
	}

	public hide(): void {
		this.closePopover();
		if (this.toolbarEl) {
			this.toolbarEl.classList.add('is-hidden');
		}
		this.capturedSelection = null;
		this.currentEditor = null;
		this.currentFilePath = null;
	}

	public destroy(): void {
		this.isDestroyed = true;
		this.hide();
		this.toolbarEl?.remove();
		this.popoverEl?.remove();
		this.toolbarEl = null;
		this.popoverEl = null;
	}

	public update(): void {
		if (this.isDestroyed || !this.plugin.settings.toolbarEnabled) {
			this.hide();
			return;
		}

		const validation = this.validateCurrentSelection();
		if (validation.type === 'hidden') {
			this.hide();
			return;
		}

		const selKey = `${validation.captured.filePath}:${validation.captured.lineNo}:${validation.captured.fromCh}-${validation.captured.toCh}`;
		if (this.dismissedKey && this.dismissedKey === selKey) {
			// User dismissed the toolbar for this exact selection range via Escape
			return;
		}
		if (this.dismissedKey && this.dismissedKey !== selKey) {
			this.dismissedKey = null;
		}

		this.capturedSelection = validation.captured;
		this.currentEditor = validation.captured.editor;
		this.currentFilePath = validation.captured.filePath;

		this.applyButtonStates(validation);
		this.reposition();
		this.toolbarEl?.classList.remove('is-hidden');
	}

	private validateCurrentSelection(): SelectionSupportStatus {
		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!leaf) return { type: 'hidden' };

		// Strictly Live Preview: edit mode with sourceMode === false
		const isLivePreview =
			leaf.getMode() === 'source' && (leaf.currentMode as unknown as { sourceMode?: boolean }).sourceMode === false;
		if (!isLivePreview) return { type: 'hidden' };

		const editor = leaf.editor;
		const activeFile = this.plugin.app.workspace.getActiveFile();
		const captured = captureSelectionState(editor, this.tracker, activeFile?.path ?? null);

		if (!captured.hasSelection) return { type: 'hidden' };

		// Multiline selection: do not show toolbar
		if (captured.lineNo !== captured.targetToLine) return { type: 'hidden' };

		// Check links
		const view = (editor as Editor & { cm?: { state: { doc: { line: (n: number) => { from: number; to: number } } } } }).cm;
		if (view) {
			const lineObj = view.state.doc.line(captured.lineNo + 1);
			const syntax = getLineSyntaxInfo(view as never, lineObj.from, lineObj.to);
			const crossesLink =
				syntax.wikilinks.some((w) => captured.toCh > w.from && captured.fromCh < w.to) ||
				syntax.links.some((l) => captured.toCh > l.from && captured.fromCh < l.to);

			if (crossesLink) {
				return {
					type: 'disabled',
					reason: 'link',
					explanation: 'Les liens ne peuvent pas être modifiés par Inkwell.',
					captured,
				};
			}
		}

		// Check unmarked spans
		const parsed = parseLine(captured.lineText);
		const minRaw = Math.min(captured.fromCh, captured.toCh);
		const maxRaw = Math.max(captured.fromCh, captured.toCh);

		for (const seg of parsed) {
			if (seg.isUnmarked) {
				const attrMatch = seg.raw?.match(/<span\b([^>]*)>/i);
				if (attrMatch) {
					const { isFormatting } = isFormattingSpan(attrMatch[1] ?? '');
					if (isFormatting) {
						// Compatible legacy formatting span without data-inkwell="1": supported by Inkwell
						continue;
					}
				}
				const rawHit = maxRaw > seg.rawStart && minRaw < seg.rawEnd;
				const contentHit =
					captured.toCh > seg.contentStart &&
					captured.fromCh < seg.contentStart + seg.text.length;
				if (rawHit || contentHit) {
					return {
						type: 'disabled',
						reason: 'unmarked_span',
						explanation:
							'Cette sélection chevauche une balise HTML non gérée. Utilisez la commande d’adoption.',
						captured,
					};
				}
			}
		}

		return { type: 'valid', captured };
	}

	private applyButtonStates(validation: SelectionSupportStatus): void {
		if (validation.type === 'disabled') {
			this.buttons.forEach((btn) => {
				btn.disabled = true;
				btn.classList.add('is-disabled');
				setTooltip(btn, validation.explanation);
			});
			this.closePopover();
		} else if (validation.type === 'valid') {
			this.buttons.forEach((btn) => {
				btn.disabled = false;
				btn.classList.remove('is-disabled');
				const title = btn.dataset.defaultTitle ?? '';
				btn.setAttribute('aria-label', title);
				setTooltip(btn, title);
			});

			const fmt = analyzeSelectionFormatting(
				validation.captured.lineText,
				validation.captured.fromCh,
				validation.captured.toCh,
			);
			const formatTypes: FormatType[] = ['bold', 'italic', 'underline', 'strikethrough'];
			for (const f of formatTypes) {
				const btn = this.formatButtons[f];
				if (!btn) continue;
				const st = fmt[f];
				btn.setAttribute('aria-pressed', st === 'all' ? 'true' : st === 'mixed' ? 'mixed' : 'false');
				btn.classList.toggle('is-active', st === 'all');
				btn.classList.toggle('is-mixed', st === 'mixed');
			}
		}
	}

	private reposition(): void {
		if (!this.toolbarEl || !this.currentEditor) return;

		let selRect: Rect | null = null;
		const sel = activeWindow.getSelection();
		if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
			const range = sel.getRangeAt(0);
			const r = range.getBoundingClientRect();
			if (r.width > 0 || r.height > 0) {
				selRect = {
					top: r.top,
					bottom: r.bottom,
					left: r.left,
					right: r.right,
					width: r.width,
					height: r.height,
				};
			}
		}

		// Fallback to CodeMirror coordsAtPos when window DOM selection is blurred
		if (!selRect && this.capturedSelection) {
			const cm = (this.currentEditor as Editor & {
				cm?: {
					coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number; right: number } | null;
				};
			}).cm;
			if (cm?.coordsAtPos) {
				const fromOffset = this.currentEditor.posToOffset({
					line: this.capturedSelection.lineNo,
					ch: this.capturedSelection.fromCh,
				});
				const toOffset = this.currentEditor.posToOffset({
					line: this.capturedSelection.lineNo,
					ch: this.capturedSelection.toCh,
				});
				const p1 = cm.coordsAtPos(fromOffset);
				const p2 = cm.coordsAtPos(toOffset);
				if (p1 && p2) {
					const top = Math.min(p1.top, p2.top);
					const bottom = Math.max(p1.bottom, p2.bottom);
					const left = Math.min(p1.left, p2.left);
					const right = Math.max(p1.right, p2.right);
					selRect = {
						top,
						bottom,
						left,
						right,
						width: Math.max(0, right - left),
						height: Math.max(0, bottom - top),
					};
				}
			}
		}

		const leaf = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const viewDom =
			(this.currentEditor as Editor & { cm?: { scrollDOM?: HTMLElement } }).cm?.scrollDOM ??
			leaf?.contentEl;
		const editorRect = viewDom?.getBoundingClientRect() ?? {
			top: 0,
			bottom: activeWindow.innerHeight,
			left: 0,
			right: activeWindow.innerWidth,
		};

		const boundaryRect: Rect = {
			top: Math.max(0, editorRect.top),
			bottom: Math.min(activeWindow.innerHeight, editorRect.bottom),
			left: Math.max(0, editorRect.left),
			right: Math.min(activeWindow.innerWidth, editorRect.right),
			width: Math.max(0, editorRect.right - editorRect.left),
			height: Math.max(0, editorRect.bottom - editorRect.top),
		};

		const isCompact = boundaryRect.width < 360;
		this.toolbarEl.classList.toggle('is-compact', isCompact);

		if (selRect) {
			// Check if selection is scrolled outside visible editor boundary
			if (selRect.bottom < boundaryRect.top || selRect.top > boundaryRect.bottom) {
				this.toolbarEl.classList.add('is-hidden');
				this.closePopover();
				return;
			}

			const toolbarWidth = this.toolbarEl.offsetWidth || 180;
			const toolbarHeight = this.toolbarEl.offsetHeight || (isCompact ? 64 : 36);

			const pos = calculateToolbarPosition(
				selRect,
				toolbarWidth,
				toolbarHeight,
				boundaryRect,
			);

			this.toolbarEl.style.top = `${pos.top}px`;
			this.toolbarEl.style.left = `${pos.left}px`;
		}

		if (this.popoverEl && this.activePopover) {
			this.repositionPopover(boundaryRect);
		}
	}

	private getAnchorIndex(type: 'color' | 'highlight' | 'size' | 'font' | 'cleanup'): number {
		switch (type) {
			case 'color':
				return 4;
			case 'highlight':
				return 5;
			case 'size':
				return 6;
			case 'font':
				return 7;
			case 'cleanup':
				return 9;
		}
	}

	private togglePopover(type: 'color' | 'highlight' | 'size' | 'font' | 'cleanup'): void {
		if (this.activePopover === type) {
			this.closePopover();
			return;
		}
		if (type === 'size') {
			this.openSizePopover();
		} else if (type === 'font') {
			this.openFontPopover();
		} else if (type === 'cleanup') {
			this.openCleanupPopover();
		} else {
			this.openPopover(type);
		}
	}

	private openCleanupPopover(): void {
		this.closePopover();
		this.activePopover = 'cleanup';

		const doc = activeWindow.document;
		this.popoverEl = doc.createElement('div');
		this.popoverEl.className = 'inkwell-toolbar-popover inkwell-cleanup-popover';
		this.popoverEl.setAttribute('role', 'menu');
		this.popoverEl.setAttribute('aria-label', 'Retirer un style');

		this.popoverEl.addEventListener('mousedown', (e) => {
			e.preventDefault();
		});

		this.popoverEl.addEventListener('keydown', (e) => {
			this.handlePopoverKeyDown(e);
		});

		const items = [
			{
				icon: 'lucide-eraser',
				label: 'Retirer la couleur du texte',
				action: () => {
					this.executeRemoveColor();
					this.closePopover();
				},
			},
			{
				icon: 'lucide-brush-cleaning',
				label: 'Retirer le surlignage',
				action: () => {
					this.executeRemoveHighlight();
					this.closePopover();
				},
			},
		];

		items.forEach((item, index) => {
			const btn = doc.createElement('button');
			btn.className = 'inkwell-cleanup-item-btn';
			btn.setAttribute('type', 'button');
			btn.setAttribute('role', 'menuitem');
			btn.setAttribute('tabindex', index === 0 ? '0' : '-1');

			const iconSpan = doc.createElement('span');
			iconSpan.className = 'inkwell-cleanup-item-icon';
			setIcon(iconSpan, item.icon);
			btn.appendChild(iconSpan);

			const textSpan = doc.createElement('span');
			textSpan.className = 'inkwell-cleanup-item-label';
			textSpan.setText(item.label);
			btn.appendChild(textSpan);

			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				item.action();
			});

			this.popoverEl?.appendChild(btn);
		});

		doc.body.appendChild(this.popoverEl);
		this.reposition();
		const firstBtn = this.popoverEl.querySelector('button');
		firstBtn?.focus();
	}

	private openSizePopover(): void {
		this.closePopover();
		this.activePopover = 'size';

		const doc = activeWindow.document;
		this.popoverEl = doc.createElement('div');
		this.popoverEl.className = 'inkwell-toolbar-popover inkwell-size-popover';
		this.popoverEl.setAttribute('role', 'dialog');
		this.popoverEl.setAttribute('aria-label', 'Taille du texte et titres Markdown');

		this.popoverEl.addEventListener('mousedown', (e) => {
			if ((e.target as HTMLElement)?.tagName === 'INPUT') {
				return;
			}
			e.preventDefault();
		});

		this.popoverEl.addEventListener('keydown', (e) => {
			this.handlePopoverKeyDown(e);
		});

		// 1. Section: Titres Markdown
		const headingHeader = doc.createElement('div');
		headingHeader.className = 'inkwell-popover-group-label';
		headingHeader.setText('Titres Markdown');
		this.popoverEl.appendChild(headingHeader);

		const currentHeading = this.capturedSelection
			? getLineHeadingLevel(this.capturedSelection.lineText)
			: null;

		HEADING_OPTIONS.forEach((opt, index) => {
			const btn = doc.createElement('button');
			btn.className = 'inkwell-heading-btn';
			btn.setAttribute('type', 'button');
			btn.setAttribute('data-heading-level', opt.level !== null ? String(opt.level) : 'normal');
			btn.setAttribute('aria-label', opt.label);
			btn.setAttribute('tabindex', index === 0 ? '0' : '-1');

			if (opt.level === currentHeading) {
				btn.classList.add('is-active');
			}

			const label = doc.createElement('span');
			label.className = `inkwell-heading-label inkwell-heading-preview-${opt.level !== null ? `h${opt.level}` : 'normal'}`;
			label.setText(opt.label);
			btn.appendChild(label);

			const badge = doc.createElement('span');
			badge.className = 'inkwell-heading-badge';
			badge.setText(opt.desc);
			btn.appendChild(badge);

			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.applyHeading(opt.level);
			});

			this.popoverEl?.appendChild(btn);
		});

		// 2. Section: Taille du texte (Word-like pt sizing)
		const sizeHeader = doc.createElement('div');
		sizeHeader.className = 'inkwell-popover-group-label';
		sizeHeader.setText('Taille du texte');
		this.popoverEl.appendChild(sizeHeader);

		// Determine current selection sizes
		const sizes = new Set<string>();
		if (this.capturedSelection) {
			const parsed = parseLine(this.capturedSelection.lineText);
			const minSel = Math.min(this.capturedSelection.fromCh, this.capturedSelection.toCh);
			const maxSel = Math.max(this.capturedSelection.fromCh, this.capturedSelection.toCh);
			for (const seg of parsed) {
				if (seg.rawStart < maxSel && seg.rawEnd > minSel) {
					sizes.add(seg.fontSize ?? 'default');
				}
			}
		}
		const isMixed = sizes.size > 1;
		const activeSize = sizes.size === 1 ? Array.from(sizes)[0] : undefined;

		// Numeric exact pt input row
		const inputRow = doc.createElement('div');
		inputRow.className = 'inkwell-size-input-row';

		const numInput = doc.createElement('input');
		numInput.className = 'inkwell-size-pt-input';
		numInput.setAttribute('type', 'number');
		numInput.setAttribute('min', '4');
		numInput.setAttribute('max', '144');
		numInput.setAttribute('step', '1');
		numInput.setAttribute('placeholder', '12');
		numInput.setAttribute('aria-label', 'Taille personnalisée en points');

		if (activeSize && activeSize !== 'default' && activeSize.endsWith('pt')) {
			const numericPart = activeSize.slice(0, -2);
			numInput.value = numericPart;
		}

		inputRow.appendChild(numInput);

		const unitSpan = doc.createElement('span');
		unitSpan.className = 'inkwell-size-pt-unit';
		unitSpan.innerText = 'pt';
		inputRow.appendChild(unitSpan);

		const applyBtn = doc.createElement('button');
		applyBtn.className = 'inkwell-size-apply-btn';
		applyBtn.setAttribute('type', 'button');
		applyBtn.setText('Appliquer');
		inputRow.appendChild(applyBtn);

		const handleApplyCustomPt = () => {
			const raw = numInput.value.trim().toLowerCase().replace(/pt$/, '').trim();
			if (!raw) {
				new Notice('Veuillez saisir une taille en points.');
				return;
			}
			const num = parseFloat(raw);
			if (isNaN(num) || num < 4 || num > 144) {
				new Notice('La taille doit être comprise entre 4 et 144 pt.');
				return;
			}
			const formatted = Math.round(num * 10) / 10;
			this.applySize(`${formatted}pt`);
		};

		applyBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			handleApplyCustomPt();
		});

		numInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				handleApplyCustomPt();
			}
		});

		this.popoverEl.appendChild(inputRow);

		const hintEl = doc.createElement('div');
		hintEl.className = 'inkwell-size-hint';
		hintEl.setText('Entrez une taille de 4 à 144 pt');
		this.popoverEl.appendChild(hintEl);

		// Quick sizes grid (Word-like common sizes)
		const quickGrid = doc.createElement('div');
		quickGrid.className = 'inkwell-size-quick-grid';

		COMMON_PT_SIZES.forEach((pt) => {
			const quickBtn = doc.createElement('button');
			quickBtn.className = 'inkwell-size-quick-btn';
			quickBtn.setAttribute('type', 'button');
			quickBtn.setAttribute('data-pt', String(pt));
			quickBtn.setAttribute('aria-label', `${pt} points`);
			quickBtn.setText(String(pt));

			const targetVal = `${pt}pt`;
			if (!isMixed && activeSize === targetVal) {
				quickBtn.classList.add('is-active');
			}

			quickBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.applySize(targetVal);
			});

			quickGrid.appendChild(quickBtn);
		});

		this.popoverEl.appendChild(quickGrid);

		// Option: Taille par défaut
		const defaultBtn = doc.createElement('button');
		defaultBtn.className = 'inkwell-size-btn';
		defaultBtn.setAttribute('type', 'button');
		defaultBtn.setAttribute('data-size-id', 'default');
		defaultBtn.setAttribute('aria-label', 'Taille par défaut');
		defaultBtn.setAttribute('tabindex', '-1');

		if (!isMixed && (activeSize === 'default' || activeSize === undefined)) {
			defaultBtn.classList.add('is-active');
		}

		const defaultLabel = doc.createElement('span');
		defaultLabel.className = 'inkwell-size-label';
		defaultLabel.setText('Taille par défaut');
		defaultBtn.appendChild(defaultLabel);

		const defaultBadge = doc.createElement('span');
		defaultBadge.className = 'inkwell-size-badge';
		defaultBadge.setText('Par défaut');
		defaultBtn.appendChild(defaultBadge);

		defaultBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.applySize(null);
		});
		this.popoverEl.appendChild(defaultBtn);

		if (isMixed) {
			const mixedBadge = doc.createElement('div');
			mixedBadge.className = 'inkwell-size-mixed-info';
			mixedBadge.setText('Tailles multiples');
			this.popoverEl.appendChild(mixedBadge);
		}

		doc.body.appendChild(this.popoverEl);
		this.reposition();
	}

	private applyHeading(level: number | null): void {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return;
		const editor = this.currentEditor;
		const success = applyHeadingToCapturedRange(
			editor,
			this.capturedSelection,
			this.currentFilePath,
			level,
		);
		this.closePopover();
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
	}

	private applySize(size: string | null): void {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return;
		const editor = this.currentEditor;
		const success = applySizeToCapturedRange(
			editor,
			this.capturedSelection,
			this.currentFilePath,
			size,
		);
		this.closePopover();
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
	}

	private openFontPopover(): void {
		this.closePopover();
		this.activePopover = 'font';

		const doc = activeWindow.document;
		this.popoverEl = doc.createElement('div');
		this.popoverEl.className = 'inkwell-toolbar-popover inkwell-font-popover';
		this.popoverEl.setAttribute('role', 'dialog');
		this.popoverEl.setAttribute('aria-label', 'Palette de polices de texte');

		this.popoverEl.addEventListener('mousedown', (e) => {
			e.preventDefault();
		});

		this.popoverEl.addEventListener('keydown', (e) => {
			this.handlePopoverKeyDown(e);
		});

		// Determine current selection font families
		const fonts = new Set<string | null>();
		if (this.capturedSelection) {
			const parsed = parseLine(this.capturedSelection.lineText);
			const minSel = Math.min(this.capturedSelection.fromCh, this.capturedSelection.toCh);
			const maxSel = Math.max(this.capturedSelection.fromCh, this.capturedSelection.toCh);
			for (const seg of parsed) {
				if (seg.rawStart < maxSel && seg.rawEnd > minSel) {
					fonts.add(seg.fontFamily);
				}
			}
		}
		const isMixed = fonts.size > 1;
		const activeFont = fonts.size === 1 ? Array.from(fonts)[0] : undefined;

		let isFirstButton = true;

		// 1. Option: Police par défaut (removes font-family only)
		const defaultBtn = doc.createElement('button');
		defaultBtn.className = 'inkwell-font-btn';
		defaultBtn.setAttribute('type', 'button');
		defaultBtn.setAttribute('data-font-id', 'default');
		defaultBtn.setAttribute('aria-label', 'Police par défaut');
		defaultBtn.setAttribute('tabindex', isFirstButton ? '0' : '-1');
		isFirstButton = false;

		if (!isMixed && (activeFont === null || activeFont === undefined)) {
			defaultBtn.classList.add('is-active');
		}

		const defaultLabel = doc.createElement('span');
		defaultLabel.className = 'inkwell-font-label';
		defaultLabel.setText('Police par défaut');
		defaultBtn.appendChild(defaultLabel);

		const defaultBadge = doc.createElement('span');
		defaultBadge.className = 'inkwell-font-desc';
		defaultBadge.setText('Par défaut');
		defaultBtn.appendChild(defaultBadge);

		defaultBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.applyFontFamily(null);
		});
		this.popoverEl.appendChild(defaultBtn);

		// 2. Custom imported fonts
		const customFonts = this.plugin.settings.customFonts;
		if (customFonts.length > 0) {
			void loadAllCustomFonts(
				this.plugin.app.vault,
				customFonts,
				doc,
				this.plugin.app,
			);

			const customHeader = doc.createElement('div');
			customHeader.className = 'inkwell-popover-group-label';
			customHeader.setText('Polices personnelles');
			this.popoverEl.appendChild(customHeader);

			customFonts.forEach((customFont) => {
				const btn = doc.createElement('button');
				btn.className = 'inkwell-font-btn';
				btn.setAttribute('type', 'button');
				btn.setAttribute('data-font-id', customFont.id);
				btn.setAttribute('aria-label', customFont.name);
				btn.setAttribute('tabindex', '-1');

				const isMatch =
					!isMixed &&
					activeFont &&
					(activeFont === customFont.familyName ||
						activeFont.includes(customFont.familyName) ||
						activeFont.replace(/['"]/g, '').trim().startsWith(customFont.familyName));

				if (isMatch) {
					btn.classList.add('is-active');
				}

				const label = doc.createElement('span');
				label.className = 'inkwell-font-label';
				label.setText(customFont.name);
				label.style.fontFamily = `'${customFont.familyName}', sans-serif`;
				btn.appendChild(label);

				const badge = doc.createElement('span');
				badge.className = 'inkwell-font-desc';
				const badgeText =
					customFont.weight === 'bold'
						? 'Gras'
						: customFont.style === 'italic'
							? 'Italique'
							: customFont.extension.toUpperCase();
				badge.setText(badgeText);
				btn.appendChild(badge);

				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					void loadFontItemIntoDocument(
						this.plugin.app.vault,
						customFont,
						doc,
						this.plugin.app,
					);
					this.applyFontFamily(`'${customFont.familyName}', sans-serif`);
				});
				this.popoverEl?.appendChild(btn);
			});
		}

		// 3. Generic standard fonts
		const genericHeader = doc.createElement('div');
		genericHeader.className = 'inkwell-popover-group-label';
		genericHeader.setText('Polices standard');
		this.popoverEl.appendChild(genericHeader);

		const genericOptions = [
			{ id: 'sans', name: 'Sans empattement', value: 'sans-serif', desc: 'sans-serif' },
			{ id: 'serif', name: 'Avec empattement', value: 'serif', desc: 'serif' },
			{ id: 'mono', name: 'Monospace', value: 'monospace', desc: 'monospace' },
		];

		genericOptions.forEach((opt) => {
			const btn = doc.createElement('button');
			btn.className = 'inkwell-font-btn';
			btn.setAttribute('type', 'button');
			btn.setAttribute('data-font-id', opt.id);
			btn.setAttribute('aria-label', `${opt.name} (${opt.desc})`);
			btn.setAttribute('tabindex', '-1');

			if (!isMixed && activeFont === opt.value) {
				btn.classList.add('is-active');
			}

			const label = doc.createElement('span');
			label.className = 'inkwell-font-label';
			label.setText(opt.name);
			label.style.fontFamily = opt.value;
			btn.appendChild(label);

			const badge = doc.createElement('span');
			badge.className = 'inkwell-font-desc';
			badge.setText(opt.desc);
			btn.appendChild(badge);

			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.applyFontFamily(opt.value);
			});

			this.popoverEl?.appendChild(btn);
		});

		// 4. Multiple fonts indicator
		if (isMixed) {
			const mixedBadge = doc.createElement('div');
			mixedBadge.className = 'inkwell-font-mixed-info';
			mixedBadge.setText('Polices multiples');
			this.popoverEl.appendChild(mixedBadge);
		}

		doc.body.appendChild(this.popoverEl);
		this.reposition();
	}

	private applyFontFamily(fontFamily: string | null): void {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return;
		const editor = this.currentEditor;
		const success = applyFontFamilyToCapturedRange(
			editor,
			this.capturedSelection,
			this.currentFilePath,
			fontFamily,
		);
		this.closePopover();
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
	}

	private executeToggleFormat(format: FormatType): void {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return;
		const editor = this.currentEditor;
		const lineNo = this.capturedSelection.lineNo;
		const lineText = this.capturedSelection.lineText;
		const fromCh = this.capturedSelection.fromCh;
		const toCh = this.capturedSelection.toCh;

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
		if (!res.success || !res.result) return;

		editor.transaction({
			changes: [
				{
					from: { line: lineNo, ch: 0 },
					to: { line: lineNo, ch: lineText.length },
					text: res.result.text,
				},
			],
			selection: {
				from: { line: lineNo, ch: res.result.from },
				to: { line: lineNo, ch: res.result.to },
			},
		});

		this.afterEditSuccess(editor);
	}

	private getSelectionColorContext(): {
		textColor: string | null;
		highlightColor: string | null;
		highlightAppearance: HighlightAppearance | null;
		isMixed: boolean;
		isLargeOrBoldText: boolean;
	} {
		if (!this.capturedSelection) {
			return { textColor: null, highlightColor: null, highlightAppearance: null, isMixed: false, isLargeOrBoldText: false };
		}
		const parsed = parseLine(this.capturedSelection.lineText);
		const minSel = Math.min(this.capturedSelection.fromCh, this.capturedSelection.toCh);
		const maxSel = Math.max(this.capturedSelection.fromCh, this.capturedSelection.toCh);
		const overlapping = parsed.filter((s) => s.rawStart < maxSel && s.rawEnd > minSel);

		const colors = new Set<string>();
		const highlights = new Set<string>();
		let highlightAppearance: HighlightAppearance | null = null;
		let hasLarge = false;

		for (const seg of overlapping) {
			if (seg.color) colors.add(seg.color.toLowerCase());
			if (seg.highlight) {
				highlights.add(seg.highlight.toLowerCase());
				if (seg.highlightAppearance) {
					highlightAppearance = seg.highlightAppearance;
				}
			}
			if (seg.fontSize === '1.25em') hasLarge = true;
		}

		const hasMultipleColors = colors.size > 1;
		const hasMultipleHighlights = highlights.size > 1;
		const hasColorAndPlain =
			colors.size > 0 &&
			overlapping.some((s) => !s.color && s.text.trim().length > 0);
		const hasHighlightAndPlain =
			highlights.size > 0 &&
			overlapping.some((s) => !s.highlight && s.text.trim().length > 0);

		const isMixed =
			hasMultipleColors ||
			hasMultipleHighlights ||
			hasColorAndPlain ||
			hasHighlightAndPlain;
		const textColor = !isMixed && colors.size === 1 ? Array.from(colors)[0] ?? null : null;
		const highlightColor = !isMixed && highlights.size === 1 ? Array.from(highlights)[0] ?? null : null;

		const isHeading = this.capturedSelection.lineText.trim().startsWith('#');
		const isBold = this.capturedSelection.lineText.includes('**');

		return {
			textColor,
			highlightColor,
			highlightAppearance,
			isMixed,
			isLargeOrBoldText: hasLarge || isHeading || isBold,
		};
	}

	private updateContrastDisplay(
		contrastContainer: HTMLElement,
		evaluatedColor: string,
		isHighlightMode: boolean,
		selCtx: {
			textColor: string | null;
			highlightColor: string | null;
			isMixed: boolean;
			isLargeOrBoldText: boolean;
		},
	): void {
		contrastContainer.empty();

		const doc = activeWindow.document;
		const { background: themeBg, isRealMeasured, isDark } = resolveEffectiveThemeBackground(doc);

		// 1. Current applied color or highlight
		const curRow = contrastContainer.createDiv({ cls: 'inkwell-contrast-row' });
		curRow.createSpan({
			cls: 'inkwell-contrast-label',
			text: isHighlightMode ? 'Surlignage actuel : ' : 'Couleur actuelle : ',
		});
		curRow.createSpan({
			cls: 'inkwell-contrast-val',
			text: isHighlightMode
				? (selCtx.isMixed ? 'Sélection mixte' : (selCtx.highlightColor ?? 'Aucun'))
				: (selCtx.isMixed ? 'Sélection mixte' : (selCtx.textColor ?? 'Défaut du thème')),
		});

		// 2. Proposed color / highlight
		const propRow = contrastContainer.createDiv({ cls: 'inkwell-contrast-row' });
		propRow.createSpan({
			cls: 'inkwell-contrast-label',
			text: isHighlightMode ? 'Surlignage proposé : ' : 'Couleur proposée : ',
		});
		propRow.createSpan({
			cls: 'inkwell-contrast-val',
			text: evaluatedColor,
		});

		// 3. Mixed selection handling
		if (selCtx.isMixed) {
			const mixedBadge = contrastContainer.createSpan({
				cls: 'inkwell-contrast-badge is-mixed',
				text: '⚠️ Sélection mixte — contraste non calculable',
			});
			setTooltip(
				mixedBadge,
				'La sélection contient plusieurs couleurs ou fonds différents : aucun ratio unique n’est pertinent.',
			);
			return;
		}

		// 4. Contrast computation
		const textColor = isHighlightMode
			? (selCtx.textColor ?? (isDark ? '#dadada' : '#1e1e1e'))
			: evaluatedColor;
		const highlightColor = isHighlightMode ? evaluatedColor : (selCtx.highlightColor ?? null);

		const evaluation = evaluateColorContrast({
			textColor,
			highlightColor,
			themeBackground: themeBg,
			isRealMeasured,
			isDarkTheme: isDark,
			isLargeOrBoldText: selCtx.isLargeOrBoldText,
		});

		const badge = contrastContainer.createSpan({ cls: 'inkwell-contrast-badge' });
		if (evaluation.passesNormal) {
			badge.addClass('is-pass-normal');
			badge.setText(`${evaluation.ratioFormatted} ✓ Conforme texte normal`);
		} else if (evaluation.passesLarge) {
			badge.addClass('is-pass-large');
			badge.setText(`${evaluation.ratioFormatted} ✓ Conforme grand texte`);
		} else {
			badge.addClass('is-low');
			badge.setText(`${evaluation.ratioFormatted} ⚠️ Contraste faible`);
		}

		contrastContainer.createSpan({
			cls: 'inkwell-contrast-bg',
			text: `Fond évalué : ${evaluation.backgroundUsed}`,
		});

		if (evaluation.suggestedColor && !evaluation.passesNormal) {
			const sugg = contrastContainer.createSpan({
				cls: 'inkwell-contrast-suggestion',
				text: `Alternative recommandée : ${evaluation.suggestedColor}`,
			});
			setTooltip(sugg, 'Alternative recommandée pour un meilleur contraste (facultative)');
		}
	}

	public openPopover(type: 'color' | 'highlight'): void {
		this.closePopover();
		this.activePopover = type;
		this.activePaletteTab = 'palette';

		const doc = activeWindow.document;
		this.popoverEl = doc.createElement('div');
		this.popoverEl.className = 'inkwell-toolbar-popover inkwell-palette-popover';
		this.popoverEl.setAttribute('role', 'dialog');
		this.popoverEl.setAttribute(
			'aria-label',
			type === 'color' ? 'Palette de couleurs' : 'Palette de surlignage',
		);

		this.popoverEl.addEventListener('mousedown', (e) => {
			if ((e.target as HTMLElement)?.closest('select')) {
				return;
			}
			e.preventDefault();
		});

		this.popoverEl.addEventListener('keydown', (e) => {
			this.handlePopoverKeyDown(e);
		});

		const selCtx = this.getSelectionColorContext();

		// Header with Tabs (Palette, Favoris, Récents) and Palette Selector
		const header = doc.createElement('div');
		header.className = 'inkwell-popover-header';

		const tabs = doc.createElement('div');
		tabs.className = 'inkwell-popover-tabs';

		const targetPaletteType = type === 'color' ? 'text' : 'highlight';
		const palettes = this.plugin.settings.palettes.filter((p) => p.type === targetPaletteType);
		const activePaletteId =
			type === 'color'
				? this.plugin.settings.activeTextPaletteId
				: this.plugin.settings.activeHighlightPaletteId;
		let curPalette =
			palettes.find((p) => p.id === activePaletteId) ?? palettes[0] ?? null;

		const favList =
			type === 'color'
				? this.plugin.settings.favoriteColors
				: this.plugin.settings.favoriteHighlights;
		const recentList =
			type === 'color'
				? this.plugin.settings.recentColors
				: this.plugin.settings.recentHighlights;

		const tabItems: Array<{ id: 'palette' | 'favorites' | 'recents'; label: string; count?: number }> = [
			{ id: 'palette', label: 'Palette' },
			{ id: 'favorites', label: 'Favoris', count: favList.length },
			{ id: 'recents', label: 'Récents', count: recentList.length },
		];

		const selectorContainer = doc.createElement('div');
		selectorContainer.className = 'inkwell-popover-palette-select-container';

		const paletteSelect = doc.createElement('select');
		paletteSelect.className = 'dropdown inkwell-popover-palette-select';
		paletteSelect.setAttribute('aria-label', 'Sélectionner la palette');

		palettes.forEach((p) => {
			const opt = doc.createElement('option');
			opt.value = p.id;
			opt.textContent = `${p.name}${p.isBuiltIn ? ' (intégrée)' : ''}`;
			if (p.id === curPalette?.id) opt.selected = true;
			paletteSelect.appendChild(opt);
		});

		selectorContainer.appendChild(paletteSelect);

		const swatchesContainer = doc.createElement('div');
		swatchesContainer.className = 'inkwell-swatches-grid';

		const contrastContainer = doc.createElement('div');
		contrastContainer.className = 'inkwell-popover-contrast';

		const renderSwatches = () => {
			swatchesContainer.empty();
			let items: Array<{ name: string; value: string }> = [];

			if (this.activePaletteTab === 'palette') {
				if (curPalette) {
					items = curPalette.colors.map((c) => ({ name: c.name, value: c.value }));
				}
			} else if (this.activePaletteTab === 'favorites') {
				items = favList.map((val) => ({ name: val, value: val }));
			} else if (this.activePaletteTab === 'recents') {
				items = recentList.map((val) => ({ name: val, value: val }));
			}

			if (items.length === 0) {
				const emptyMsg = doc.createElement('div');
				emptyMsg.className = 'inkwell-popover-empty';
				emptyMsg.setText(
					this.activePaletteTab === 'favorites'
						? 'Aucune couleur favorite'
						: this.activePaletteTab === 'recents'
							? 'Aucun historique récent'
							: 'Palette vide',
				);
				swatchesContainer.appendChild(emptyMsg);
				return;
			}

			items.forEach((item, index) => {
				const btn = doc.createElement('button');
				btn.className = 'inkwell-swatch-btn';
				btn.setAttribute('type', 'button');
				btn.setAttribute('aria-label', item.name);
				btn.setAttribute('data-color', item.value);
				btn.setAttribute('tabindex', index === 0 ? '0' : '-1');
				setTooltip(btn, item.name);

				const circle = doc.createElement('span');
				circle.className = 'inkwell-swatch-circle';
				circle.style.setProperty('--inkwell-swatch-color', item.value);
				btn.appendChild(circle);

				btn.addEventListener('mouseenter', () => {
					this.updateContrastDisplay(
						contrastContainer,
						item.value,
						type === 'highlight',
						selCtx,
					);
				});
				btn.addEventListener('focus', () => {
					this.updateContrastDisplay(
						contrastContainer,
						item.value,
						type === 'highlight',
						selCtx,
					);
				});

				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					if (type === 'color') {
						this.applyColor(item.value);
					} else {
						this.applyHighlight(item.value);
					}
				});

				swatchesContainer.appendChild(btn);
			});

			const firstColor = items[0]?.value;
			if (firstColor) {
				this.updateContrastDisplay(
					contrastContainer,
					firstColor,
					type === 'highlight',
					selCtx,
				);
			}
		};

		paletteSelect.addEventListener('change', () => {
			const selectedId = paletteSelect.value;
			const found = palettes.find((p) => p.id === selectedId);
			if (found) {
				curPalette = found;
				if (type === 'color') {
					this.plugin.settings.activeTextPaletteId = found.id;
				} else {
					this.plugin.settings.activeHighlightPaletteId = found.id;
				}
				void this.plugin.saveSettings();
				renderSwatches();
				this.reposition();
			}
		});

		tabItems.forEach((tab) => {
			const tabBtn = doc.createElement('button');
			tabBtn.className = 'inkwell-popover-tab-btn';
			if (this.activePaletteTab === tab.id) tabBtn.addClass('is-active');
			const labelText = tab.count !== undefined ? `${tab.label} (${tab.count})` : tab.label;
			tabBtn.setText(labelText);

			tabBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.activePaletteTab = tab.id;
				tabs.querySelectorAll('.inkwell-popover-tab-btn').forEach((b) => b.removeClass('is-active'));
				tabBtn.addClass('is-active');
				selectorContainer.toggleClass('is-hidden', tab.id !== 'palette');
				renderSwatches();
				this.reposition();
			});

			tabs.appendChild(tabBtn);
		});

		header.appendChild(tabs);
		header.appendChild(selectorContainer);
		this.popoverEl.appendChild(header);
		this.popoverEl.appendChild(swatchesContainer);
		this.popoverEl.appendChild(contrastContainer);

		// Footer with Custom Color Picker button & Default Appearance reset
		const footer = doc.createElement('div');
		footer.className = 'inkwell-popover-footer';

		const customColorBtn = doc.createElement('button');
		customColorBtn.className = 'inkwell-popover-custom-btn';
		customColorBtn.setAttribute('type', 'button');
		customColorBtn.setText(type === 'highlight' ? 'Surlignage personnalisé…' : 'Couleur personnalisée…');
		customColorBtn.setAttribute('tabindex', '0');
		customColorBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openCustomColorPicker(type);
		});
		footer.appendChild(customColorBtn);

		if (type === 'highlight') {
			const defaultAppearanceBtn = doc.createElement('button');
			defaultAppearanceBtn.className = 'inkwell-popover-custom-btn inkwell-popover-reset-btn';
			defaultAppearanceBtn.setAttribute('type', 'button');
			defaultAppearanceBtn.setText('Apparence par défaut');
			defaultAppearanceBtn.setAttribute('aria-label', 'Rétablir l’apparence par défaut du surlignage');
			defaultAppearanceBtn.setAttribute('tabindex', '0');
			defaultAppearanceBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.executeRemoveHighlightAppearance();
			});
			footer.appendChild(defaultAppearanceBtn);
		}

		this.popoverEl.appendChild(footer);

		renderSwatches();

		doc.body.appendChild(this.popoverEl);
		this.reposition();
	}

	private repositionPopover(boundaryRect: Rect): void {
		if (!this.popoverEl || !this.toolbarEl || !this.activePopover) return;

		const anchorIdx = this.getAnchorIndex(this.activePopover);
		const anchorBtn = this.buttons[anchorIdx];
		if (!anchorBtn) return;

		const anchorRect = anchorBtn.getBoundingClientRect();
		const popoverWidth = this.popoverEl.offsetWidth || 180;
		const popoverHeight = this.popoverEl.offsetHeight || 110;

		const pos = calculatePopoverPosition(
			anchorRect,
			popoverWidth,
			popoverHeight,
			boundaryRect,
			'bottom',
		);

		this.popoverEl.style.top = `${pos.top}px`;
		this.popoverEl.style.left = `${pos.left}px`;
	}

	public closePopover(): void {
		if (this.popoverEl) {
			this.popoverEl.remove();
			this.popoverEl = null;
		}
		this.activePopover = null;
	}

	private validateBeforeEdit(): boolean {
		if (!this.currentEditor || !this.capturedSelection) return false;
		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile?.path !== this.capturedSelection.filePath) {
			new Notice('Note has changed. Operation cancelled.');
			this.hide();
			return false;
		}
		if (
			this.capturedSelection.lineNo >= this.currentEditor.lineCount() ||
			this.currentEditor.getLine(this.capturedSelection.lineNo) !== this.capturedSelection.lineText
		) {
			new Notice('Content has changed. Operation cancelled.');
			this.hide();
			return false;
		}
		return true;
	}

	private applyColor(color: string): void {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return;
		const editor = this.currentEditor;

		// Record in recent colors
		this.plugin.settings.recentColors = addRecentColor(
			this.plugin.settings.recentColors,
			color,
		);
		void this.plugin.saveSettings();

		const success = applyColorToCapturedRange(
			editor,
			this.capturedSelection,
			this.currentFilePath,
			color,
		);
		this.closePopover();
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
	}

	public applyHighlight(
		highlight: string,
		appearance?: HighlightAppearance | null,
	): boolean {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return false;
		const editor = this.currentEditor;

		// Record in recent highlights
		this.plugin.settings.recentHighlights = addRecentColor(
			this.plugin.settings.recentHighlights,
			highlight,
		);
		void this.plugin.saveSettings();

		const success = applyHighlightToCapturedRange(
			editor,
			this.capturedSelection,
			this.currentFilePath,
			highlight,
			appearance,
		);
		this.closePopover();
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
		return success;
	}

	public openCustomColorPicker(type: 'color' | 'highlight'): void {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return;
		const editor = this.currentEditor;
		const captured = this.capturedSelection;
		const filePath = this.currentFilePath;

		this.closePopover();

		const selCtx = this.getSelectionColorContext();
		const initialColor =
			type === 'color'
				? (selCtx.textColor ?? this.plugin.settings.defaultColor ?? '#1971c2')
				: (selCtx.highlightColor ??
					this.plugin.settings.defaultHighlightColor ??
					'rgba(255, 212, 59, 0.35)');

		const modal = new CustomColorPickerModal(
			this.plugin.app,
			this.plugin,
			type === 'highlight',
			initialColor,
			(
				finalColor: string,
				saveToPalette?: SaveToPaletteConfig,
				appearance?: HighlightAppearance | null,
			) => {
				if (saveToPalette) {
					const pal = this.plugin.settings.palettes.find(
						(p) => p.id === saveToPalette.paletteId,
					);
					if (pal) {
						pal.colors.push({
							id: `color-${Date.now()}`,
							name: saveToPalette.name,
							value: finalColor,
						});
					}
				}

				if (type === 'color') {
					this.plugin.settings.recentColors = addRecentColor(
						this.plugin.settings.recentColors,
						finalColor,
					);
					void this.plugin.saveSettings();

					const success = applyColorToCapturedRange(
						editor,
						captured,
						filePath,
						finalColor,
					);
					if (success) {
						this.afterEditSuccess(editor);
					} else {
						this.hide();
					}
				} else {
					this.plugin.settings.recentHighlights = addRecentColor(
						this.plugin.settings.recentHighlights,
						finalColor,
					);
					void this.plugin.saveSettings();

					const success = applyHighlightToCapturedRange(
						editor,
						captured,
						filePath,
						finalColor,
						appearance,
					);
					if (success) {
						this.afterEditSuccess(editor);
					} else {
						this.hide();
					}
				}
			},
			() => {
				editor.focus();
				editor.setSelection(
					{ line: captured.lineNo, ch: captured.fromCh },
					{ line: captured.lineNo, ch: captured.toCh },
				);
				this.update();
			},
			type === 'highlight' ? selCtx.highlightAppearance : undefined,
		);
		modal.open();
	}


	public removeHighlightAppearance(): boolean {
		if (!this.validateBeforeEdit() || !this.currentEditor || !this.capturedSelection) return false;
		const editor = this.currentEditor;
		const captured = this.capturedSelection;
		const filePath = this.currentFilePath;
		this.closePopover();
		const success = removeHighlightAppearanceFromCapturedRange(editor, captured, filePath);
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
		return success;
	}

	private executeRemoveHighlightAppearance(): void {
		this.removeHighlightAppearance();
	}

	private executeRemoveColor(): void {
		if (!this.validateBeforeEdit() || !this.currentEditor) return;
		const editor = this.currentEditor;
		const success = setSelectionColor(editor, this.tracker, null, this.currentFilePath);
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
	}

	private executeRemoveHighlight(): void {
		if (!this.validateBeforeEdit() || !this.currentEditor) return;
		const editor = this.currentEditor;
		const success = setSelectionHighlight(editor, this.tracker, null, this.currentFilePath);
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
	}

	private executeClearAll(): void {
		if (!this.validateBeforeEdit() || !this.currentEditor) return;
		const editor = this.currentEditor;
		const success = clearInkwellFormatting(editor, this.tracker, this.currentFilePath);
		if (success) {
			this.afterEditSuccess(editor);
		} else {
			this.hide();
		}
	}

	/**
	 * Chains selection after a successful edit:
	 * applyLineChange sets editor selection over the styled content synchronously.
	 * We update captured selection state immediately, and schedule reposition on next frame.
	 */
	private afterEditSuccess(editor: Editor): void {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		const updated = captureSelectionState(editor, this.tracker, activeFile?.path ?? null);
		if (updated.hasSelection && updated.lineNo === updated.targetToLine) {
			this.capturedSelection = updated;
			this.currentEditor = editor;
			this.currentFilePath = activeFile?.path ?? null;
			window.requestAnimationFrame(() => {
				if (this.isVisible()) {
					this.reposition();
				}
			});
		} else {
			this.hide();
		}
	}

	private handleToolbarKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			if (this.activePopover) {
				const anchorIdx = this.getAnchorIndex(this.activePopover);
				this.closePopover();
				this.buttons[anchorIdx]?.focus();
			} else {
				// Dismiss toolbar and return focus to editor
				if (this.capturedSelection) {
					this.dismissedKey = `${this.capturedSelection.filePath}:${this.capturedSelection.lineNo}:${this.capturedSelection.fromCh}-${this.capturedSelection.toCh}`;
				}
				this.hide();
				this.currentEditor?.focus();
			}
			return;
		}

		if (e.key === 'ArrowRight') {
			e.preventDefault();
			const nextIdx = (this.focusedButtonIndex + 1) % this.buttons.length;
			this.updateRovingTabIndex(nextIdx);
			const nextBtn = this.buttons[nextIdx];
			if (nextBtn) nextBtn.focus();
			return;
		}

		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			const prevIdx = (this.focusedButtonIndex - 1 + this.buttons.length) % this.buttons.length;
			this.updateRovingTabIndex(prevIdx);
			const prevBtn = this.buttons[prevIdx];
			if (prevBtn) prevBtn.focus();
			return;
		}
	}

	private handlePopoverKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			const anchorIdx = this.activePopover ? this.getAnchorIndex(this.activePopover) : 0;
			this.closePopover();
			this.buttons[anchorIdx]?.focus();
			return;
		}

		if (!this.popoverEl) return;
		const items = Array.from(
			this.popoverEl.querySelectorAll<HTMLButtonElement>(
				'.inkwell-swatch-btn, .inkwell-size-btn, .inkwell-font-btn, .inkwell-popover-custom-btn, .inkwell-cleanup-item-btn',
			),
		);
		if (items.length === 0) return;

		const currentIdx = items.indexOf(activeWindow.document.activeElement as HTMLButtonElement);

		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			e.preventDefault();
			const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % items.length;
			items.forEach((s, idx) => (s.tabIndex = idx === nextIdx ? 0 : -1));
			const nextItem = items[nextIdx];
			if (nextItem) nextItem.focus();
			return;
		}

		if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			e.preventDefault();
			const prevIdx = currentIdx === -1 ? 0 : (currentIdx - 1 + items.length) % items.length;
			items.forEach((s, idx) => (s.tabIndex = idx === prevIdx ? 0 : -1));
			const prevItem = items[prevIdx];
			if (prevItem) prevItem.focus();
			return;
		}
	}
}
