/**
 * Toolbar appearance shared by the real floating toolbar and its settings preview,
 * so both always render from the same rules.
 */

export type ToolbarStyle = 'classic' | 'liquid-glass' | 'glass-figma';

export interface ToolbarAppearanceSettings {
	toolbarStyle: ToolbarStyle;
	toolbarReduceTransparency: boolean;
	/** Custom corner radius in px (0–23), or null to keep the style's own radius. */
	toolbarCornerRadius: number | null;
}

export const TOOLBAR_RADIUS_MIN = 0;
export const TOOLBAR_RADIUS_MAX = 23;

/** Stored values are kept as-is; labels only ("Normal" is the stored `classic`). */
export const TOOLBAR_STYLE_OPTIONS: ReadonlyArray<{ value: ToolbarStyle; label: string }> = [
	{ value: 'classic', label: 'Normal' },
	{ value: 'liquid-glass', label: 'Liquid Glass' },
	{ value: 'glass-figma', label: 'Verre Figma' },
];

/** Reduced transparency only changes the translucent styles. */
export function styleSupportsReduceTransparency(style: ToolbarStyle): boolean {
	return style === 'liquid-glass' || style === 'glass-figma';
}

/**
 * Slider position shown while no custom radius is set (display only, never stored):
 * Normal uses the theme radius (8 px by default), the glass styles are capsules.
 */
export function styleRadiusHint(style: ToolbarStyle): number {
	return style === 'classic' ? 8 : TOOLBAR_RADIUS_MAX;
}

/** Validates a stored radius without converting it: anything invalid means "style radius". */
export function sanitizeToolbarCornerRadius(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value)) return null;
	if (value < TOOLBAR_RADIUS_MIN || value > TOOLBAR_RADIUS_MAX) return null;
	return value;
}

export interface ToolbarAppearance {
	liquidGlass: boolean;
	glassFigma: boolean;
	reduceTransparency: boolean;
	/** CSS value for `--inkwell-toolbar-radius`, or null to let the style's CSS apply. */
	radiusCss: string | null;
}

export function getToolbarAppearance(settings: ToolbarAppearanceSettings): ToolbarAppearance {
	const radius = sanitizeToolbarCornerRadius(settings.toolbarCornerRadius);
	return {
		liquidGlass: settings.toolbarStyle === 'liquid-glass',
		glassFigma: settings.toolbarStyle === 'glass-figma',
		reduceTransparency: settings.toolbarReduceTransparency,
		radiusCss: radius === null ? null : `${radius}px`,
	};
}

/** Applies the appearance to a toolbar container (real toolbar or preview). */
export function applyToolbarAppearance(el: HTMLElement, settings: ToolbarAppearanceSettings): void {
	const a = getToolbarAppearance(settings);
	el.classList.toggle('inkwell-theme-liquid-glass', a.liquidGlass);
	el.classList.toggle('inkwell-theme-glass-figma', a.glassFigma);
	el.classList.toggle('inkwell-reduce-transparency', a.reduceTransparency);
	if (a.radiusCss === null) {
		el.style.removeProperty('--inkwell-toolbar-radius');
	} else {
		el.setCssProps({ '--inkwell-toolbar-radius': a.radiusCss });
	}
}
