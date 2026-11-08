import { App, debounce, Notice, PluginSettingTab, Setting } from 'obsidian';
import type InkwellPlugin from './main';
import { renderSlashMenuSetting } from './slash-menu/slash-settings';
import {
	getVisibleSettingsTabs,
	renderSettingsTabBar,
	resolveSettingsTab,
	SettingsTabId,
	TABS_ROW_ATTRIBUTES,
	TABS_ROW_CLASSES,
} from './settings/settings-tabs';
import { ToolbarPreview } from './settings/toolbar-preview';
import { captureFocus, FOCUS_ATTR, restoreFocus, stampFocusIds } from './settings/focus-restore';
import { palettesForSelector, renderPaletteSelector } from './settings/palette-selector';
import {
	styleRadiusHint,
	styleSupportsReduceTransparency,
	TOOLBAR_RADIUS_MAX,
	TOOLBAR_RADIUS_MIN,
	TOOLBAR_STYLE_OPTIONS,
} from './ui/toolbar-appearance';
import {
	DEFAULT_SETTINGS,
	InkwellSettings,
	sanitizeSettings,
} from './settings/types';
import {
	CustomPalette,
	ImportConflictMode,
	PaletteColorItem,
	PaletteType,
} from './palette/types';
import {
	BUILTIN_HIGHLIGHT_PALETTE_ID,
	BUILTIN_TEXT_PALETTE_ID,
	createDefaultPalettes,
	exportPalettesToJson,
	isColorFavorite,
	reorderPaletteColors,
	resolvePalettesImport,
	toggleFavoriteColor,
} from './palette/palette-manager';
import { evaluateColorContrast, resolveEffectiveThemeBackground } from './palette/contrast';
import {
	ConfirmActionModal,
	CreatePaletteModal,
	EditColorModal,
	ImportPalettesModal,
	RenamePaletteModal,
} from './ui/palette-modals';
import { CustomFontItem, getInkwellFontsDir } from './fonts/types';
import {
	ensureFontsDirectory,
	generateUniqueFamilyName,
	getFontExtension,
	inferFontAttributes,
	isSupportedFontExtension,
	loadFontItemIntoDocument,
	resolveUniqueDisplayName,
	resolveUniqueFileName,
	unregisterFontFromDocument,
	validateFontFaceBuffer,
} from './fonts/font-manager';
import { ConfirmDeleteFontModal, RenameFontModal } from './ui/font-modals';

export { DEFAULT_SETTINGS, sanitizeSettings };
export type { InkwellSettings };

export class InkwellSettingTab extends PluginSettingTab {
	plugin: InkwellPlugin;
	private selectedPaletteId: string | null = null;
	/** Session-only UI state (not stored in data.json). */
	private activeTab: SettingsTabId = 'general';
	private previewState: { selectedIndex: number | null } = { selectedIndex: null };

	constructor(app: App, plugin: InkwellPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const focusSnapshot = captureFocus(containerEl);
		containerEl.empty();
		containerEl.addClass('inkwell-settings');

		const visible = getVisibleSettingsTabs(this.plugin.settings);
		this.activeTab = resolveSettingsTab(this.activeTab, this.plugin.settings);
		// Ordinary setting row (see TABS_ROW_CLASSES) so Obsidian's keyboard navigation
		// reaches the tabs in both directions: sidebar → row → active tab → settings.
		const tabsRow = containerEl.createDiv({
			cls: [...TABS_ROW_CLASSES],
			attr: { ...TABS_ROW_ATTRIBUTES },
		});
		renderSettingsTabBar(tabsRow, visible, this.activeTab, (id, focus) => {
			this.activeTab = id;
			this.display();
			if (focus) {
				containerEl.querySelector<HTMLElement>(`.inkwell-settings-tab[data-tab="${id}"]`)?.focus();
			}
		});

		const panel = containerEl.createDiv({
			cls: 'inkwell-settings-panel',
			attr: { role: 'tabpanel' },
		});
		if (this.activeTab === 'toolbar') {
			this.renderToolbarTab(panel);
		} else if (this.activeTab === 'slash') {
			renderSlashMenuSetting(panel, this.plugin, () => this.display());
		} else {
			this.renderGeneralTab(panel);
		}

		stampFocusIds(containerEl);
		restoreFocus(containerEl, focusSnapshot, () =>
			containerEl.querySelector<HTMLElement>('.inkwell-settings-tab.is-active'),
		);
	}

	/* ---------------------------------------------------------------------- */
	/* Paramètres généraux                                                     */
	/* ---------------------------------------------------------------------- */

