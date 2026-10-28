import { App, FuzzySuggestModal } from 'obsidian';
import type InkwellPlugin from '../main';
import { CapturedEditorSelection } from '../commands/selection-state';
import { applyFontFamilyToCapturedRange } from '../commands/font-family';
import { FontFamilyOption, FONT_FAMILY_OPTIONS } from '../utils/constants';

export class FontFamilyModal extends FuzzySuggestModal<FontFamilyOption> {
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
		this.setPlaceholder('Choisir une police de texte...');
	}

	getItems(): FontFamilyOption[] {
		return FONT_FAMILY_OPTIONS;
	}

	getItemText(item: FontFamilyOption): string {
		return `${item.name} (${item.desc})`;
	}

	renderSuggestion(item: { item: FontFamilyOption }, el: HTMLElement): void {
		el.empty();
		const container = el.createDiv({ cls: 'inkwell-palette-item' });
		const left = container.createDiv({ cls: 'inkwell-palette-item-left' });
		const label = left.createSpan({ cls: 'inkwell-palette-label' });
		label.setText(item.item.name);
		if (item.item.value) {
			label.style.fontFamily = item.item.value;
		}

		const badge = container.createSpan({ cls: 'inkwell-palette-badge' });
		badge.setText(item.item.desc);
	}

	onChooseItem(item: FontFamilyOption): void {
		const activeFile = this.plugin.app.workspace.getActiveFile();
		applyFontFamilyToCapturedRange(
			this.captured.editor,
			this.captured,
			activeFile?.path ?? null,
			item.value,
		);
	}
}
