import test from 'node:test';
import assert from 'node:assert/strict';
import { findSimpleSpansInLine } from '../src/editor/tag-navigation/simple-spans';
import { checkChange } from '../src/editor/tag-navigation/edit-guard';

const LINE = 'Avant <span data-inkwell="1" style="color: #e03131;">texte</span> après.';
const OPEN = LINE.indexOf('<span');
const INNER = LINE.indexOf('>') + 1;
const CLOSE = LINE.indexOf('</span>');
const END = CLOSE + '</span>'.length;

const MULTI_LINE = 'Avant <span data-inkwell="1" style="color: #e03131;">premier</span> et <span data-inkwell="1" style="color: #1971c2;">second</span> après.';

test('Vérification précise des 4 questions de l utilisateur', async (t) => {
	const spans = findSimpleSpansInLine(LINE, 0);

	await t.test('Q1: Sélectionner uniquement le mot visible (INNER à CLOSE) puis supprimer (Backspace/Suppr)', () => {
		// fromA = INNER (53), toA = CLOSE (58), inserted = ""
		const res = checkChange(spans, INNER, CLOSE, '');
		// Constat : déclenche 'clean-span' pour supprimer le mot ET les deux balises !
		assert.equal(res.type, 'clean-span');
		if (res.type === 'clean-span') {
			assert.equal(res.span.spanStart, OPEN);
			assert.equal(res.span.spanEnd, END);
		}
	});

	await t.test('Q2: Sélectionner le mot visible (INNER à CLOSE) puis taper un remplacement ("nouveau")', () => {
		// fromA = INNER, toA = CLOSE, inserted = "nouveau"
		const res = checkChange(spans, INNER, CLOSE, 'nouveau');
		// Constat : AUTORISÉ (type: 'allow') ! Le remplacement fonctionne et préserve les balises
		assert.deepEqual(res, { type: 'allow' });
	});

	await t.test('Q3: Distinction entre remplacement par texte vide vs suppression qui coupe une balise', () => {
		// Cas A : vider le mot visible exactement (INNER à CLOSE) -> 'clean-span'
		const resEmpty = checkChange(spans, INNER, CLOSE, '');
		assert.equal(resEmpty.type, 'clean-span');

		// Cas B : couper la balise ouvrante (ex: de OPEN à INNER-1) -> 'refuse' / 'tag'
		const resCutOpen = checkChange(spans, OPEN, INNER - 1, '');
		assert.deepEqual(resCutOpen, { type: 'refuse', reason: 'tag' });

		// Cas C : déborder d un caractère dans la balise ouvrante (INNER-1 à CLOSE) -> 'refuse' / 'tag'
		const resOverflowTag = checkChange(spans, INNER - 1, CLOSE, '');
		assert.deepEqual(resOverflowTag, { type: 'refuse', reason: 'tag' });
	});

	await t.test('Q4: Sélection traversant plusieurs passages', async (t2) => {
		const multiSpans = findSimpleSpansInLine(MULTI_LINE, 0);
		assert.equal(multiSpans.length, 2);
		const s1 = multiSpans[0];
		const s2 = multiSpans[1];
		assert.ok(s1);
		assert.ok(s2);

		await t2.test('Q4-A: Sélection de tout le bloc englobant les 2 spans (du début de span 1 à la fin de span 2)', () => {
			// fromA <= s1.spanStart && toA >= s2.spanEnd
			const res = checkChange(multiSpans, s1.spanStart, s2.spanEnd, '');
			// AUTORISÉ : supprime les deux spans et ce qu il y a entre les deux
			assert.deepEqual(res, { type: 'allow' });
		});

		await t2.test('Q4-B: Sélection partielle du mot 1 jusqu au mot 2 (ex: de innerStart1 à innerEnd2)', () => {
			const res = checkChange(multiSpans, s1.innerStart, s2.innerEnd, '');
			// REFUSÉ avec 'tag' car elle traverse </span> du premier et <span...> du second
			assert.deepEqual(res, { type: 'refuse', reason: 'tag' });
		});

		await t2.test('Q4-C: Sélection du texte ordinaire intermédiaire (" et ") sans toucher aux balises', () => {
			const res = checkChange(multiSpans, s1.spanEnd, s2.spanStart, '');
			// AUTORISÉ : le texte intermédiaire n est pas stylé
			assert.deepEqual(res, { type: 'allow' });
		});
	});
});
