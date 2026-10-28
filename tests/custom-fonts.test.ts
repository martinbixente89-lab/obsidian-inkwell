import test from 'node:test';
import assert from 'node:assert/strict';
import {
	getFontExtension,
	isSupportedFontExtension,
	getFontFormatFromExtension,
	inferFontAttributes,
	generateUniqueFamilyName,
	resolveUniqueDisplayName,
	resolveUniqueFileName,
} from '../src/fonts/font-manager';
import { CustomFontItem } from '../src/fonts/types';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/settings/types';
import { transformLine } from '../src/format/color-spans';

test('custom-fonts: getFontExtension and isSupportedFontExtension identify valid font formats', () => {
	assert.equal(getFontExtension('Caveat.ttf'), 'ttf');
	assert.equal(getFontExtension('Roboto-Bold.OTF'), 'otf');
	assert.equal(getFontExtension('Inter-Variable.woff2'), 'woff2');
	assert.equal(getFontExtension('Merriweather.woff'), 'woff');
	assert.equal(getFontExtension('no-extension'), '');

	assert.equal(isSupportedFontExtension('ttf'), true);
	assert.equal(isSupportedFontExtension('OTF'), true);
	assert.equal(isSupportedFontExtension('woff'), true);
	assert.equal(isSupportedFontExtension('WOFF2'), true);

	assert.equal(isSupportedFontExtension('eot'), false);
	assert.equal(isSupportedFontExtension('svg'), false);
	assert.equal(isSupportedFontExtension('txt'), false);
	assert.equal(isSupportedFontExtension('png'), false);
});

test('custom-fonts: getFontFormatFromExtension maps to CSS format descriptors', () => {
	assert.equal(getFontFormatFromExtension('ttf'), 'truetype');
	assert.equal(getFontFormatFromExtension('otf'), 'opentype');
	assert.equal(getFontFormatFromExtension('woff'), 'woff');
	assert.equal(getFontFormatFromExtension('woff2'), 'woff2');
	assert.equal(getFontFormatFromExtension('invalid'), null);
});

test('custom-fonts: inferFontAttributes correctly detects variants (weight, style, name)', () => {
	const regular = inferFontAttributes('Caveat-Regular.ttf');
	assert.equal(regular.style, 'normal');
	assert.equal(regular.weight, 'normal');
	assert.equal(regular.format, 'truetype');
	assert.equal(regular.displayName, 'Caveat Regular');

	const bold = inferFontAttributes('Roboto-Bold.otf');
	assert.equal(bold.style, 'normal');
	assert.equal(bold.weight, 'bold');
	assert.equal(bold.format, 'opentype');
	assert.equal(bold.displayName, 'Roboto Bold');

	const italic = inferFontAttributes('Merriweather-Italic.woff2');
	assert.equal(italic.style, 'italic');
	assert.equal(italic.weight, 'normal');
	assert.equal(italic.format, 'woff2');
	assert.equal(italic.displayName, 'Merriweather Italic');

	const boldItalic = inferFontAttributes('Inter-BoldItalic.woff');
	assert.equal(boldItalic.style, 'italic');
	assert.equal(boldItalic.weight, 'bold');
	assert.equal(boldItalic.displayName, 'Inter Bold Italic');

	const semiBold = inferFontAttributes('FiraCode-SemiBold.ttf');
	assert.equal(semiBold.weight, '600');

	const light = inferFontAttributes('Ubuntu-Light.ttf');
	assert.equal(light.weight, '300');
});

test('custom-fonts: generateUniqueFamilyName produces safe CSS identifiers', () => {
	const name1 = generateUniqueFamilyName('Caveat Brush', 'id123');
	assert.equal(name1, 'InkwellFont_CaveatBrush_id123');

	const name2 = generateUniqueFamilyName('Fira Code (v2)', 'abc');
	assert.equal(name2, 'InkwellFont_FiraCodev2_abc');
});

test('custom-fonts: duplicate resolution for display names avoids silent collision', () => {
	const existing: CustomFontItem[] = [
		{
			id: 'font-1',
			name: 'Caveat',
			familyName: 'InkwellFont_Caveat_1',
			fileName: 'Caveat.ttf',
			relativePath: 'vault-config/plugins/inkwell/fonts/Caveat.ttf',
			format: 'truetype',
			weight: 'normal',
			style: 'normal',
			extension: 'ttf',
			sizeBytes: 1024,
			importedAt: '2026-10-27T00:00:00Z',
		},
	];

	// Duplicate name appends index
	const uniqueName = resolveUniqueDisplayName(existing, 'Caveat');
	assert.equal(uniqueName, 'Caveat (1)');

	// Renaming self to current name keeps name
	const selfName = resolveUniqueDisplayName(existing, 'Caveat', 'font-1');
	assert.equal(selfName, 'Caveat');

	// Unrelated name stays as is
	const newName = resolveUniqueDisplayName(existing, 'Roboto');
	assert.equal(newName, 'Roboto');
});

