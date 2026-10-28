import { App, Modal, Setting } from 'obsidian';

export interface AdoptModalOptions {
	count: number;
	scopeDescription: string;
	onConfirm: () => void;
	onCancel?: () => void;
}

export class AdoptModal extends Modal {
	private options: AdoptModalOptions;
	private confirmed = false;

	constructor(app: App, options: AdoptModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Adopter le formatage historique' });

		const info = contentEl.createDiv({ cls: 'inkwell-adopt-dialog-info' });
		info.createEl('p', {
			text: `${this.options.count} balise(s) correspondant à l’ancien format détectée(s).`,
		});
		info.createEl('p', {
			text: `Périmètre : ${this.options.scopeDescription}.`,
		});

		contentEl.createEl('p', {
			cls: 'inkwell-adopt-disclaimer',
			text:
				'Avertissement : Ces balises correspondent au format historique d’Inkwell, mais leur origine exacte ne peut pas être prouvée avec certitude. Confirmez-vous l’ajout du marqueur data-inkwell="1" pour permettre leur gestion par le plugin ?',
		});

		new Setting(contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('Confirmer l’adoption')
					.setCta()
					.onClick(() => {
						this.confirmed = true;
						this.close();
						this.options.onConfirm();
					});
			})
			.addButton((btn) => {
				btn.setButtonText('Annuler').onClick(() => {
					this.confirmed = false;
					this.close();
					if (this.options.onCancel) this.options.onCancel();
				});
			});
	}

	onClose(): void {
		if (!this.confirmed && this.options.onCancel) {
			this.options.onCancel();
		}
	}
}
