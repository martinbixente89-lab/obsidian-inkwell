import test from 'node:test';
import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import { findSimpleSpans } from '../src/editor/tag-navigation/simple-spans';
import {
	convertInkwellHtmlToMarkdown,
	sanitizeSelectionClipboard,
} from '../src/editor/tag-navigation/clipboard-sanitizer';

test('clipboard sanitizer: cleanly balances partial selections across spans', () => {
	const raw = 'Un <span data-inkwell="1" style="color: #e03131;">rouge</span> et un <span data-inkwell="1" style="color: #1971c2;">bleu</span> fin';
	const doc = Text.of(raw.split('\n'));
	const spans = findSimpleSpans(doc, 1, 1, true);

	const fromA = raw.indexOf('ge'); // inside "rouge"
	const toA = raw.indexOf('bleu') + 2; // inside "bleu"

	const res = sanitizeSelectionClipboard(doc, fromA, toA, spans);
	assert.ok(res !== null);
	assert.equal(res.plainText, 'ge et un bl');
	assert.equal(
		res.htmlText,
		'<span data-inkwell="1" style="color: #e03131;">ge</span> et un <span data-inkwell="1" style="color: #1971c2;">bl</span>',
	);
});

test('clipboard sanitizer: strictly preserves literal <, >, & in user content', () => {
	const raw = 'Prefix if a < b && b > c <span data-inkwell="1" style="color: #e03131;">rouge</span> Suffix';
	const doc = Text.of([raw]);
	const spans = findSimpleSpans(doc, 1, 1, true);

	// Select from "Prefix" through "Suffix"
	const res = sanitizeSelectionClipboard(doc, 0, raw.length, spans);
	assert.ok(res !== null);
	// In plain text, literal characters must NOT be stripped or altered
	assert.equal(res.plainText, 'Prefix if a < b && b > c rouge Suffix');
	// In HTML text, user content entities must be properly escaped
	assert.ok(res.htmlText.includes('if a &lt; b &amp;&amp; b &gt; c'));
});

test('clipboard sanitizer: handles markdown bold in copied HTML payload', () => {
	const raw = '<span data-inkwell="1" style="color: #e03131;">rouge</span> et **gras fort**';
	const doc = Text.of([raw]);
	const spans = findSimpleSpans(doc, 1, 1, true);

	const res = sanitizeSelectionClipboard(doc, 0, raw.length, spans);
	assert.ok(res !== null);
	assert.equal(res.plainText, 'rouge et **gras fort**');
	assert.ok(res.htmlText.includes('<strong>gras fort</strong>'));
});

test('clipboard sanitizer: preserves multiline breaks in plainText and converts to <br> in htmlText', () => {
	const raw = 'Ligne 1 <span data-inkwell="1" style="color: #e03131;">rouge</span>\nLigne 2 suite';
	const doc = Text.of(raw.split('\n'));
	const spans = findSimpleSpans(doc, 1, 2, true);

	const res = sanitizeSelectionClipboard(doc, 0, raw.length, spans);
	assert.ok(res !== null);
	assert.equal(res.plainText, 'Ligne 1 rouge\nLigne 2 suite');
	assert.ok(res.htmlText.includes('<br>'));
});

test('clipboard sanitizer: handles canonical Cas 6 bold + color span', () => {
	const raw = 'Prefix if a < b && b > c **<span data-inkwell="1" style="color: #e03131;">rouge & gras</span>** Suffix';
	const doc = Text.of([raw]);
	const spans = findSimpleSpans(doc, 1, 1, true);

	const fromA = raw.indexOf('if a < b');
	const toA = raw.indexOf(' Suffix');

	const res = sanitizeSelectionClipboard(doc, fromA, toA, spans);
	assert.ok(res !== null);
	assert.equal(res.plainText, 'if a < b && b > c **rouge & gras**');
	assert.ok(res.htmlText.includes('&lt;'));
	assert.ok(res.htmlText.includes('&amp;&amp;'));
	// Must represent bold with <strong> in HTML, NOT with literal markdown **
	assert.ok(res.htmlText.includes('<strong><span data-inkwell="1" style="color: #e03131;">rouge &amp; gras</span></strong>'));
	assert.ok(!res.htmlText.includes('**'));

	// Test conversion upon paste back to markdown
	const converted = convertInkwellHtmlToMarkdown(res.htmlText);
	assert.equal(converted, 'if a < b && b > c **<span data-inkwell="1" style="color: #e03131;">rouge & gras</span>**');
});

test('clipboard sanitizer: copies visible < for &lt;, and literal &lt; for &amp;lt;', () => {
	const raw = 'Hors: &lt; et <span data-inkwell="1" style="color: #e03131;">x &lt; y et &amp;lt;</span> fin';
	const doc = Text.of([raw]);
	const spans = findSimpleSpans(doc, 1, 1, true);

	// 1. Copy inside span only
	const fromInside = raw.indexOf('x &lt;');
	const toInside = raw.indexOf('</span>');
	const resInside = sanitizeSelectionClipboard(doc, fromInside, toInside, spans);
	assert.ok(resInside !== null);
	// &lt; becomes <, &amp;lt; becomes &lt;
	assert.equal(resInside.plainText, 'x < y et &lt;');

	// 2. Copy entire line from "Hors: &lt;" across the span
	const resFull = sanitizeSelectionClipboard(doc, 0, raw.length, spans);
	assert.ok(resFull !== null);
	// Outside &lt; stays &lt;, inside &lt; becomes <, inside &amp;lt; becomes &lt;
	assert.equal(resFull.plainText, 'Hors: &lt; et x < y et &lt; fin');
});

test('clipboard sanitizer: partial selection inside -> outside (coloré après)', () => {
	const raw = 'Avant <span data-inkwell="1" style="color: #e03131;">texte coloré</span> après.';
	const doc = Text.of([raw]);
	const spans = findSimpleSpans(doc, 1, 1, true);

	const fromA = raw.indexOf('coloré');
	const toA = raw.indexOf('après') + 'après'.length;

	const res = sanitizeSelectionClipboard(doc, fromA, toA, spans);
	assert.ok(res !== null);
	assert.equal(res.plainText, 'coloré après');
	assert.equal(
		res.htmlText,
		'<span data-inkwell="1" style="color: #e03131;">coloré</span> après',
	);
});

test('clipboard sanitizer: partial selection outside -> inside (Avant texte)', () => {
	const raw = 'Avant <span data-inkwell="1" style="color: #e03131;">texte coloré</span> après.';
	const doc = Text.of([raw]);
	const spans = findSimpleSpans(doc, 1, 1, true);

	const fromA = raw.indexOf('Avant');
	const toA = raw.indexOf('texte') + 'texte'.length;

	const res = sanitizeSelectionClipboard(doc, fromA, toA, spans);
	assert.ok(res !== null);
	assert.equal(res.plainText, 'Avant texte');
	assert.equal(
		res.htmlText,
		'Avant <span data-inkwell="1" style="color: #e03131;">texte</span>',
	);
});


