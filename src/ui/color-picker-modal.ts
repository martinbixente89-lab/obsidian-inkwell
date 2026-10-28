import { App, FuzzyMatch, FuzzySuggestModal } from 'obsidian';
import type InkwellPlugin from '../main';
import { applyColorToCapturedRange } from '../commands/text-color';
import type { CapturedEditorSelection } from '../commands/selection-state';
import { addRecentColor, isColorFavorite } from '../palette/palette-manager';

export interface ColorModalItem {
	id: string;
	name: string;
	hex: string;
	paletteName: string;
	isFavorite?: boolean;
}

export class ColorPickerModal extends FuzzySuggestModal<ColorModalItem> {
	private plugin: InkwellPlugin;
	private captured: CapturedEditorSelection;
	private wasChosen = false;

	constructor(app: App, plugin: InkwellPlugin, captured: CapturedEditorSelection) {
		super(app);
		this.plugin = plugin;
		this.captured = captured;
		this.setPlaceholder('Choisir une couleur de texte...');
	}

	getItems(): ColorModalItem[] {
		const items: ColorModalItem[] = [];
		const textPalettes = this.plugin.settings.palettes.filter((p) => p.type === 'text');
		const favs = this.plugin.settings.favoriteColors;

		for (const palette of textPalettes) {
			for (const c of palette.colors) {
				items.push({
					id: c.id,
					name: c.name,
					hex: c.value,
					paletteName: palette.name,
					isFavorite: isColorFavorite(favs, c.value),
				});
			}
		}
		return items;
	}

	getItemText(item: ColorModalItem): string {
		const isDefault =
			item.hex.toLowerCase() === this.plugin.settings.defaultColor.toLowerCase();
		const defaultBadge = isDefault ? ' défaut' : '';
		const favBadge = item.isFavorite ? ' favori' : '';
		return `${item.name} (${item.paletteName})${defaultBadge}${favBadge}`;
	}

	renderSuggestion(match: FuzzyMatch<ColorModalItem>, el: HTMLElement): void {
		el.empty();
		const item = match.item;
		const isDefault =
			item.hex.toLowerCase() === this.plugin.settings.defaultColor.toLowerCase();

		const row = el.createDiv({
			cls: 'inkwell-palette-item',
		});

		const left = row.createDiv({
			cls: 'inkwell-palette-item-left',
		});

		const swatch = left.createSpan({ cls: 'inkwell-modal-swatch' });
		swatch.setCssProps({
			'--inkwell-swatch-color': item.hex,
		});

		const labelContainer = left.createDiv({ cls: 'inkwell-palette-label-group' });
		labelContainer.createSpan({
			cls: 'inkwell-palette-label',
			text: item.name,
		});
		labelContainer.createSpan({
			cls: 'inkwell-palette-group-name',
			text: item.paletteName,
		});

		const right = row.createDiv({ cls: 'inkwell-palette-item-right' });
		if (item.isFavorite) {
			right.createSpan({
				cls: 'inkwell-palette-star-badge',
				text: '★',
			});
		}
		if (isDefault) {
			right.createSpan({
				cls: 'inkwell-palette-badge',
				text: 'défaut',
			});
		}
	}

	onChooseItem(item: ColorModalItem, _evt: MouseEvent | KeyboardEvent): void {
		this.wasChosen = true;
		const activeFile = this.app.workspace.getActiveFile();
		const currentFilePath = activeFile?.path ?? null;

		// Record in recents
		this.plugin.settings.recentColors = addRecentColor(
			this.plugin.settings.recentColors,
			item.hex,
		);
		void this.plugin.saveSettings();

		// Apply color
		applyColorToCapturedRange(
			this.captured.editor,
			this.captured,
			currentFilePath,
			item.hex,
		);
	}

	onClose(): void {
		this.wasChosen = false;
	}
}
