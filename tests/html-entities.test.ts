import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlEntities, encodeHtmlEntities } from '../src/utils/html-entities';

test('html entities: encoding and decoding for styled text editing', async (t) => {
	await t.test('decodes standard named entities', () => {
		const res = decodeHtmlEntities('&lt;b&gt; &amp; &quot;test&quot; &apos;ok&apos;');
		assert.equal(res.success, true);
		assert.equal(res.text, '<b> & "test" \'ok\'');
	});

	await t.test('decodes numeric decimal entities', () => {
		const res = decodeHtmlEntities('Lettre &#65; et emoji &#127912;');
		assert.equal(res.success, true);
		assert.equal(res.text, 'Lettre A et emoji 🎨');
	});

	await t.test('decodes numeric hexadecimal entities', () => {
		const res = decodeHtmlEntities('Lettre &#x41; et emoji &#x1F3A8;');
		assert.equal(res.success, true);
		assert.equal(res.text, 'Lettre A et emoji 🎨');
	});

	await t.test('refuses unhandled named entities cleanly without silent modification', () => {
		const res = decodeHtmlEntities('Copyright &copy; 2026');
		assert.equal(res.success, false);
		assert.ok(res.error?.includes('&copy;'));
		assert.equal(res.text, 'Copyright &copy; 2026');
	});

	await t.test('refuses malformed or unclosed entities cleanly', () => {
		const res = decodeHtmlEntities('Texte avec &amp sans point virgule');
		assert.equal(res.success, false);
		assert.ok(res.error?.includes('non fermée'));
	});

	await t.test('encodes only &, <, > without touching accents, emoji, or Japanese', () => {
		const input = 'Formule : 5 < 10 & 20 > 15 avec é, 日本語 et 🎨';
		const encoded = encodeHtmlEntities(input);
		assert.equal(encoded, 'Formule : 5 &lt; 10 &amp; 20 &gt; 15 avec é, 日本語 et 🎨');
	});

	await t.test('preserves literal asterisks and tildes without encoding', () => {
		const input = '*texte* **gras** ~~barre~~';
		const encoded = encodeHtmlEntities(input);
		assert.equal(encoded, input);
		const decoded = decodeHtmlEntities(encoded);
		assert.equal(decoded.success, true);
		assert.equal(decoded.text, input);
	});

	await t.test('prevents double encoding across multiple successive encode/decode cycles', () => {
		const originalVisible = 'A & B < C > D';
		let currentSource = encodeHtmlEntities(originalVisible);
		assert.equal(currentSource, 'A &amp; B &lt; C &gt; D');

		// Cycle 1 : Ouvrir (décoder), ré-enregistrer sans modification (encoder)
		let decoded = decodeHtmlEntities(currentSource);
		assert.equal(decoded.success, true);
		assert.equal(decoded.text, originalVisible);
		currentSource = encodeHtmlEntities(decoded.text);
		assert.equal(currentSource, 'A &amp; B &lt; C &gt; D');

		// Cycle 2 : Répéter
		decoded = decodeHtmlEntities(currentSource);
		assert.equal(decoded.success, true);
		assert.equal(decoded.text, originalVisible);
		currentSource = encodeHtmlEntities(decoded.text);
		assert.equal(currentSource, 'A &amp; B &lt; C &gt; D');
	});
});
