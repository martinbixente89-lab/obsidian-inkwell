import type { App, Vault } from 'obsidian';
import {
	CustomFontItem,
	FontFormat,
	FontStyle,
	FontWeight,
	FontValidationResult,
	getInkwellFontsDir,
	SUPPORTED_FONT_EXTENSIONS,
} from './types';

/**
 * Normalizes and extracts extension from a file name.
 */
export function getFontExtension(fileName: string): string {
	const parts = fileName.split('.');
	return parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
}

/**
 * Checks if a file extension is among supported font formats.
 */
export function isSupportedFontExtension(ext: string): boolean {
	return (SUPPORTED_FONT_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * Determines CSS format descriptor from extension.
 */
export function getFontFormatFromExtension(ext: string): FontFormat | null {
	switch (ext.toLowerCase()) {
		case 'ttf':
			return 'truetype';
		case 'otf':
			return 'opentype';
		case 'woff':
			return 'woff';
		case 'woff2':
			return 'woff2';
		default:
			return null;
	}
}

/**
 * Infers font attributes (name, style, weight, format) from a filename.
 */
export function inferFontAttributes(fileName: string): {
	displayName: string;
	style: FontStyle;
	weight: FontWeight;
	format: FontFormat;
	extension: string;
} {
	const ext = getFontExtension(fileName);
	const format = getFontFormatFromExtension(ext) ?? 'truetype';
	const baseName = fileName.slice(0, -(ext.length + 1)).trim();

	// Style inference
	const lower = baseName.toLowerCase();
	const isItalic =
		lower.includes('italic') || lower.includes('oblique') || lower.includes('-it');
	const style: FontStyle = isItalic ? 'italic' : 'normal';

	// Weight inference
	let weight: FontWeight = 'normal';
	if (
		lower.includes('black') ||
		lower.includes('heavy') ||
		lower.includes('extrabold') ||
		lower.includes('ultra-bold') ||
		lower.includes('800') ||
		lower.includes('900')
	) {
		weight = 'bold';
	} else if (lower.includes('semibold') || lower.includes('semi-bold') || lower.includes('600')) {
		weight = '600';
	} else if (
		lower.includes('bold') ||
		lower.includes('700') ||
		lower.includes('-bd') ||
		lower.includes('-b')
	) {
		weight = 'bold';
	} else if (lower.includes('medium') || lower.includes('500')) {
		weight = '500';
	} else if (lower.includes('light') || lower.includes('300')) {
		weight = '300';
	} else if (lower.includes('thin') || lower.includes('100')) {
		weight = '100';
	}

	// Human-friendly display name (e.g. "Roboto-BoldItalic" -> "Roboto Bold Italic")
	const cleaned = baseName
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.trim();

	return {
		displayName: cleaned || 'Police personnalisée',
		style,
		weight,
		format,
		extension: ext,
	};
}

/**
 * Generates an internal safe CSS font family identifier.
 */
export function generateUniqueFamilyName(baseName: string, id: string): string {
	const sanitized = baseName.replace(/[^a-zA-Z0-9]/g, '');
	return `InkwellFont_${sanitized}_${id}`;
}

/**
 * Validates that an ArrayBuffer actually loads as a valid FontFace in the browser/electron engine.
 */
export async function validateFontFaceBuffer(
	familyName: string,
	buffer: ArrayBuffer,
	style: FontStyle,
	weight: FontWeight,
): Promise<FontValidationResult> {
	if (!buffer || buffer.byteLength === 0) {
		return { valid: false, error: 'Le fichier est vide (0 octet).' };
	}

	if (typeof FontFace === 'undefined') {
		// Non-browser / Node test environment
		return { valid: true, style, weight };
	}

	try {
		const fontFace = new FontFace(familyName, buffer, {
			style,
			weight,
		});
		await fontFace.load();
		return { valid: true, fontFace, style, weight };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			valid: false,
			error: `Le fichier n'est pas un fichier de police valide ou est corrompu (${msg}).`,
		};
	}
}

/**
 * Resolves duplicate display names by appending (1), (2), etc.
 */
export function resolveUniqueDisplayName(
	existingFonts: CustomFontItem[],
	desiredName: string,
	currentId?: string,
): string {
	let candidate = desiredName.trim();
	let counter = 1;

	while (
		existingFonts.some(
			(f) => f.id !== currentId && f.name.toLowerCase() === candidate.toLowerCase(),
		)
	) {
		candidate = `${desiredName.trim()} (${counter})`;
		counter++;
	}

	return candidate;
}

/**
 * Resolves unique safe file name in fonts directory.
 */
export function resolveUniqueFileName(
	existingFonts: CustomFontItem[],
	desiredFileName: string,
): string {
	const ext = getFontExtension(desiredFileName);
	const base = desiredFileName.slice(0, -(ext.length + 1));
	let candidate = desiredFileName;
	let counter = 1;

	while (
		existingFonts.some((f) => f.fileName.toLowerCase() === candidate.toLowerCase())
	) {
		candidate = `${base}-${counter}.${ext}`;
		counter++;
	}

	return candidate;
}

/**
 * Returns all accessible Document instances in the current Obsidian application,
 * including main window, activeWindow, leaves, and popout windows.
 */
export function getAllObsidianDocuments(app?: App): Document[] {
	const docs = new Set<Document>();
	if (typeof window !== 'undefined' && window.document) {
		docs.add(window.document);
	}
	if (typeof activeWindow !== 'undefined' && activeWindow.document) {
		docs.add(activeWindow.document);
	}
	if (app) {
		try {
			app.workspace.iterateAllLeaves((leaf) => {
				const leafDoc = leaf.view?.containerEl?.ownerDocument;
				if (leafDoc) {
					docs.add(leafDoc);
				}
			});
		} catch {
			// Ignore iteration issues on older or custom leaves
		}
		try {
			const settingPopout = (
				app as unknown as {
					setting?: { popout?: { win?: { document?: Document } } };
				}
			).setting?.popout?.win?.document;
			if (settingPopout) {
				docs.add(settingPopout);
			}
		} catch {
			// Ignore missing setting popout
		}
	}
	return Array.from(docs);
}

/**
 * Ensures the target vault fonts directory exists.
 */
export async function ensureFontsDirectory(vault: Vault): Promise<void> {
	const dir = getInkwellFontsDir(vault);
	const adapter = vault.adapter;
	const exists = await adapter.exists(dir);
	if (!exists) {
		await adapter.mkdir(dir);
	}
}

/**
 * Loads a single CustomFontItem into the target Document's fonts set or into all active documents.
 */
export async function loadFontItemIntoDocument(
	vault: Vault,
	fontItem: CustomFontItem,
	targetDoc?: Document,
	app?: App,
): Promise<boolean> {
	const docsToLoad = targetDoc ? [targetDoc] : getAllObsidianDocuments(app);
	if (docsToLoad.length === 0) {
		return true;
	}

	try {
		const exists = await vault.adapter.exists(fontItem.relativePath);
		if (!exists) {
			console.warn(`[Inkwell] Fichier de police introuvable : ${fontItem.relativePath}. Repli automatique activé.`);
			return false;
		}

		const buffer = await vault.adapter.readBinary(fontItem.relativePath);
		let loadedInAtLeastOne = false;

		for (const doc of docsToLoad) {
			if (!doc || !doc.fonts) continue;

			// Check if already loaded in this document
			let alreadyLoaded = false;
			try {
				(doc.fonts as unknown as Set<FontFace>).forEach((ff) => {
					if (ff.family === fontItem.familyName && ff.status === 'loaded') {
						alreadyLoaded = true;
					}
				});
			} catch {
				// Ignore inspection error
			}
			if (alreadyLoaded) {
				loadedInAtLeastOne = true;
				continue;
			}

			// Use the document-specific window FontFace constructor if present to prevent cross-realm errors
			const fontFaceCtor =
				(doc.defaultView as unknown as { FontFace?: typeof FontFace })?.FontFace ??
				(typeof FontFace !== 'undefined' ? FontFace : undefined);

			if (!fontFaceCtor) continue;

			try {
				const fontFace = new fontFaceCtor(fontItem.familyName, buffer, {
					style: fontItem.style,
					weight: fontItem.weight,
				});
				await fontFace.load();
				(doc.fonts as unknown as Set<FontFace>).add(fontFace);
				loadedInAtLeastOne = true;
			} catch (err) {
				console.warn(`[Inkwell] Erreur lors de l’injection de la police « ${fontItem.name} » :`, err);
			}
		}

		return loadedInAtLeastOne;
	} catch (err) {
		console.warn(`[Inkwell] Impossible de charger la police « ${fontItem.name} » :`, err);
		return false;
	}
}

/**
 * Unregisters a CustomFontItem from document.fonts across all windows or target document.
 */
export function unregisterFontFromDocument(
	fontItem: CustomFontItem,
	targetDoc?: Document,
	app?: App,
): void {
	const docs = targetDoc ? [targetDoc] : getAllObsidianDocuments(app);
	for (const doc of docs) {
		if (!doc || !doc.fonts) continue;
		try {
			const fontSet = doc.fonts as unknown as Set<FontFace>;
			const toRemove: FontFace[] = [];
			fontSet.forEach((ff) => {
				if (ff.family === fontItem.familyName) {
					toRemove.push(ff);
				}
			});
			toRemove.forEach((ff) => fontSet.delete(ff));
		} catch {
			// Ignore cleanup errors
		}
	}
}

/**
 * Loads all configured custom fonts into documents.
 */
export async function loadAllCustomFonts(
	vault: Vault,
	fonts: CustomFontItem[],
	targetDoc?: Document,
	app?: App,
): Promise<number> {
	let loadedCount = 0;
	for (const font of fonts) {
		const ok = await loadFontItemIntoDocument(vault, font, targetDoc, app);
		if (ok) loadedCount++;
	}
	return loadedCount;
}
