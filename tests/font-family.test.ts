import test from 'node:test';
import assert from 'node:assert/strict';
import {
	transformLine,
	transformLineWithDelimiters,
} from '../src/format/color-spans';
import {
	FONT_FAMILY_OPTIONS,
	getFontFamilyOptionById,
	getFontFamilyOptionByValue,
} from '../src/utils/constants';

test('font family: options and definitions (V0.6.0)', async (t) => {
	await t.test('defines 4 font family options (sans, serif, mono, default)', () => {
		assert.equal(FONT_FAMILY_OPTIONS.length, 4);
		const ids = FONT_FAMILY_OPTIONS.map((f) => f.id);
		assert.deepEqual(ids, ['sans', 'serif', 'mono', 'default']);
	});

	await t.test('finds option by ID and by value', () => {
		const sans = getFontFamilyOptionById('sans');
		assert.equal(sans?.value, 'sans-serif');

		const serif = getFontFamilyOptionByValue('serif');
		assert.equal(serif?.id, 'serif');

		const def = getFontFamilyOptionByValue(null);
		assert.equal(def?.id, 'default');
	});
});

test('font family: non-cumulative state and replacement (V0.6.0)', async (t) => {
	await t.test('applies serif font-family to plain text with data-inkwell="1"', () => {
		const line = 'Un texte simple ici.';
		const from = line.indexOf('texte simple');
		const to = from + 'texte simple'.length;
		const res = transformLine(line, from, to, {
			type: 'set-font-family',
			fontFamily: 'serif',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-family: serif;">texte simple</span> ici.',
		);
	});

	await t.test('applying font family repeatedly retains single value (non-cumulative)', () => {
		const line =
			'Un <span data-inkwell="1" style="font-family: serif;">texte simple</span> ici.';
		const from = line.indexOf('texte simple');
		const to = from + 'texte simple'.length;
		const res = transformLine(line, from, to, {
			type: 'set-font-family',
			fontFamily: 'serif',
		});
		assert.equal(res.success, false);
		assert.equal(res.errorReason, 'no_change');
	});

	await t.test('switching from serif to sans-serif replaces value directly without nesting spans', () => {
		const line =
			'Un <span data-inkwell="1" style="font-family: serif;">texte simple</span> ici.';
		const from = line.indexOf('texte simple');
		const to = from + 'texte simple'.length;
		const res = transformLine(line, from, to, {
			type: 'set-font-family',
			fontFamily: 'sans-serif',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-family: sans-serif;">texte simple</span> ici.',
		);
	});

	await t.test('switching from sans-serif to monospace replaces value directly', () => {
		const line =
			'Un <span data-inkwell="1" style="font-family: sans-serif;">texte simple</span> ici.';
		const from = line.indexOf('texte simple');
		const to = from + 'texte simple'.length;
		const res = transformLine(line, from, to, {
			type: 'set-font-family',
			fontFamily: 'monospace',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-family: monospace;">texte simple</span> ici.',
		);
	});

	await t.test('setting to default (remove-font-family) strips span completely when no other styles exist', () => {
		const line =
			'Un <span data-inkwell="1" style="font-family: monospace;">texte simple</span> ici.';
		const from = line.indexOf('texte simple');
		const to = from + 'texte simple'.length;
		const res = transformLine(line, from, to, {
			type: 'remove-font-family',
		});
		assert.equal(res.success, true);
		assert.equal(res.result?.text, 'Un texte simple ici.');
	});

	await t.test('removing font family preserves span if third-party attributes exist', () => {
		const line =
			'Un <span data-inkwell="1" class="custom-span" style="font-family: serif; letter-spacing: 1px;">texte</span> ici.';
		const from = line.indexOf('texte');
		const to = from + 'texte'.length;
		const res = transformLine(line, from, to, {
			type: 'remove-font-family',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span class="custom-span" style="letter-spacing: 1px;">texte</span> ici.',
		);
	});
});

test('font family: combination with other Inkwell styles and Markdown (V0.6.0)', async (t) => {
	await t.test('adds font family to colored, highlighted, and sized text', () => {
		const line =
			'<span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot stylé</span>';
		const from = line.indexOf('mot stylé');
		const to = from + 'mot stylé'.length;
		const res = transformLine(line, from, to, {
			type: 'set-font-family',
			fontFamily: 'serif',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'<span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em; font-family: serif;">mot stylé</span>',
		);
	});

	await t.test('removes font family while preserving color, highlight, and size', () => {
		const line =
			'<span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em; font-family: serif;">mot stylé</span>';
		const from = line.indexOf('mot stylé');
		const to = from + 'mot stylé'.length;
		const res = transformLine(line, from, to, {
			type: 'remove-font-family',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'<span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot stylé</span>',
		);
	});

	await t.test('clear-all removes font family along with color, highlight, and size', () => {
		const line =
			'<span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em; font-family: serif;">mot stylé</span>';
		const from = line.indexOf('mot stylé');
		const to = from + 'mot stylé'.length;
		const res = transformLine(line, from, to, {
			type: 'clear-all',
		});
		assert.equal(res.success, true);
		assert.equal(res.result?.text, 'mot stylé');
	});
});

test('font family: partial and mixed selections (V0.6.0)', async (t) => {
	await t.test('changes font family for only a middle word inside an existing span', () => {
		const line =
			'Un <span data-inkwell="1" style="font-family: serif;">grand beau texte</span> ici.';
		const from = line.indexOf('beau');
		const to = from + 'beau'.length;
		const res = transformLine(line, from, to, {
			type: 'set-font-family',
			fontFamily: 'monospace',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-family: serif;">grand </span><span data-inkwell="1" style="font-family: monospace;">beau</span><span data-inkwell="1" style="font-family: serif;"> texte</span> ici.',
		);
	});

	await t.test('unifies a mixed-font selection under a single font family', () => {
		const line =
			'Un <span data-inkwell="1" style="font-family: serif;">mot serif</span> et un <span data-inkwell="1" style="font-family: monospace;">mot mono</span> fin.';
		const from = line.indexOf('mot serif');
		const to = line.indexOf('mot mono') + 'mot mono'.length;
		const res = transformLine(line, from, to, {
			type: 'set-font-family',
			fontFamily: 'sans-serif',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-family: sans-serif;">mot serif et un mot mono</span> fin.',
		);
	});
});

test('font family: markdown structure and delimiter preservation (V0.6.0)', async (t) => {
	await t.test('keeps heading marker # outside the span', () => {
		const line = '## Titre de section';
		const res = transformLineWithDelimiters(line, 0, line.length, [], {
			type: 'set-font-family',
			fontFamily: 'serif',
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'## <span data-inkwell="1" style="font-family: serif;">Titre de section</span>',
		);
	});

	await t.test('refuses formatting if selection covers only the heading marker', () => {
		const line = '## Titre de section';
		const res = transformLineWithDelimiters(line, 0, 2, [], {
			type: 'set-font-family',
			fontFamily: 'serif',
		});
		assert.equal(res.success, false);
		assert.equal(res.errorReason, 'markdown_prefix');
	});

	await t.test('splits font family selection around bold markdown delimiters and absorbs bold', () => {
		const line = 'Un **mot gras** normal.';
		const boldStart = line.indexOf('**');
		const boldEnd = line.indexOf('**', boldStart + 2) + 2;
		const delimiters = [
			{ from: boldStart, to: boldStart + 2 },
			{ from: boldEnd - 2, to: boldEnd },
		];

		const res = transformLineWithDelimiters(
			line,
			boldStart,
			boldEnd,
			delimiters,
			{ type: 'set-font-family', fontFamily: 'serif' },
		);
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			'Un <span data-inkwell="1" style="font-family: serif; font-weight: bold;">mot gras</span> normal.',
		);
	});
});
