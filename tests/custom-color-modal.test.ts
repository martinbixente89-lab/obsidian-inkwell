import test from 'node:test';
import assert from 'node:assert/strict';
import {
	hsvToRgb,
	rgbToHsv,
	rgbToHex,
	rgbToRgba,
} from '../src/palette/contrast';
import { addRecentColor } from '../src/palette/palette-manager';

test('custom color conversions: hsvToRgb and rgbToHex', () => {
	// Pure Red
	const redRgb = hsvToRgb(0, 1, 1);
	assert.deepEqual(redRgb, { r: 255, g: 0, b: 0 });
	assert.equal(rgbToHex(redRgb.r, redRgb.g, redRgb.b), '#ff0000');

	// Pure Green
	const greenRgb = hsvToRgb(120, 1, 1);
	assert.deepEqual(greenRgb, { r: 0, g: 255, b: 0 });
	assert.equal(rgbToHex(greenRgb.r, greenRgb.g, greenRgb.b), '#00ff00');

	// Pure Blue
	const blueRgb = hsvToRgb(240, 1, 1);
	assert.deepEqual(blueRgb, { r: 0, g: 0, b: 255 });
	assert.equal(rgbToHex(blueRgb.r, blueRgb.g, blueRgb.b), '#0000ff');

	// Pure Yellow
	const yellowRgb = hsvToRgb(60, 1, 1);
	assert.deepEqual(yellowRgb, { r: 255, g: 255, b: 0 });
	assert.equal(rgbToHex(yellowRgb.r, yellowRgb.g, yellowRgb.b), '#ffff00');

	// White
	const whiteRgb = hsvToRgb(0, 0, 1);
	assert.deepEqual(whiteRgb, { r: 255, g: 255, b: 255 });
	assert.equal(rgbToHex(whiteRgb.r, whiteRgb.g, whiteRgb.b), '#ffffff');

	// Black
	const blackRgb = hsvToRgb(0, 0, 0);
	assert.deepEqual(blackRgb, { r: 0, g: 0, b: 0 });
	assert.equal(rgbToHex(blackRgb.r, blackRgb.g, blackRgb.b), '#000000');
});

test('custom color conversions: rgbToHsv roundtrip', () => {
	const testColors = [
		{ r: 255, g: 0, b: 0 },
		{ r: 0, g: 255, b: 0 },
		{ r: 0, g: 0, b: 255 },
		{ r: 25, g: 113, b: 194 },
		{ r: 255, g: 212, b: 59 },
	];

	for (const rgb of testColors) {
		const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
		const roundtrip = hsvToRgb(hsv.h, hsv.s, hsv.v);
		// Allow small rounding tolerance of 1 unit
		assert.ok(Math.abs(roundtrip.r - rgb.r) <= 1, `r failed for ${JSON.stringify(rgb)}: got ${roundtrip.r}`);
		assert.ok(Math.abs(roundtrip.g - rgb.g) <= 1, `g failed for ${JSON.stringify(rgb)}: got ${roundtrip.g}`);
		assert.ok(Math.abs(roundtrip.b - rgb.b) <= 1, `b failed for ${JSON.stringify(rgb)}: got ${roundtrip.b}`);
	}
});

test('custom color conversions: rgbToRgba', () => {
	assert.equal(rgbToRgba(255, 212, 59, 0.35), 'rgba(255, 212, 59, 0.35)');
	assert.equal(rgbToRgba(10, 20, 30, 0.8), 'rgba(10, 20, 30, 0.8)');
	assert.equal(rgbToRgba(0, 0, 0, 1), 'rgba(0, 0, 0, 1)');
});

test('custom color workflow: adds to recent colors without duplicates and respects MRU order', () => {
	let recents: string[] = ['#1971c2', '#2f9e44'];
	recents = addRecentColor(recents, '#e03131');
	assert.deepEqual(recents, ['#e03131', '#1971c2', '#2f9e44']);

	// Applying the same custom color moves it to front without duplicating
	recents = addRecentColor(recents, '#1971c2');
	assert.deepEqual(recents, ['#1971c2', '#e03131', '#2f9e44']);

	// Applying a new highlight rgba adds to front
	recents = addRecentColor(recents, 'rgba(255, 212, 59, 0.35)');
	assert.equal(recents[0], 'rgba(255, 212, 59, 0.35)');
	assert.equal(recents.length, 4);
});
