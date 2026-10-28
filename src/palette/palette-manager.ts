import {
	CustomPalette,
	ImportConflictMode,
	ImportValidationResult,
	PaletteColorItem,
	PalettesExportFormat,
	PaletteType,
} from './types';
import { parseCssColor } from './contrast';
import { COLOR_PALETTE, HIGHLIGHT_PALETTE } from '../utils/constants';

export const BUILTIN_TEXT_PALETTE_ID = 'built-in-text';
export const BUILTIN_HIGHLIGHT_PALETTE_ID = 'built-in-highlight';

/**
 * Returns the default built-in text and highlight palettes.
 */
export function createDefaultPalettes(): CustomPalette[] {
	return [
		{
			id: BUILTIN_TEXT_PALETTE_ID,
			name: 'Palette intégrée',
			type: 'text',
			isBuiltIn: true,
			colors: COLOR_PALETTE.map((c) => ({
				id: c.id,
				name: c.name,
				value: c.hex,
			})),
		},
		{
			id: BUILTIN_HIGHLIGHT_PALETTE_ID,
			name: 'Surlignages intégrés',
			type: 'highlight',
			isBuiltIn: true,
			colors: HIGHLIGHT_PALETTE.map((h) => ({
				id: h.id,
				name: h.name,
				value: h.value,
			})),
		},
	];
}

/**
 * Validates a color value (must be parseable as CSS hex/rgb/rgba).
 */
export function isValidColorValue(val: string): boolean {
	return parseCssColor(val) !== null;
}

/**
 * Normalizes a color string for deduplication (case-insensitive, whitespace-trimmed).
 */
export function normalizeColorValue(val: string): string {
	return val.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Adds a color to a recent list (MRU order, max 10, deduplicated).
 */
export function addRecentColor(list: string[], color: string, maxItems = 10): string[] {
	if (!isValidColorValue(color)) return list;
	const norm = normalizeColorValue(color);
	const filtered = list.filter((c) => normalizeColorValue(c) !== norm);
	filtered.unshift(color.trim());
	return filtered.slice(0, maxItems);
}

/**
 * Toggles a color in a favorites list.
 */
export function toggleFavoriteColor(list: string[], color: string): { list: string[]; isFavorite: boolean } {
	if (!isValidColorValue(color)) return { list, isFavorite: false };
	const norm = normalizeColorValue(color);
	const exists = list.some((c) => normalizeColorValue(c) === norm);
	if (exists) {
		return {
			list: list.filter((c) => normalizeColorValue(c) !== norm),
			isFavorite: false,
		};
	} else {
		return {
			list: [...list, color.trim()],
			isFavorite: true,
		};
	}
}

/**
 * Checks if a color is marked as favorite.
 */
export function isColorFavorite(list: string[], color: string): boolean {
	const norm = normalizeColorValue(color);
	return list.some((c) => normalizeColorValue(c) === norm);
}

/**
 * Generates an export payload in validated JSON Schema V1 format.
 */
export function exportPalettesToJson(palettes: CustomPalette[], pluginVersion = '1.1.0'): string {
	const payload: PalettesExportFormat = {
		schemaVersion: 1,
		exportedAt: new Date().toISOString(),
		pluginVersion,
		palettes,
	};
	return JSON.stringify(payload, null, 2);
}

/**
 * Validates raw JSON string or object for palette import.
 */
export function validateImportedPalettesJson(raw: unknown): ImportValidationResult {
	try {
		const obj: unknown = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
		if (!obj || typeof obj !== 'object') {
			return { valid: false, error: 'Le fichier ne contient pas un objet JSON valide.' };
		}
		const data = obj as Record<string, unknown>;
		if (data.schemaVersion !== 1) {
			return { valid: false, error: 'Version de schéma non supportée (schemaVersion attendu: 1).' };
		}
		if (!Array.isArray(data.palettes)) {
			return { valid: false, error: 'Le champ "palettes" doit être une liste.' };
		}

		const validatedPalettes: CustomPalette[] = [];
		for (let i = 0; i < data.palettes.length; i++) {
			const p = data.palettes[i] as Record<string, unknown>;
			if (!p || typeof p !== 'object') continue;
			const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `imported-palette-${i + 1}`;
			const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Palette importée ${i + 1}`;
			const type: PaletteType = p.type === 'highlight' ? 'highlight' : 'text';
			const isBuiltIn = Boolean(p.isBuiltIn);

			const colors: PaletteColorItem[] = [];
			if (Array.isArray(p.colors)) {
				for (let j = 0; j < p.colors.length; j++) {
					const c = p.colors[j] as Record<string, unknown>;
					if (!c || typeof c !== 'object') continue;
					const cVal = typeof c.value === 'string' ? c.value.trim() : '';
					if (!isValidColorValue(cVal)) continue; // ignore invalid color strings
					const cId = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `color-${j + 1}`;
					const cName = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : cVal;
					colors.push({ id: cId, name: cName, value: cVal });
				}
			}

			validatedPalettes.push({
				id,
				name,
				type,
				isBuiltIn,
				colors,
			});
		}

		if (validatedPalettes.length === 0) {
			return { valid: false, error: 'Aucune palette valide n’a été trouvée dans le fichier.' };
		}

		return { valid: true, palettes: validatedPalettes };
	} catch (err) {
		return {
			valid: false,
			error: `Erreur de syntaxe JSON : ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Resolves imported palettes with current existing palettes (merge vs replace).
 */
export function resolvePalettesImport(
	existing: CustomPalette[],
	imported: CustomPalette[],
	mode: ImportConflictMode,
): CustomPalette[] {
	if (mode === 'replace') {
		// In replace mode, ensure built-in palettes remain available if omitted
		const builtIns = createDefaultPalettes();
		const hasTextBuiltin = imported.some((p) => p.id === BUILTIN_TEXT_PALETTE_ID);
		const hasHlBuiltin = imported.some((p) => p.id === BUILTIN_HIGHLIGHT_PALETTE_ID);

		const result = [...imported];
		if (!hasTextBuiltin) {
			const bText = builtIns.find((p) => p.id === BUILTIN_TEXT_PALETTE_ID);
			if (bText) result.unshift(bText);
		}
		if (!hasHlBuiltin) {
			const bHl = builtIns.find((p) => p.id === BUILTIN_HIGHLIGHT_PALETTE_ID);
			if (bHl) result.push(bHl);
		}
		return result;
	}

	// Merge mode:
	const result = [...existing];
	const existingIds = new Set(existing.map((p) => p.id));

	for (const imp of imported) {
		if (existingIds.has(imp.id)) {
			// Duplicate ID conflict: generate unique new ID and adjust name
			const newId = `${imp.id}-copy-${Date.now().toString().slice(-4)}`;
			result.push({
				...imp,
				id: newId,
				name: `${imp.name} (copie)`,
				isBuiltIn: false,
			});
		} else {
			result.push(imp);
		}
	}

	return result;
}

/**
 * Reorders colors inside a palette by moving an item from fromIndex to toIndex.
 */
export function reorderPaletteColors(
	palette: CustomPalette,
	fromIndex: number,
	toIndex: number,
): CustomPalette {
	if (fromIndex < 0 || fromIndex >= palette.colors.length || toIndex < 0 || toIndex >= palette.colors.length) {
		return palette;
	}
	const updated = [...palette.colors];
	const [item] = updated.splice(fromIndex, 1);
	if (item) {
		updated.splice(toIndex, 0, item);
	}
	return {
		...palette,
		colors: updated,
	};
}
