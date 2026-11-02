import { App, FuzzySuggestModal, Modal, Notice, Setting } from 'obsidian';
import {
	ButtonActionType,
	ButtonData,
	ButtonVariant,
	isValidWebUrl,
	sanitizeColor,
	sanitizeVariant,
	serializeButton,
} from './button-model';
import {
	getCommandInfo,
	isCommandRegistryAvailable,
	listAvailableCommands,
	ObsidianCommandItem,
} from './command-adapter';
import { NoteSuggestModal } from '../slash-menu/modals';

export class CommandSuggestModal extends FuzzySuggestModal<ObsidianCommandItem> {
	constructor(
		app: App,
		private onSelect: (cmd: ObsidianCommandItem) => void,
	) {
		super(app);
		this.setPlaceholder('Rechercher une commande Obsidian...');
	}

	getItems(): ObsidianCommandItem[] {
		return listAvailableCommands(this.app);
	}

	getItemText(item: ObsidianCommandItem): string {
		return `${item.name} (${item.id}) — ${item.origin}`;
	}

	onChooseItem(item: ObsidianCommandItem): void {
		this.onSelect(item);
	}
}

export interface ButtonModalOptions {
	initialData?: ButtonData;
	onSave: (data: ButtonData, markdown: string) => void;
}

export class ButtonModal extends Modal {
	private label = 'Mon action';
	private actionType: ButtonActionType = 'note';
	private target = '';
	private variant: ButtonVariant = 'filled';
	private color = '';
	private isEditMode = false;
	private previewBtnEl: HTMLElement | null = null;

	constructor(
		app: App,
		private options: ButtonModalOptions,
	) {
		super(app);
		if (options.initialData) {
			this.isEditMode = true;
			this.label = options.initialData.label;
			this.actionType = options.initialData.actionType;
			this.target = options.initialData.target;
			this.variant = options.initialData.variant;
			this.color = options.initialData.color || '';
		}
	}

	override onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('inkwell-button-modal');

		contentEl.createEl('h2', {
			text: this.isEditMode
				? 'Modifier le bouton d’action'
				: 'Insérer un bouton d’action',
		});

		// 1. Live visual preview area (never executes action)
		const previewSection = contentEl.createDiv({ cls: 'inkwell-button-modal-preview-wrap' });
		previewSection.createDiv({
			cls: 'inkwell-button-modal-preview-title',
			text: 'Aperçu visuel (interactif, sans exécution)',
		});

