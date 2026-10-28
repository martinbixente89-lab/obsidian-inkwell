import {
	DEFAULT_HIGHLIGHT_COLOR,
	DEFAULT_TEXT_COLOR,
} from '../utils/constants';
import { CustomPalette } from '../palette/types';
import {
	BUILTIN_HIGHLIGHT_PALETTE_ID,
	BUILTIN_TEXT_PALETTE_ID,
	createDefaultPalettes,
	isValidColorValue,
	normalizeColorValue,
} from '../palette/palette-manager';
import { CustomFontItem } from '../fonts/types';

export interface InkwellSettings {
	defaultColor: string;
	defaultHighlightColor: string;
	toolbarEnabled: boolean;
	experimentalTagNavigation: boolean;
	experimentalColorBoldSupport: boolean;

	// V1.1.0 — Palettes personnalisées
	palettes: CustomPalette[];
	recentColors: string[];
	recentHighlights: string[];
	favoriteColors: string[];
	favoriteHighlights: string[];
	activeTextPaletteId: string;
	activeHighlightPaletteId: string;

	// V1.2.0 — Polices personnelles
	customFonts: CustomFontItem[];
}

export const DEFAULT_SETTINGS: InkwellSettings = {
	defaultColor: DEFAULT_TEXT_COLOR,
	defaultHighlightColor: DEFAULT_HIGHLIGHT_COLOR,
	toolbarEnabled: true,
	experimentalTagNavigation: true,
	experimentalColorBoldSupport: true,

	palettes: createDefaultPalettes(),
	recentColors: [],
	recentHighlights: [],
	favoriteColors: [],
	favoriteHighlights: [],
	activeTextPaletteId: BUILTIN_TEXT_PALETTE_ID,
	activeHighlightPaletteId: BUILTIN_HIGHLIGHT_PALETTE_ID,

	customFonts: [],
};

/**
 * Validates loaded data, filling missing fields with defaults.
 * Preserves existing defaultColor and defaultHighlightColor.
 * Preserves explicit boolean choices for toolbar and tag navigation.
 * Validates and restores custom palettes, recents, and favorites.
 * If values are unrecognized or missing, falls back safely to default values.
 */
export function sanitizeSettings(loaded: unknown): InkwellSettings {
	if (!loaded || typeof loaded !== 'object') {
		return { ...DEFAULT_SETTINGS };
	}
	const data = loaded as Record<string, unknown>;
	const rawColor = typeof data.defaultColor === 'string' ? data.defaultColor.trim() : '';
	const rawHighlight =
		typeof data.defaultHighlightColor === 'string'
			? data.defaultHighlightColor.trim()
			: '';
	const rawToolbar =
		typeof data.toolbarEnabled === 'boolean'
			? data.toolbarEnabled
			: DEFAULT_SETTINGS.toolbarEnabled;
	const rawNav =
		typeof data.experimentalTagNavigation === 'boolean'
			? data.experimentalTagNavigation
			: DEFAULT_SETTINGS.experimentalTagNavigation;
	const rawBold =
		typeof data.experimentalColorBoldSupport === 'boolean'
			? data.experimentalColorBoldSupport
			: DEFAULT_SETTINGS.experimentalColorBoldSupport;

	// Palettes sanitization
	let palettes: CustomPalette[] = DEFAULT_SETTINGS.palettes;
	if (Array.isArray(data.palettes) && data.palettes.length > 0) {
		const validList: CustomPalette[] = [];
		for (const p of data.palettes) {
			if (!p || typeof p !== 'object') continue;
			const pRec = p as Record<string, unknown>;
			const id = typeof pRec.id === 'string' && pRec.id.trim() ? pRec.id.trim() : '';
			const name = typeof pRec.name === 'string' && pRec.name.trim() ? pRec.name.trim() : '';
			const type = pRec.type === 'highlight' ? 'highlight' : 'text';
			if (!id || !name) continue;

			const colors = Array.isArray(pRec.colors)
				? pRec.colors
						.filter(
							(c) =>
								c &&
								typeof c === 'object' &&
								typeof (c as Record<string, unknown>).value === 'string' &&
								isValidColorValue((c as Record<string, unknown>).value as string),
						)
						.map((c, idx) => {
							const cRec = c as Record<string, unknown>;
							const val = (cRec.value as string).trim();
							const cId =
								typeof cRec.id === 'string' && cRec.id.trim()
									? cRec.id.trim()
									: `color-${idx + 1}`;
							const cName =
								typeof cRec.name === 'string' && cRec.name.trim()
									? cRec.name.trim()
									: val;
							return { id: cId, name: cName, value: val };
						})
				: [];

			validList.push({
				id,
				name,
				type,
				isBuiltIn: Boolean(pRec.isBuiltIn),
				colors,
			});
		}
		if (validList.length > 0) {
			palettes = validList;
		}
	}

	// Sanitize recent colors (max 10, valid, deduplicated)
	const sanitizeColorList = (list: unknown, maxLen = 10): string[] => {
		if (!Array.isArray(list)) return [];
		const res: string[] = [];
		const seen = new Set<string>();
		for (const item of list) {
			if (typeof item === 'string' && isValidColorValue(item)) {
				const norm = normalizeColorValue(item);
				if (!seen.has(norm)) {
					seen.add(norm);
					res.push(item.trim());
					if (res.length >= maxLen) break;
				}
			}
		}
		return res;
	};

	const recentColors = sanitizeColorList(data.recentColors, 10);
	const recentHighlights = sanitizeColorList(data.recentHighlights, 10);
	const favoriteColors = sanitizeColorList(data.favoriteColors, 100);
	const favoriteHighlights = sanitizeColorList(data.favoriteHighlights, 100);

	const activeTextPaletteId =
		typeof data.activeTextPaletteId === 'string' &&
		palettes.some((p) => p.id === data.activeTextPaletteId && p.type === 'text')
			? data.activeTextPaletteId
			: palettes.find((p) => p.type === 'text')?.id ?? BUILTIN_TEXT_PALETTE_ID;

	const activeHighlightPaletteId =
		typeof data.activeHighlightPaletteId === 'string' &&
		palettes.some((p) => p.id === data.activeHighlightPaletteId && p.type === 'highlight')
			? data.activeHighlightPaletteId
			: palettes.find((p) => p.type === 'highlight')?.id ?? BUILTIN_HIGHLIGHT_PALETTE_ID;

	// Validate defaultColor & defaultHighlightColor: must be valid color values, else fallback explicitly
	const defaultColor = isValidColorValue(rawColor) ? rawColor : DEFAULT_SETTINGS.defaultColor;
	const defaultHighlightColor = isValidColorValue(rawHighlight)
		? rawHighlight
		: DEFAULT_SETTINGS.defaultHighlightColor;

	// Custom fonts sanitization
	let customFonts: CustomFontItem[] = [];
	if (Array.isArray(data.customFonts)) {
		customFonts = data.customFonts.filter((f) => {
			if (!f || typeof f !== 'object') return false;
			const r = f as Record<string, unknown>;
			return (
				typeof r.id === 'string' &&
				typeof r.name === 'string' &&
				typeof r.familyName === 'string' &&
				typeof r.relativePath === 'string'
			);
		}) as CustomFontItem[];
	}

	return {
		defaultColor,
		defaultHighlightColor,
		toolbarEnabled: rawToolbar,
		experimentalTagNavigation: rawNav,
		experimentalColorBoldSupport: rawBold,
		palettes,
		recentColors,
		recentHighlights,
		favoriteColors,
		favoriteHighlights,
		activeTextPaletteId,
		activeHighlightPaletteId,
		customFonts,
	};
}