test('custom-fonts: duplicate resolution for file names prevents file overwrite', () => {
	const existing: CustomFontItem[] = [
		{
			id: 'font-1',
			name: 'Caveat',
			familyName: 'InkwellFont_Caveat_1',
			fileName: 'Caveat.ttf',
			relativePath: 'vault-config/plugins/inkwell/fonts/Caveat.ttf',
			format: 'truetype',
			weight: 'normal',
			style: 'normal',
			extension: 'ttf',
			sizeBytes: 1024,
			importedAt: '2026-10-27T00:00:00Z',
		},
	];

	const fileCandidate = resolveUniqueFileName(existing, 'Caveat.ttf');
	assert.equal(fileCandidate, 'Caveat-1.ttf');

	const otherFile = resolveUniqueFileName(existing, 'Roboto.otf');
	assert.equal(otherFile, 'Roboto.otf');
});

test('custom-fonts: settings sanitization preserves customFonts and cleans invalid records', () => {
	const validFont: CustomFontItem = {
		id: 'font-test',
		name: 'Ma Police',
		familyName: 'InkwellFont_MaPolice_123',
		fileName: 'MaPolice.woff2',
		relativePath: 'vault-config/plugins/inkwell/fonts/MaPolice.woff2',
		format: 'woff2',
		weight: 'normal',
		style: 'normal',
		extension: 'woff2',
		sizeBytes: 45000,
		importedAt: '2026-10-27T12:00:00Z',
	};

	const sanitized = sanitizeSettings({
		...DEFAULT_SETTINGS,
		customFonts: [validFont, null, { id: 'broken' }, 'not-an-object'],
	});

	assert.equal(sanitized.customFonts.length, 1);
	assert.equal(sanitized.customFonts[0]?.name, 'Ma Police');
	assert.equal(sanitized.customFonts[0]?.familyName, 'InkwellFont_MaPolice_123');
});

test('custom-fonts: formatting operations set, preserve, and remove font-family cleanly', () => {
	const line = 'Texte avec un mot spécial au milieu.';
	// Select "spécial" (ch 14 to 21)
	const from = line.indexOf('spécial');
	const to = from + 'spécial'.length;

	// 1. Apply font family
	const setRes = transformLine(line, from, to, {
		type: 'set-font-family',
		fontFamily: "'InkwellFont_Caveat_1', sans-serif",
	});
	assert.equal(setRes.success, true);
	assert.ok(setRes.result?.text.includes('data-inkwell="1"'));
	assert.ok(
		setRes.result?.text.includes("style=\"font-family: 'InkwellFont_Caveat_1', sans-serif;\""),
	);
	assert.ok(setRes.result?.text.includes('>spécial</span>'));

	const formattedLine = setRes.result!.text;

	// 2. Add color to same word without losing font family
	const from2 = formattedLine.indexOf('spécial');
	const to2 = from2 + 'spécial'.length;
	const colorRes = transformLine(formattedLine, from2, to2, {
		type: 'set-color',
		color: '#1971c2',
	});
	assert.equal(colorRes.success, true);
	assert.ok(colorRes.result?.text.includes('color: #1971c2'));
	assert.ok(
		colorRes.result?.text.includes("font-family: 'InkwellFont_Caveat_1', sans-serif"),
	);

	const coloredAndFontLine = colorRes.result!.text;

	// 3. Remove font family only: color is preserved!
	const from3 = coloredAndFontLine.indexOf('spécial');
	const to3 = from3 + 'spécial'.length;
	const removeFontRes = transformLine(coloredAndFontLine, from3, to3, {
		type: 'remove-font-family',
	});
	assert.equal(removeFontRes.success, true);
	assert.ok(removeFontRes.result?.text.includes('color: #1971c2'));
	assert.ok(!removeFontRes.result?.text.includes('font-family'));

	// 4. Remove font family when it was the ONLY style: unwraps span completely
	const from4 = formattedLine.indexOf('spécial');
	const to4 = from4 + 'spécial'.length;
	const removeOnlyFontRes = transformLine(formattedLine, from4, to4, {
		type: 'remove-font-family',
	});
	assert.equal(removeOnlyFontRes.success, true);
	assert.equal(removeOnlyFontRes.result?.text, line);
});