		const previewBox = previewSection.createDiv({ cls: 'inkwell-button-modal-preview-box' });
		this.previewBtnEl = previewBox.createEl('button', {
			cls: 'inkwell-action-btn',
			text: this.label || 'Action',
		});
		this.previewBtnEl.setAttribute('type', 'button');
		this.previewBtnEl.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			new Notice('Aperçu visuel uniquement : aucune action n’est exécutée.');
		});
		this.updatePreviewButton();

		// 2. Button Label Setting
		new Setting(contentEl)
			.setName('Libellé du bouton')
			.setDesc('Texte visible sur le bouton')
			.addText((text) => {
				text.setPlaceholder('Ex : Ouvrir le tableau de bord');
				text.setValue(this.label);
				text.onChange((val) => {
					this.label = val;
					this.updatePreviewButton();
				});
				if (!this.isEditMode) {
					window.setTimeout(() => text.inputEl.focus(), 50);
				}
			});

		// 3. Action Type Selector
		const isCmdAvailable = isCommandRegistryAvailable(this.app);
		new Setting(contentEl)
			.setName('Type d’action')
			.setDesc('Action déclenchée lors de l’appui sur le bouton')
			.addDropdown((dd) => {
				dd.addOption('note', 'Ouvrir une note du coffre');
				dd.addOption('url', 'Ouvrir un lien Web (HTTP/HTTPS)');
				if (isCmdAvailable) {
					dd.addOption('command', 'Exécuter une commande Obsidian');
				} else {
					dd.addOption('command', 'Commande Obsidian (indisponible)');
				}
				dd.setValue(this.actionType);
				dd.onChange((val) => {
					this.actionType = val as ButtonActionType;
					this.target = '';
					this.render();
				});
			});

		// 4. Action Target Setting (dynamically adapts according to actionType)
		if (this.actionType === 'note') {
			let noteInput: { setValue: (v: string) => void } | null = null;
			new Setting(contentEl)
				.setName('Note cible')
				.setDesc('Chemin ou titre de la note dans le coffre')
				.addText((text) => {
					noteInput = text;
					text.setPlaceholder('Ex : Projets/Roadmap.md');
					text.setValue(this.target);
					text.onChange((val) => {
						this.target = val.trim();
					});
				})
				.addButton((btn) => {
					btn.setButtonText('Parcourir...');
					btn.onClick(() => {
						const modal = new NoteSuggestModal(this.app, (file) => {
							this.target = file.path;
							noteInput?.setValue(file.path);
						});
						modal.open();
					});
				});
		} else if (this.actionType === 'url') {
			new Setting(contentEl)
				.setName('URL Web')
				.setDesc('Adresse Web (strictement HTTP ou HTTPS)')
				.addText((text) => {
					text.setPlaceholder('https://exemple.fr/page');
					text.setValue(this.target);
					text.onChange((val) => {
						this.target = val.trim();
					});
				});
		} else if (this.actionType === 'command') {
			let cmdInput: { setValue: (v: string) => void } | null = null;
			const initialCmdInfo = this.target ? getCommandInfo(this.app, this.target) : null;
			const displayTarget = initialCmdInfo
				? `${initialCmdInfo.name} (${initialCmdInfo.id}) [${initialCmdInfo.origin}]`
				: this.target;

			new Setting(contentEl)
				.setName('Commande Obsidian')
				.setDesc('Commande issue du registre interne d’Obsidian')
				.addText((text) => {
					cmdInput = text;
					text.setPlaceholder('Sélectionnez une commande...');
					text.setValue(displayTarget);
					text.setDisabled(true);
				})
				.addButton((btn) => {
					btn.setButtonText('Choisir une commande...');
					btn.onClick(() => {
						const modal = new CommandSuggestModal(this.app, (cmd) => {
							this.target = cmd.id;
							cmdInput?.setValue(`${cmd.name} (${cmd.id}) [${cmd.origin}]`);
						});
						modal.open();
					});
				});
		}

		// 5. Variant Setting
		new Setting(contentEl)
			.setName('Variante visuelle')
			.setDesc('Style d’affichage du bouton')
			.addDropdown((dd) => {
				dd.addOption('filled', 'Rempli (Filled)');
				dd.addOption('outline', 'Contour (Outline)');
				dd.setValue(this.variant);
				dd.onChange((val) => {
					this.variant = sanitizeVariant(val);
					this.updatePreviewButton();
				});
			});

		// 6. Color Setting (Hexadecimal or default)
		new Setting(contentEl)
			.setName('Couleur personnalisée (optionnelle)')
			.setDesc('Code hexadécimal (#rgb ou #rrggbb). Laisser vide pour la couleur d’accent.')
			.addText((text) => {
				text.setPlaceholder('#7864ff');
				text.setValue(this.color);
				text.onChange((val) => {
					this.color = val.trim();
					this.updatePreviewButton();
				});
			});

		// 7. Action buttons
		const btnRow = contentEl.createDiv({ cls: 'inkwell-button-modal-btn-row' });

		const cancelBtn = btnRow.createEl('button', {
			cls: 'mod-cancel',
			text: 'Annuler',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		const saveBtn = btnRow.createEl('button', {
			cls: 'mod-cta',
			text: this.isEditMode ? 'Enregistrer les modifications' : 'Insérer le bouton',
		});
		saveBtn.addEventListener('click', () => {
			this.handleSave();
		});
	}

	private updatePreviewButton(): void {
		if (!this.previewBtnEl) return;
		this.previewBtnEl.setText(this.label.trim() || 'Action');

		this.previewBtnEl.removeClass('is-filled', 'is-outline');
		this.previewBtnEl.addClass(this.variant === 'outline' ? 'is-outline' : 'is-filled');

		const validColor = sanitizeColor(this.color);
		if (validColor) {
			this.previewBtnEl.style.setProperty('--inkwell-btn-color', validColor);
		} else {
			this.previewBtnEl.style.removeProperty('--inkwell-btn-color');
		}
	}

	private handleSave(): void {
		const finalLabel = this.label.trim() || 'Action';
		const finalTarget = this.target.trim();

		if (!finalTarget) {
			new Notice('Veuillez renseigner ou sélectionner une cible pour le bouton.');
			return;
		}

		if (this.actionType === 'url') {
			if (!isValidWebUrl(finalTarget)) {
				new Notice('L’adresse URL doit obligatoirement commencer par http:// ou https://.');
				return;
			}
		}

		if (this.actionType === 'command') {
			if (!isCommandRegistryAvailable(this.app)) {
				new Notice('Le registre de commandes d’Obsidian n’est pas disponible.');
				return;
			}
		}

		const data: ButtonData = {
			label: finalLabel,
			actionType: this.actionType,
			target: finalTarget,
			variant: this.variant,
			color: sanitizeColor(this.color),
		};

		const markdown = serializeButton(data);
		this.options.onSave(data, markdown);
		this.close();
	}
}
