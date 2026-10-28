import { App, Modal, Notice, Setting, TextAreaComponent } from 'obsidian';
import {
	CustomPalette,
	ImportConflictMode,
	PaletteColorItem,
	PaletteType,
} from '../palette/types';
import {
	isValidColorValue,
	validateImportedPalettesJson,
} from '../palette/palette-manager';
import { evaluateColorContrast, resolveEffectiveThemeBackground } from '../palette/contrast';

/**
 * Modal to create a new custom palette.
 */
export class CreatePaletteModal extends Modal {
	private name = '';
	private type: PaletteType = 'text';
	private onSave: (name: string, type: PaletteType) => void;

	constructor(app: App, defaultType: PaletteType, onSave: (name: string, type: PaletteType) => void) {
		super(app);
		this.type = defaultType;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Nouvelle palette de couleurs' });

		new Setting(contentEl)
			.setName('Nom de la palette')
			.setDesc('Nom affiché dans les menus et paramètres')
			.addText((text) => {
				text
					.setPlaceholder('Ex : Mes teintes de projet')
					.onChange((val) => {
						this.name = val.trim();
					});
				text.inputEl.focus();
			});

		new Setting(contentEl)
			.setName('Type de palette')
			.setDesc('Définit si les couleurs s’appliquent au texte ou au surlignage')
			.addDropdown((dropdown) => {
				dropdown.addOption('text', 'Couleurs de texte');
				dropdown.addOption('highlight', 'Couleurs de surlignage');
				dropdown.setValue(this.type);
				dropdown.onChange((val) => {
					this.type = val as PaletteType;
				});
			});

		new Setting(contentEl).addButton((btn) => {
			btn
				.setButtonText('Créer la palette')
				.setCta()
				.onClick(() => {
					if (!this.name) {
						new Notice('Veuillez saisir un nom de palette.');
						return;
					}
					this.onSave(this.name, this.type);
					this.close();
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Modal to rename an existing palette.
 */
export class RenamePaletteModal extends Modal {
	private name: string;
	private onSave: (newName: string) => void;

	constructor(app: App, currentName: string, onSave: (newName: string) => void) {
		super(app);
		this.name = currentName;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Renommer la palette' });

		new Setting(contentEl)
			.setName('Nouveau nom')
			.addText((text) => {
				text.setValue(this.name).onChange((val) => {
					this.name = val.trim();
				});
				text.inputEl.focus();
			});

		new Setting(contentEl).addButton((btn) => {
			btn
				.setButtonText('Enregistrer')
				.setCta()
				.onClick(() => {
					if (!this.name) {
						new Notice('Le nom ne peut pas être vide.');
						return;
					}
					this.onSave(this.name);
					this.close();
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Modal to add or edit a color item with live contrast evaluation.
 */
export class EditColorModal extends Modal {
	private isHighlight: boolean;
	private initialItem?: PaletteColorItem;
	private onSave: (item: PaletteColorItem) => void;

	private colorName: string;
	private colorValue: string;

	constructor(
		app: App,
		isHighlight: boolean,
		initialItem: PaletteColorItem | undefined,
		onSave: (item: PaletteColorItem) => void,
	) {
		super(app);
		this.isHighlight = isHighlight;
		this.initialItem = initialItem;
		this.onSave = onSave;
		this.colorName = initialItem?.name ?? '';
		this.colorValue =
			initialItem?.value ?? (isHighlight ? 'rgba(255, 212, 59, 0.35)' : '#1971c2');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', {
			text: this.initialItem
				? `Modifier la couleur « ${this.initialItem.name} »`
				: this.isHighlight
					? 'Ajouter un surlignage'
					: 'Ajouter une couleur de texte',
		});

		new Setting(contentEl)
			.setName('Nom de la couleur')
			.setDesc('Libellé affiché au survol et dans la liste des commandes')
			.addText((text) => {
				text.setValue(this.colorName).onChange((val) => {
					this.colorName = val.trim();
				});
				text.inputEl.focus();
			});

		// Live preview container
		const previewBox = contentEl.createDiv({ cls: 'inkwell-color-edit-preview' });
		const previewText = previewBox.createSpan({
			cls: 'inkwell-color-edit-text',
			text: 'Exemple de texte avec cette couleur',
		});
		const contrastInfoEl = contentEl.createDiv({ cls: 'inkwell-color-edit-contrast' });

		const updatePreview = () => {
			if (isValidColorValue(this.colorValue)) {
				if (this.isHighlight) {
					previewText.addClass('is-highlight');
					previewText.removeClass('is-text');
				} else {
					previewText.addClass('is-text');
					previewText.removeClass('is-highlight');
				}
				previewText.setCssProps({
					'--inkwell-preview-color': this.colorValue,
				});

				// Contrast calculation against theme
				const { background: themeBg, isRealMeasured, isDark } = resolveEffectiveThemeBackground();
				const evalResult = evaluateColorContrast({
					textColor: this.isHighlight ? (isDark ? '#e0e0e0' : '#1e1e1e') : this.colorValue,
					themeBackground: themeBg,
					isRealMeasured,
					isDarkTheme: isDark,
					highlightColor: this.isHighlight ? this.colorValue : null,
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
				bgEl.setText(`Fond évalué : ${evalResult.backgroundUsed}`);

				if (!evalResult.passesNormal && evalResult.suggestedColor) {
					const suggEl = contrastInfoEl.createDiv({ cls: 'inkwell-contrast-suggestion' });
					suggEl.setText(`Alternative recommandée : ${evalResult.suggestedColor}`);
				}
			} else {
				contrastInfoEl.empty();
				const errBadge = contrastInfoEl.createDiv({ cls: 'inkwell-contrast-badge is-low' });
				errBadge.setText('Valeur CSS invalide (format hex #rrggbb ou rgba(...) requis)');
			}
		};

		new Setting(contentEl)
			.setName('Valeur de couleur (CSS)')
			.setDesc('Hex (#1971c2), rgb(25, 113, 194) ou rgba(...)')
			.addText((text) => {
				text.setValue(this.colorValue).onChange((val) => {
					this.colorValue = val.trim();
					updatePreview();
				});
			})
			.addColorPicker((picker) => {
				// Only for hex representations
				if (this.colorValue.startsWith('#') && this.colorValue.length === 7) {
					picker.setValue(this.colorValue);
				}
				picker.onChange((hex) => {
					this.colorValue = hex;
					updatePreview();
				});
			});

		updatePreview();

		new Setting(contentEl).addButton((btn) => {
			btn
				.setButtonText(this.initialItem ? 'Enregistrer les modifications' : 'Ajouter la couleur')
				.setCta()
				.onClick(() => {
					if (!this.colorName) {
						new Notice('Veuillez renseigner un nom pour la couleur.');
						return;
					}
					if (!isValidColorValue(this.colorValue)) {
						new Notice('La valeur de couleur est invalide. Utilisez un format hex ou rgba.');
						return;
					}
					const id = this.initialItem?.id ?? `color-${Date.now()}`;
					this.onSave({
						id,
						name: this.colorName,
						value: this.colorValue,
					});
					this.close();
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Modal to import palettes from JSON.
 */
export class ImportPalettesModal extends Modal {
	private jsonContent = '';
	private mode: ImportConflictMode = 'merge';
	private onImport: (palettes: CustomPalette[], mode: ImportConflictMode) => void;

	constructor(
		app: App,
		onImport: (palettes: CustomPalette[], mode: ImportConflictMode) => void,
	) {
		super(app);
		this.onImport = onImport;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Importer des palettes (JSON)' });

		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Collez le contenu JSON ou sélectionnez un fichier exporté de palettes.',
		});

		// File picker input
		const fileInput = contentEl.createEl('input', {
			type: 'file',
			attr: { accept: '.json' },
			cls: 'inkwell-file-input',
		});
		let textAreaComp: TextAreaComponent | null = null;

		fileInput.addEventListener('change', () => {
			const files = fileInput.files;
			const file = files && files.length > 0 ? files[0] : null;
			if (file) {
				const reader = new FileReader();
				reader.onload = (e) => {
					const text = typeof e.target?.result === 'string' ? e.target.result : '';
					if (textAreaComp) {
						textAreaComp.setValue(text);
					}
					this.jsonContent = text;
				};
				reader.readAsText(file);
			}
		});

		// Text area
		const textAreaContainer = contentEl.createDiv({ cls: 'inkwell-import-json-container' });
		new Setting(textAreaContainer)
			.setClass('inkwell-import-setting')
			.addTextArea((ta) => {
				textAreaComp = ta;
				ta.setPlaceholder('{\n  "schemaVersion": 1,\n  "palettes": [...]\n}')
					.setValue(this.jsonContent)
					.onChange((val) => {
						this.jsonContent = val;
					});
				ta.inputEl.rows = 8;
			});

		// Conflict mode
		new Setting(contentEl)
			.setName('Gestion des conflits')
			.setDesc('Fusionner avec les palettes actuelles ou remplacer toutes les palettes personnalisées')
			.addDropdown((dropdown) => {
				dropdown.addOption('merge', 'Fusionner (conserver l’existant et renommer les doublons)');
				dropdown.addOption('replace', 'Remplacer (écraser les palettes personnalisées actuelles)');
				dropdown.setValue(this.mode);
				dropdown.onChange((val) => {
					this.mode = val as ImportConflictMode;
				});
			});

		const statusEl = contentEl.createDiv({ cls: 'inkwell-import-status' });

		new Setting(contentEl).addButton((btn) => {
			btn
				.setButtonText('Valider et importer')
				.setCta()
				.onClick(() => {
					if (!this.jsonContent.trim()) {
						statusEl.setText('Le contenu JSON est vide.');
						statusEl.className = 'inkwell-import-status is-error';
						return;
					}

					const res = validateImportedPalettesJson(this.jsonContent);
					if (!res.valid || !res.palettes) {
						statusEl.setText(`Erreur de validation : ${res.error}`);
						statusEl.className = 'inkwell-import-status is-error';
						return;
					}

					if (this.mode === 'replace') {
						new ConfirmActionModal(
							this.app,
							'Remplacer toutes les palettes personnalisées ?',
							'Cette action écrasera vos palettes personnalisées actuelles par les palettes importées. Les styles existants dans vos notes restent préservés.',
							'Remplacer les palettes',
							() => {
								this.onImport(res.palettes!, this.mode);
								this.close();
							},
						).open();
					} else {
						this.onImport(res.palettes, this.mode);
						this.close();
					}
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Generic confirmation modal for destructive operations.
 */
export class ConfirmActionModal extends Modal {
	private title: string;
	private message: string;
	private confirmLabel: string;
	private onConfirm: () => void;

	constructor(
		app: App,
		title: string,
		message: string,
		confirmLabel: string,
		onConfirm: () => void,
	) {
		super(app);
		this.title = title;
		this.message = message;
		this.confirmLabel = confirmLabel;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: this.title });
		contentEl.createEl('p', { text: this.message });

		const actions = new Setting(contentEl);
		actions.addButton((btn) => {
			btn.setButtonText('Annuler').onClick(() => {
				this.close();
			});
		});
		actions.addButton((btn) => {
			btn
				.setButtonText(this.confirmLabel)
				.setWarning()
				.onClick(() => {
					this.onConfirm();
					this.close();
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
