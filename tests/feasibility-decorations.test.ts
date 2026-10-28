import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { findSimpleSpansInLine } from '../src/editor/tag-navigation/simple-spans';

const LINE = 'Avant <span data-inkwell="1" style="color: #e03131;">texte</span> après.';
const spans = findSimpleSpansInLine(LINE, 0);
const s = spans[0]!;

test('Étude technique : Decoration.replace sur les balises seules dans CodeMirror 6', async (t) => {
	// Créer les décorations :
	// 1. replace sur [spanStart, innerStart) : masque <span ...>
	// 2. mark sur [innerStart, innerEnd) : colore 'texte'
	// 3. replace sur [innerEnd, spanEnd) : masque </span>
	const builder = new RangeSetBuilder<Decoration>();
	builder.add(s.spanStart, s.innerStart, Decoration.replace({}));
	builder.add(s.innerStart, s.innerEnd, Decoration.mark({ attributes: { style: 'color: #e03131;' } }));
	builder.add(s.innerEnd, s.spanEnd, Decoration.replace({}));
	const decos = builder.finish();

	await t.test('Les décorations sont valides et ne se chevauchent pas dans CodeMirror', () => {
		assert.equal(decos.size, 3);
	});

	await t.test('Comportement lors de la frappe à la position 55 (au milieu de texte)', () => {
		const state = EditorState.create({
			doc: LINE,
			selection: { anchor: 55 },
		});
		const tr = state.update({
			changes: { from: 55, insert: 'Z' },
			selection: { anchor: 56 },
		});
		assert.equal(
			tr.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">teZxte</span> après.',
		);
	});

	await t.test('Comportement lors de la frappe à la position 53 (au début du texte intérieur)', () => {
		const state = EditorState.create({
			doc: LINE,
			selection: { anchor: 53 },
		});
		const tr = state.update({
			changes: { from: 53, insert: 'A' },
			selection: { anchor: 54 },
		});
		assert.equal(
			tr.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">Atexte</span> après.',
		);
	});
});
