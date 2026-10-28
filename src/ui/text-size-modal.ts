import { App, FuzzySuggestModal } from 'obsidian';
import type InkwellPlugin from '../main';
import { CapturedEditorSelection } from '../commands/selection-state';
import { applySizeToCapturedRange } from '../commands/text-size';
import { TextSizeOption, TEXT_SIZE_OPTIONS } from '../utils/constants';

export class TextSizeModal extends FuzzySuggestModal<TextSizeOption> {
	private plugin: InkwellPlugin;
	private captured: CapturedEditorSelection;

	constructor(
		app: App,
		plugin: InkwellPlugin,
		captured: CapturedEditorSelection,
	) {
		super(app);
		this.plugin = plugin;
		this.captured = captured;
		this.setPlaceholder('Choisir une taille de texte...');
	}

	getItems(): TextSizeOption[] {
		return TEXT_SIZE_OPTIONS;
	}

	getItemText(item: TextSizeOption): string {
		return `${item.name} (${item.desc})`;
	}

	renderSuggestion(item: { item: TextSizeOption }, el: HTMLElement): void {
		el.empty();
		const container = el.createDiv({ cls: 'inkwell-palette-item' });
		const left = container.createDiv({ cls: 'inkwell-palette-item-left' });
		const label = left.createSpan({ cls: 'inkwell-palette-label' });
		label.setText(item.item.name);

		const badge = container.createSpan({ cls: 'inkwell-palette-badge' });
		badge.setText(item.item.desc);
	}

	onChooseItem(item: TextSizeOption): void {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		applySizeToCapturedRange(
			this.captured.editor,
			this.captured,
			activeFile?.path ?? null,
			item.value,
		);
	}
}
