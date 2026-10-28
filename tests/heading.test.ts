import test from 'node:test';
import assert from 'node:assert/strict';
import {
	getLineHeadingLevel,
	transformHeading,
} from '../src/format/heading';

test('getLineHeadingLevel correctly identifies heading levels', () => {
	assert.equal(getLineHeadingLevel('Texte normal'), null);
	assert.equal(getLineHeadingLevel('# Titre 1'), 1);
	assert.equal(getLineHeadingLevel('## Titre 2'), 2);
	assert.equal(getLineHeadingLevel('### Titre 3'), 3);
	assert.equal(getLineHeadingLevel('#### Titre 4'), 4);
	assert.equal(getLineHeadingLevel('##### Titre 5'), 5);
	assert.equal(getLineHeadingLevel('###### Titre 6'), 6);
	assert.equal(getLineHeadingLevel('   ### Titre indenté'), 3);
	assert.equal(getLineHeadingLevel('#SansEspace'), null);
	assert.equal(getLineHeadingLevel('####### Trop de dièses'), null);
});

test('transformHeading transforms plain text into headings', () => {
	const res1 = transformHeading('Paragraphe ordinaire', 1);
	assert.equal(res1.newLine, '# Paragraphe ordinaire');
	assert.equal(res1.delta, 2);

	const res2 = transformHeading('Paragraphe ordinaire', 3);
	assert.equal(res2.newLine, '### Paragraphe ordinaire');
	assert.equal(res2.delta, 4);

	const resIndent = transformHeading('  Texte indenté', 2);
	assert.equal(resIndent.newLine, '  ## Texte indenté');
	assert.equal(resIndent.delta, 3);
});

test('transformHeading changes existing heading level without accumulating markers', () => {
	const resH3toH1 = transformHeading('### Titre trois', 1);
	assert.equal(resH3toH1.newLine, '# Titre trois');
	assert.equal(resH3toH1.delta, -2); // was "### ", now "# "

	const resH1toH4 = transformHeading('# Titre un', 4);
	assert.equal(resH1toH4.newLine, '#### Titre un');
	assert.equal(resH1toH4.delta, 3);

	const resSame = transformHeading('## Titre deux', 2);
	assert.equal(resSame.newLine, '## Titre deux');
	assert.equal(resSame.delta, 0);
});

test('transformHeading removes heading level cleanly for normal text', () => {
	const resClear = transformHeading('### Titre à enlever', null);
	assert.equal(resClear.newLine, 'Titre à enlever');
	assert.equal(resClear.delta, -4);

	const resClearNormal = transformHeading('Texte déjà normal', null);
	assert.equal(resClearNormal.newLine, 'Texte déjà normal');
	assert.equal(resClearNormal.delta, 0);
});

test('transformHeading preserves internal styles intact', () => {
	const initial = '### Titre avec **gras**, *italique* et <span data-inkwell="1" style="color: #e03131;">couleur</span>';
	const res = transformHeading(initial, 1);
	assert.equal(
		res.newLine,
		'# Titre avec **gras**, *italique* et <span data-inkwell="1" style="color: #e03131;">couleur</span>',
	);

	const resNormal = transformHeading(initial, null);
	assert.equal(
		resNormal.newLine,
		'Titre avec **gras**, *italique* et <span data-inkwell="1" style="color: #e03131;">couleur</span>',
	);
});
