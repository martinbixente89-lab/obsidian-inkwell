import { App, Modal, Notice, Setting } from 'obsidian';
import { BookmarkData, extractDomain, serializeBookmark } from './bookmark-model';

export interface BookmarkModalOptions {
	initialData?: BookmarkData;
	onSave: (data: BookmarkData, markdown: string) => void;
}

export class BookmarkModal extends Modal {
	private url = '';
	private title = '';
	private description = '';
	private isEditMode = false;

	constructor(
		app: App,
		private options: BookmarkModalOptions,
	) {
		super(app);
		if (options.initialData) {
			this.isEditMode = true;
			this.url = options.initialData.url;
			this.title = options.initialData.title;
			this.description = options.initialData.description;
		}
	}

	override onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('inkwell-bookmark-modal');

		contentEl.createEl('h2', {
			text: this.isEditMode
				? 'Modifier l’aperçu de lien Web'
				: 'Insérer un aperçu de lien Web',
		});

		// Information banner explaining 100% offline mode & limitations of automatic fetch
		const infoBanner = contentEl.createDiv({ cls: 'inkwell-bookmark-modal-banner' });
		const bannerIcon = infoBanner.createSpan({ cls: 'inkwell-bookmark-modal-banner-icon' });
		bannerIcon.setText('🔒');
		const bannerText = infoBanner.createDiv({ cls: 'inkwell-bookmark-modal-banner-text' });
		bannerText.createEl('strong', { text: 'Mode 100% local et sécurisé' });
		bannerText.createEl('p', {
			text: 'Les cartes sont gérées entièrement hors-ligne sans aucune requête réseau en arrière-plan. La récupération distante automatique est volontairement désactivée par mesure de sécurité.',
		});

		// URL setting
		new Setting(contentEl)
			.setName('URL du lien')
			.setDesc('Adresse Web (HTTP ou HTTPS)')
			.addText((text) => {
				text.setPlaceholder('https://exemple.fr/page');
				text.setValue(this.url);
				text.onChange((val) => {
					this.url = val.trim();
					// Auto-fill title with domain if title is empty
					if (!this.title && this.url) {
						const domain = extractDomain(this.url);
						if (domain) {
							titleInput?.setValue(domain);
							this.title = domain;
						}
					}
				});
				// Auto-focus URL input on open if creating
				if (!this.isEditMode) {
					window.setTimeout(() => text.inputEl.focus(), 50);
				}
			});

		// Title setting
		let titleInput: { setValue: (val: string) => void } | null = null;
		new Setting(contentEl)
			.setName('Titre')
			.setDesc('Titre affiché sur la carte')
			.addText((text) => {
				titleInput = text;
				text.setPlaceholder('Titre du site ou de l’article');
				text.setValue(this.title);
				text.onChange((val) => {
					this.title = val;
				});
				if (this.isEditMode) {
					window.setTimeout(() => text.inputEl.focus(), 50);
				}
			});

		// Description setting (multiline)
		new Setting(contentEl)
			.setName('Description')
			.setDesc('Résumé ou description facultative (supporte plusieurs lignes)')
			.addTextArea((textArea) => {
				textArea.setPlaceholder('Description de la page...');
				textArea.setValue(this.description);
				textArea.inputEl.rows = 4;
				textArea.inputEl.addClass('inkwell-bookmark-textarea');
				textArea.onChange((val) => {
					this.description = val;
				});
			});

		// Action buttons
		const btnRow = contentEl.createDiv({ cls: 'inkwell-bookmark-modal-btn-row' });

		const cancelBtn = btnRow.createEl('button', {
			cls: 'mod-cancel',
			text: 'Annuler',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		const saveBtn = btnRow.createEl('button', {
			cls: 'mod-cta',
			text: this.isEditMode ? 'Enregistrer les modifications' : 'Insérer la carte',
		});
		saveBtn.addEventListener('click', () => {
			this.handleSave();
		});
	}

	private handleSave(): void {
		let finalUrl = this.url.trim();
		if (!finalUrl) {
			new Notice('Veuillez renseigner l’URL du lien.');
			return;
		}

		if (!/^https?:\/\//i.test(finalUrl)) {
			// Prefix https:// by default if not present
			finalUrl = `https://${finalUrl}`;
		}

		const finalTitle = this.title.trim() || extractDomain(finalUrl) || finalUrl;
		const data: BookmarkData = {
			url: finalUrl,
			title: finalTitle,
			description: this.description.trim(),
		};

		const markdown = serializeBookmark(data);
		this.options.onSave(data, markdown);
		this.close();
	}
}