	private renderGeneralTab(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Fonctionnalités').setHeading();

		new Setting(containerEl)
			.setName('Barre d’outils à la sélection')
			.setDesc(
				'Affiche une barre d’outils contextuelle lors de la sélection de texte en aperçu en direct. Sa personnalisation est conservée lorsqu’elle est désactivée.',
			)
			.addToggle((toggle) => {
				toggle.toggleEl.setAttribute(FOCUS_ATTR, 'toolbar-enabled');
				toggle
					.setValue(this.plugin.settings.toolbarEnabled)
					.onChange(async (value) => {
						this.plugin.settings.toolbarEnabled = value;
						await this.plugin.saveSettings();
						this.plugin.onToolbarSettingChanged();
						this.display();
					});
			});

		new Setting(containerEl).setName('Couleurs par défaut').setHeading();
		this.buildDefaultTextColorSetting(containerEl);
		this.buildDefaultHighlightColorSetting(containerEl);

		new Setting(containerEl).setName('Édition').setHeading();

		// 3c. Page Width Mode (Standard vs Full Width)
		new Setting(containerEl)
			.setName('Largeur de page')
			.setDesc(
				'Définit la largeur d’écriture dans les panneaux de notes Markdown sans modifier la configuration globale du coffre. Le mode « Pleine largeur » utilise toute la largeur disponible avec des marges confortables pour les poignées de blocs.',
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption('full', 'Pleine largeur (marges confortables)')
					.addOption('standard', 'Standard (longueur de ligne d’Obsidian)')
					.setValue(this.plugin.settings.pageWidthMode)
					.onChange(async (value) => {
						this.plugin.settings.pageWidthMode =
							value === 'standard' ? 'standard' : 'full';
						await this.plugin.saveSettings();
						this.plugin.updateColumnPrototypeBodyClass();
					});
			});

