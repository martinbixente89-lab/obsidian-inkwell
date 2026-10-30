import { App, Modal, Notice, Setting, TFile } from 'obsidian';

export interface PageModalCallbacks {
	onSubmit: (noteName: string, isExisting: boolean) => void;
	onCancel: () => void;
}

export class PageModal extends Modal {
	private noteName = '';
	private isSubmitted = false;

	constructor(
		app: App,
		private readonly defaultFolder: string,
		private readonly callbacks: PageModalCallbacks,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText('Créer ou lier une page');
		this.renderInputView();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.isSubmitted) {
			this.callbacks.onCancel();
		}
	}

	private renderInputView(): void {
		this.contentEl.empty();

		const descEl = this.contentEl.createDiv({ cls: 'inkwell-page-modal-desc' });
		descEl.setText(
			'Saisissez le nom de la page à créer dans votre coffre (Cmd+Z annule uniquement le lien inséré dans l’éditeur sans jamais supprimer le fichier créé) :',
		);

		const inputSetting = new Setting(this.contentEl)
			.addText((text) => {
				text
					.setPlaceholder('Nom de la note')
					.setValue(this.noteName)
					.onChange((val) => {
						this.noteName = val;
					});

				text.inputEl.focus();
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void this.handleSubmit();
					}
				});
			});

		inputSetting.addButton((btn) => {
			btn
				.setButtonText('Créer la page')
				.setCta()
				.onClick(() => {
					void this.handleSubmit();
				});
		});

		inputSetting.addButton((btn) => {
			btn
				.setButtonText('Annuler')
				.onClick(() => {
					this.close();
				});
		});
	}

	private async handleSubmit(): Promise<void> {
		const name = this.noteName.trim();
		if (!name) {
			new Notice('Veuillez saisir un nom de note valide.');
			return;
		}

		if (/[\\/:*?"<>|]/.test(name)) {
			new Notice('Le nom contient des caractères interdits (\\ / : * ? " < > |).');
			return;
		}

		// Check if file already exists in vault
		const targetPath = this.defaultFolder ? `${this.defaultFolder}/${name}.md` : `${name}.md`;
		const existingByPath = this.app.vault.getAbstractFileByPath(targetPath);
		const existingByName = this.app.vault
			.getFiles()
			.find((f) => f.basename.toLowerCase() === name.toLowerCase());

		const existing = (existingByPath instanceof TFile ? existingByPath : null) ?? existingByName;

		if (existing) {
			this.renderConflictView(existing);
			return;
		}

		// Create new file
		try {
			await this.app.vault.create(targetPath, '');
			this.isSubmitted = true;
			this.close();
			this.callbacks.onSubmit(name, false);
		} catch (err) {
			new Notice('Impossible de créer le fichier : ' + String(err));
		}
	}

	private renderConflictView(existing: TFile): void {
		this.contentEl.empty();

		const warningEl = this.contentEl.createDiv({ cls: 'inkwell-page-conflict-warning' });
		warningEl.setText(`Une note nommée « ${existing.basename} » existe déjà dans votre coffre.`);

		new Setting(this.contentEl)
			.addButton((btn) => {
				btn
					.setButtonText('Lier la note existante')
					.setCta()
					.onClick(() => {
						this.isSubmitted = true;
						this.close();
						this.callbacks.onSubmit(existing.basename, true);
					});
			})
			.addButton((btn) => {
				btn
					.setButtonText('Choisir un autre nom')
					.onClick(() => {
						this.renderInputView();
					});
			})
			.addButton((btn) => {
				btn
					.setButtonText('Annuler')
					.onClick(() => {
						this.close();
					});
			});
	}
}
