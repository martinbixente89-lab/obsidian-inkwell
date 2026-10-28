import { App, Modal, Setting } from 'obsidian';
import type InkwellPlugin from '../main';
import { HighlightAppearance } from '../format/color-spans';
import {
	evaluateColorContrast,
	hsvToRgb,
	parseCssColor,
	resolveEffectiveThemeBackground,
	rgbToHex,
	rgbToHsv,
	rgbToRgba,
} from '../palette/contrast';
import { PaletteType } from '../palette/types';

export {
	hsvToRgb,
	rgbToHsv,
	rgbToHex,
	rgbToRgba,
};

export interface SaveToPaletteConfig {
	paletteId: string;
	name: string;
}

/**
 * Modal to pick any custom color or highlight freely with visual picker, hue slider,
 * exact HEX input, opacity slider (for highlights), appearance controls (corners, thickness, offset),
 * live preview with contrast ratio, and optional palette saving.
 */
export class CustomColorPickerModal extends Modal {
	private plugin: InkwellPlugin;
	private isHighlight: boolean;
	private onApply: (
		finalColor: string,
		saveToPalette?: SaveToPaletteConfig,
		appearance?: HighlightAppearance | null,
	) => void;
	private onCancel: () => void;

	// Internal color state
	private h = 210; // 0..360
	private s = 0.8; // 0..1
	private v = 0.75; // 0..1
	private alpha = 0.35; // 0.05..1.0 (for highlights)

	// Appearance state (Highlight only)
	private radius = 0; // 0..12 px
	private thickness = 100; // 15..100 %
	private position = 0; // 0..85 %

	// Palette saving state
	private isSaveToPalette = false;
	private selectedPaletteId = '';
	private customColorName = '';

	// State tracking
	private applied = false;

	constructor(
		app: App,
		plugin: InkwellPlugin,
		isHighlight: boolean,
		initialColor: string,
		onApply: (
			finalColor: string,
			saveToPalette?: SaveToPaletteConfig,
			appearance?: HighlightAppearance | null,
		) => void,
		onCancel: () => void,
		initialAppearance?: HighlightAppearance | null,
	) {
		super(app);
		this.plugin = plugin;
		this.isHighlight = isHighlight;
		this.onApply = onApply;
		this.onCancel = onCancel;

		if (initialAppearance) {
			this.radius = initialAppearance.radius ?? 0;
			this.thickness = initialAppearance.thickness ?? 100;
			this.position = initialAppearance.position ?? 0;
		}

		// Initialize color from initialColor
		const parsed = parseCssColor(initialColor);
		if (parsed) {
			const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
			this.h = hsv.h;
			this.s = hsv.s;
			this.v = hsv.v;
			this.alpha = isHighlight ? parsed.a : 1;
		} else if (isHighlight) {
			this.h = 45;
			this.s = 0.8;
			this.v = 1.0;
			this.alpha = 0.35;
		} else {
			this.h = 210;
			this.s = 0.8;
			this.v = 0.75;
			this.alpha = 1;
		}

		const targetPaletteType: PaletteType = isHighlight ? 'highlight' : 'text';
		const availablePalettes = this.plugin.settings.palettes.filter(
			(p) => p.type === targetPaletteType,
		);
		this.selectedPaletteId = availablePalettes[0]?.id ?? '';
	}

