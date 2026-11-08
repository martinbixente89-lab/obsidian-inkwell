import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	getVisibleSettingsTabs,
	nextTabIndex,
	resolveSettingsTab,
} from '../src/settings/settings-tabs';
import {
	getToolbarAppearance,
	sanitizeToolbarCornerRadius,
	styleRadiusHint,
	styleSupportsReduceTransparency,
	TOOLBAR_RADIUS_MAX,
	TOOLBAR_RADIUS_MIN,
	TOOLBAR_STYLE_OPTIONS,
} from '../src/ui/toolbar-appearance';
import { nextListboxIndex, palettesForSelector } from '../src/settings/palette-selector';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings/types';
import type { CustomPalette } from '../src/palette/types';

void describe('settings 2.0: tabs', () => {
	void test('Toolbar tab only while the toolbar is enabled; Menu / always available', () => {
		assert.deepEqual(getVisibleSettingsTabs({ toolbarEnabled: true }), ['general', 'toolbar', 'slash']);
		assert.deepEqual(getVisibleSettingsTabs({ toolbarEnabled: false }), ['general', 'slash']);
	});

	void test('falls back to general when the toolbar tab disappears', () => {
		assert.equal(resolveSettingsTab('toolbar', { toolbarEnabled: false }), 'general');
		assert.equal(resolveSettingsTab('toolbar', { toolbarEnabled: true }), 'toolbar');
		assert.equal(resolveSettingsTab('slash', { toolbarEnabled: false }), 'slash');
		assert.equal(resolveSettingsTab(null, { toolbarEnabled: true }), 'general');
	});

	void test('keyboard navigation wraps and supports Home/End', () => {
		assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
		assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
		assert.equal(nextTabIndex('Home', 2, 3), 0);
		assert.equal(nextTabIndex('End', 0, 3), 2);
		assert.equal(nextTabIndex('a', 0, 3), null);
	});
});

void describe('settings 2.0: toolbar styles and corner radius', () => {
	void test('style options keep the stored values; "Normal" labels the existing classic style', () => {
		assert.deepEqual(
			TOOLBAR_STYLE_OPTIONS.map((o) => [o.value, o.label]),
			[
				['classic', 'Normal'],
				['liquid-glass', 'Liquid Glass'],
				['glass-figma', 'Verre Figma'],
			],
		);
		assert.ok(!TOOLBAR_STYLE_OPTIONS.some((o) => /ring|radial|anneau/i.test(o.label)));
	});

	void test('radius: null by default, existing 1.6.x data keeps the style radius', () => {
		assert.equal(DEFAULT_SETTINGS.toolbarCornerRadius, null);
		assert.equal(sanitizeSettings({ toolbarStyle: 'liquid-glass' }).toolbarCornerRadius, null);
	});

	void test('radius: valid 0–23 integers kept as-is, anything else ignored without conversion', () => {
		for (const v of [0, 1, 12, 17, 23]) assert.equal(sanitizeToolbarCornerRadius(v), v);
		for (const v of [-1, 24, 3.5, '8', null, undefined, NaN, Infinity]) {
			assert.equal(sanitizeToolbarCornerRadius(v), null, String(v));
		}
		assert.equal(sanitizeSettings({ toolbarCornerRadius: 12 }).toolbarCornerRadius, 12);
		assert.equal(sanitizeSettings({ toolbarCornerRadius: 40 }).toolbarCornerRadius, null);
		assert.equal(TOOLBAR_RADIUS_MIN, 0);
		assert.equal(TOOLBAR_RADIUS_MAX, 23);
	});

	void test('appearance shared by toolbar and preview', () => {
		const a = getToolbarAppearance({ toolbarStyle: 'glass-figma', toolbarReduceTransparency: true, toolbarCornerRadius: 5 });
		assert.deepEqual(a, { liquidGlass: false, glassFigma: true, reduceTransparency: true, radiusCss: '5px' });
		const b = getToolbarAppearance({ toolbarStyle: 'classic', toolbarReduceTransparency: false, toolbarCornerRadius: null });
		assert.equal(b.radiusCss, null);
		assert.equal(b.liquidGlass || b.glassFigma, false);
	});

	void test('reduce transparency shown for translucent styles only; slider hint is display-only', () => {
		assert.equal(styleSupportsReduceTransparency('classic'), false);
		assert.equal(styleSupportsReduceTransparency('liquid-glass'), true);
		assert.equal(styleSupportsReduceTransparency('glass-figma'), true);
		assert.equal(styleRadiusHint('classic'), 8);
		assert.equal(styleRadiusHint('liquid-glass'), 23);
	});
});

void describe('settings 2.0: preservation', () => {
	void test('disabling then re-enabling the toolbar keeps every preference', () => {
		const stored = sanitizeSettings({
			toolbarEnabled: true,
			toolbarStyle: 'glass-figma',
			toolbarReduceTransparency: true,
			toolbarCornerRadius: 11,
			toolbarLayout: 'horizontal',
			slashMenuEnabled: true,
			inkwellSlashChosen: true,
			customFonts: [{ id: 'f1', name: 'Ma police', familyName: 'MaPolice', relativePath: 'fonts/a.otf' }],
		});
		const off = sanitizeSettings({ ...stored, toolbarEnabled: false });
		const on = sanitizeSettings({ ...off, toolbarEnabled: true });
		for (const s of [off, on]) {
			assert.equal(s.toolbarStyle, 'glass-figma');
			assert.equal(s.toolbarReduceTransparency, true);
			assert.equal(s.toolbarCornerRadius, 11);
			assert.equal(s.customFonts.length, 1);
			assert.deepEqual(s.palettes, stored.palettes);
		}
		// Menu / is independent of the toolbar
		assert.equal(off.slashMenuEnabled, true);
		assert.equal(off.inkwellSlashChosen, true);
		assert.ok(getVisibleSettingsTabs(off).includes('slash'));
	});
});

void describe('settings 2.0: palette selectors', () => {
	const pal = (id: string, type: 'text' | 'highlight', isBuiltIn: boolean): CustomPalette => ({
		id,
		name: id,
		type,
		isBuiltIn,
		colors: [{ id: 'c', name: 'c', value: '#000' }],
	});

	void test('one selector per type, built-in palettes first, no invented palette', () => {
		const palettes = [pal('perso-t', 'text', false), pal('hl', 'highlight', true), pal('builtin-t', 'text', true)];
		assert.deepEqual(palettesForSelector(palettes, 'text').map((p) => p.id), ['builtin-t', 'perso-t']);
		assert.deepEqual(palettesForSelector(palettes, 'highlight').map((p) => p.id), ['hl']);
		assert.equal(palettesForSelector(DEFAULT_SETTINGS.palettes, 'text').length, 1);
		assert.equal(palettesForSelector(DEFAULT_SETTINGS.palettes, 'highlight').length, 1);
	});

	void test('listbox keyboard navigation clamps at both ends', () => {
		assert.equal(nextListboxIndex('ArrowDown', 1, 2), 1);
		assert.equal(nextListboxIndex('ArrowUp', 0, 2), 0);
		assert.equal(nextListboxIndex('End', 0, 3), 2);
		assert.equal(nextListboxIndex('Tab', 0, 3), null);
	});
});
