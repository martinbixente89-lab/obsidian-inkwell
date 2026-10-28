import test from 'node:test';
import assert from 'node:assert/strict';
import { findInnerEmphasisSpans } from '../src/editor/tag-navigation/inner-markdown';
import { toggleFormat } from '../src/format/markdown-formats';

test('inner-markdown: detects bold, italic, and bold-italic within inner span content', async (t) => {
	await t.test('detects ***premier*** span rouge as bold-italic', () => {
		const text = '***premier*** span rouge';
		const res = findInnerEmphasisSpans(text, 100);
		assert.equal(res.length, 1);
		const e = res[0]!;
		assert.equal(e.kind, 'bold-italic');
		assert.equal(e.openStart, 100);
		assert.equal(e.openEnd, 103);
		assert.equal(e.contentStart, 103);
		assert.equal(e.contentEnd, 110); // "premier" is length 7
		assert.equal(e.closeStart, 110);
		assert.equal(e.closeEnd, 113);
	});

	await t.test('detects **mot gras** et *mot italique* as distinct segments', () => {
		const text = '**mot gras** et *mot italique*';
		const res = findInnerEmphasisSpans(text, 0);
		assert.equal(res.length, 2);

		assert.equal(res[0]!.kind, 'bold');
		assert.equal(res[0]!.openStart, 0);
		assert.equal(res[0]!.openEnd, 2);
		assert.equal(res[0]!.contentStart, 2);
		assert.equal(res[0]!.contentEnd, 10);
		assert.equal(res[0]!.closeStart, 10);
		assert.equal(res[0]!.closeEnd, 12);

		assert.equal(res[1]!.kind, 'italic');
		assert.equal(res[1]!.openStart, 16);
		assert.equal(res[1]!.openEnd, 17);
		assert.equal(res[1]!.contentStart, 17);
		assert.equal(res[1]!.contentEnd, 29);
		assert.equal(res[1]!.closeStart, 29);
		assert.equal(res[1]!.closeEnd, 30);
	});

	await t.test('ignores escaped asterisks and literal arithmetic expressions', () => {
		const text = 'a * b = c et 2 ** 3 = 8 et \\*pas de gras\\*';
		const res = findInnerEmphasisSpans(text, 0);
		assert.equal(res.length, 0);
	});

	await t.test('ignores inline code inside the span', () => {
		const text = 'voici `***code***` et **gras**';
		const res = findInnerEmphasisSpans(text, 0);
		assert.equal(res.length, 1);
		assert.equal(res[0]!.kind, 'bold');
		assert.equal(res[0]!.contentStart, text.indexOf('gras'));
	});

	await t.test('detects ~~texte barré~~ et texte normal correctly', () => {
		const text = '~~texte barré~~ et texte normal';
		const res = findInnerEmphasisSpans(text, 50);
		assert.equal(res.length, 1);
		const e = res[0]!;
		assert.equal(e.kind, 'strikethrough');
		assert.equal(e.openStart, 50);
		assert.equal(e.openEnd, 52);
		assert.equal(e.contentStart, 52);
		assert.equal(e.contentEnd, 52 + 'texte barré'.length);
		assert.equal(e.closeStart, 52 + 'texte barré'.length);
		assert.equal(e.closeEnd, 52 + 'texte barré'.length + 2);
	});

	await t.test('detects combinations: ~~***gras italique barré***~~ and **~~gras barré~~**', () => {
		const text1 = '~~***gras italique barré***~~ et normal';
		const res1 = findInnerEmphasisSpans(text1, 0);
		assert.equal(res1.length, 2);
		assert.equal(res1[0]!.kind, 'strikethrough');
		assert.equal(res1[1]!.kind, 'bold-italic');
		assert.equal(text1.slice(res1[1]!.contentStart, res1[1]!.contentEnd), 'gras italique barré');

		const text2 = '**~~gras barré~~** et normal';
		const res2 = findInnerEmphasisSpans(text2, 0);
		assert.equal(res2.length, 2);
		const kinds = res2.map((r) => r.kind);
		assert.ok(kinds.includes('bold'));
		assert.ok(kinds.includes('strikethrough'));
	});

	await t.test('ignores escaped tildes, single tildes, and code spans with tildes', () => {
		const text = 'environ ~100~ et \\~~pas barré\\~~ et `~~code~~`';
		const res = findInnerEmphasisSpans(text, 0);
		assert.equal(res.length, 0);
	});

	await t.test('ignores incomplete or unmatched delimiters', () => {
		const text = 'texte **incomplet ici et *seul ici et ~~incomplet';
		const res = findInnerEmphasisSpans(text, 0);
		assert.equal(res.length, 0);
	});

	await t.test('toggleFormat applies and removes strikethrough inside spans correctly', () => {
		const line = '<span style="color: #1971c2">texte barré et texte normal</span>';
		const start = line.indexOf('texte barré');
		const end = start + 'texte barré'.length;

		// 1. Apply strikethrough to "texte barré"
		const applied = toggleFormat(line, start, end, 'strikethrough');
		assert.equal(applied.success, true);
		assert.equal(applied.line, '<span style="color: #1971c2">~~texte barré~~ et texte normal</span>');

		// 2. Remove strikethrough by toggling again on the struck text
		const innerStart = applied.line.indexOf('texte barré');
		const innerEnd = innerStart + 'texte barré'.length;
		const removed = toggleFormat(applied.line, innerStart, innerEnd, 'strikethrough');
		assert.equal(removed.success, true);
		assert.equal(removed.line, '<span style="color: #1971c2">texte barré et texte normal</span>');
	});
});
