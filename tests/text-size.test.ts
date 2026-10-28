import test from 'node:test';
import assert from 'node:assert/strict';
import {
	transformLine,
	transformLineWithDelimiters,
	getLinePrefixLength,
} from '../src/format/color-spans';
import { SMALL_TEXT_SIZE, LARGE_TEXT_SIZE, TEXT_SIZE_OPTIONS } from '../src/utils/constants';

test('text size: non-cumulative state and replacement (V0.5.0)', async (t) => {
	await t.test('applies 1.25em (Grande) to plain text with explicit data-inkwell="1"', () => {
		const line = 'Un texte avec un mot grand ici.';
		const from = line.indexOf('mot grand');
		const to = from + 'mot grand'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: LARGE_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un texte avec un <span data-inkwell="1" style="font-size: 1.25em;">mot grand</span> ici.',
		);
	});

	await t.test('applying 1.25em repeatedly retains 1.25em (non-cumulative)', () => {
		const line = 'Un texte avec un <span data-inkwell="1" style="font-size: 1.25em;">mot grand</span> ici.';
		const from = line.indexOf('mot grand');
		const to = from + 'mot grand'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: LARGE_TEXT_SIZE });
		// Applying identical size results in no_change
		assert.equal(res.success, false);
		assert.equal(res.errorReason, 'no_change');
	});

	await t.test('switching from Grande (1.25em) to Petite (0.85em) replaces value directly without nesting', () => {
		const line = 'Un texte avec un <span data-inkwell="1" style="font-size: 1.25em;">mot grand</span> ici.';
		const from = line.indexOf('mot grand');
		const to = from + 'mot grand'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: SMALL_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un texte avec un <span data-inkwell="1" style="font-size: 0.85em;">mot grand</span> ici.',
		);
	});

	await t.test('setting to Normale (remove-size) strips span completely when no other styles exist', () => {
		const line = 'Un texte avec un <span data-inkwell="1" style="font-size: 1.25em;">mot grand</span> ici.';
		const from = line.indexOf('mot grand');
		const to = from + 'mot grand'.length;

		const res = transformLine(line, from, to, { type: 'remove-size' });
		assert.equal(res.success, true);
		assert.equal(res.result?.text, 'Un texte avec un mot grand ici.');
	});
});

test('text size: combination with color and highlight (V0.5.0)', async (t) => {
	await t.test('adds size to colored text without losing color', () => {
		const line = 'Texte <span data-inkwell="1" style="color: #e03131;">rouge</span> normal.';
		const from = line.indexOf('rouge');
		const to = from + 'rouge'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: LARGE_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Texte <span data-inkwell="1" style="color: #e03131; font-size: 1.25em;">rouge</span> normal.',
		);
	});

	await t.test('adds size to highlighted text without losing highlight', () => {
		const line = 'Texte <span data-inkwell="1" style="background-color: rgba(255, 212, 59, 0.35);">jaune</span> normal.';
		const from = line.indexOf('jaune');
		const to = from + 'jaune'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: SMALL_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Texte <span data-inkwell="1" style="background-color: rgba(255, 212, 59, 0.35); font-size: 0.85em;">jaune</span> normal.',
		);
	});

	await t.test('combines all three styles: color + highlight + size in single consolidated span', () => {
		const line = 'Texte <span data-inkwell="1" style="color: #1971c2; background-color: rgba(81, 207, 102, 0.35);">bleu vert</span> normal.';
		const from = line.indexOf('bleu vert');
		const to = from + 'bleu vert'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: LARGE_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Texte <span data-inkwell="1" style="color: #1971c2; background-color: rgba(81, 207, 102, 0.35); font-size: 1.25em;">bleu vert</span> normal.',
		);
	});

	await t.test('removes size from triple combination preserving color and highlight', () => {
		const line = 'Texte <span data-inkwell="1" style="color: #1971c2; background-color: rgba(81, 207, 102, 0.35); font-size: 1.25em;">bleu vert</span> normal.';
		const from = line.indexOf('bleu vert');
		const to = from + 'bleu vert'.length;

		const res = transformLine(line, from, to, { type: 'remove-size' });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Texte <span data-inkwell="1" style="color: #1971c2; background-color: rgba(81, 207, 102, 0.35);">bleu vert</span> normal.',
		);
	});

	await t.test('clear-all removes color, highlight, AND size in a single action', () => {
		const line = 'Texte <span data-inkwell="1" style="color: #1971c2; background-color: rgba(81, 207, 102, 0.35); font-size: 1.25em;">bleu vert</span> normal.';
		const from = line.indexOf('bleu vert');
		const to = from + 'bleu vert'.length;

		const res = transformLine(line, from, to, { type: 'clear-all' });
		assert.equal(res.success, true);
		assert.equal(res.result?.text, 'Texte bleu vert normal.');
	});
});

