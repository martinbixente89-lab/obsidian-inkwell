import test from 'node:test';
import assert from 'node:assert/strict';
import {
	addRecentColor,
	createDefaultPalettes,
	exportPalettesToJson,
	isColorFavorite,
	reorderPaletteColors,
	resolvePalettesImport,
	toggleFavoriteColor,
	validateImportedPalettesJson,
} from '../src/palette/palette-manager';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/settings/types';
import { CustomPalette } from '../src/palette/types';

test('palette-manager: creates default built-in text and highlight palettes', () => {
	const defaults = createDefaultPalettes();
	assert.equal(defaults.length, 2);

	const textP = defaults.find((p) => p.type === 'text');
	assert.ok(textP !== null);
	assert.equal(textP?.colors.length, 8);
	assert.equal(textP?.isBuiltIn, true);

	const hlP = defaults.find((p) => p.type === 'highlight');
	assert.ok(hlP !== null);
	assert.equal(hlP?.colors.length, 5);
	assert.equal(hlP?.isBuiltIn, true);
});

test('palette-manager: recents list maintains MRU order, deduplication and max items', () => {
	let list: string[] = [];
	list = addRecentColor(list, '#e03131', 3);
	list = addRecentColor(list, '#1971c2', 3);
	list = addRecentColor(list, '#0ca678', 3);
	assert.deepEqual(list, ['#0ca678', '#1971c2', '#e03131']);

	// Adding duplicate moves it to front without duplicating
	list = addRecentColor(list, '#1971c2', 3);
	assert.deepEqual(list, ['#1971c2', '#0ca678', '#e03131']);

	// Adding a 4th drops oldest when maxItems is 3
	list = addRecentColor(list, '#fab005', 3);
	assert.deepEqual(list, ['#fab005', '#1971c2', '#0ca678']);
});

test('palette-manager: favorites toggle and membership test', () => {
	let favs: string[] = [];
	const r1 = toggleFavoriteColor(favs, '#e03131');
	favs = r1.list;
	assert.equal(r1.isFavorite, true);
	assert.equal(isColorFavorite(favs, '#e03131'), true);

	// Toggling again removes it
	const r2 = toggleFavoriteColor(favs, '#e03131');
	favs = r2.list;
	assert.equal(r2.isFavorite, false);
	assert.equal(isColorFavorite(favs, '#e03131'), false);
});

test('palette-manager: export and validate imported JSON', () => {
	const palettes = createDefaultPalettes();
	const json = exportPalettesToJson(palettes, '1.1.0');
	assert.ok(json.includes('"schemaVersion": 1'));

	const res = validateImportedPalettesJson(json);
	assert.equal(res.valid, true);
	assert.ok(res.palettes !== undefined);
	assert.equal(res.palettes?.length, 2);

	// Invalid schemaVersion rejection
	const badJson = JSON.stringify({ schemaVersion: 99, palettes: [] });
	const badRes = validateImportedPalettesJson(badJson);
	assert.equal(badRes.valid, false);
	assert.ok(badRes.error?.includes('schemaVersion'));

	// Corrupt string rejection
	const corruptRes = validateImportedPalettesJson('{ corrupt json ...');
	assert.equal(corruptRes.valid, false);
});

test('palette-manager: resolve import conflicts with merge vs replace', () => {
	const existing = createDefaultPalettes();
	const newPalette: CustomPalette = {
		id: 'built-in-text', // duplicate id
		name: 'Mes favoris',
		type: 'text',
		colors: [{ id: 'c1', name: 'Mon violet', value: '#ae3ec9' }],
	};

	// Merge mode: renames conflicting id with -copy
	const merged = resolvePalettesImport(existing, [newPalette], 'merge');
	assert.equal(merged.length, 3);
	const copied = merged.find((p) => p.name.includes('(copie)'));
	assert.ok(copied !== undefined);
	assert.ok(copied?.id.startsWith('built-in-text-copy'));

	// Replace mode: preserves essential built-in palettes
	const replaced = resolvePalettesImport(existing, [newPalette], 'replace');
	assert.ok(replaced.some((p) => p.id === 'built-in-highlight'));
});

test('palette-manager: reorderPaletteColors moves item correctly', () => {
	const pal: CustomPalette = {
		id: 'p1',
		name: 'P1',
		type: 'text',
		colors: [
			{ id: '1', name: 'A', value: '#111' },
			{ id: '2', name: 'B', value: '#222' },
			{ id: '3', name: 'C', value: '#333' },
		],
	};

	// Move index 0 to index 2
	const reordered = reorderPaletteColors(pal, 0, 2);
	assert.deepEqual(
		reordered.colors.map((c) => c.name),
		['B', 'C', 'A'],
	);
});

test('settings: sanitizeSettings validates custom palettes and safe fallbacks', () => {
	const custom: CustomPalette = {
		id: 'custom-p1',
		name: 'Custom',
		type: 'text',
		colors: [{ id: 'c1', name: 'Jaune vif', value: '#fab005' }],
	};

	const s = sanitizeSettings({
		defaultColor: '#fab005', // custom color
		defaultHighlightColor: 'invalid-hl', // should fallback
		palettes: [custom],
		recentColors: ['#fab005', 'invalid-color'],
	});

	assert.equal(s.defaultColor, '#fab005');
	assert.equal(s.defaultHighlightColor, DEFAULT_SETTINGS.defaultHighlightColor);
	assert.equal(s.palettes.length, 1);
	assert.equal(s.palettes[0]?.name, 'Custom');
	assert.deepEqual(s.recentColors, ['#fab005']);
});

test('palette lifecycle: deleting a palette provides safe fallback for defaultColor', () => {
	const custom: CustomPalette = {
		id: 'custom-p1',
		name: 'Custom',
		type: 'text',
		colors: [{ id: 'c1', name: 'Jaune vif', value: '#fab005' }],
	};
	const builtIns = createDefaultPalettes();
	let palettes = [...builtIns, custom];
	let defaultColor = '#fab005';

	// Delete custom palette
	palettes = palettes.filter((p) => p.id !== 'custom-p1');

	// Verify if defaultColor still exists
	const exists = palettes.some((p) => p.colors.some((c) => c.value === defaultColor));
	if (!exists) {
		const textPalettes = palettes.filter((p) => p.type === 'text');
		defaultColor = textPalettes[0]?.colors[0]?.value ?? '#e03131';
	}

	assert.equal(palettes.length, 2);
	assert.notEqual(defaultColor, '#fab005');
	assert.ok(defaultColor.startsWith('#'));
});

test('palette lifecycle: resetting palettes preserves built-in palettes and restores defaults', () => {
	const custom: CustomPalette = {
		id: 'custom-p1',
		name: 'Custom',
		type: 'text',
		colors: [{ id: 'c1', name: 'Jaune vif', value: '#fab005' }],
	};
	let palettes = [custom];
	assert.equal(palettes.length, 1);

	// Reset
	palettes = createDefaultPalettes();
	assert.equal(palettes.length, 2);
	assert.equal(palettes[0]?.id, 'built-in-text');
	assert.equal(palettes[1]?.id, 'built-in-highlight');
});

