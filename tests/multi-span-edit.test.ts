import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { findSimpleSpansInLine } from '../src/editor/tag-navigation/simple-spans';
import { planMultiSpanEdit } from '../src/editor/tag-navigation/multi-span-edit';
import { createEditGuard } from '../src/editor/tag-navigation/extension';
import { buildUnfoldedTagDecorations } from '../src/editor/tag-navigation/unfolded-decorations';

describe('multi-span-edit: deletions and replacements across fragments', () => {
	const doc2Colors = 'Avant <span data-inkwell="1" style="color: #e03131;">rouge</span> et <span data-inkwell="1" style="color: #1971c2;">bleu</span> après.';
	const spans2Colors = findSimpleSpansInLine(doc2Colors, 0);

	const docColorBold = 'Avant <span data-inkwell="1" style="color: #e03131;">rouge </span>**<span data-inkwell="1" style="color: #e03131;">gras</span>** après.';
	const spansColorBold = findSimpleSpansInLine(docColorBold, 0, true);

	it('partial deletion across two colored spans preserves surviving text and tags', () => {
		const s1 = spans2Colors[0]!;
		const s2 = spans2Colors[1]!;
		const fromA = s1.innerStart + 3; // "rou|ge"
		const toA = s2.innerStart + 2;   // "bl|eu"
		const st = EditorState.create({ doc: doc2Colors });

		const plan = planMultiSpanEdit(st.doc, spans2Colors, fromA, toA, '');
		assert.ok(plan);
		assert.equal(plan.type, 'apply');
		if (plan.type !== 'apply') return;

		const { rangeStart, rangeEnd, replacement } = plan.plan;
		const updated =
			doc2Colors.slice(0, rangeStart) +
			replacement +
			doc2Colors.slice(rangeEnd);

		assert.equal(
			updated,
			'Avant <span data-inkwell="1" style="color: #e03131;">rou</span><span data-inkwell="1" style="color: #1971c2;">eu</span> après.',
		);
	});

	it('partial deletion across color-only and bold Cas 6 fragments preserves tags and delimiters', () => {
		const s1 = spansColorBold[0]!;
		const s2 = spansColorBold[1]!;
		const fromA = s1.innerStart + 3; // "rou|ge "
		const toA = s2.innerStart + 2;   // "gr|as"
		const st = EditorState.create({ doc: docColorBold });

		const plan = planMultiSpanEdit(st.doc, spansColorBold, fromA, toA, '');
		assert.ok(plan);
		assert.equal(plan.type, 'apply');
		if (plan.type !== 'apply') return;

		const { rangeStart, rangeEnd, replacement } = plan.plan;
		const updated =
			docColorBold.slice(0, rangeStart) +
			replacement +
			docColorBold.slice(rangeEnd);

		assert.equal(
			updated,
			'Avant <span data-inkwell="1" style="color: #e03131;">rou</span>**<span data-inkwell="1" style="color: #e03131;">as</span>** après.',
		);
	});

	it('replacing selection across two spans inserts replacement and preserves surviving tags', () => {
		const s1 = spansColorBold[0]!;
		const s2 = spansColorBold[1]!;
		const fromA = s1.innerStart + 3; // "rou|ge "
		const toA = s2.innerStart + 2;   // "gr|as"
		const st = EditorState.create({ doc: docColorBold });

		const plan = planMultiSpanEdit(st.doc, spansColorBold, fromA, toA, 'XYZ');
		assert.ok(plan);
		assert.equal(plan.type, 'apply');
		if (plan.type !== 'apply') return;

		const { rangeStart, rangeEnd, replacement } = plan.plan;
		const updated =
			docColorBold.slice(0, rangeStart) +
			replacement +
			docColorBold.slice(rangeEnd);

		assert.equal(
			updated,
			'Avant <span data-inkwell="1" style="color: #e03131;">rouXYZ</span>**<span data-inkwell="1" style="color: #e03131;">as</span>** après.',
		);
	});

	it('completely emptying span 1 while leaving span 2 cleans span 1 entirely', () => {
		const s1 = spansColorBold[0]!;
		const s2 = spansColorBold[1]!;
		const fromA = s1.innerStart;     // deletes ALL of "rouge "
		const toA = s2.innerStart + 2;   // "gr|as"
		const st = EditorState.create({ doc: docColorBold });

		const plan = planMultiSpanEdit(st.doc, spansColorBold, fromA, toA, '');
		assert.ok(plan);
		assert.equal(plan.type, 'apply');
		if (plan.type !== 'apply') return;

		const { rangeStart, rangeEnd, replacement } = plan.plan;
		const updated =
			docColorBold.slice(0, rangeStart) +
			replacement +
			docColorBold.slice(rangeEnd);

		// Span 1 is removed completely, only span 2 survives
		assert.equal(
			updated,
			'Avant **<span data-inkwell="1" style="color: #e03131;">as</span>** après.',
		);
	});

	it('completely emptying span 2 while leaving span 1 cleans span 2 entirely', () => {
		const s1 = spansColorBold[0]!;
		const s2 = spansColorBold[1]!;
		const fromA = s1.innerStart + 3; // "rou|ge "
		const toA = s2.innerEnd;         // deletes ALL of "gras"
		const st = EditorState.create({ doc: docColorBold });

		const plan = planMultiSpanEdit(st.doc, spansColorBold, fromA, toA, '');
		assert.ok(plan);
		assert.equal(plan.type, 'apply');
		if (plan.type !== 'apply') return;

		const { rangeStart, rangeEnd, replacement } = plan.plan;
		const updated =
			docColorBold.slice(0, rangeStart) +
			replacement +
			docColorBold.slice(rangeEnd);

		// Span 2 is removed completely, only span 1 survives
		assert.equal(
			updated,
			'Avant <span data-inkwell="1" style="color: #e03131;">rou</span> après.',
		);
	});

	it('handles multi-line replacement cleanly and refuses special characters', () => {
		const s1 = spansColorBold[0]!;
		const s2 = spansColorBold[1]!;
		const fromA = s1.innerStart + 3;
		const toA = s2.innerStart + 2;
		const st = EditorState.create({ doc: docColorBold });

		const planML = planMultiSpanEdit(st.doc, spansColorBold, fromA, toA, 'line\nbreak');
		assert.ok(planML);
		assert.equal(planML.type, 'apply');
		if (planML.type === 'apply') {
			assert.equal(
				planML.plan.replacement,
				'line</span>\nbreak**<span data-inkwell="1" style="color: #e03131;">',
			);
		}

		const planSpec = planMultiSpanEdit(st.doc, spansColorBold, fromA, toA, 'foo < bar');
		assert.equal(planSpec?.type, 'apply');
	});

	it('end-to-end integration: user edit across fragments with undo/redo atomicity', () => {
		let refusedReason: string | null = null;
		const state = EditorState.create({
			doc: docColorBold,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: (r) => {
						refusedReason = r;
					},
				}),
			],
		});

		const s1 = spansColorBold[0]!;
		const s2 = spansColorBold[1]!;
		const fromA = s1.innerStart + 3; // "rou|ge "
		const toA = s2.innerStart + 2;   // "gr|as"

		const tr = state.update({
			changes: { from: fromA, to: toA, insert: '' },
			userEvent: 'delete.backward',
		});

		assert.equal(tr.docChanged, true);
		assert.equal(refusedReason, null);
		assert.equal(
			tr.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">rou</span>**<span data-inkwell="1" style="color: #e03131;">as</span>** après.',
		);

		// Invert transaction to verify single-step undo
		const undoTr = tr.state.update({
			changes: tr.changes.invert(tr.startState.doc),
			userEvent: 'undo',
		});
		assert.equal(undoTr.docChanged, true);
		assert.equal(undoTr.newDoc.toString(), docColorBold);
	});

	it('partial selection inside -> outside (coloré après): deletion and replacement preserves surviving span', () => {
		const doc = 'Avant <span data-inkwell="1" style="color: #e03131;">texte coloré</span> après.';
		const spans = findSimpleSpansInLine(doc, 0);
		const s = spans[0]!;
		const fromA = s.innerStart + 'texte '.length; // start of "coloré" inside span
		const toA = doc.indexOf('après') + 'après'.length; // end of "après" in plain text

		// 1. Deletion
		const stateDel = EditorState.create({
			doc,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const trDel = stateDel.update({
			changes: { from: fromA, to: toA, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(trDel.docChanged, true);
		assert.equal(
			trDel.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">texte </span>.',
		);

		// 2. Replacement with new text
		const stateRep = EditorState.create({
			doc,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const trRep = stateRep.update({
			changes: { from: fromA, to: toA, insert: 'MODIF' },
			userEvent: 'input',
		});
		assert.equal(trRep.docChanged, true);
		assert.equal(
			trRep.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">texte </span>MODIF.',
		);
	});

	it('partial selection outside -> inside (Avant texte): deletion and replacement preserves surviving span', () => {
		const doc = 'Avant <span data-inkwell="1" style="color: #e03131;">texte coloré</span> après.';
		const spans = findSimpleSpansInLine(doc, 0);
		const s = spans[0]!;
		const fromA = doc.indexOf('ant'); // in "Avant"
		const toA = s.innerStart + 'texte'.length; // after "texte" inside span

		// 1. Deletion
		const stateDel = EditorState.create({
			doc,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const trDel = stateDel.update({
			changes: { from: fromA, to: toA, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(trDel.docChanged, true);
		assert.equal(
			trDel.newDoc.toString(),
			'Av<span data-inkwell="1" style="color: #e03131;"> coloré</span> après.',
		);

		// 2. Replacement
		const stateRep = EditorState.create({
			doc,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const trRep = stateRep.update({
			changes: { from: fromA, to: toA, insert: 'NOUVEAU' },
			userEvent: 'input',
		});
		assert.equal(trRep.docChanged, true);
		assert.equal(
			trRep.newDoc.toString(),
			'AvNOUVEAU<span data-inkwell="1" style="color: #e03131;"> coloré</span> après.',
		);
	});

	it('partial selection across nested styles (<u><span ...> and plain text)', () => {
		const docNested = 'Avant <u><span data-inkwell="1" style="color: #e03131;">souligné rouge</span></u> après.';
		const spansNested = findSimpleSpansInLine(docNested, 0);
		assert.equal(spansNested.length, 1);
		const s = spansNested[0]!;
		assert.equal(s.enclosedInUnderline, true);

		// Inside -> outside across <u><span ...>
		const fromA = s.innerStart + 'souligné '.length; // start of "rouge"
		const toA = docNested.indexOf('après') + 'après'.length;

		const stateDel = EditorState.create({
			doc: docNested,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const trDel = stateDel.update({
			changes: { from: fromA, to: toA, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(trDel.docChanged, true);
		// Remaining text "souligné " must retain <u><span...> ... </span></u>
		assert.equal(
			trDel.newDoc.toString(),
			'Avant <u><span data-inkwell="1" style="color: #e03131;">souligné </span></u>.',
		);

		// Outside -> inside across <u><span ...>
		const fromB = docNested.indexOf('ant');
		const toB = s.innerStart + 'souligné'.length;

		const stateDelB = EditorState.create({
			doc: docNested,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const trDelB = stateDelB.update({
			changes: { from: fromB, to: toB, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(trDelB.docChanged, true);
		// Remaining text " rouge" must retain <u><span...> ... </span></u>
		assert.equal(
			trDelB.newDoc.toString(),
			'Av<u><span data-inkwell="1" style="color: #e03131;"> rouge</span></u> après.',
		);
	});
});

describe('unfolded-decorations: all inkwell styles preserved on active line', () => {
	it('preserves color, highlight, font-size, and font-family when line is unfolded', () => {
		const fullStyleLine =
			'Prefix <span data-inkwell="1" style="color: #e03131; background-color: #ffd43b; font-size: 1.25em; font-family: monospace;">texte</span> suffix.';
		const state = EditorState.create({
			doc: fullStyleLine,
			selection: { anchor: fullStyleLine.indexOf('texte') + 1 },
		});

		// Mock EditorView
		const mockView = {
			state,
			viewport: { from: 0, to: fullStyleLine.length },
		};

		// @ts-expect-error Mock minimal view
		const deco = buildUnfoldedTagDecorations(mockView, true, true);
		assert.ok(deco);

		// Traverse marks
		let foundStyleAttr: string | null = null;
		deco.between(0, fullStyleLine.length, (from, to, value) => {
			const spec = (value.spec as { attributes?: Record<string, string> });
			if (spec.attributes && spec.attributes['style']) {
				foundStyleAttr = spec.attributes['style'];
			}
		});

		assert.ok(foundStyleAttr);
		assert.match(foundStyleAttr, /color:\s*#e03131/);
		assert.match(foundStyleAttr, /background-color:\s*#ffd43b/);
		assert.match(foundStyleAttr, /font-size:\s*1\.25em/);
		assert.match(foundStyleAttr, /font-family:\s*monospace/);
	});

	it('preserves and hides <u> tags around inkwell span on active line', () => {
		const uLine = 'Prefix <u><span data-inkwell="1" style="color: #e03131;">souligné</span></u> suffix.';
		const state = EditorState.create({
			doc: uLine,
			selection: { anchor: uLine.indexOf('souligné') + 1 },
		});
		const mockView = {
			state,
			viewport: { from: 0, to: uLine.length },
		};
		// @ts-expect-error Mock minimal view
		const deco = buildUnfoldedTagDecorations(mockView, true, true);
		assert.ok(deco);

		let foundStyleAttr: string | null = null;
		let replacedCount = 0;
		deco.between(0, uLine.length, (from, to, value) => {
			const spec = value.spec as { attributes?: Record<string, string> };
			if (spec.attributes && spec.attributes['style']) {
				foundStyleAttr = spec.attributes['style'];
			} else {
				replacedCount++;
			}
		});

		assert.ok(foundStyleAttr);
		assert.match(foundStyleAttr, /color:\s*#e03131/);
		assert.match(foundStyleAttr, /text-decoration:\s*underline/);
		// Opening <u><span...> and closing </span></u> replaced (hidden)
		assert.equal(replacedCount, 2);
	});

	it('hides standalone <u> tags on active line and styles inner text with underline', () => {
		const uPlainLine = 'Prefix <u>texte souligné pur</u> suffix.';
		const state = EditorState.create({
			doc: uPlainLine,
			selection: { anchor: uPlainLine.indexOf('souligné') },
		});
		const mockView = {
			state,
			viewport: { from: 0, to: uPlainLine.length },
		};
		// @ts-expect-error Mock minimal view
		const deco = buildUnfoldedTagDecorations(mockView, true, true);
		assert.ok(deco);

		let replacedCount = 0;
		let underlineFound = false;
		deco.between(0, uPlainLine.length, (from, to, value) => {
			const spec = value.spec as { attributes?: Record<string, string> };
			if (spec.attributes && spec.attributes['style']) {
				if (spec.attributes['style'].includes('text-decoration: underline')) {
					underlineFound = true;
				}
			} else {
				replacedCount++;
			}
		});

		assert.equal(replacedCount, 2); // <u> and </u> hidden
		assert.equal(underlineFound, true);
	});

	it('clean-span removes entire <u><span ...>word</span></u> atomically in one step', () => {
		const uSpanLine = 'Prefix <u><span data-inkwell="1" style="color: #e03131;">mot</span></u> suffix.';
		const state = EditorState.create({
			doc: uSpanLine,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});

		const wordPos = uSpanLine.indexOf('mot');
		const tr = state.update({
			changes: { from: wordPos, to: wordPos + 3, insert: '' },
			userEvent: 'delete.backward',
		});

		assert.equal(tr.docChanged, true);
		// All tags (<u>, <span>, </span>, </u>) and the word are cleaned
		assert.equal(tr.newDoc.toString(), 'Prefix  suffix.');
		assert.equal(tr.newSelection.main.head, uSpanLine.indexOf('<u>'));
	});
});

describe('multiline-selections: multi-line deletions and replacements across lines', () => {
	it('deleting selection from span on line 1 to span on line 3 preserves outer tags and structure', () => {
		const doc3Lines =
			'# Titre <span data-inkwell="1" style="color: #e03131;">rouge</span>\n' +
			'Paragraphe intermédiaire neutre\n' +
			'- Liste **<span data-inkwell="1" style="color: #1971c2;">bleu</span>** fin';

		const state = EditorState.create({
			doc: doc3Lines,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});

		const fromA = doc3Lines.indexOf('ge'); // in "rouge" (line 1)
		const toA = doc3Lines.indexOf('bleu') + 2; // in "bl|eu" (line 3)

		const tr = state.update({
			changes: { from: fromA, to: toA, insert: '' },
			userEvent: 'delete.backward',
		});

		assert.equal(tr.docChanged, true);
		const result = tr.newDoc.toString();
		// "rou" remains closed in span 1 on line 1, intermediate line is cut, "eu" remains open in span 2 on line 2
		assert.equal(
			result,
			'# Titre <span data-inkwell="1" style="color: #e03131;">rou</span>**<span data-inkwell="1" style="color: #1971c2;">eu</span>** fin',
		);
	});

	it('replacing multiline selection with multi-line paste balances lines and tags cleanly', () => {
		const doc3Lines =
			'Prefix <span data-inkwell="1" style="color: #e03131;">mot1</span>\n' +
			'Ligne 2\n' +
			'Suffix **<span data-inkwell="1" style="color: #1971c2;">mot2</span>**';

		const state = EditorState.create({
			doc: doc3Lines,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});

		const fromA = doc3Lines.indexOf('t1');
		const toA = doc3Lines.indexOf('t2');

		const tr = state.update({
			changes: { from: fromA, to: toA, insert: 'colleLigne1\ncolleLigne2\ncolleLigne3' },
			userEvent: 'input.paste',
		});

		assert.equal(tr.docChanged, true);
		const result = tr.newDoc.toString();
		// Mot 1 receives colleLigne1 then closes, middle lines inserted cleanly, mot 2 receives colleLigne3
		assert.match(result, /Prefix <span data-inkwell="1" style="color: #e03131;">mocolleLigne1<\/span>\n/);
		assert.match(result, /\ncolleLigne2\n/);
		assert.match(result, /\ncolleLigne3\*\*<span data-inkwell="1" style="color: #1971c2;">t2<\/span>\*\*/);
	});
});

