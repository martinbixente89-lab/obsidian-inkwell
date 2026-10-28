import { App, Modal, Notice, Setting } from 'obsidian';
import { CustomFontItem } from '../fonts/types';
import { resolveUniqueDisplayName } from '../fonts/font-manager';

/**
 * Modal to edit the display name of an imported custom font.
 */
export class RenameFontModal extends Modal {
	private font: CustomFontItem;
	private existingFonts: CustomFontItem[];
	private currentName: string;
	private onSave: (newName: string) => void;

	constructor(
		app: App,
		font: CustomFontItem,
		existingFonts: CustomFontItem[],
		onSave: (newName: string) => void,
	) {
		super(app);
		this.font = font;
		this.existingFonts = existingFonts;
		this.currentName = font.name;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: `Renommer la police « ${this.font.name} »` });

		new Setting(contentEl)
			.setName('Nom d’affichage de la police')
			.setDesc('Ce nom apparaîtra dans la barre flottante et les menus')
			.addText((text) => {
				text.setValue(this.currentName).onChange((val) => {
					this.currentName = val.trim();
				});
				text.inputEl.focus();
				text.inputEl.select();
			});

		new Setting(contentEl).addButton((btn) => {
			btn
				.setButtonText('Enregistrer')
				.setCta()
				.onClick(() => {
					if (!this.currentName) {
						new Notice('Veuillez saisir un nom pour la police.');
						return;
					}
					const finalName = resolveUniqueDisplayName(
						this.existingFonts,
						this.currentName,
						this.font.id,
					);
					if (finalName !== this.currentName) {
						new Notice(
							`Une autre police porte déjà ce nom. Renommée en « ${finalName} ».`,
						);
					}
					this.onSave(finalName);
					this.close();
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Modal to confirm removal of an imported font.
 */
export class ConfirmDeleteFontModal extends Modal {
	private font: CustomFontItem;
	private onConfirm: () => void;

	constructor(app: App, font: CustomFontItem, onConfirm: () => void) {
		super(app);
		this.font = font;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: `Retirer la police « ${this.font.name} » ?` });

		const desc = contentEl.createEl('p');
		desc.setText(
			`Le fichier « ${this.font.fileName} » sera supprimé du dossier du coffre (.obsidian/plugins/inkwell/fonts/). Les passages de texte utilisant cette police s’afficheront avec une police de repli standard sans altérer leur contenu.`,
		);

		const actions = new Setting(contentEl);
		actions.addButton((btn) => {
			btn.setButtonText('Annuler').onClick(() => {
				this.close();
			});
		});
		actions.addButton((btn) => {
			btn
				.setButtonText('Retirer la police')
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