test('text size: partial and mixed selections (V0.5.0)', async (t) => {
	await t.test('sizes only a middle word inside an existing span, leaving surrounding words intact', () => {
		const line = 'Un <span data-inkwell="1" style="font-size: 1.25em;">grand passage ici</span>.';
		// Select only "passage"
		const from = line.indexOf('passage');
		const to = from + 'passage'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: SMALL_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-size: 1.25em;">grand </span><span data-inkwell="1" style="font-size: 0.85em;">passage</span><span data-inkwell="1" style="font-size: 1.25em;"> ici</span>.',
		);
	});

	await t.test('unifies a mixed-size selection under a single target size', () => {
		const line = 'Un <span data-inkwell="1" style="font-size: 0.85em;">petit</span> et un <span data-inkwell="1" style="font-size: 1.25em;">grand</span> mot.';
		// Select from "petit" through "grand"
		const from = line.indexOf('petit');
		const to = line.indexOf('grand') + 'grand'.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: LARGE_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-size: 1.25em;">petit et un grand</span> mot.',
		);
	});
});

test('text size: Markdown structure protection (V0.5.0)', async (t) => {
	await t.test('detects line prefix lengths for headings, lists, and task checkboxes', () => {
		assert.equal(getLinePrefixLength('# Titre 1'), 2);
		assert.equal(getLinePrefixLength('### Titre 3'), 4);
		assert.equal(getLinePrefixLength('- Un élément'), 2);
		assert.equal(getLinePrefixLength('  * Item indenté'), 4);
		assert.equal(getLinePrefixLength('12. Item numéroté'), 4);
		assert.equal(getLinePrefixLength('- [ ] Tâche à faire'), 6);
		assert.equal(getLinePrefixLength('- [x] Tâche terminée'), 6);
		assert.equal(getLinePrefixLength('Paragraphe ordinaire'), 0);
	});

	await t.test('keeps heading marker # outside the span when selection starts at 0', () => {
		const line = '# Titre important';
		// User selected whole line including "# "
		const from = 0;
		const to = line.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: LARGE_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'# <span data-inkwell="1" style="font-size: 1.25em;">Titre important</span>',
		);
	});

	await t.test('refuses formatting if selection covers only the heading marker itself', () => {
		const line = '### Titre 3';
		const res = transformLine(line, 0, 3, { type: 'set-size', size: LARGE_TEXT_SIZE });
		assert.equal(res.success, false);
		assert.equal(res.errorReason, 'markdown_prefix');
	});

	await t.test('keeps list item marker and task checkbox outside the span', () => {
		const line = '- [ ] Faire les courses';
		const from = 0;
		const to = line.length;

		const res = transformLine(line, from, to, { type: 'set-size', size: SMALL_TEXT_SIZE });
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'- [ ] <span data-inkwell="1" style="font-size: 0.85em;">Faire les courses</span>',
		);
	});

	await t.test('splits size selection around bold markdown delimiters and absorbs bold', () => {
		const line = 'Texte avec **mot en gras** ici.';
		const from = line.indexOf('**mot en gras**');
		const to = from + '**mot en gras**'.length;
		const delimiters = [{ from, to: from + 2 }, { from: to - 2, to }];

		const res = transformLineWithDelimiters(
			line,
			from,
			to,
			delimiters,
			{ type: 'set-size', size: LARGE_TEXT_SIZE },
		);

		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Texte avec <span data-inkwell="1" style="font-size: 1.25em; font-weight: bold;">mot en gras</span> ici.',
		);
	});
});

test('text size: options definition (V0.5.0)', async (t) => {
	await t.test('contains exactly 3 text size options: small, normal, large', () => {
		assert.equal(TEXT_SIZE_OPTIONS.length, 3);
		assert.equal(TEXT_SIZE_OPTIONS[0]?.id, 'small');
		assert.equal(TEXT_SIZE_OPTIONS[0]?.value, '0.85em');
		assert.equal(TEXT_SIZE_OPTIONS[1]?.id, 'normal');
		assert.equal(TEXT_SIZE_OPTIONS[1]?.value, null);
		assert.equal(TEXT_SIZE_OPTIONS[2]?.id, 'large');
		assert.equal(TEXT_SIZE_OPTIONS[2]?.value, '1.25em');
	});
});
