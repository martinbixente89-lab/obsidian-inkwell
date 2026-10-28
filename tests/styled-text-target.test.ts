import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStyledSpanTarget } from '../src/editor/styled-text-target';

test('styled text targeting: detection, validation, and refusal guards', async (t) => {
	await t.test('detects single colored span under simple cursor', () => {
		const line = 'Un passage <span data-inkwell="1" style="color: #e03131;">texte</span> ici.';
		const cursorCh = line.indexOf('texte') + 2;
		const res = analyzeStyledSpanTarget(line, cursorCh, cursorCh);
		assert.equal(res.success, true);
		assert.equal(res.target?.visibleText, 'texte');
		assert.equal(res.target?.color, '#e03131');
	});

	await t.test('targets entire span even if selection covers only a partial word inside', () => {
		const line = 'Un passage <span data-inkwell="1" style="color: #e03131;">texte</span> ici.';
		const from = line.indexOf('texte') + 1;
		const to = from + 2; // "ex"
		const res = analyzeStyledSpanTarget(line, from, to);
		assert.equal(res.success, true);
		// Crucial requirement: returns ENTIRE span target, not just "ex"
		assert.equal(res.target?.visibleText, 'texte');
		assert.equal(res.target?.spanStart, line.indexOf('<span'));
		assert.equal(res.target?.spanEnd, line.indexOf('</span>') + 7);
	});

	await t.test('refuses selection overflowing outside the span', () => {
		const line = 'Un passage <span data-inkwell="1" style="color: #e03131;">texte</span> ici.';
		const from = line.indexOf('passage');
		const to = line.indexOf('texte') + 2;
		const res = analyzeStyledSpanTarget(line, from, to);
		assert.equal(res.success, false);
		assert.ok(res.reason?.includes('déborde'));
	});

	await t.test('refuses selection overlapping multiple spans', () => {
		const line = '<span data-inkwell="1" style="color: #e03131;">un</span> et <span data-inkwell="1" style="color: #1971c2;">deux</span>';
		const from = 5;
		const to = line.length - 5;
		const res = analyzeStyledSpanTarget(line, from, to);
		assert.equal(res.success, false);
		assert.ok(res.reason?.includes('plusieurs'));
	});

	await t.test('refuses span with third-party attributes cleanly', () => {
		const line = '<span data-inkwell="1" style="color: #e03131;" class="custom-cls">texte</span>';
		const res = analyzeStyledSpanTarget(line, 50, 52);
		assert.equal(res.success, false);
		assert.ok(res.reason?.includes('attributs tiers'));
	});

	await t.test('refuses span with multiple styles (size, highlight, font)', () => {
		const line = '<span data-inkwell="1" style="color: #e03131; font-size: 1.25em;">texte</span>';
		const res = analyzeStyledSpanTarget(line, 55, 57);
		assert.equal(res.success, false);
		assert.ok(res.reason?.includes('uniquement une couleur'));
	});

	await t.test('refuses span containing unhandled HTML entities', () => {
		const line = '<span data-inkwell="1" style="color: #e03131;">Copyright &copy; 2026</span>';
		const res = analyzeStyledSpanTarget(line, 50, 55);
		assert.equal(res.success, false);
		assert.ok(res.reason?.includes('&copy;'));
	});

	await t.test('decodes visible text with valid entities on targeted span', () => {
		const line = '<span data-inkwell="1" style="color: #e03131;">&lt;b&gt; &amp; é</span>';
		const res = analyzeStyledSpanTarget(line, 50, 52);
		assert.equal(res.success, true);
		assert.equal(res.target?.visibleText, '<b> & é');
		assert.equal(res.target?.rawInnerText, '&lt;b&gt; &amp; é');
	});
});
