import { setIcon } from 'obsidian';
import { CalloutCustomStyle } from './callout-parser';

export interface CalloutStylePopoverOptions {
	anchorEl: HTMLElement;
	initialStyle?: CalloutCustomStyle;
	onPreviewStyle: (style: CalloutCustomStyle | undefined) => void;
	onCommitStyle: (style: CalloutCustomStyle | undefined) => void;
	onClose: () => void;
}

const PRESET_BG_COLORS = [
	{ id: 'default', label: 'Par défaut', value: '' },
	{ id: 'slate', label: 'Ardoise', value: '#1e293b' },
	{ id: 'blue', label: 'Bleu', value: '#1e3a8a' },
	{ id: 'emerald', label: 'Vert', value: '#14532d' },
	{ id: 'amber', label: 'Ambre', value: '#451a03' },
	{ id: 'rose', label: 'Rose', value: '#4c0519' },
	{ id: 'purple', label: 'Violet', value: '#2e1065' },
	{ id: 'teal', label: 'Turquoise', value: '#134e4a' },
];

const PRESET_BORDER_COLORS = [
	{ id: 'default', label: 'Par défaut', value: '' },
	{ id: 'slate', label: 'Gris', value: '#64748b' },
	{ id: 'blue', label: 'Bleu', value: '#3b82f6' },
	{ id: 'emerald', label: 'Vert', value: '#10b981' },
	{ id: 'amber', label: 'Ambre', value: '#f59e0b' },
	{ id: 'rose', label: 'Rose', value: '#ef4444' },
	{ id: 'purple', label: 'Violet', value: '#8b5cf6' },
	{ id: 'teal', label: 'Turquoise', value: '#14b8a6' },
];

export class CalloutStylePopover {
	private popoverEl: HTMLElement;
	private currentStyle: CalloutCustomStyle;
	private rememberedBorderColor: string;
	private isBorderActive: boolean;
	private options: CalloutStylePopoverOptions;

	private bgSwatchesContainer!: HTMLElement;
	private bgCustomColorInput!: HTMLInputElement;
	private borderSwitchInput!: HTMLInputElement;
	private borderSwitchThumb!: HTMLElement;
	private borderSwitchLabel!: HTMLElement;
	private borderColorSection!: HTMLElement;
	private borderColorSwatchesContainer!: HTMLElement;
	private borderCustomColorInput!: HTMLInputElement;

	private docPointerHandler: (e: PointerEvent) => void;
	private docKeyHandler: (e: KeyboardEvent) => void;
	private isDestroyed = false;

	constructor(options: CalloutStylePopoverOptions) {
		this.options = options;
		this.currentStyle = { ...(options.initialStyle ?? {}) };
		this.isBorderActive = this.currentStyle.border !== false;
		this.rememberedBorderColor = this.currentStyle.borderColor ?? '';

		this.popoverEl = document.createElement('div');
		this.popoverEl.className = 'inkwell-callout-style-popover';
		this.popoverEl.setAttribute('role', 'dialog');
		this.popoverEl.setAttribute('aria-label', 'Personnaliser l’apparence de l’encadré');

		// Prevent clicks/mousedown inside from closing or triggering drag-drop
		const stopEvent = (e: Event) => {
			e.stopPropagation();
		};
		this.popoverEl.addEventListener('pointerdown', stopEvent);
		this.popoverEl.addEventListener('mousedown', stopEvent);
		this.popoverEl.addEventListener('click', stopEvent);

		this.buildDOM();
		document.body.appendChild(this.popoverEl);
		this.reposition();

		this.docPointerHandler = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (
				target &&
				!this.popoverEl.contains(target) &&
				!this.options.anchorEl.contains(target)
			) {
				this.close();
			}
		};