		// 4. Tag Navigation & Hiding
		new Setting(containerEl)
			.setName('Navigation et masquage des balises')
			.setDesc(
				'Aperçu en direct (macOS Desktop). Les flèches franchissent en une fois les balises Inkwell et celles-ci sont masquées pendant l’édition. Activé par défaut pour les nouvelles installations. Ne modifie aucune note existante.',
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.experimentalTagNavigation)
					.onChange(async (value) => {
						this.plugin.settings.experimentalTagNavigation = value;
						await this.plugin.saveSettings();
						this.plugin.onTagNavigationSettingChanged();
					});
			});

		// 5. Bold & Color support
		new Setting(containerEl)
			.setName('Prise en charge couleur et gras')
			.setDesc(
				'Requiert la navigation de balises. Masque et préserve les combinaisons canoniques (Cas 6 : **<span>...</span>**). Le gras partiel est réécrit en segments partitionnés. Le Cas 1 historique (<span...>**...**</span>) reste protégé sans migration automatique. Activé par défaut.',
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.experimentalColorBoldSupport)
					.onChange(async (value) => {
						this.plugin.settings.experimentalColorBoldSupport = value;
						await this.plugin.saveSettings();
						this.plugin.onTagNavigationSettingChanged();
					});
			});

		// Resources used by commands stay reachable when the toolbar is disabled.
		if (!this.plugin.settings.toolbarEnabled) {
			new Setting(containerEl)
				.setName('Couleurs et polices')
				.setDesc(
					'Palettes et polices utilisées par les commandes d’Inkwell. Elles apparaissent dans l’onglet Toolbar lorsque la barre d’outils est activée.',
				)
				.setHeading();
			this.renderColorsAndFonts(containerEl);
		}

		new Setting(containerEl).setName('Rétablissement complet').setHeading();

		new Setting(containerEl)
			.setName('Rétablir tous les réglages par défaut')
			.setDesc(
				'Réinitialise l’ensemble des réglages Inkwell (couleurs par défaut, options de barre et de navigation). Ne modifie aucune note existante.',
			)
			.addButton((button) => {
				button
					.setButtonText('Tout réinitialiser')
					.setWarning()
					.onClick(() => {
						new ConfirmActionModal(
							this.app,
							'Rétablir tous les réglages par défaut ?',
							'Tous les réglages d’Inkwell seront réinitialisés à leur configuration d’origine. Vos notes ne seront pas modifiées.',
							'Tout réinitialiser',
							() => {
								void (async () => {
									this.plugin.settings = { ...DEFAULT_SETTINGS };
									await this.plugin.saveSettings();
									this.plugin.onTagNavigationSettingChanged();
									this.plugin.onToolbarSettingChanged();
									this.display();
									new Notice('Tous les paramètres ont été réinitialisés.');
								})();
							},
						).open();
					});
			});
	}

	/* ---------------------------------------------------------------------- */
	/* Toolbar                                                                 */
	/* ---------------------------------------------------------------------- */

	private renderToolbarTab(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Personnalisation de la toolbar').setHeading();
		this.renderToolbarPersonalization(containerEl);
		this.renderColorsAndFonts(containerEl);
	}

	private renderToolbarPersonalization(containerEl: HTMLElement): void {
		const preview = new ToolbarPreview(containerEl, this.plugin, this.previewState);
		const applyToolbar = () => {
			this.plugin.onToolbarSettingChanged();
			preview.refresh();
		};

		new Setting(containerEl)
			.setName('Forme de la toolbar')
			.setDesc('Choisissez l’apparence de votre toolbar.')
			.addDropdown((dropdown) => {
				for (const option of TOOLBAR_STYLE_OPTIONS) {
					dropdown.addOption(option.value, option.label);
				}
				dropdown.setValue(this.plugin.settings.toolbarStyle).onChange(async (value: string) => {
					const known = TOOLBAR_STYLE_OPTIONS.find((o) => o.value === value);
					this.plugin.settings.toolbarStyle = known ? known.value : 'classic';
					await this.plugin.saveSettings();
					applyToolbar();
					renderSubOptions();
				});
			});

		const subEl = containerEl.createDiv({ cls: 'inkwell-toolbar-suboptions' });
		const renderSubOptions = () => {
			subEl.empty();
			this.renderCornerRadiusSetting(subEl, applyToolbar);
			if (styleSupportsReduceTransparency(this.plugin.settings.toolbarStyle)) {
				new Setting(subEl)
					.setName('Réduire la transparence')
					.setDesc(
						'Désactive les effets de transparence et de flou translucide au profit d’un fond opaque contrasté, améliorant la lisibilité sur fond complexe ou si la transparence fatigue.',
					)
					.addToggle((toggle) => {
						toggle
							.setValue(this.plugin.settings.toolbarReduceTransparency)
							.onChange(async (value) => {
								this.plugin.settings.toolbarReduceTransparency = value;
								await this.plugin.saveSettings();
								applyToolbar();
							});
					});
			}
		};
		renderSubOptions();
	}

	private renderCornerRadiusSetting(containerEl: HTMLElement, applyToolbar: () => void): void {
		const settings = this.plugin.settings;
		const describe = () =>
			settings.toolbarCornerRadius === null
				? 'Arrondi du style'
				: `${settings.toolbarCornerRadius} px`;

		const setting = new Setting(containerEl)
			.setName('Arrondi des coins')
			.setDesc(
				`Arrondi du conteneur de la toolbar, de ${TOOLBAR_RADIUS_MIN} à ${TOOLBAR_RADIUS_MAX} px. Au-delà de la moitié de la hauteur de la barre, la forme est déjà une capsule.`,
			);
		const valueEl = setting.controlEl.createSpan({
			cls: 'inkwell-radius-value',
			attr: { 'aria-live': 'polite' },
		});
		valueEl.setText(describe());

		let resetButton: { setDisabled: (disabled: boolean) => unknown } | null = null;
		const persist = debounce(
			async () => {
				await this.plugin.saveSettings();
			},
			250,
			true,
		);
		const applyValue = (value: number | null) => {
			settings.toolbarCornerRadius = value;
			valueEl.setText(describe());
			resetButton?.setDisabled(value === null);
			applyToolbar();
		};

		setting.addSlider((slider) => {
			// Only shows the current value; nothing is stored until the user moves the slider.
			slider
				.setLimits(TOOLBAR_RADIUS_MIN, TOOLBAR_RADIUS_MAX, 1)
				.setValue(settings.toolbarCornerRadius ?? styleRadiusHint(settings.toolbarStyle))
				.setDynamicTooltip();
			slider.sliderEl.setAttribute('aria-label', 'Arrondi des coins de la toolbar, en pixels');
			if (settings.toolbarCornerRadius === null) {
				slider.sliderEl.setAttribute('aria-valuetext', 'Arrondi du style');
			}
			// Live preview while dragging (works on every supported Obsidian version).
			slider.sliderEl.addEventListener('input', () => {
				const value = Number(slider.sliderEl.value);
				slider.sliderEl.removeAttribute('aria-valuetext');
				applyValue(value);
				persist();
			});
			slider.onChange((value) => {
				applyValue(value);
				persist();
			});
		});
		valueEl.parentElement?.prepend(valueEl);

		setting.addExtraButton((btn) => {
			resetButton = btn;
			btn
				.setIcon('rotate-ccw')
				.setTooltip('Rétablir l’arrondi du style')
				.setDisabled(settings.toolbarCornerRadius === null)
				.onClick(() => {
					applyValue(null);
					void this.plugin.saveSettings();
					this.display();
				});
		});
	}

	/* ---------------------------------------------------------------------- */
	/* Palettes and fonts (Toolbar tab, or General when the toolbar is off)    */
	/* ---------------------------------------------------------------------- */

	private renderColorsAndFonts(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Palette de couleurs').setHeading();

		const presets = new Setting(containerEl)
			.setName('Palettes prédéfinies')
			.setDesc('Choisissez une palette de couleurs prédéfinie.');
		// Inside the setting row so Obsidian's keyboard navigation reaches the listboxes.
		presets.settingEl.addClass('inkwell-palette-presets');
		const selectors = presets.settingEl.createDiv({ cls: 'inkwell-palette-selectors' });
		const choose = async (palette: CustomPalette) => {
			if (palette.type === 'text') {
				this.plugin.settings.activeTextPaletteId = palette.id;
			} else {
				this.plugin.settings.activeHighlightPaletteId = palette.id;
			}
			await this.plugin.saveSettings();
		};
		renderPaletteSelector(selectors, {
			label: 'Palette de texte',
			palettes: palettesForSelector(this.plugin.settings.palettes, 'text'),
			activeId: this.plugin.settings.activeTextPaletteId,
			onSelect: (p) => void choose(p),
		});
		renderPaletteSelector(selectors, {
			label: 'Palette de surlignage',
			palettes: palettesForSelector(this.plugin.settings.palettes, 'highlight'),
			activeId: this.plugin.settings.activeHighlightPaletteId,
			onSelect: (p) => void choose(p),
		});

		new Setting(containerEl)
			.setName('Importation de palettes')
			.setDesc('Importez vos propres palettes.')
			.addButton((btn) => {
				btn.setButtonText('Importer depuis JSON').onClick(() => {
					new ImportPalettesModal(
						this.app,
						(imported: CustomPalette[], mode: ImportConflictMode) => {
							void (async () => {
								this.plugin.settings.palettes = resolvePalettesImport(
									this.plugin.settings.palettes,
									imported,
									mode,
								);
								await this.plugin.saveSettings();
								this.display();
								new Notice('Palettes importées avec succès.');
							})();
						},
					).open();
				});
			});

		new Setting(containerEl)
			.setName('Exporter les palettes')
			.setDesc('Télécharge vos palettes au format JSON documenté et validé (schéma v1).')
			.addButton((btn) => {
				btn.setButtonText('Exporter en JSON').onClick(() => {
					this.exportPalettes();
				});
			});

		// Personal palettes (created or imported)
		const personal = this.plugin.settings.palettes.filter((p) => !p.isBuiltIn);
		const box = containerEl.createDiv({ cls: 'inkwell-settings-box' });
		box.createDiv({ cls: 'inkwell-settings-box-title', text: 'Palettes personnelles' });
		if (personal.length === 0) {
			box.createDiv({
				cls: 'inkwell-settings-box-empty',
				text: 'Aucune palette personnelle. Créez-en une ci-dessous ou importez un fichier JSON.',
			});
		} else {
			for (const palette of personal) {
				const row = box.createDiv({ cls: 'inkwell-personal-palette' });
				row.createSpan({ cls: 'inkwell-personal-palette-name', text: palette.name });
				row.createSpan({
					cls: 'inkwell-palette-option-meta',
					text: palette.type === 'text' ? 'Texte' : 'Surlignage',
				});
				const sw = row.createDiv({ cls: 'inkwell-palette-option-swatches', attr: { 'aria-hidden': 'true' } });
				for (const color of palette.colors.slice(0, 12)) {
					sw.createSpan({ cls: 'inkwell-palette-option-swatch' }).setCssProps({
						'--inkwell-swatch-color': color.value,
					});
				}
			}
		}

		new Setting(containerEl)
			.setName('Modifier une palette')
			.setDesc(
				'Créez, renommez ou supprimez des palettes et modifiez leurs couleurs (palettes intégrées comprises). Vos couleurs sont immédiatement disponibles dans la barre d’outils et les commandes.',
			)
			.setHeading();
		this.buildPaletteManagerSection(containerEl);

		new Setting(containerEl)
			.setName('Réinitialiser les palettes')
			.setDesc(
				'Rétablit les palettes de texte et de surlignage intégrées sans modifier vos autres réglages ni vos notes.',
			)
			.addButton((btn) => {
				btn
					.setButtonText('Réinitialiser les palettes')
					.setWarning()
					.onClick(() => {
						new ConfirmActionModal(
							this.app,
							'Réinitialiser les palettes ?',
							'Cette action restaurera les palettes intégrées par défaut et supprimera les palettes personnalisées. Vos notes et les autres réglages restent inchangés.',
							'Réinitialiser uniquement les palettes',
							() => {
								void (async () => {
									this.plugin.settings.palettes = createDefaultPalettes();
									this.plugin.settings.activeTextPaletteId = BUILTIN_TEXT_PALETTE_ID;
									this.plugin.settings.activeHighlightPaletteId = BUILTIN_HIGHLIGHT_PALETTE_ID;
									this.selectedPaletteId = BUILTIN_TEXT_PALETTE_ID;

									// Verify fallbacks for default colors
									const textColors = this.plugin.settings.palettes[0]?.colors ?? [];
									if (!textColors.some((c) => c.value === this.plugin.settings.defaultColor)) {
										this.plugin.settings.defaultColor = textColors[0]?.value ?? '#e03131';
									}
									const hlColors = this.plugin.settings.palettes[1]?.colors ?? [];
									if (!hlColors.some((h) => h.value === this.plugin.settings.defaultHighlightColor)) {
										this.plugin.settings.defaultHighlightColor = hlColors[0]?.value ?? 'rgba(255, 212, 59, 0.35)';
									}

									await this.plugin.saveSettings();
									this.display();
									new Notice('Palettes réinitialisées aux valeurs par défaut.');
								})();
							},
						).open();
					});
			});

		new Setting(containerEl).setName('Polices d’écriture').setHeading();
		this.buildCustomFontsSection(containerEl);
	}

	private buildDefaultTextColorSetting(containerEl: HTMLElement): void {
		const textPalettes = this.plugin.settings.palettes.filter((p) => p.type === 'text');
		const allTextColors: Array<{ name: string; value: string; paletteName: string }> = [];

		for (const p of textPalettes) {
			for (const c of p.colors) {
				allTextColors.push({
					name: c.name,
					value: c.value,
					paletteName: p.name,
				});
			}
		}

		// Ensure current default is in the list; if not, fallback to first available or #e03131
		const hasCurrent = allTextColors.some(
			(c) => c.value.toLowerCase() === this.plugin.settings.defaultColor.toLowerCase(),
		);
		if (!hasCurrent && allTextColors.length > 0) {
			this.plugin.settings.defaultColor = allTextColors[0]?.value ?? '#e03131';
			void this.plugin.saveSettings();
		}

		new Setting(containerEl)
			.setName('Couleur de texte par défaut')
			.setDesc(
				'Couleur appliquée directement avec la commande d’application rapide de texte.',
			)
			.addDropdown((dropdown) => {
				for (const item of allTextColors) {
					dropdown.addOption(item.value, `${item.name} (${item.paletteName})`);
				}
				dropdown.setValue(this.plugin.settings.defaultColor);

				const swatch = containerEl.createSpan({
					cls: 'inkwell-setting-swatch',
				});
				this.updateSwatchDisplay(swatch, this.plugin.settings.defaultColor);
				dropdown.selectEl.parentElement?.appendChild(swatch);

				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultColor = value;
					this.updateSwatchDisplay(swatch, value);
					await this.plugin.saveSettings();
				});
			});
	}

	private buildDefaultHighlightColorSetting(containerEl: HTMLElement): void {
		const hlPalettes = this.plugin.settings.palettes.filter((p) => p.type === 'highlight');
		const allHlColors: Array<{ name: string; value: string; paletteName: string }> = [];

		for (const p of hlPalettes) {
			for (const h of p.colors) {
				allHlColors.push({
					name: h.name,
					value: h.value,
					paletteName: p.name,
				});
			}
		}

		const hasCurrent = allHlColors.some(
			(h) =>
				h.value.replace(/\s+/g, '').toLowerCase() ===
				this.plugin.settings.defaultHighlightColor.replace(/\s+/g, '').toLowerCase(),
		);
		if (!hasCurrent && allHlColors.length > 0) {
			this.plugin.settings.defaultHighlightColor =
				allHlColors[0]?.value ?? 'rgba(255, 212, 59, 0.35)';
			void this.plugin.saveSettings();
		}

		new Setting(containerEl)
			.setName('Couleur de surlignage par défaut')
			.setDesc(
				'Teinte appliquée directement avec la commande d’application rapide de surlignage.',
			)
			.addDropdown((dropdown) => {
				for (const item of allHlColors) {
					dropdown.addOption(item.value, `${item.name} (${item.paletteName})`);
				}
				dropdown.setValue(this.plugin.settings.defaultHighlightColor);

				const swatch = containerEl.createSpan({
					cls: 'inkwell-setting-swatch',
				});
				this.updateSwatchDisplay(swatch, this.plugin.settings.defaultHighlightColor);
				dropdown.selectEl.parentElement?.appendChild(swatch);

				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultHighlightColor = value;
					this.updateSwatchDisplay(swatch, value);
					await this.plugin.saveSettings();
				});
			});
	}

	private buildPaletteManagerSection(containerEl: HTMLElement): void {
		const palettes = this.plugin.settings.palettes;
		if (palettes.length === 0) {
			this.plugin.settings.palettes = createDefaultPalettes();
		}

		if (!this.selectedPaletteId || !palettes.some((p) => p.id === this.selectedPaletteId)) {
			this.selectedPaletteId = palettes[0]?.id ?? BUILTIN_TEXT_PALETTE_ID;
		}

		const activePalette =
			palettes.find((p) => p.id === this.selectedPaletteId) ?? palettes[0];
		if (!activePalette) return;

		// Palette Selector and Global Palette Actions
		const paletteToolbar = new Setting(containerEl)
			.setName('Palette à modifier')
			.setDesc(
				`${activePalette.type === 'text' ? 'Palette de texte' : 'Palette de surlignage'}${
					activePalette.isBuiltIn ? ' (intégrée)' : ' (personnalisée)'
				}`,
			)
			.addDropdown((dropdown) => {
				for (const p of palettes) {
					dropdown.addOption(
						p.id,
						`${p.name} [${p.type === 'text' ? 'Texte' : 'Surlignage'}]${
							p.isBuiltIn ? ' (Intégrée)' : ''
						}`,
					);
				}
				dropdown.setValue(this.selectedPaletteId!);
				dropdown.onChange((val) => {
					this.selectedPaletteId = val;
					this.display();
				});
			})
			.addButton((btn) => {
				btn.setButtonText('Nouvelle palette').onClick(() => {
					new CreatePaletteModal(
						this.app,
						activePalette.type,
						(name: string, type: PaletteType) => {
							void (async () => {
								const newId = `custom-palette-${Date.now()}`;
								const newPalette: CustomPalette = {
									id: newId,
									name,
									type,
									isBuiltIn: false,
									colors: [],
								};
								this.plugin.settings.palettes.push(newPalette);
								this.selectedPaletteId = newId;
								await this.plugin.saveSettings();
								this.display();
								new Notice(`Palette « ${name} » créée.`);
							})();
						},
					).open();
				});
			});

		// Rename and Delete for custom palettes
		if (!activePalette.isBuiltIn) {
			paletteToolbar.addButton((btn) => {
				btn.setButtonText('Renommer').onClick(() => {
					new RenamePaletteModal(this.app, activePalette.name, (newName: string) => {
						void (async () => {
							activePalette.name = newName;
							await this.plugin.saveSettings();
							this.display();
							new Notice('Palette renommée.');
						})();
					}).open();
				});
			});

			paletteToolbar.addButton((btn) => {
				btn
					.setButtonText('Supprimer')
					.setWarning()
					.onClick(() => {
						new ConfirmActionModal(
							this.app,
							`Supprimer la palette « ${activePalette.name} » ?`,
							'Les couleurs de cette palette ne seront plus proposées, mais les styles déjà enregistrés dans vos notes resteront inchangés.',
							'Supprimer la palette',
							() => {
								void (async () => {
									this.plugin.settings.palettes = this.plugin.settings.palettes.filter(
										(p) => p.id !== activePalette.id,
									);
									this.selectedPaletteId =
										this.plugin.settings.palettes[0]?.id ?? BUILTIN_TEXT_PALETTE_ID;
									await this.plugin.saveSettings();
									this.display();
									new Notice('Palette supprimée.');
								})();
							},
						).open();
					});
			});
		}

		// Colors List Header
		new Setting(containerEl)
			.setName(`Couleurs disponibles (${activePalette.colors.length})`)
			.setDesc(
				'Réorganisez, marquez en favori, modifiez ou supprimez les couleurs de cette palette.',
			)
			.addButton((btn) => {
				btn
					.setButtonText('Ajouter une couleur')
					.setCta()
					.onClick(() => {
						new EditColorModal(
							this.app,
							activePalette.type === 'highlight',
							undefined,
							(newItem: PaletteColorItem) => {
								void (async () => {
									activePalette.colors.push(newItem);
									await this.plugin.saveSettings();
									this.display();
									new Notice(`Couleur « ${newItem.name} » ajoutée.`);
								})();
							},
						).open();
					});
			});

		// Render list of color items
		const colorListContainer = containerEl.createDiv({ cls: 'inkwell-settings-color-list' });

		if (activePalette.colors.length === 0) {
			const emptyEl = colorListContainer.createDiv({ cls: 'inkwell-settings-empty' });
			emptyEl.setText('Aucune couleur dans cette palette. Cliquez sur « ajouter une couleur ».');
			return;
		}

		const favList =
			activePalette.type === 'text'
				? this.plugin.settings.favoriteColors
				: this.plugin.settings.favoriteHighlights;

		activePalette.colors.forEach((c, index) => {
			const row = colorListContainer.createDiv({ cls: 'inkwell-settings-color-row' });

			// Swatch
			const swatch = row.createSpan({ cls: 'inkwell-modal-swatch' });
			swatch.setCssProps({ '--inkwell-swatch-color': c.value });

			// Info & Name
			const info = row.createDiv({ cls: 'inkwell-settings-color-info' });
			info.createSpan({ cls: 'inkwell-settings-color-name', text: c.name });
			info.createSpan({ cls: 'inkwell-settings-color-val', text: c.value });

			// Contrast indicator against theme
			const { background: themeBg, isRealMeasured, isDark: themeIsDark } = resolveEffectiveThemeBackground();
			const evalResult = evaluateColorContrast({
				textColor:
					activePalette.type === 'highlight'
						? themeIsDark
							? '#e0e0e0'
							: '#1e1e1e'
						: c.value,
				themeBackground: themeBg,
				isRealMeasured,
				isDarkTheme: themeIsDark,
				highlightColor: activePalette.type === 'highlight' ? c.value : null,
			});

			const contrastBadge = row.createSpan({
				cls: `inkwell-contrast-badge ${
					evalResult.passesNormal
						? 'is-pass-normal'
						: evalResult.passesLarge
							? 'is-pass-large'
							: 'is-low'
				}`,
				text: `${evalResult.ratio.toFixed(1)}:1`,
			});
			contrastBadge.setAttribute(
				'title',
				`Contraste sur fond ${evalResult.backgroundUsed} : ${
					evalResult.passesNormal
						? 'Conforme texte normal'
						: evalResult.passesLarge
							? 'Conforme grand texte'
							: 'Faible'
				}`,
			);

			// Action buttons container
			const actions = row.createDiv({ cls: 'inkwell-settings-color-actions' });

			// Favorite toggle button
			const isFav = isColorFavorite(favList, c.value);
			const favBtn = actions.createEl('button', {
				cls: `inkwell-btn-icon ${isFav ? 'is-favorite' : ''}`,
				text: isFav ? '★' : '☆',
			});
			favBtn.setAttribute(FOCUS_ATTR, `color:${activePalette.id}:${c.id}:favorite`);
			favBtn.setAttribute('title', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
			favBtn.addEventListener('click', () => {
				void (async () => {
					if (activePalette.type === 'text') {
						const res = toggleFavoriteColor(this.plugin.settings.favoriteColors, c.value);
						this.plugin.settings.favoriteColors = res.list;
					} else {
						const res = toggleFavoriteColor(
							this.plugin.settings.favoriteHighlights,
							c.value,
						);
						this.plugin.settings.favoriteHighlights = res.list;
					}
					await this.plugin.saveSettings();
					this.display();
				})();
			});

			// Move Up button
			const upBtn = actions.createEl('button', {
				cls: 'inkwell-btn-icon',
				text: '↑',
			});
			upBtn.setAttribute(FOCUS_ATTR, `color:${activePalette.id}:${c.id}:up`);
			upBtn.setAttribute('title', 'Déplacer vers le haut');
			if (index === 0) upBtn.setAttribute('disabled', 'true');
			upBtn.addEventListener('click', () => {
				void (async () => {
					const updated = reorderPaletteColors(activePalette, index, index - 1);
					activePalette.colors = updated.colors;
					await this.plugin.saveSettings();
					this.display();
				})();
			});

			// Move Down button
			const downBtn = actions.createEl('button', {
				cls: 'inkwell-btn-icon',
				text: '↓',
			});
			downBtn.setAttribute(FOCUS_ATTR, `color:${activePalette.id}:${c.id}:down`);
			downBtn.setAttribute('title', 'Déplacer vers le bas');
			if (index === activePalette.colors.length - 1) downBtn.setAttribute('disabled', 'true');
			downBtn.addEventListener('click', () => {
				void (async () => {
					const updated = reorderPaletteColors(activePalette, index, index + 1);
					activePalette.colors = updated.colors;
					await this.plugin.saveSettings();
					this.display();
				})();
			});

			// Edit color button
			const editBtn = actions.createEl('button', {
				cls: 'inkwell-btn-icon',
				text: '✎',
			});
			editBtn.setAttribute(FOCUS_ATTR, `color:${activePalette.id}:${c.id}:edit`);
			editBtn.setAttribute('title', 'Modifier cette couleur');
			editBtn.addEventListener('click', () => {
				new EditColorModal(
					this.app,
					activePalette.type === 'highlight',
					c,
					(modifiedItem: PaletteColorItem) => {
						void (async () => {
							activePalette.colors[index] = modifiedItem;
							await this.plugin.saveSettings();
							this.display();
							new Notice('Couleur modifiée.');
						})();
					},
				).open();
			});

			// Delete color button
			const delBtn = actions.createEl('button', {
				cls: 'inkwell-btn-icon is-danger',
				text: '×',
			});
			delBtn.setAttribute(FOCUS_ATTR, `color:${activePalette.id}:${c.id}:delete`);
			delBtn.setAttribute('title', 'Supprimer cette couleur');
			delBtn.addEventListener('click', () => {
				void (async () => {
					activePalette.colors.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
					new Notice('Couleur supprimée de la palette.');
				})();
			});
		});
	}

	private updateSwatchDisplay(el: HTMLElement, value: string): void {
		el.setCssProps({
			'--inkwell-swatch-color': value,
		});
		el.setAttribute('title', value);
	}

	private exportPalettes(): void {
		const json = exportPalettesToJson(this.plugin.settings.palettes);
		try {
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = activeWindow.document.createElement('a');
			a.href = url;
			a.download = 'inkwell-palettes.json';
			a.click();
			URL.revokeObjectURL(url);
			new Notice('Fichier inkwell-palettes.json téléchargé.');
		} catch {
			// Fallback copy to clipboard
			void navigator.clipboard.writeText(json);
			new Notice('Palettes copiées dans le presse-papier au format JSON.');
		}
	}

	private buildCustomFontsSection(containerEl: HTMLElement): void {
		const importZone = containerEl.createDiv({ cls: 'inkwell-font-import-zone' });
		const importSetting = new Setting(importZone)
			.setName('Importation des polices')
			.setDesc(
				'Importez des polices pour styliser vos notes. Formats acceptés : .ttf, .otf, .woff ou .woff2 ; chaque fichier est validé puis copié dans le dossier de polices du plugin.',
			);

		const fileInput = activeWindow.document.createElement('input');
		fileInput.type = 'file';
		fileInput.multiple = true;
		fileInput.accept = '.ttf,.otf,.woff,.woff2';
		fileInput.addClass('inkwell-hidden-file-input');
		containerEl.appendChild(fileInput);

		fileInput.addEventListener('change', () => {
			const files = Array.from(fileInput.files ?? []);
			if (files.length === 0) return;

			void (async () => {
				let importedCount = 0;
				for (const file of files) {
					const ext = getFontExtension(file.name);
					if (!isSupportedFontExtension(ext)) {
						new Notice(
							`Le fichier « ${file.name} » a une extension non supportée. Formats acceptés : .ttf, .otf, .woff, .woff2.`,
						);
						continue;
					}

					const buffer = await file.arrayBuffer();
					if (buffer.byteLength === 0) {
						new Notice(`Le fichier « ${file.name} » est vide.`);
						continue;
					}

					const inferred = inferFontAttributes(file.name);
					const tempFamily = generateUniqueFamilyName(inferred.displayName, 'validation');
					const validation = await validateFontFaceBuffer(
						tempFamily,
						buffer,
						inferred.style,
						inferred.weight,
					);

					if (!validation.valid) {
						new Notice(
							`Le fichier « ${file.name} » n’a pas pu être chargé comme police valide : ${validation.error}`,
						);
						continue;
					}

					// Duplicate detection and non-destructive resolution
					const uniqueFileName = resolveUniqueFileName(
						this.plugin.settings.customFonts,
						file.name,
					);
					const uniqueDisplayName = resolveUniqueDisplayName(
						this.plugin.settings.customFonts,
						inferred.displayName,
					);

					if (uniqueFileName !== file.name || uniqueDisplayName !== inferred.displayName) {
						new Notice(
							`Doublon détecté pour « ${file.name} » : enregistré sous « ${uniqueFileName} » (« ${uniqueDisplayName} »).`,
						);
					}

					await ensureFontsDirectory(this.app.vault);
					const relativePath = `${getInkwellFontsDir(this.app.vault)}/${uniqueFileName}`;
					await this.app.vault.adapter.writeBinary(relativePath, buffer);

					const id = `font-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
					const familyName = generateUniqueFamilyName(uniqueDisplayName, id);

					const fontItem: CustomFontItem = {
						id,
						name: uniqueDisplayName,
						familyName,
						fileName: uniqueFileName,
						relativePath,
						format: inferred.format,
						weight: inferred.weight,
						style: inferred.style,
						extension: inferred.extension,
						sizeBytes: buffer.byteLength,
						importedAt: new Date().toISOString(),
					};

					await loadFontItemIntoDocument(this.app.vault, fontItem, undefined, this.app);
					this.plugin.settings.customFonts.push(fontItem);
					importedCount++;
				}

				if (importedCount > 0) {
					await this.plugin.saveSettings();
					this.display();
					new Notice(
						importedCount === 1
							? 'Police personnelle importée avec succès.'
							: `${importedCount} polices personnelles importées avec succès.`,
					);
				}
				fileInput.value = '';
			})();
		});

		importSetting.addButton((btn) => {
			btn
				.setButtonText('Importer une police…')
				.setCta()
				.onClick(() => {
					fileInput.click();
				});
		});

		// Font items list, boxed under the import zone
		const fontsBox = containerEl.createDiv({ cls: 'inkwell-settings-box' });
		fontsBox.createDiv({ cls: 'inkwell-settings-box-title', text: 'Polices importées' });
		const fonts = this.plugin.settings.customFonts;
		if (fonts.length === 0) {
			const emptyBox = fontsBox.createDiv({ cls: 'inkwell-fonts-empty' });
			emptyBox.createEl('p', {
				text: 'Aucune police personnelle importée. Utilisez le bouton ci-dessus pour ajouter vos fichiers de police.',
			});
		} else {
			const listContainer = fontsBox.createDiv({ cls: 'inkwell-fonts-list' });

			fonts.forEach((font, index) => {
				const card = listContainer.createDiv({ cls: 'inkwell-font-card' });

				const topRow = card.createDiv({ cls: 'inkwell-font-card-top' });
				const titleWrap = topRow.createDiv({ cls: 'inkwell-font-card-title' });
				titleWrap.createSpan({ cls: 'inkwell-font-card-name', text: font.name });

				const badgesWrap = topRow.createDiv({ cls: 'inkwell-font-card-badges' });
				badgesWrap.createSpan({
					cls: 'inkwell-palette-badge',
					text: font.extension.toUpperCase(),
				});
				if (font.weight === 'bold') {
					badgesWrap.createSpan({ cls: 'inkwell-palette-badge', text: 'Gras' });
				} else if (font.weight !== 'normal') {
					badgesWrap.createSpan({ cls: 'inkwell-palette-badge', text: font.weight });
				}
				if (font.style === 'italic') {
					badgesWrap.createSpan({ cls: 'inkwell-palette-badge', text: 'Italique' });
				}
				badgesWrap.createSpan({
					cls: 'inkwell-palette-badge inkwell-font-size-badge',
					text: `${(font.sizeBytes / 1024).toFixed(1)} Ko`,
				});

				// Preview area
				const previewEl = card.createDiv({ cls: 'inkwell-font-card-preview' });
				previewEl.setText('Voix ambiguë d’un cœur qui au zéphyr préfère les jattes de kiwis. 1234567890');
				previewEl.style.fontFamily = `'${font.familyName}', sans-serif`;
				previewEl.style.fontWeight = font.weight;
				previewEl.style.fontStyle = font.style;

				// Action buttons
				const actionsWrap = card.createDiv({ cls: 'inkwell-font-card-actions' });

				const renameBtn = actionsWrap.createEl('button', {
					cls: 'inkwell-font-action-btn',
					text: 'Renommer',
				});
				renameBtn.setAttribute(FOCUS_ATTR, `font:${font.id}:rename`);
				renameBtn.addEventListener('click', () => {
					new RenameFontModal(
						this.app,
						font,
						this.plugin.settings.customFonts,
						(newName) => {
							void (async () => {
								font.name = newName;
								await this.plugin.saveSettings();
								this.display();
								new Notice(`Police renommée en « ${newName} ».`);
							})();
						},
					).open();
				});

				const deleteBtn = actionsWrap.createEl('button', {
					cls: 'inkwell-font-action-btn is-danger',
					text: 'Retirer',
				});
				deleteBtn.setAttribute(FOCUS_ATTR, `font:${font.id}:remove`);
				deleteBtn.addEventListener('click', () => {
					new ConfirmDeleteFontModal(this.app, font, () => {
						void (async () => {
							unregisterFontFromDocument(font, undefined, this.app);
							try {
								const exists = await this.app.vault.adapter.exists(font.relativePath);
								if (exists) {
									await this.app.vault.adapter.remove(font.relativePath);
								}
							} catch (err) {
								console.warn('[Inkwell] Erreur lors de la suppression du fichier de police:', err);
							}
							this.plugin.settings.customFonts.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
							new Notice(`Police « ${font.name} » retirée.`);
						})();
					}).open();
				});
			});
		}

		// Notice card for sync documentation
		const docCard = containerEl.createDiv({ cls: 'inkwell-fonts-doc-card' });
		new Setting(docCard).setName('Transférer vos polices avec le coffre').setHeading();
		const p1 = docCard.createEl('p');
		p1.setText(
			'Pour retrouver vos polices sur un autre appareil, copiez le dossier de polices du plugin ainsi que le fichier data.json dans le coffre cible. Tout fonctionne localement et hors ligne, sans aucun transfert vers un service externe.',
		);
		const p2 = docCard.createEl('p', { cls: 'inkwell-fonts-doc-disclaimer' });
		p2.setText(
			'Remarque : le rendu de ces polices est assuré dans Obsidian avec Inkwell. Les applications externes ne disposant pas de ces polices installées sur le système utiliseront automatiquement une police de repli standard sans altérer votre texte.',
		);
	}
}
