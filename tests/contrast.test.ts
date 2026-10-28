import test from 'node:test';
import assert from 'node:assert/strict';
import {
	blendAlpha,
	calculateContrastRatio,
	evaluateColorContrast,
	createMixedContrastEvaluation,
	getRelativeLuminance,
	parseCssColor,
} from '../src/palette/contrast';

test('contrast: parseCssColor handles various formats', () => {
	const c1 = parseCssColor('#e03131');
	assert.ok(c1 !== null);
	assert.equal(c1.r, 224);
	assert.equal(c1.g, 49);
	assert.equal(c1.b, 49);
	assert.equal(c1.a, 1);

	const c2 = parseCssColor('#fff');
	assert.ok(c2 !== null);
	assert.equal(c2.r, 255);
	assert.equal(c2.g, 255);
	assert.equal(c2.b, 255);

	const c3 = parseCssColor('rgba(255, 212, 59, 0.35)');
	assert.ok(c3 !== null);
	assert.equal(c3.r, 255);
	assert.equal(c3.g, 212);
	assert.equal(c3.b, 59);
	assert.equal(c3.a, 0.35);

	const c4 = parseCssColor('invalid');
	assert.equal(c4, null);
});

test('contrast: luminance and ratio calculations match WCAG 2.1 specs', () => {
	const lumWhite = getRelativeLuminance({ r: 255, g: 255, b: 255 });
	const lumBlack = getRelativeLuminance({ r: 0, g: 0, b: 0 });
	assert.equal(lumWhite, 1);
	assert.equal(lumBlack, 0);

	const ratioMax = calculateContrastRatio(lumWhite, lumBlack);
	assert.equal(Math.round(ratioMax), 21);

	const ratioMin = calculateContrastRatio(lumWhite, lumWhite);
	assert.equal(ratioMin, 1);
});

test('contrast: alpha blending computes effective highlight background', () => {
	const fg = { r: 255, g: 212, b: 59, a: 0.35 }; // pastel yellow highlight
	const bg = { r: 255, g: 255, b: 255, a: 1 }; // white theme
	const blended = blendAlpha(fg, bg);

	// r = 255 * 0.35 + 255 * 0.65 = 255
	assert.equal(blended.r, 255);
	// g = 212 * 0.35 + 255 * 0.65 = 74.2 + 165.75 = 240
	assert.equal(blended.g, 240);
	// b = 59 * 0.35 + 255 * 0.65 = 20.65 + 165.75 = 186
	assert.equal(blended.b, 186);
});

test('contrast: evaluateColorContrast distinguishes normal vs large text & identifies background', () => {
	// Dark theme with red text
	const evalDark = evaluateColorContrast({
		textColor: '#e03131',
		isDarkTheme: true,
		themeBackground: '#1c1c1c',
	});

	assert.ok(evalDark.backgroundUsed.includes('#1c1c1c'));
	// Ratio ~3.78:1 -> passes large text (>= 3.0), fails normal text (< 4.5)
	assert.equal(evalDark.passesLarge, true);
	assert.equal(evalDark.passesNormal, false);
	assert.ok(evalDark.suggestedColor !== undefined);

	// Contrast with highlight present
	const evalWithHl = evaluateColorContrast({
		textColor: '#1971c2',
		highlightColor: 'rgba(255, 212, 59, 0.35)',
		themeBackground: '#ffffff',
	});

	assert.ok(evalWithHl.backgroundUsed.includes('Surlignage'));
	assert.equal(evalWithHl.passesLarge, true);

	// Black text over yellow highlight passes normal text (>= 4.5:1)
	const evalBlackHl = evaluateColorContrast({
		textColor: '#000000',
		highlightColor: 'rgba(255, 212, 59, 0.35)',
		themeBackground: '#ffffff',
	});
	assert.equal(evalBlackHl.passesNormal, true);
});

test('contrast: mixed selection returns isMixed without misleading ratio', () => {
	const mixed = createMixedContrastEvaluation('Plusieurs couleurs sélectionnées');
	assert.equal(mixed.isMixed, true);
	assert.equal(mixed.ratioFormatted, 'Mixte');
	assert.equal(mixed.passesNormal, false);
	assert.equal(mixed.passesLarge, false);
	assert.equal(mixed.mixedDescription, 'Plusieurs couleurs sélectionnées');
});
