import test from 'node:test';
import assert from 'node:assert';
import {
	canAddColumnToGroup,
	getBalancedRatios,
	localOffsetToParentOffset,
	normalizeRatiosTo100,
	parentOffsetToLocalOffset,
	parseMultiColumnMarkdown,
	redistributeRatiosAfterRemoval,
	serializeMultiColumnMarkdown,
} from '../src/columns/parser';
import { transformLine } from '../src/format/color-spans';

void test('columns parser: parses 2 columns and ratios (legacy [!column] format)', () => {
	const md = `> [!multi-column|40-60]
>
> > [!column]
> > ### Titre gauche
> > Premier paragraphe gauche
>
> > [!column]
> > ### Titre droite
> > Second paragraphe droite`;

	const parsed = parseMultiColumnMarkdown(md);
	assert.deepStrictEqual(parsed.ratios, [40, 60]);
	assert.strictEqual(parsed.col1.length, 1);
	assert.ok(parsed.col1[0]?.includes('Titre gauche'));
	assert.strictEqual(parsed.col2.length, 1);
	assert.ok(parsed.col2[0]?.includes('Titre droite'));

	const serialized = serializeMultiColumnMarkdown(parsed);
	assert.ok(serialized.includes('> [!multi-column|40-60]'));
	assert.ok(serialized.includes('> > [!column]'));
	assert.ok(serialized.includes('### Titre gauche'));
	assert.ok(serialized.includes('### Titre droite'));
});

void test('columns parser: parses [!col|XX] ratios and preserves empty lines on double Enter', () => {
	const md = [
		'> [!multi-column|65-35]',
		'>',
		'> > [!col|65]',
		'> > ### Colonne gauche',
		'> > ',
		'> > ',
		'> > Paragraphe après deux lignes vides',
		'>',
		'> > [!col|35]',
		'> > ### Colonne droite',
	].join('\n');

	const parsed = parseMultiColumnMarkdown(md);
	assert.deepStrictEqual(parsed.ratios, [65, 35]);
	assert.strictEqual(
		parsed.col1Text,
		'### Colonne gauche\n\n\nParagraphe après deux lignes vides',
	);
	assert.strictEqual(parsed.col2Text, '### Colonne droite');

	const roundTrip = serializeMultiColumnMarkdown(parsed);
	const reparsed = parseMultiColumnMarkdown(roundTrip);
	assert.strictEqual(reparsed.col1Text, parsed.col1Text);
	assert.strictEqual(reparsed.col2Text, parsed.col2Text);
	assert.deepStrictEqual(reparsed.ratios, [65, 35]);
});

void test('columns offset mapper: handles variable prefixes, empty lines, multiline selections, and Inkwell formatting length changes', () => {
	const blockFrom = 100; // e.g. block starts at offset 100 in parent note
	const md = [
		'> [!multi-column]',
		'>',
		'> > [!col|50]',
		'> > Ligne un avec mot cible ici', // prefix '> > ' (len 4)
		'> >',                              // prefix '> >' (len 3, empty content)
		'>> Ligne trois compacte',          // prefix '>> ' (len 3)
		'>   > Ligne quatre indentée',      // prefix '>   > ' (len 6)
		'>',
		'> > [!col|50]',
		'> > Colonne deux texte',
	].join('\n');

	const parsed = parseMultiColumnMarkdown(md);
	const col1Map = parsed.col1Map!;
	const col1Text = parsed.col1Text!;

	assert.strictEqual(col1Map.length, 4);
	assert.strictEqual(col1Map[0]?.prefixLength, 4);
	assert.strictEqual(col1Map[1]?.prefixLength, 3);
	assert.strictEqual(col1Map[1]?.contentLength, 0);
	assert.strictEqual(col1Map[2]?.prefixLength, 3);
	assert.strictEqual(col1Map[3]?.prefixLength, 6);

	// 1. Single-word selection on line 0: "cible"
	const wordStartLocal = col1Text.indexOf('cible');
	const wordEndLocal = wordStartLocal + 'cible'.length;
	const parentFrom = localOffsetToParentOffset(col1Map, col1Text, wordStartLocal, blockFrom);
	const parentTo = localOffsetToParentOffset(col1Map, col1Text, wordEndLocal, blockFrom);

	assert.strictEqual(
		md.slice(parentFrom - blockFrom, parentTo - blockFrom),
		'cible',
	);
	assert.strictEqual(
		parentOffsetToLocalOffset(col1Map, col1Text, parentFrom, blockFrom),
		wordStartLocal,
	);
	assert.strictEqual(
		parentOffsetToLocalOffset(col1Map, col1Text, parentTo, blockFrom),
		wordEndLocal,
	);

	// 2. Empty line (line 1) offset mapping
	const emptyLineLocalOffset = 'Ligne un avec mot cible ici\n'.length;
	const parentEmptyOffset = localOffsetToParentOffset(
		col1Map,
		col1Text,
		emptyLineLocalOffset,
		blockFrom,
	);
	assert.strictEqual(
		parentOffsetToLocalOffset(col1Map, col1Text, parentEmptyOffset, blockFrom),
		emptyLineLocalOffset,
	);

	// 3. Multiline selection from line 0 ("cible") across empty line 1 and line 2 to line 3 ("indentée")
	const line4WordLocal = col1Text.indexOf('indentée');
	const parentMultiTo = localOffsetToParentOffset(col1Map, col1Text, line4WordLocal + 8, blockFrom);
	assert.strictEqual(
		md.slice(parentMultiTo - blockFrom - 8, parentMultiTo - blockFrom),
		'indentée',
	);
	assert.strictEqual(
		parentOffsetToLocalOffset(col1Map, col1Text, parentMultiTo, blockFrom),
		line4WordLocal + 8,
	);

	// 4. Length change after Inkwell bold + color formatting on parent line
	const rawLine0 = '> > Ligne un avec mot cible ici';
	const rawFromCh = col1Map[0].prefixLength + wordStartLocal;
	const rawToCh = col1Map[0].prefixLength + wordEndLocal;

	const boldRes = transformLine(rawLine0, rawFromCh, rawToCh, { type: 'toggle-bold' });
	assert.ok(boldRes.success && boldRes.result);
	const colorRes = transformLine(
		boldRes.result.text,
		boldRes.result.from,
		boldRes.result.to,
		{ type: 'set-color', color: '#e03131' },
	);
	assert.ok(colorRes.success && colorRes.result);

	// Replace line in block and verify parentOffsetToLocalOffset maps the shifted selection back to "cible"
	const updatedMd = md.replace(rawLine0, colorRes.result.text);
	const updatedParsed = parseMultiColumnMarkdown(updatedMd);
	const updatedCol1Map = updatedParsed.col1Map!;
	const updatedCol1Text = updatedParsed.col1Text!;

	const line0StartInBlock = updatedCol1Map[0]!.lineOffsetInBlock;
	const newParentFrom = blockFrom + line0StartInBlock + colorRes.result.from;
	const newParentTo = blockFrom + line0StartInBlock + colorRes.result.to;

	const remappedLocalFrom = parentOffsetToLocalOffset(
		updatedCol1Map,
		updatedCol1Text,
		newParentFrom,
		blockFrom,
	);
	const remappedLocalTo = parentOffsetToLocalOffset(
		updatedCol1Map,
		updatedCol1Text,
		newParentTo,
		blockFrom,
	);

	assert.ok(remappedLocalFrom !== null && remappedLocalTo !== null);
	assert.strictEqual(
		updatedCol1Text.slice(remappedLocalFrom, remappedLocalTo),
		'cible',
	);
});