	onOpen(): void {
		this.modalEl.addClass('inkwell-custom-color-modal');
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('inkwell-custom-color-modal');

		contentEl.createEl('h3', {
			text: this.isHighlight ? 'Surlignage personnalisé' : 'Couleur de texte personnalisée',
		});

		// 1. Visual 2D picker area + Hue slider
		const visualSection = contentEl.createDiv({ cls: 'inkwell-custom-picker-visual' });

		const svArea = visualSection.createDiv({ cls: 'inkwell-custom-sv-area' });
		svArea.setAttribute('role', 'region');
		svArea.setAttribute('aria-label', 'Zone de saturation et luminosité');
		svArea.createDiv({ cls: 'inkwell-custom-sv-white' });
		svArea.createDiv({ cls: 'inkwell-custom-sv-black' });
		const svHandle = svArea.createDiv({ cls: 'inkwell-custom-sv-handle' });

		// Hue slider container
		const hueContainer = visualSection.createDiv({ cls: 'inkwell-custom-hue-container' });
		const hueSlider = hueContainer.createEl('input', {
			type: 'range',
			cls: 'inkwell-custom-hue-slider',
			attr: {
				min: '0',
				max: '360',
				step: '1',
				value: `${this.h}`,
				'aria-label': 'Réglage de la teinte',
			},
		});

		// Native color picker (companion)
		const nativePicker = hueContainer.createEl('input', {
			type: 'color',
			cls: 'inkwell-custom-native-picker',
			attr: {
				'aria-label': 'Sélecteur de couleur natif',
			},
		});

		// 2. Exact HEX input setting
		let hexInputEl: HTMLInputElement;
		new Setting(contentEl)
			.setName('Code hex')
			.setDesc('Format exact #rrggbb ou sans le dièse')
			.addText((text) => {
				hexInputEl = text.inputEl;
				text.inputEl.maxLength = 7;
				text.inputEl.setAttribute('aria-label', 'Code hex');
				text.onChange((val) => {
					let clean = val.trim();
					if (clean.startsWith('#')) clean = clean.slice(1);
					if (clean.length === 3 || clean.length === 6) {
						const testHex = `#${clean}`;
						const parsed = parseCssColor(testHex);
						if (parsed) {
							const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
							this.h = hsv.h;
							this.s = hsv.s;
							this.v = hsv.v;
							updateAll(false);
						}
					}
				});
			});

		// 3. Opacity slider setting (Highlight only)
		let opacityDescEl: HTMLElement | null = null;
		let radiusDescEl: HTMLElement | null = null;
		let thicknessDescEl: HTMLElement | null = null;
		let positionDescEl: HTMLElement | null = null;
		let radiusSliderEl: HTMLInputElement | null = null;
		let thicknessSliderEl: HTMLInputElement | null = null;
		let positionSliderEl: HTMLInputElement | null = null;

		if (this.isHighlight) {
			const opacitySetting = new Setting(contentEl)
				.setName('Opacité du surlignage')
				.setDesc(`Transparence appliquée (actuelle : ${Math.round(this.alpha * 100)}%)`)
				.addSlider((slider) => {
					slider.sliderEl.addClass('inkwell-opacity-slider');
					slider.sliderEl.setAttribute('aria-label', 'Opacité du surlignage');
					slider
						.setLimits(5, 100, 1)
						.setValue(Math.round(this.alpha * 100))
						.onChange((val) => {
							this.alpha = val / 100;
							if (opacityDescEl) {
								opacityDescEl.setText(`Transparence appliquée (actuelle : ${val}%)`);
							}
							updatePreviewAndContrast();
						});

					const onSliderInput = () => {
						const val = parseInt(slider.sliderEl.value, 10);
						if (!isNaN(val)) {
							this.alpha = val / 100;
							if (opacityDescEl) {
								opacityDescEl.setText(`Transparence appliquée (actuelle : ${val}%)`);
							}
							updatePreviewAndContrast();
						}
					};
					slider.sliderEl.addEventListener('input', onSliderInput);
					slider.sliderEl.addEventListener('change', onSliderInput);
				});
			opacityDescEl = opacitySetting.descEl;

			// Apparence section
			contentEl.createEl('h4', {
				text: 'Apparence',
				cls: 'inkwell-custom-section-title',
			});

			// 3a. Coins arrondis
			const radiusSetting = new Setting(contentEl)
				.setName('Coins arrondis')
				.setDesc(`Arrondi des angles (actuel : ${this.radius} px)`)
				.addSlider((slider) => {
					radiusSliderEl = slider.sliderEl;
					slider.sliderEl.setAttribute('aria-label', 'Coins arrondis');
					slider
						.setLimits(0, 12, 1)
						.setValue(this.radius)
						.onChange((val) => {
							this.radius = val;
							if (radiusDescEl) {
								radiusDescEl.setText(`Arrondi des angles (actuel : ${val} px)`);
							}
							updatePreviewAndContrast();
						});
					slider.sliderEl.addEventListener('input', () => {
						const val = parseInt(slider.sliderEl.value, 10);
						if (!isNaN(val)) {
							this.radius = val;
							if (radiusDescEl) {
								radiusDescEl.setText(`Arrondi des angles (actuel : ${val} px)`);
							}
							updatePreviewAndContrast();
						}
					});
				});
			radiusDescEl = radiusSetting.descEl;

			// 3b. Épaisseur
			const thicknessSetting = new Setting(contentEl)
				.setName('Épaisseur')
				.setDesc(`Hauteur du bandeau coloré (actuelle : ${this.thickness}%)`)
				.addSlider((slider) => {
					thicknessSliderEl = slider.sliderEl;
					slider.sliderEl.setAttribute('aria-label', 'Épaisseur du surlignage');
					slider
						.setLimits(15, 100, 5)
						.setValue(this.thickness)
						.onChange((val) => {
							this.thickness = val;
							if (thicknessDescEl) {
								thicknessDescEl.setText(`Hauteur du bandeau coloré (actuelle : ${val}%)`);
							}
							updatePreviewAndContrast();
						});
					slider.sliderEl.addEventListener('input', () => {
						const val = parseInt(slider.sliderEl.value, 10);
						if (!isNaN(val)) {
							this.thickness = val;
							if (thicknessDescEl) {
								thicknessDescEl.setText(`Hauteur du bandeau coloré (actuelle : ${val}%)`);
							}
							updatePreviewAndContrast();
						}
					});
				});
			thicknessDescEl = thicknessSetting.descEl;

			// 3c. Position verticale
			const positionSetting = new Setting(contentEl)
				.setName('Position verticale')
				.setDesc(`Décalage vertical du bandeau (actuel : ${this.position}%)`)
				.addSlider((slider) => {
					positionSliderEl = slider.sliderEl;
					slider.sliderEl.setAttribute('aria-label', 'Position verticale du surlignage');
					slider
						.setLimits(0, 85, 5)
						.setValue(this.position)
						.onChange((val) => {
							this.position = val;
							if (positionDescEl) {
								positionDescEl.setText(`Décalage vertical du bandeau (actuel : ${val}%)`);
							}
							updatePreviewAndContrast();
						});
					slider.sliderEl.addEventListener('input', () => {
						const val = parseInt(slider.sliderEl.value, 10);
						if (!isNaN(val)) {
							this.position = val;
							if (positionDescEl) {
								positionDescEl.setText(`Décalage vertical du bandeau (actuel : ${val}%)`);
							}
							updatePreviewAndContrast();
						}
					});
				});
			positionDescEl = positionSetting.descEl;

			// 3d. Bouton « Apparence par défaut »
			new Setting(contentEl)
				.setName('Apparence par défaut')
				.setDesc('Rétablit un surlignage couvrant toute la hauteur sans arrondi.')
				.addButton((btn) => {
					btn.setButtonText('Rétablir').onClick(() => {
						this.radius = 0;
						this.thickness = 100;
						this.position = 0;
						if (radiusSliderEl) radiusSliderEl.value = '0';
						if (thicknessSliderEl) thicknessSliderEl.value = '100';
						if (positionSliderEl) positionSliderEl.value = '0';
						if (radiusDescEl) radiusDescEl.setText('Arrondi des angles (actuel : 0 px)');
						if (thicknessDescEl) thicknessDescEl.setText('Hauteur du bandeau coloré (actuelle : 100%)');
						if (positionDescEl) positionDescEl.setText('Décalage vertical du bandeau (actuel : 0%)');
						updatePreviewAndContrast();
					});
				});
		}

		// 4. Live preview & Contrast
		const previewBox = contentEl.createDiv({ cls: 'inkwell-color-edit-preview' });
		const previewText = previewBox.createSpan({
			cls: 'inkwell-color-edit-text',
			text: 'Aperçu du texte sélectionné',
		});
		const contrastInfoEl = contentEl.createDiv({ cls: 'inkwell-color-edit-contrast' });

		// 5. Optional Palette Saving (Facultatif)
		const targetPaletteType: PaletteType = this.isHighlight ? 'highlight' : 'text';
		const availablePalettes = this.plugin.settings.palettes.filter(
			(p) => p.type === targetPaletteType,
		);

		const paletteSaveContainer = contentEl.createDiv({ cls: 'inkwell-custom-save-section' });
		let paletteDetailsContainer: HTMLElement | null = null;

		new Setting(paletteSaveContainer)
			.setName('Enregistrer dans une palette')
			.setDesc('Facultatif. Conserve la nuance dans une palette pour la réutiliser plus tard.')
			.addToggle((toggle) => {
				toggle.setValue(this.isSaveToPalette).onChange((val) => {
					this.isSaveToPalette = val;
					if (paletteDetailsContainer) {
						paletteDetailsContainer.toggleClass('is-hidden', !val);
					}
				});
			});

		paletteDetailsContainer = paletteSaveContainer.createDiv({
			cls: 'inkwell-custom-save-details is-hidden',
		});

		new Setting(paletteDetailsContainer)
			.setName('Nom dans la palette')
			.addText((text) => {
				text.setPlaceholder('Ex : Bleu nuit').onChange((val) => {
					this.customColorName = val.trim();
				});
			});

		new Setting(paletteDetailsContainer)
			.setName('Palette de destination')
			.addDropdown((dropdown) => {
				availablePalettes.forEach((p) => {
					dropdown.addOption(p.id, `${p.name}${p.isBuiltIn ? ' (intégrée)' : ''}`);
				});
				if (this.selectedPaletteId) {
					dropdown.setValue(this.selectedPaletteId);
				}
				dropdown.onChange((val) => {
					this.selectedPaletteId = val;
				});
			});

		// 6. Action buttons (Annuler & Appliquer)
		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Annuler').onClick(() => {
					this.close();
				});
			})
			.addButton((btn) => {
				btn
					.setButtonText('Appliquer')
					.setCta()
					.onClick(() => {
						this.applied = true;
						const rgb = hsvToRgb(this.h, this.s, this.v);
						const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
						const finalColor =
							this.isHighlight && this.alpha < 1
								? rgbToRgba(rgb.r, rgb.g, rgb.b, this.alpha)
								: hex;

						let saveConfig: SaveToPaletteConfig | undefined;
						if (this.isSaveToPalette && this.selectedPaletteId) {
							saveConfig = {
								paletteId: this.selectedPaletteId,
								name: this.customColorName || hex,
							};
						}

						const appearance: HighlightAppearance | null =
							this.isHighlight &&
							(this.radius > 0 || this.thickness < 100 || this.position > 0)
								? {
										radius: this.radius,
										thickness: this.thickness,
										position: this.position,
									}
								: null;
						this.onApply(finalColor, saveConfig, appearance);
						this.close();
					});
			});

		// Helper to compute current hex and rgba
		const getCurrentColorStrings = () => {
			const rgb = hsvToRgb(this.h, this.s, this.v);
			const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
			const rgba =
				this.isHighlight && this.alpha < 1
					? rgbToRgba(rgb.r, rgb.g, rgb.b, this.alpha)
					: hex;
			return { rgb, hex, rgba };
		};

		const updatePreviewAndContrast = () => {
			const { hex, rgba } = getCurrentColorStrings();
			if (this.isHighlight) {
				previewText.addClass('is-highlight');
				previewText.removeClass('is-text');
				const isGradient = this.thickness < 100 || this.position > 0;
				previewText.setCssProps({
					'--inkwell-preview-bg': isGradient ? 'transparent' : rgba,
					'--inkwell-preview-image': isGradient
						? `linear-gradient(to top, transparent ${this.position}%, ${rgba} ${this.position}%, ${rgba} ${this.position + this.thickness}%, transparent ${this.position + this.thickness}%)`
						: 'none',
					'--inkwell-preview-radius': `${this.radius}px`,
					'--inkwell-preview-color': rgba,
				});
			} else {
				previewText.addClass('is-text');
				previewText.removeClass('is-highlight');
				previewText.setCssProps({
					'--inkwell-preview-bg': 'transparent',
					'--inkwell-preview-image': 'none',
					'--inkwell-preview-radius': '0px',
					'--inkwell-preview-color': hex,
				});
			}

			// Contrast calculation
			const { background: themeBg, isRealMeasured, isDark } = resolveEffectiveThemeBackground();
			const evalResult = evaluateColorContrast({
				textColor: this.isHighlight ? (isDark ? '#e0e0e0' : '#1e1e1e') : hex,
				themeBackground: themeBg,
				isRealMeasured,
				isDarkTheme: isDark,
				highlightColor: this.isHighlight ? rgba : null,
			});

			contrastInfoEl.empty();
			const badge = contrastInfoEl.createDiv({
				cls: `inkwell-contrast-badge ${
					evalResult.passesNormal
						? 'is-pass-normal'
						: evalResult.passesLarge
							? 'is-pass-large'
							: 'is-low'
				}`,
			});
			badge.setText(
				`Ratio : ${evalResult.ratio.toFixed(2)}:1 — ${
					evalResult.passesNormal
						? 'Conforme texte normal (≥ 4.5:1)'
						: evalResult.passesLarge
							? 'Conforme grand texte (≥ 3:1)'
							: 'Contraste faible (< 3:1)'
				}`,
			);

			const bgEl = contrastInfoEl.createDiv({ cls: 'inkwell-contrast-bg' });
			if (this.isHighlight && this.thickness < 100) {
				bgEl.setText(`Fond évalué : ${evalResult.backgroundUsed} (zone couverte par le bandeau)`);
			} else {
				bgEl.setText(`Fond évalué : ${evalResult.backgroundUsed}`);
			}

			if (!evalResult.passesNormal && evalResult.suggestedColor) {
				const suggEl = contrastInfoEl.createDiv({ cls: 'inkwell-contrast-suggestion' });
				suggEl.setText(`Alternative recommandée : ${evalResult.suggestedColor}`);
			}
		};

		const updateAll = (updateHexInput = true) => {
			// Update SV area base background color
			svArea.style.backgroundColor = `hsl(${this.h}, 100%, 50%)`;

			// Update handle position
			svHandle.style.left = `${Math.round(this.s * 100)}%`;
			svHandle.style.top = `${Math.round((1 - this.v) * 100)}%`;

			// Update Hue slider
			hueSlider.value = `${Math.round(this.h)}`;

			const { hex } = getCurrentColorStrings();
			nativePicker.value = hex;

			if (updateHexInput && hexInputEl) {
				hexInputEl.value = hex;
			}

			updatePreviewAndContrast();
		};

		// Pointer dragging on SV area
		let isDragging = false;
		const handlePointer = (e: PointerEvent) => {
			const rect = svArea.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return;
			const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
			const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
			this.s = x / rect.width;
			this.v = 1 - y / rect.height;
			updateAll(true);
		};

		svArea.addEventListener('pointerdown', (e) => {
			isDragging = true;
			svArea.setPointerCapture(e.pointerId);
			handlePointer(e);
		});

		svArea.addEventListener('pointermove', (e) => {
			if (isDragging) {
				handlePointer(e);
			}
		});

		const stopDragging = (e: PointerEvent) => {
			if (isDragging) {
				isDragging = false;
				try {
					svArea.releasePointerCapture(e.pointerId);
				} catch {
					// Ignore if capture already lost
				}
			}
		};

		svArea.addEventListener('pointerup', stopDragging);
		svArea.addEventListener('pointercancel', stopDragging);

		// Hue slider listener
		hueSlider.addEventListener('input', () => {
			this.h = parseInt(hueSlider.value, 10);
			updateAll(true);
		});

		// Native picker listener
		nativePicker.addEventListener('input', () => {
			const parsed = parseCssColor(nativePicker.value);
			if (parsed) {
				const hsv = rgbToHsv(parsed.r, parsed.g, parsed.b);
				this.h = hsv.h;
				this.s = hsv.s;
				this.v = hsv.v;
				updateAll(true);
			}
		});

		// Initial render
		updateAll(true);
	}

	onClose(): void {
		if (!this.applied) {
			this.onCancel();
		}
		this.contentEl.empty();
	}
}
