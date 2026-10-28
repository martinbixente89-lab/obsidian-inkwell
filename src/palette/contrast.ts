import { ContrastEvaluation } from './types';

export interface RgbColor {
	r: number; // 0..255
	g: number; // 0..255
	b: number; // 0..255
	a: number; // 0..1
}

/**
 * Parses any valid CSS color string (hex #rgb/#rrggbb/#rrggbbaa, rgb(), rgba()) into RGBA.
 */
export function parseCssColor(colorStr: string): RgbColor | null {
	if (!colorStr) return null;
	const s = colorStr.trim().toLowerCase();

	// Hex #rgb, #rgba, #rrggbb, #rrggbbaa
	if (s.startsWith('#')) {
		let hex = s.slice(1);
		if (hex.length === 3) {
			hex = hex.split('').map((c) => c + c).join('') + 'ff';
		} else if (hex.length === 4) {
			hex = hex.split('').map((c) => c + c).join('');
		} else if (hex.length === 6) {
			hex += 'ff';
		}
		if (hex.length === 8) {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			const a = parseInt(hex.slice(6, 8), 16) / 255;
			if (!isNaN(r) && !isNaN(g) && !isNaN(b) && !isNaN(a)) {
				return { r, g, b, a };
			}
		}
		return null;
	}

	// rgba(r, g, b, a) or rgb(r, g, b)
	const rgbMatch = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
	if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
		const r = Math.max(0, Math.min(255, parseFloat(rgbMatch[1])));
		const g = Math.max(0, Math.min(255, parseFloat(rgbMatch[2])));
		const b = Math.max(0, Math.min(255, parseFloat(rgbMatch[3])));
		const a = rgbMatch[4] !== undefined ? Math.max(0, Math.min(1, parseFloat(rgbMatch[4]))) : 1;
		return { r, g, b, a };
	}

	return null;
}

/**
 * Calculates WCAG 2.1 relative luminance for an opaque RGB color (0..1).
 */
