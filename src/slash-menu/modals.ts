import { App, FuzzySuggestModal, TFile } from 'obsidian';

export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly onSelect: (file: TFile) => void;

	constructor(app: App, onSelect: (file: TFile) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder('Sélectionner une note du coffre...');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(item);
	}
}

export class VaultFileSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly allowedExtensions: Set<string> | null;
	private readonly onSelect: (file: TFile) => void;

	constructor(
		app: App,
		placeholder: string,
		extensions: string[] | null,
		onSelect: (file: TFile) => void,
	) {
		super(app);
		this.allowedExtensions = extensions ? new Set(extensions.map((e) => e.toLowerCase())) : null;
		this.onSelect = onSelect;
		this.setPlaceholder(placeholder);
	}

	getItems(): TFile[] {
		const files = this.app.vault.getFiles();
		if (!this.allowedExtensions) {
			return files;
		}
		return files.filter((f) => this.allowedExtensions?.has(f.extension.toLowerCase()));
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(item);
	}
}

