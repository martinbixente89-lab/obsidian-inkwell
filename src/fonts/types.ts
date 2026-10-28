/**
 * Inkwell V1.2.0 — Types pour polices personnelles.
 */
import type { Vault } from 'obsidian';

export type FontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2';
export type FontStyle = 'normal' | 'italic';
export type FontWeight =
	| 'normal'
	| 'bold'
	| '100'
	| '200'
	| '300'
	| '400'
	| '500'
	| '600'
	| '700'
	| '800'
	| '900';

export interface CustomFontItem {
	id: string; // Identifiant interne unique
	name: string; // Nom d'affichage dans Inkwell (modifiable par l'utilisateur)
	familyName: string; // Nom CSS unique utilisé dans @font-face et font-family: '...'
	fileName: string; // Nom du fichier stocké dans le coffre
	relativePath: string; // Chemin relatif dans le coffre (ex: .obsidian/plugins/inkwell/fonts/Police.ttf)
	format: FontFormat;
	weight: FontWeight;
	style: FontStyle;
	extension: string; // ttf, otf, woff, woff2
	sizeBytes: number;
	importedAt: string; // ISO 8601
}

export interface FontValidationResult {
	valid: boolean;
	error?: string;
	fontFace?: FontFace;
	format?: FontFormat;
	style?: FontStyle;
	weight?: FontWeight;
}

export const SUPPORTED_FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const;
export type SupportedFontExtension = (typeof SUPPORTED_FONT_EXTENSIONS)[number];

export function getInkwellFontsDir(vault: Vault): string {
	return `${vault.configDir}/plugins/inkwell/fonts`;
}


