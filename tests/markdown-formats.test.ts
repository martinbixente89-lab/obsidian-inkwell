import test from 'node:test';
import assert from 'node:assert/strict';
import {
	analyzeSelectionFormatting,
	toggleFormat,
	findBoldRanges,
	findItalicRanges,
	findStrikethroughRanges,
	findUnderlineRanges,
} from '../src/format/markdown-formats';

test('markdown formats: parsing and exclusions', async (t) => {
	await t.test('detects bold with ** and __', () => {
		const line = 'Un **mot gras** et un __autre gras__.';
		const ranges = findBoldRanges(line);
		assert.equal(ranges.length, 2);
		assert.equal(line.slice(ranges[0]?.innerFrom, ranges[0]?.innerTo), 'mot gras');
		assert.equal(line.slice(ranges[1]?.innerFrom, ranges[1]?.innerTo), 'autre gras');
	});

	await t.test('detects italic with * and _', () => {
		const line = 'Un *mot italique* et un _autre italique_.';
		const ranges = findItalicRanges(line);
		assert.equal(ranges.length, 2);
		assert.equal(line.slice(ranges[0]?.innerFrom, ranges[0]?.innerTo), 'mot italique');
		assert.equal(line.slice(ranges[1]?.innerFrom, ranges[1]?.innerTo), 'autre italique');
	});

	await t.test('detects strikethrough with ~~', () => {
		const line = 'Un ~~mot barre~~ ici.';
		const ranges = findStrikethroughRanges(line);
		assert.equal(ranges.length, 1);
		assert.equal(line.slice(ranges[0]?.innerFrom, ranges[0]?.innerTo), 'mot barre');
	});

	await t.test('detects underline with <u>...</u> and preserves attributes', () => {
		const line = 'Un <u>simple</u> et un <u style="color: blue;" data-custom="1">attribut</u>.';
		const ranges = findUnderlineRanges(line);
		assert.equal(ranges.length, 2);
		assert.equal(line.slice(ranges[0]?.innerFrom, ranges[0]?.innerTo), 'simple');
		assert.equal(line.slice(ranges[1]?.innerFrom, ranges[1]?.innerTo), 'attribut');
		assert.equal(ranges[1]?.attrs?.['style'], 'color: blue;');
		assert.equal(ranges[1]?.attrs?.['data-custom'], '1');
	});

	await t.test('ignores escaped delimiters (\\*, \\_, \\~)', () => {
		const line = 'Ceci est \\*\\*non gras\\*\\* et \\_non italique\\_.';
		assert.equal(findBoldRanges(line).length, 0);
		assert.equal(findItalicRanges(line).length, 0);
	});

	await t.test('ignores formatting inside inline code (`...`)', () => {
		const line = 'Regarde `**non gras**` et `<u>non souligne</u>`.';
		assert.equal(findBoldRanges(line).length, 0);
		assert.equal(findUnderlineRanges(line).length, 0);
	});
});

test('markdown formats: coverage states (none, all, mixed)', async (t) => {
	await t.test('detects none when selection has no format', () => {
		const line = 'Un texte ordinaire ici.';
		const from = line.indexOf('texte');
		const to = from + 'texte'.length;
		const state = analyzeSelectionFormatting(line, from, to);
		assert.equal(state.bold, 'none');
		assert.equal(state.italic, 'none');
		assert.equal(state.strikethrough, 'none');
		assert.equal(state.underline, 'none');
	});

	await t.test('detects all when whole selection is formatted', () => {
		const line = 'Un **texte en gras** ici.';
		const from = line.indexOf('texte en gras');
		const to = from + 'texte en gras'.length;
		const state = analyzeSelectionFormatting(line, from, to);
		assert.equal(state.bold, 'all');
		assert.equal(state.italic, 'none');
	});

	await t.test('detects mixed when selection only partially formatted', () => {
		const line = 'Un **texte** et suite.';
		const from = line.indexOf('texte');
		const to = line.indexOf('suite');
		const state = analyzeSelectionFormatting(line, from, to);
		assert.equal(state.bold, 'mixed');
	});
});

