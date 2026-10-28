import { App, FuzzyMatch, FuzzySuggestModal } from 'obsidian';
import type InkwellPlugin from '../main';
import { applyHighlightToCapturedRange } from '../commands/text-highlight';
import type { CapturedEditorSelection } from '../commands/selection-state';
import { addRecentColor, isColorFavorite } from '../palette/palette-manager';

export interface HighlightModalItem {
	id: string;
	name: string;
	value: string;
	paletteName: string;
	isFavorite?: boolean;
}

export class HighlightPickerModal extends FuzzySuggestModal<HighlightModalItem> {
	private plugin: InkwellPlugin;
	private captured: CapturedEditorSelection;

	constructor(app: App, plugin: InkwellPlugin, captured: CapturedEditorSelection) {
		super(app);
		this.plugin = plugin;
		this.captured = captured;
		this.setPlaceholder('Choisir une couleur de surlignage...');
	}

	getItems(): HighlightModalItem[] {
		const items: HighlightModalItem[] = [];
		const hlPalettes = this.plugin.settings.palettes.filter((p) => p.type === 'highlight');
		const favs = this.plugin.settings.favoriteHighlights;

		for (const palette of hlPalettes) {
			for (const h of palette.colors) {
				items.push({
					id: h.id,
					name: h.name,
					value: h.value,
					paletteName: palette.name,
					isFavorite: isColorFavorite(favs, h.value),
				});
			}
		}
		return items;
	}

	getItemText(item: HighlightModalItem): string {
		const isDefault =
			item.value.replace(/\s+/g, '').toLowerCase() ===
			this.plugin.settings.defaultHighlightColor.replace(/\s+/g, '').toLowerCase();
		const defaultBadge = isDefault ? ' défaut' : '';
		const favBadge = item.isFavorite ? ' favori' : '';
		return `${item.name} (${item.paletteName})${defaultBadge}${favBadge}`;
	}

	renderSuggestion(match: FuzzyMatch<HighlightModalItem>, el: HTMLElement): void {
		el.empty();
		const item = match.item;
		const isDefault =
			item.value.replace(/\s+/g, '').toLowerCase() ===
			this.plugin.settings.defaultHighlightColor.replace(/\s+/g, '').toLowerCase();

		const row = el.createDiv({
			cls: 'inkwell-palette-item',
		});

		const left = row.createDiv({
			cls: 'inkwell-palette-item-left',
		});

		const swatch = left.createSpan({ cls: 'inkwell-modal-swatch' });
		swatch.setCssProps({
			'--inkwell-swatch-color': item.value,
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

	onChooseItem(item: HighlightModalItem, _evt: MouseEvent | KeyboardEvent): void {
		const activeFile = this.app.workspace.getActiveFile();
		const currentFilePath = activeFile?.path ?? null;

		// Record in recents
		this.plugin.settings.recentHighlights = addRecentColor(
			this.plugin.settings.recentHighlights,
			item.value,
		);
		void this.plugin.saveSettings();

		applyHighlightToCapturedRange(
			this.captured.editor,
			this.captured,
			currentFilePath,
			item.value,
		);
	}

	onClose(): void {
		// Closing modal without choice leaves note strictly untouched.
	}
}