void test('columns parser: parses, serializes, and maps offsets for 3 and 4 columns with ratios totaling 100%', () => {
	assert.deepStrictEqual(getBalancedRatios(2), [50, 50]);
	assert.deepStrictEqual(getBalancedRatios(3), [34, 33, 33]);
	assert.deepStrictEqual(getBalancedRatios(4), [25, 25, 25, 25]);
	assert.strictEqual(
		normalizeRatiosTo100([20, 30, 50], 3).reduce((a, b) => a + b, 0),
		100,
	);

	// Redistributing after removing middle column (30%) from [20, 30, 50] -> [29, 71] (sum 100)
	const redistributed = redistributeRatiosAfterRemoval([20, 30, 50], [0, 2]);
	assert.strictEqual(redistributed.length, 2);
	assert.strictEqual(redistributed[0]! + redistributed[1]!, 100);
	assert.ok(redistributed[1]! > redistributed[0]!);

	const md4 = [
		'> [!multi-column|25-25-25-25]',
		'>',
		'> > [!col|25]',
		'> > Col 1 texte',
		'>',
		'> > [!col|25]',
		'> > Col 2 texte',
		'>',
		'> > [!col|25]',
		'> > Col 3 texte',
		'>',
		'> > [!col|25]',
		'> > Col 4 mot quatre ici',
	].join('\n');

	const parsed4 = parseMultiColumnMarkdown(md4);
	assert.strictEqual(parsed4.columns?.length, 4);
	assert.deepStrictEqual(parsed4.ratios, [25, 25, 25, 25]);

	// Offset mapping in the 4th column (index 3)
	const col4Slice = parsed4.columns?.[3];
	assert.ok(col4Slice);
	const blockFrom = 50;
	const localIdx = col4Slice.text.indexOf('quatre');
	const parentOff = localOffsetToParentOffset(col4Slice.map, col4Slice.text, localIdx, blockFrom);
	assert.strictEqual(md4.slice(parentOff - blockFrom, parentOff - blockFrom + 6), 'quatre');
	assert.strictEqual(
		parentOffsetToLocalOffset(col4Slice.map, col4Slice.text, parentOff, blockFrom),
		localIdx,
	);

	// Width constraint checks
	assert.strictEqual(canAddColumnToGroup(2, 700).allowed, true); // 3 cols in 700px -> allowed
	assert.strictEqual(canAddColumnToGroup(3, 700).allowed, true); // 4 cols in 700px -> allowed (min 588px)
	assert.strictEqual(canAddColumnToGroup(3, 450).allowed, false); // 4 cols in 450px -> refused (< 588px)
});