test('markdown formats: toggle behavior (inactive -> apply, mixed -> apply, active -> remove)', async (t) => {
	await t.test('applies bold to unformatted selection', () => {
		const line = 'Un mot simple.';
		const from = line.indexOf('mot');
		const to = from + 'mot'.length;
		const res = toggleFormat(line, from, to, 'bold');
		assert.equal(res.success, true);
		assert.equal(res.line, 'Un **mot** simple.');
	});

	await t.test('removes bold when whole selection is bold', () => {
		const line = 'Un **mot simple** ici.';
		const from = line.indexOf('mot simple');
		const to = from + 'mot simple'.length;
		const res = toggleFormat(line, from, to, 'bold');
		assert.equal(res.success, true);
		assert.equal(res.line, 'Un mot simple ici.');
	});

	await t.test('mixed selection is unified to bold on first click', () => {
		const line = 'Un **petit** et grand mot.';
		const from = line.indexOf('petit');
		const to = line.indexOf('mot');
		// "petit" is bold, " et grand " is not -> mixed
		const res = toggleFormat(line, from, to, 'bold');
		assert.equal(res.success, true);
		assert.equal(res.line, 'Un **petit et grand **mot.');

		// Second click on unified range removes bold
		const newFrom = res.line.indexOf('petit et grand ');
		const newTo = newFrom + 'petit et grand '.length;
		const res2 = toggleFormat(res.line, newFrom, newTo, 'bold');
		assert.equal(res2.success, true);
		assert.equal(res2.line, 'Un petit et grand mot.');
	});

	await t.test('partial selection inside bold splits without unbolding surrounding words', () => {
		const line = 'Un **grand passage ici** pour tester.';
		const from = line.indexOf('passage');
		const to = from + 'passage'.length;
		const res = toggleFormat(line, from, to, 'bold');
		assert.equal(res.success, true);
		assert.equal(res.line, 'Un **grand** passage **ici** pour tester.');
	});

	await t.test('applies underline with <u>...</u>', () => {
		const line = 'Un mot souligne ici.';
		const from = line.indexOf('mot souligne');
		const to = from + 'mot souligne'.length;
		const res = toggleFormat(line, from, to, 'underline');
		assert.equal(res.success, true);
		assert.equal(res.line, 'Un <u>mot souligne</u> ici.');

		// Toggle off
		const uFrom = res.line.indexOf('mot souligne');
		const uTo = uFrom + 'mot souligne'.length;
		const res2 = toggleFormat(res.line, uFrom, uTo, 'underline');
		assert.equal(res2.success, true);
		assert.equal(res2.line, 'Un mot souligne ici.');
	});
});

test('markdown formats: combination with Inkwell span (color, highlight, size)', async (t) => {
	await t.test('applies bold outside an existing Inkwell span', () => {
		const line = 'Texte <span data-inkwell="1" style="color: #e03131;">rouge</span> normal.';
		const from = line.indexOf('<span');
		const to = line.indexOf('</span>') + '</span>'.length;
		const res = toggleFormat(line, from, to, 'bold');
		assert.equal(res.success, true);
		assert.equal(
			res.line,
			'Texte **<span data-inkwell="1" style="color: #e03131;">rouge</span>** normal.',
		);
	});

	await t.test('applies underline around an existing Inkwell span', () => {
		const line = 'Texte <span data-inkwell="1" style="color: #e03131; font-size: 1.25em;">rouge</span> normal.';
		const from = line.indexOf('<span');
		const to = line.indexOf('</span>') + '</span>'.length;
		const res = toggleFormat(line, from, to, 'underline');
		assert.equal(res.success, true);
		assert.equal(
			res.line,
			'Texte <u><span data-inkwell="1" style="color: #e03131; font-size: 1.25em;">rouge</span></u> normal.',
		);
	});

	await t.test('combines all four formats (bold, italic, strike, underline) around Inkwell span', () => {
		let line = '<span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span>';
		// Underline
		line = toggleFormat(line, 0, line.length, 'underline').line;
		assert.equal(
			line,
			'<u><span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span></u>',
		);
		// Strikethrough
		line = toggleFormat(line, 0, line.length, 'strikethrough').line;
		assert.equal(
			line,
			'~~<u><span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span></u>~~',
		);
		// Italic
		line = toggleFormat(line, 0, line.length, 'italic').line;
		assert.equal(
			line,
			'*~~<u><span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span></u>~~*',
		);
		// Bold
		line = toggleFormat(line, 0, line.length, 'bold').line;
		assert.equal(
			line,
			'***~~<u><span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span></u>~~***',
		);

		// Now remove bold
		line = toggleFormat(line, 0, line.length, 'bold').line;
		assert.equal(
			line,
			'*~~<u><span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span></u>~~*',
		);

		// Remove italic
		line = toggleFormat(line, 0, line.length, 'italic').line;
		assert.equal(
			line,
			'~~<u><span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span></u>~~',
		);

		// Remove strikethrough
		line = toggleFormat(line, 0, line.length, 'strikethrough').line;
		assert.equal(
			line,
			'<u><span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span></u>',
		);

		// Remove underline
		line = toggleFormat(line, 0, line.length, 'underline').line;
		assert.equal(
			line,
			'<span data-inkwell="1" style="color: #e03131; background-color: rgba(255, 212, 59, 0.35); font-size: 1.25em;">mot</span>',
		);
	});

	await t.test('preserves third-party attributes and styles on u tags during partial splits', () => {
		const line = 'Un <u class="custom-underline" style="text-decoration-color: red;">grand passage</u> ici.';
		const from = line.indexOf('grand');
		const to = from + 'grand'.length;
		const res = toggleFormat(line, from, to, 'underline');
		assert.equal(res.success, true);
		assert.equal(
			res.line,
			'Un grand <u class="custom-underline" style="text-decoration-color: red;">passage</u> ici.',
		);
	});
});
