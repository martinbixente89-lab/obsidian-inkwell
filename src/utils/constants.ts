export interface PaletteColor {
	id: string;
	name: string;
	hex: string;
}

export interface HighlightColor {
	id: string;
	name: string;
	value: string; // rgba(...) or hex with alpha
}

/**
 * 8-color palette for text colors (Inkwell V0.2.0+).
 */
export const COLOR_PALETTE: PaletteColor[] = [
	{ id: 'red', name: 'Rouge', hex: '#e03131' },
	{ id: 'orange', name: 'Orange', hex: '#e8590c' },
	{ id: 'yellow', name: 'Jaune', hex: '#d48806' },
	{ id: 'green', name: 'Vert', hex: '#2f9e44' },
	{ id: 'blue', name: 'Bleu', hex: '#1971c2' },
	{ id: 'turquoise', name: 'Turquoise', hex: '#0ca678' },
	{ id: 'purple', name: 'Violet', hex: '#ae3ec9' },
	{ id: 'gray', name: 'Gris', hex: '#868e96' },
];

/**
 * 5 translucent pastel highlights with alpha 0.35 (Inkwell V0.3.0).
 * Tested for contrast in light and dark themes.
 */
export const HIGHLIGHT_PALETTE: HighlightColor[] = [
	{ id: 'yellow', name: 'Jaune', value: 'rgba(255, 212, 59, 0.35)' },
	{ id: 'green', name: 'Vert', value: 'rgba(81, 207, 102, 0.35)' },
	{ id: 'blue', name: 'Bleu', value: 'rgba(77, 171, 247, 0.35)' },
	{ id: 'pink', name: 'Rose', value: 'rgba(240, 101, 149, 0.35)' },
	{ id: 'orange', name: 'Orange', value: 'rgba(255, 146, 43, 0.35)' },
];

/** The default fallback text color (Red). */
export const DEFAULT_TEXT_COLOR = '#e03131';

/** The default fallback highlight color (Jaune translucent). */
export const DEFAULT_HIGHLIGHT_COLOR = 'rgba(255, 212, 59, 0.35)';

/** Explicit marker identifying spans managed by Inkwell. */
export const INKWELL_MARKER_ATTR = 'data-inkwell';
export const INKWELL_MARKER_VALUE = '1';

/**
 * Text size options for Inkwell (V0.5.0).
 * Relative 'em' units scale contextually in paragraphs, headings, and lists.
 */
export interface TextSizeOption {
	id: 'small' | 'normal' | 'large';
	name: string;
	value: string | null;
	desc: string;
}

export const SMALL_TEXT_SIZE = '0.85em';
export const LARGE_TEXT_SIZE = '1.25em';

export const TEXT_SIZE_OPTIONS: TextSizeOption[] = [
	{ id: 'small', name: 'Petite', value: SMALL_TEXT_SIZE, desc: '0.85em' },
	{ id: 'normal', name: 'Normale', value: null, desc: 'Taille d’origine' },
	{ id: 'large', name: 'Grande', value: LARGE_TEXT_SIZE, desc: '1.25em' },
];

export const COMMON_PT_SIZES: number[] = [
	8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72,
];

export interface HeadingOption {
	level: 1 | 2 | 3 | 4 | 5 | 6 | null;
	label: string;
	desc: string;
}

export const HEADING_OPTIONS: HeadingOption[] = [
	{ level: null, label: 'Texte normal', desc: 'Paragraphe' },
	{ level: 1, label: 'Titre 1', desc: 'H1' },
	{ level: 2, label: 'Titre 2', desc: 'H2' },
	{ level: 3, label: 'Titre 3', desc: 'H3' },
	{ level: 4, label: 'Titre 4', desc: 'H4' },
	{ level: 5, label: 'Titre 5', desc: 'H5' },
	{ level: 6, label: 'Titre 6', desc: 'H6' },
];

export function isValidPaletteColor(hex: string): boolean {
	return COLOR_PALETTE.some((c) => c.hex.toLowerCase() === hex.toLowerCase());
}

export function getPaletteColorByHex(hex: string): PaletteColor | undefined {
	return COLOR_PALETTE.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
}

export function isValidHighlightColor(value: string): boolean {
	const norm = value.replace(/\s+/g, '').toLowerCase();
	return HIGHLIGHT_PALETTE.some(
		(h) => h.value.replace(/\s+/g, '').toLowerCase() === norm,
	);
}

export function getHighlightColorByValue(value: string): HighlightColor | undefined {
	const norm = value.replace(/\s+/g, '').toLowerCase();
	return HIGHLIGHT_PALETTE.find(
		(h) => h.value.replace(/\s+/g, '').toLowerCase() === norm,
	);
}

/**
 * Font family options for Inkwell (V0.6.0).
 * Generic CSS font families: sans-serif, serif, monospace, or contextual default.
 */
export type FontFamilyId = 'sans' | 'serif' | 'mono' | 'default';

export interface FontFamilyOption {
	id: FontFamilyId;
	name: string;
	value: string | null;
	desc: string;
}

export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
	{ id: 'sans', name: 'Sans empattement', value: 'sans-serif', desc: 'sans-serif' },
	{ id: 'serif', name: 'Avec empattement', value: 'serif', desc: 'serif' },
	{ id: 'mono', name: 'Monospace', value: 'monospace', desc: 'monospace' },
	{ id: 'default', name: 'Police par défaut', value: null, desc: 'Police du contexte' },
];

export function getFontFamilyOptionById(id: FontFamilyId): FontFamilyOption | undefined {
	return FONT_FAMILY_OPTIONS.find((f) => f.id === id);
}

export function getFontFamilyOptionByValue(value: string | null): FontFamilyOption | undefined {
	if (value === null) return FONT_FAMILY_OPTIONS.find((f) => f.value === null);
	const norm = value.trim().toLowerCase();
	return FONT_FAMILY_OPTIONS.find((f) => f.value?.toLowerCase() === norm);
}