		this.docKeyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			}
		};

		// Attach global listeners with slight defer to avoid current click closing it
		window.setTimeout(() => {
			if (!this.isDestroyed) {
				document.addEventListener('pointerdown', this.docPointerHandler, true);
				document.addEventListener('keydown', this.docKeyHandler, true);
			}
		}, 10);
	}

	public close(): void {
		if (this.isDestroyed) return;
		this.isDestroyed = true;
		document.removeEventListener('pointerdown', this.docPointerHandler, true);
		document.removeEventListener('keydown', this.docKeyHandler, true);
		if (this.popoverEl.parentNode) {
			this.popoverEl.parentNode.removeChild(this.popoverEl);
		}
		// Final commit of current state
		this.options.onCommitStyle(
			this.isStyleEmpty(this.currentStyle) ? undefined : this.currentStyle,
		);
		this.options.onClose();
	}

	private isStyleEmpty(style: CalloutCustomStyle): boolean {
		return (
			!style.bg &&
			(style.border === undefined || style.border === true) &&
			!style.borderColor
		);
	}

	private buildDOM(): void {
		// --- Header ---
		const header = document.createElement('div');
		header.className = 'inkwell-style-popover-header';

		const title = document.createElement('span');
		title.className = 'inkwell-style-popover-title';
		title.textContent = 'Apparence de l’encadré';
		header.appendChild(title);

		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'inkwell-style-popover-close-btn';
		closeBtn.setAttribute('aria-label', 'Fermer le menu');
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());
		header.appendChild(closeBtn);
		this.popoverEl.appendChild(header);

		// --- Section 1: Couleur de l'encadré (Fond) ---
		const bgSection = document.createElement('div');
		bgSection.className = 'inkwell-style-popover-section';

		const bgLabel = document.createElement('label');
		bgLabel.className = 'inkwell-style-popover-label';
		bgLabel.textContent = 'Couleur de l’encadré';
		bgSection.appendChild(bgLabel);

		this.bgSwatchesContainer = document.createElement('div');
		this.bgSwatchesContainer.className = 'inkwell-style-swatches-row';

		for (const preset of PRESET_BG_COLORS) {
			const swatch = document.createElement('button');
			swatch.type = 'button';
			swatch.className = 'inkwell-style-swatch';
			swatch.title = preset.label;
			swatch.setAttribute('aria-label', preset.label);
			if (preset.value) {
				swatch.style.backgroundColor = preset.value;
			} else {
				swatch.classList.add('is-default-swatch');
			}
			if ((this.currentStyle.bg ?? '') === preset.value) {
				swatch.classList.add('is-active');
			}

			swatch.addEventListener('click', () => {
				this.currentStyle.bg = preset.value ? preset.value : undefined;
				this.updateActiveSwatches();
				this.options.onPreviewStyle(this.currentStyle);
				this.options.onCommitStyle(this.currentStyle);
			});
			this.bgSwatchesContainer.appendChild(swatch);
		}

		// Custom color picker for background
		const bgCustomWrap = document.createElement('label');
		bgCustomWrap.className = 'inkwell-style-custom-color-wrap';
		bgCustomWrap.title = 'Couleur personnalisée';

		this.bgCustomColorInput = document.createElement('input');
		this.bgCustomColorInput.type = 'color';
		this.bgCustomColorInput.className = 'inkwell-style-color-input';
		this.bgCustomColorInput.value = this.currentStyle.bg || '#1e293b';

		this.bgCustomColorInput.addEventListener('input', () => {
			this.currentStyle.bg = this.bgCustomColorInput.value;
			this.updateActiveSwatches();
			this.options.onPreviewStyle(this.currentStyle);
		});

		this.bgCustomColorInput.addEventListener('change', () => {
			this.currentStyle.bg = this.bgCustomColorInput.value;
			this.updateActiveSwatches();
			this.options.onPreviewStyle(this.currentStyle);
			this.options.onCommitStyle(this.currentStyle);
		});

		bgCustomWrap.appendChild(this.bgCustomColorInput);
		const customIcon = document.createElement('span');
		customIcon.className = 'inkwell-style-custom-icon';
		setIcon(customIcon, 'pipette');
		bgCustomWrap.appendChild(customIcon);
		this.bgSwatchesContainer.appendChild(bgCustomWrap);

		bgSection.appendChild(this.bgSwatchesContainer);
		this.popoverEl.appendChild(bgSection);

		// --- Section 2: Bordure (Interrupteur Oui / Non) ---
		const borderToggleSection = document.createElement('div');
		borderToggleSection.className = 'inkwell-style-popover-row-inline';

		const borderToggleLabel = document.createElement('span');
		borderToggleLabel.className = 'inkwell-style-popover-label-inline';
		borderToggleLabel.textContent = 'Bordure';
		borderToggleSection.appendChild(borderToggleLabel);

		const switchWrapper = document.createElement('div');
		switchWrapper.className = 'inkwell-style-switch-wrap';

		this.borderSwitchLabel = document.createElement('span');
		this.borderSwitchLabel.className = 'inkwell-style-switch-text';
		this.borderSwitchLabel.textContent = this.isBorderActive ? 'Oui' : 'Non';
		switchWrapper.appendChild(this.borderSwitchLabel);

		const switchTrack = document.createElement('div');
		switchTrack.className = 'inkwell-style-switch-track';
		switchTrack.setAttribute('role', 'switch');
		switchTrack.setAttribute('tabindex', '0');
		switchTrack.setAttribute('aria-label', 'Activer ou désactiver la bordure');
		switchTrack.setAttribute(
			'aria-checked',
			this.isBorderActive ? 'true' : 'false',
		);
		if (this.isBorderActive) {
			switchTrack.classList.add('is-checked');
		}

		this.borderSwitchThumb = document.createElement('div');
		this.borderSwitchThumb.className = 'inkwell-style-switch-thumb';
		switchTrack.appendChild(this.borderSwitchThumb);

		const toggleBorder = () => {
			this.isBorderActive = !this.isBorderActive;
			switchTrack.setAttribute(
				'aria-checked',
				this.isBorderActive ? 'true' : 'false',
			);
			switchTrack.classList.toggle('is-checked', this.isBorderActive);
			this.borderSwitchLabel.textContent = this.isBorderActive ? 'Oui' : 'Non';

			if (this.isBorderActive) {
				this.currentStyle.border = true;
				if (this.rememberedBorderColor) {
					this.currentStyle.borderColor = this.rememberedBorderColor;
				}
			} else {
				this.currentStyle.border = false;
			}

			this.updateBorderSectionVisibility();
			this.options.onPreviewStyle(this.currentStyle);
			this.options.onCommitStyle(this.currentStyle);
		};

		switchTrack.addEventListener('click', toggleBorder);
		switchTrack.addEventListener('keydown', (e) => {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				toggleBorder();
			}
		});

		switchWrapper.appendChild(switchTrack);
		borderToggleSection.appendChild(switchWrapper);
		this.popoverEl.appendChild(borderToggleSection);

		// --- Section 3: Couleur de la bordure ---
		this.borderColorSection = document.createElement('div');
		this.borderColorSection.className = 'inkwell-style-popover-section';

		const borderColorLabel = document.createElement('label');
		borderColorLabel.className = 'inkwell-style-popover-label';
		borderColorLabel.textContent = 'Couleur de la bordure';
		this.borderColorSection.appendChild(borderColorLabel);

		this.borderColorSwatchesContainer = document.createElement('div');
		this.borderColorSwatchesContainer.className = 'inkwell-style-swatches-row';

		for (const preset of PRESET_BORDER_COLORS) {
			const swatch = document.createElement('button');
			swatch.type = 'button';
			swatch.className = 'inkwell-style-swatch';
			swatch.title = preset.label;
			swatch.setAttribute('aria-label', preset.label);
			if (preset.value) {
				swatch.style.backgroundColor = preset.value;
			} else {
				swatch.classList.add('is-default-swatch');
			}
			if ((this.currentStyle.borderColor ?? '') === preset.value) {
				swatch.classList.add('is-active');
			}

			swatch.addEventListener('click', () => {
				if (!this.isBorderActive) return;
				this.currentStyle.borderColor = preset.value ? preset.value : undefined;
				this.rememberedBorderColor = preset.value;
				this.updateActiveSwatches();
				this.options.onPreviewStyle(this.currentStyle);
				this.options.onCommitStyle(this.currentStyle);
			});
			this.borderColorSwatchesContainer.appendChild(swatch);
		}

		// Custom color picker for border
		const borderCustomWrap = document.createElement('label');
		borderCustomWrap.className = 'inkwell-style-custom-color-wrap';
		borderCustomWrap.title = 'Couleur de bordure personnalisée';

		this.borderCustomColorInput = document.createElement('input');
		this.borderCustomColorInput.type = 'color';
		this.borderCustomColorInput.className = 'inkwell-style-color-input';
		this.borderCustomColorInput.value = this.currentStyle.borderColor || '#64748b';

		this.borderCustomColorInput.addEventListener('input', () => {
			if (!this.isBorderActive) return;
			this.currentStyle.borderColor = this.borderCustomColorInput.value;
			this.rememberedBorderColor = this.borderCustomColorInput.value;
			this.updateActiveSwatches();
			this.options.onPreviewStyle(this.currentStyle);
		});

		this.borderCustomColorInput.addEventListener('change', () => {
			if (!this.isBorderActive) return;
			this.currentStyle.borderColor = this.borderCustomColorInput.value;
			this.rememberedBorderColor = this.borderCustomColorInput.value;
			this.updateActiveSwatches();
			this.options.onPreviewStyle(this.currentStyle);
			this.options.onCommitStyle(this.currentStyle);
		});

		borderCustomWrap.appendChild(this.borderCustomColorInput);
		const borderCustomIcon = document.createElement('span');
		borderCustomIcon.className = 'inkwell-style-custom-icon';
		setIcon(borderCustomIcon, 'pipette');
		borderCustomWrap.appendChild(borderCustomIcon);
		this.borderColorSwatchesContainer.appendChild(borderCustomWrap);

		this.borderColorSection.appendChild(this.borderColorSwatchesContainer);
		this.popoverEl.appendChild(this.borderColorSection);

		this.updateBorderSectionVisibility();

		// --- Footer: Action discrète Réinitialiser ---
		const footer = document.createElement('div');
		footer.className = 'inkwell-style-popover-footer';

		const resetBtn = document.createElement('button');
		resetBtn.type = 'button';
		resetBtn.className = 'inkwell-style-popover-reset-btn';
		resetBtn.textContent = 'Réinitialiser';
		resetBtn.title = 'Revenir au style par défaut de cet encadré';

		resetBtn.addEventListener('click', () => {
			this.currentStyle = {};
			this.isBorderActive = true;
			this.rememberedBorderColor = '';
			this.borderSwitchLabel.textContent = 'Oui';
			switchTrack.setAttribute('aria-checked', 'true');
			switchTrack.classList.add('is-checked');
			this.updateActiveSwatches();
			this.updateBorderSectionVisibility();
			this.options.onPreviewStyle(undefined);
			this.options.onCommitStyle(undefined);
		});

		footer.appendChild(resetBtn);
		this.popoverEl.appendChild(footer);
	}

	private updateBorderSectionVisibility(): void {
		if (this.isBorderActive) {
			this.borderColorSection.classList.remove('is-disabled');
		} else {
			this.borderColorSection.classList.add('is-disabled');
		}
	}

	private updateActiveSwatches(): void {
		// Update background swatches
		const bgSwatches = this.bgSwatchesContainer.querySelectorAll<HTMLButtonElement>(
			'button.inkwell-style-swatch',
		);
		bgSwatches.forEach((swatch, idx) => {
			const preset = PRESET_BG_COLORS[idx];
			if (!preset) return;
			const isMatch = (this.currentStyle.bg ?? '') === preset.value;
			swatch.classList.toggle('is-active', isMatch);
		});

		// Update border swatches
		const borderSwatches =
			this.borderColorSwatchesContainer.querySelectorAll<HTMLButtonElement>(
				'button.inkwell-style-swatch',
			);
		borderSwatches.forEach((swatch, idx) => {
			const preset = PRESET_BORDER_COLORS[idx];
			if (!preset) return;
			const isMatch = (this.currentStyle.borderColor ?? '') === preset.value;
			swatch.classList.toggle('is-active', isMatch);
		});
	}

	private reposition(): void {
		const anchorRect = this.options.anchorEl.getBoundingClientRect();
		const popoverRect = this.popoverEl.getBoundingClientRect();

		const margin = 10;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// Align right edge of popover with right edge of anchor by default
		let left = anchorRect.right - popoverRect.width;
		if (left + popoverRect.width > viewportWidth - margin) {
			left = viewportWidth - margin - popoverRect.width;
		}
		if (left < margin) {
			left = margin;
		}

		// Vertical: place below anchor, flip above if bottom overflows
		let top = anchorRect.bottom + 6;
		if (top + popoverRect.height > viewportHeight - margin) {
			const aboveTop = anchorRect.top - popoverRect.height - 6;
			if (aboveTop >= margin) {
				top = aboveTop;
			} else {
				top = Math.max(margin, viewportHeight - margin - popoverRect.height);
			}
		}

		this.popoverEl.style.left = `${Math.round(left)}px`;
		this.popoverEl.style.top = `${Math.round(top)}px`;
	}
}

/**
 * Convenience helper to open the callout style popover
 */
export function openCalloutStylePopover(
	options: CalloutStylePopoverOptions,
): CalloutStylePopover {
	return new CalloutStylePopover(options);
}
