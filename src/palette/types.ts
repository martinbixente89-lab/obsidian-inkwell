/**
 * Inkwell V1.1.0 — Types pour palettes personnalisées, récents, favoris et contraste.
 */

export type PaletteType = 'text' | 'highlight';

export interface PaletteColorItem {
	id: string;
	name: string;
	value: string; // hex (#rrggbb, #rgb) ou rgba(...)
}

export interface CustomPalette {
	id: string;
	name: string;
	type: PaletteType;
	isBuiltIn?: boolean;
	colors: PaletteColorItem[];
}

/**
 * Format d'export / import JSON versionné (Schéma v1).
 */
export interface PalettesExportFormat {
	schemaVersion: 1;
	exportedAt: string; // ISO 8601
	pluginVersion: string; // "1.1.0"
	palettes: CustomPalette[];
}

/**
 * Modes de résolution des conflits lors de l'import.
 */
export type ImportConflictMode = 'merge' | 'replace';

export interface ImportValidationResult {
	valid: boolean;
	error?: string;
	palettes?: CustomPalette[];
}

/**
 * Informations de contraste WCAG 2.1.
 */
export interface ContrastEvaluation {
	ratio: number; // ex: 4.51
	ratioFormatted: string; // "4.5:1"
	backgroundUsed: string; // ex: "Fond affiché (#1c1c1c)" ou "Fond de référence (#1e1e1e)" ou "Surlignage..."
	isRealMeasuredBackground?: boolean;
	passesNormal: boolean; // ratio >= 4.5
	passesLarge: boolean; // ratio >= 3.0
	isMixed: boolean; // true si sélection hétérogène (plusieurs couleurs ou fonds)
	mixedDescription?: string;
	suggestedColor?: string; // suggestion plus lisible sans substitution forcée
}
