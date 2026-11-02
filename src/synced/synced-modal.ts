import { App, Modal, Notice, Setting } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	generateSyncId,
	serializeSyncedReference,
} from './synced-model';

export interface SyncedBlockModalOptions {
	onInsert: (markdown: string) => void;
}

export class SyncedBlockModal extends Modal {
	private activeTab: 'create' | 'existing' = 'create';
	private newBlockTitle = '';
	private searchQuery = '';

	constructor(
		app: App,
		private plugin: InkwellPlugin,
		private options: SyncedBlockModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('inkwell-synced-modal');

		contentEl.createEl('h2', { text: 'Bloc synchronisé' });

		// Tab selector
		const tabsBar = contentEl.createDiv({ cls: 'inkwell-synced-modal-tabs' });
		const createTabBtn = tabsBar.createEl('button', {
			cls: `inkwell-synced-modal-tab-btn ${this.activeTab === 'create' ? 'is-active' : ''}`,
			text: 'Créer un nouveau bloc',
		});
		createTabBtn.addEventListener('click', () => {
			this.activeTab = 'create';
			this.render();
		});

		const existingTabBtn = tabsBar.createEl('button', {
			cls: `inkwell-synced-modal-tab-btn ${this.activeTab === 'existing' ? 'is-active' : ''}`,
			text: 'Insérer un bloc existant',
		});
		existingTabBtn.addEventListener('click', () => {
			this.activeTab = 'existing';
			this.render();
		});

		const bodyEl = contentEl.createDiv({ cls: 'inkwell-synced-modal-body' });

		if (this.activeTab === 'create') {
			this.renderCreateTab(bodyEl);
		} else {
			this.renderExistingTab(bodyEl);
		}
	}

	private renderCreateTab(container: HTMLElement): void {
		container.createEl('p', {
			cls: 'inkwell-synced-modal-hint',
			text: 'Crée une nouvelle note source dédiée qui pourra être partagée et éditée simultanément à plusieurs endroits.',
		});

		new Setting(container)
			.setName('Titre du bloc synchronisé')
			.setDesc('Ce nom servira de titre visible et nommera le fichier Markdown source.')
			.addText((text) => {
				text
					.setPlaceholder('Ex : Note de cadrage, rappel d’équipe…')
					.setValue(this.newBlockTitle)
					.onChange((val) => {
						this.newBlockTitle = val;
					});
				text.inputEl.focus();
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void this.submitCreate();
					}
				});
			});

		const folderDesc = container.createDiv({
			cls: 'inkwell-synced-modal-folder-info',
		});
		folderDesc.createSpan({
			text: `Emplacement prévu : ${this.plugin.syncedBlockManager.getDefaultFolder()}/`,
		});

		new Setting(container)
			.addButton((btn) => {
				btn
					.setButtonText('Créer et insérer')
					.setCta()
					.onClick(() => {
						void this.submitCreate();
					});
			})
			.addButton((btn) => {
				btn.setButtonText('Annuler').onClick(() => {
					this.close();
				});
			});
	}

	private async submitCreate(): Promise<void> {
		const rawTitle = this.newBlockTitle.trim();
		const title = rawTitle || 'Bloc synchronisé';

		try {
			await this.plugin.syncedBlockManager.ensureFolderExists(
				this.plugin.syncedBlockManager.getDefaultFolder(),
			);

			const targetPath = await this.plugin.syncedBlockManager.getUniqueSourcePath(
				title,
			);
			const syncId = generateSyncId();
			const fileContent = `---\ninkwell-sync-id: ${syncId}\n---\n`;

			await this.app.vault.create(targetPath, fileContent);

			const refMarkdown = serializeSyncedReference(targetPath, title, syncId);
			this.close();
			this.options.onInsert(refMarkdown);
			new Notice(`Bloc synchronisé créé : ${targetPath}`);
		} catch (e) {
			new Notice(`Erreur lors de la création : ${(e as Error).message}`);
		}
	}

	private renderExistingTab(container: HTMLElement): void {
		container.createEl('p', {
			cls: 'inkwell-synced-modal-hint',
			text: 'Sélectionnez un bloc synchronisé déjà existant pour insérer une nouvelle occurrence reliée à la même source.',
		});

		new Setting(container)
			.setName('Rechercher un bloc')
			.addText((text) => {
				text
					.setPlaceholder('Filtrer par nom ou chemin…')
					.setValue(this.searchQuery)
					.onChange((val) => {
						this.searchQuery = val.toLowerCase();
						this.updateExistingList(listContainer);
					});
				text.inputEl.focus();
			});

		const listContainer = container.createDiv({
			cls: 'inkwell-synced-existing-list',
		});
		this.updateExistingList(listContainer);
	}

	private updateExistingList(listContainer: HTMLElement): void {
		listContainer.empty();

		const candidates = this.findExistingSyncedNotes();

		const filtered = candidates.filter(
			(c) =>
				c.title.toLowerCase().includes(this.searchQuery) ||
				c.path.toLowerCase().includes(this.searchQuery),
		);

		if (filtered.length === 0) {
			listContainer.createDiv({
				cls: 'inkwell-synced-empty-list',
				text: 'Aucun bloc synchronisé trouvé.',
			});
			return;
		}

		for (const item of filtered) {
			const row = listContainer.createDiv({
				cls: 'inkwell-synced-existing-item',
			});

			const textWrap = row.createDiv({ cls: 'inkwell-synced-item-info' });
			textWrap.createDiv({ cls: 'inkwell-synced-item-title', text: item.title });
			textWrap.createDiv({ cls: 'inkwell-synced-item-path', text: item.path });

			row.addEventListener('click', () => {
				const refMarkdown = serializeSyncedReference(
					item.path,
					item.title,
					item.syncId,
				);
				this.close();
				this.options.onInsert(refMarkdown);
				new Notice(`Occurrence insérée pour : ${item.title}`);
			});
		}
	}

	private findExistingSyncedNotes(): Array<{
		title: string;
		path: string;
		syncId?: string;
	}> {
		const result: Array<{ title: string; path: string; syncId?: string }> = [];
		const mdFiles = this.app.vault.getMarkdownFiles();
		const defaultFolder = this.plugin.syncedBlockManager.getDefaultFolder();

		for (const file of mdFiles) {
			let isSynced = false;
			let syncId: string | undefined;

			// Check if file is inside default _synced folder
			if (file.path.startsWith(`${defaultFolder}/`)) {
				isSynced = true;
			}

			// Check frontmatter
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter && cache.frontmatter['inkwell-sync-id']) {
				isSynced = true;
				syncId = String(cache.frontmatter['inkwell-sync-id']);
			}

			if (isSynced) {
				result.push({
					title: file.basename,
					path: file.path,
					syncId,
				});
			}
		}

		return result.sort((a, b) => a.title.localeCompare(b.title));
	}
}
