import type { CustomPalette, PaletteType } from '../palette/types';

/**
 * Accessible palette picker (role="listbox"): each option shows the palette name
 * and its colour swatches. Selection follows focus (arrows, Home/End) and also
 * works with click, Enter and Space. Built-in palettes are listed first.
 */

export function palettesForSelector(palettes: CustomPalette[], type: PaletteType): CustomPalette[] {
	const ofType = palettes.filter((p) => p.type === type);
	return [...ofType.filter((p) => p.isBuiltIn), ...ofType.filter((p) => !p.isBuiltIn)];
}

export function nextListboxIndex(key: string, current: number, count: number): number | null {
	if (count <= 0) return null;
	switch (key) {
		case 'ArrowDown':
		case 'ArrowRight':
			return Math.min(count - 1, current + 1);
		case 'ArrowUp':
		case 'ArrowLeft':
			return Math.max(0, current - 1);
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}

const MAX_SWATCHES = 12;

export function renderPaletteSelector(
	containerEl: HTMLElement,
	options: {
		label: string;
		palettes: CustomPalette[];
		activeId: string;
		onSelect: (palette: CustomPalette) => void;
	},
): void {
	const group = containerEl.createDiv({ cls: 'inkwell-palette-selector' });
	const labelEl = group.createDiv({ cls: 'inkwell-palette-selector-label', text: options.label });
	const list = group.createDiv({
		cls: 'inkwell-palette-selector-list',
		attr: { role: 'listbox' },
	});
	labelEl.id = `inkwell-palette-selector-${Math.random().toString(36).slice(2, 9)}`;
	list.setAttribute('aria-labelledby', labelEl.id);

	if (options.palettes.length === 0) {
		list.createDiv({ cls: 'inkwell-palette-selector-empty', text: 'Aucune palette disponible.' });
		return;
	}

	let activeIndex = Math.max(
		0,
		options.palettes.findIndex((p) => p.id === options.activeId),
	);
	const items: HTMLElement[] = [];

	const select = (index: number, focus: boolean) => {
		const palette = options.palettes[index];
		if (!palette) return;
		const changed = index !== activeIndex || palette.id !== options.activeId;
		activeIndex = index;
		items.forEach((item, i) => {
			const on = i === index;
			item.setAttribute('aria-selected', on ? 'true' : 'false');
			item.setAttribute('tabindex', on ? '0' : '-1');
			item.toggleClass('is-selected', on);
		});
		if (focus) items[index]?.focus();
		if (changed) {
			options.activeId = palette.id;
			options.onSelect(palette);
		}
	};

	options.palettes.forEach((palette, index) => {
		const item = list.createDiv({
			cls: 'inkwell-palette-option',
			attr: { role: 'option', 'data-inkwell-focus-id': `palette-option:${palette.type}:${palette.id}` },
		});
		const head = item.createDiv({ cls: 'inkwell-palette-option-head' });
		head.createSpan({ cls: 'inkwell-palette-option-name', text: palette.name });
		head.createSpan({
			cls: 'inkwell-palette-option-meta',
			text: palette.isBuiltIn ? 'Intégrée' : 'Personnelle',
		});
		const swatches = item.createDiv({ cls: 'inkwell-palette-option-swatches', attr: { 'aria-hidden': 'true' } });
		for (const color of palette.colors.slice(0, MAX_SWATCHES)) {
			const sw = swatches.createSpan({ cls: 'inkwell-palette-option-swatch' });
			sw.setCssProps({ '--inkwell-swatch-color': color.value });
		}
		if (palette.colors.length > MAX_SWATCHES) {
			swatches.createSpan({
				cls: 'inkwell-palette-option-more',
				text: `+${palette.colors.length - MAX_SWATCHES}`,
			});
		}
		item.setAttribute(
			'aria-label',
			`${palette.name}, ${palette.colors.length} couleur${palette.colors.length > 1 ? 's' : ''}`,
		);
		item.addEventListener('click', () => select(index, true));
		item.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				select(index, true);
				return;
			}
			const next = nextListboxIndex(e.key, index, options.palettes.length);
			if (next === null) return;
			e.preventDefault();
			select(next, true);
		});
		items.push(item);
	});

	// Initial state without triggering onSelect.
	items.forEach((item, i) => {
		const on = i === activeIndex;
		item.setAttribute('aria-selected', on ? 'true' : 'false');
		item.setAttribute('tabindex', on ? '0' : '-1');
		item.toggleClass('is-selected', on);
	});
}