export function getRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
	const linearize = (val: number) => {
		const s = val / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const r = linearize(rgb.r);
	const g = linearize(rgb.g);
	const b = linearize(rgb.b);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Blends a foreground color (with alpha) over an opaque background color.
 */
export function blendAlpha(fg: RgbColor, bg: RgbColor): RgbColor {
	const a = fg.a;
	const r = Math.round(fg.r * a + bg.r * (1 - a));
	const g = Math.round(fg.g * a + bg.g * (1 - a));
	const b = Math.round(fg.b * a + bg.b * (1 - a));
	return { r, g, b, a: 1 };
}

/**
 * Computes contrast ratio between two relative luminances according to WCAG 2.1 formula.
 * Result is in range 1.0 to 21.0.
 */
export function calculateContrastRatio(lum1: number, lum2: number): number {
	const l1 = Math.max(lum1, lum2);
	const l2 = Math.min(lum1, lum2);
	return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Resolves the real background color actively displayed in the Obsidian window.
 * Reads --background-primary from activeWindow. If not found or transparent, falls back to a reference background.
 */
export function resolveEffectiveThemeBackground(doc?: Document): {
	background: string;
	isRealMeasured: boolean;
	isDark: boolean;
} {
	const documentRef = doc ?? (typeof activeWindow !== 'undefined' ? activeWindow.document : undefined);
	if (!documentRef) {
		return { background: '#1e1e1e', isRealMeasured: false, isDark: true };
	}
	const isDark = documentRef.body.classList.contains('theme-dark');
	const referenceFallback = isDark ? '#1e1e1e' : '#ffffff';

	try {
		const computed = activeWindow.getComputedStyle(documentRef.body).getPropertyValue('--background-primary').trim();
		if (computed && parseCssColor(computed)) {
			return { background: computed, isRealMeasured: true, isDark };
		}
	} catch {
		// Environment without getComputedStyle (e.g. unit tests)
	}

	return { background: referenceFallback, isRealMeasured: false, isDark };
}

/**
 * Evaluates contrast for a specific text color on a background (with optional highlight).
 */
export function evaluateColorContrast(params: {
	textColor: string;
	highlightColor?: string | null;
	themeBackground?: string; // e.g. '#1c1c1c' (real) or '#1e1e1e' (ref)
	isRealMeasured?: boolean;
	isDarkTheme?: boolean;
	isLargeOrBoldText?: boolean;
}): ContrastEvaluation {
	const isDark = params.isDarkTheme ?? true;
	const isReal = params.isRealMeasured ?? false;
	const baseBgStr = params.themeBackground || (isDark ? '#1e1e1e' : '#ffffff');
	const baseBgRgb = parseCssColor(baseBgStr) || { r: 30, g: 30, b: 30, a: 1 };

	let effectiveBgRgb: RgbColor = { r: baseBgRgb.r, g: baseBgRgb.g, b: baseBgRgb.b, a: 1 };
	let backgroundUsedDesc = isReal
		? `Fond affiché (${baseBgStr})`
		: `Fond de référence (${baseBgStr})`;

	if (params.highlightColor) {
		const hlRgb = parseCssColor(params.highlightColor);
		if (hlRgb) {
			effectiveBgRgb = blendAlpha(hlRgb, baseBgRgb);
			backgroundUsedDesc = `Surlignage (${params.highlightColor}) sur ${isReal ? 'fond affiché' : 'fond de référence'} (${baseBgStr})`;
		}
	}

	const textRgb = parseCssColor(params.textColor);
	if (!textRgb) {
		return {
			ratio: 1,
			ratioFormatted: '1.0:1',
			backgroundUsed: backgroundUsedDesc,
			isRealMeasuredBackground: isReal,
			passesNormal: false,
			passesLarge: false,
			isMixed: false,
		};
	}

	const opaqueTextRgb = textRgb.a < 1 ? blendAlpha(textRgb, effectiveBgRgb) : textRgb;
	const lumText = getRelativeLuminance(opaqueTextRgb);
	const lumBg = getRelativeLuminance(effectiveBgRgb);
	const ratio = calculateContrastRatio(lumText, lumBg);
	const ratioRounded = Math.round(ratio * 100) / 100;
	const ratioFormatted = `${ratioRounded.toFixed(1)}:1`;

	const passesNormal = ratioRounded >= 4.5;
	const passesLarge = ratioRounded >= 3.0;

	// Suggest a more readable alternative if contrast is poor (< 4.5)
	let suggestedColor: string | undefined;
	if (!passesNormal) {
		suggestedColor = lumBg > 0.45 ? '#1a1a1a' : '#f8f9fa';
	}

	return {
		ratio: ratioRounded,
		ratioFormatted,
		backgroundUsed: backgroundUsedDesc,
		isRealMeasuredBackground: isReal,
		passesNormal,
		passesLarge,
		isMixed: false,
		suggestedColor,
	};
}

/**
 * Creates an evaluation representation for a selection with mixed colors or backgrounds.
 */
export function createMixedContrastEvaluation(reason: string): ContrastEvaluation {
	return {
		ratio: 0,
		ratioFormatted: 'Mixte',
		backgroundUsed: 'Sélection multiple',
		passesNormal: false,
		passesLarge: false,
		isMixed: true,
		mixedDescription: reason,
	};
}

/**
 * Converts HSV to RGB.
 * h: 0..360, s: 0..1, v: 0..1 -> r, g, b: 0..255
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
	h = ((h % 360) + 360) % 360;
	s = Math.max(0, Math.min(1, s));
	v = Math.max(0, Math.min(1, v));
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r1 = 0;
	let g1 = 0;
	let b1 = 0;
	if (h < 60) {
		r1 = c;
		g1 = x;
		b1 = 0;
	} else if (h < 120) {
		r1 = x;
		g1 = c;
		b1 = 0;
	} else if (h < 180) {
		r1 = 0;
		g1 = c;
		b1 = x;
	} else if (h < 240) {
		r1 = 0;
		g1 = x;
		b1 = c;
	} else if (h < 300) {
		r1 = x;
		g1 = 0;
		b1 = c;
	} else {
		r1 = c;
		g1 = 0;
		b1 = x;
	}
	return {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255),
	};
}

/**
 * Converts RGB to HSV.
 * r, g, b: 0..255 -> h: 0..360, s: 0..1, v: 0..1
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	const s = max === 0 ? 0 : d / max;
	const v = max;
	if (max !== min) {
		switch (max) {
			case r:
				h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
				break;
			case g:
				h = ((b - r) / d + 2) * 60;
				break;
			case b:
				h = ((r - g) / d + 4) * 60;
				break;
		}
	}
	return { h: Math.round(h), s, v };
}

/**
 * Converts RGB to hex string (#rrggbb).
 */
export function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n)))
			.toString(16)
			.padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Converts RGB and Alpha to rgba(...) string.
 */
export function rgbToRgba(r: number, g: number, b: number, a: number): string {
	const aClean = Math.round(a * 100) / 100;
	return `rgba(${r}, ${g}, ${b}, ${aClean})`;
}

