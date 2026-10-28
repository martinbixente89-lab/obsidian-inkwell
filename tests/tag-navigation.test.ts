import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet, EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
	findFormattingSpansInDoc,
	findSimpleSpans,
	findSimpleSpansInLine,
} from '../src/editor/tag-navigation/simple-spans';
import { checkChange } from '../src/editor/tag-navigation/edit-guard';
import {
	createEditGuard,
	evaluateBoldToggle,
	toggleBoldOnInkwellSpan,
} from '../src/editor/tag-navigation/extension';
import { buildUnfoldedTagDecorations } from '../src/editor/tag-navigation/unfolded-decorations';

const LINE = 'Avant <span data-inkwell="1" style="color: #e03131;">texte</span> après.';
const OPEN = LINE.indexOf('<span');
const INNER = LINE.indexOf('>') + 1;
const CLOSE = LINE.indexOf('</span>');
const END = CLOSE + '</span>'.length;

test('simple span detection', async (t) => {
	await t.test('finds the offsets of a simple Inkwell span', () => {
		assert.deepEqual(findSimpleSpansInLine(LINE, 0), [
			{ spanStart: OPEN, innerStart: INNER, innerEnd: CLOSE, spanEnd: END },
		]);
	});
	await t.test('applies the line offset', () => {
		const [s] = findSimpleSpansInLine(LINE, 100);
		assert.equal(s?.spanStart, OPEN + 100);
	});
	await t.test('ignores non-Inkwell, nested, empty, third-party and inline-code spans', () => {
		for (const line of [
			'<span style="color: red;">x</span>',
			'<span data-inkwell="1" style="color: red;">a <u>b</u></span>',
			'<span data-inkwell="1" style="color: red;"></span>',
			'<span data-inkwell="1" class="x" style="color: red;">x</span>',
			'`<span data-inkwell="1" style="color: red;">x</span>`',
		]) {
			assert.deepEqual(findSimpleSpansInLine(line, 0), [], line);
		}
	});
	await t.test('ignores spans inside fenced code blocks', () => {
		const doc = Text.of(['```', LINE, '```', LINE]);
		const spans = findSimpleSpans(doc, 1, 4);
		assert.equal(spans.length, 1);
		assert.equal(spans[0]?.spanStart, doc.line(4).from + OPEN);
	});
	await t.test('finds two spans on one line', () => {
		assert.equal(findSimpleSpansInLine(`${LINE} ${LINE}`, 0).length, 2);
	});
	await t.test('accepts internal Markdown formatting (**gras**, *italique*) when data-inkwell is present', () => {
		const lineWithMd = 'Cas 1: <span data-inkwell="1" style="color: #e03131">**texte en gras**</span>';
		const res = findSimpleSpansInLine(lineWithMd, 0);
		assert.equal(res.length, 1);
		const s = res[0];
		assert.ok(s);
		assert.equal(s.innerEnd - s.innerStart, '**texte en gras**'.length);
	});
});

test('edit guard rules', async (t) => {
	const spans = findSimpleSpansInLine(LINE, 0);
	const ok = (from: number, to: number, ins = '') =>
		assert.deepEqual(checkChange(spans, from, to, ins), { type: 'allow' });
	const no = (from: number, to: number, ins: string, r: string) =>
		assert.deepEqual(checkChange(spans, from, to, ins), { type: 'refuse', reason: r });
	const clean = (from: number, to: number) => {
		const res = checkChange(spans, from, to, '');
		assert.equal(res.type, 'clean-span');
		if (res.type === 'clean-span') {
			assert.equal(res.span.spanStart, OPEN);
			assert.equal(res.span.spanEnd, END);
		}
	};

	await t.test('allows typing inside, at both inner boundaries and outside', () => {
		ok(INNER, INNER, 'x');
		ok(INNER + 2, INNER + 2, 'x');
		ok(CLOSE, CLOSE, 'x');
		ok(OPEN, OPEN, 'x');
		ok(END, END, 'x');
	});
	await t.test('allows deleting one letter inside (when multiple remain) and characters outside', () => {
		ok(INNER, INNER + 1);
		ok(CLOSE - 1, CLOSE);
		ok(OPEN - 1, OPEN);
		ok(END, END + 1);
	});
	await t.test('allows deleting or replacing the whole span (tags included)', () => {
		ok(OPEN, END);
		ok(OPEN - 2, END + 2, 'z');
	});
	await t.test('refuses atomic deletion of a lone tag (Backspace/Suppr at boundaries)', () => {
		no(OPEN, INNER, '', 'tag');
		no(CLOSE, END, '', 'tag');
	});
	await t.test('refuses selections crossing a single tag', () => {
		no(OPEN - 2, INNER + 2, '', 'tag');
		no(CLOSE - 2, END + 2, 'x', 'tag');
		no(OPEN + 3, OPEN + 4, '', 'tag');
	});
	await t.test('triggers clean-span on emptying the visible content, allows non-empty replacement', () => {
		clean(INNER, CLOSE);
		ok(INNER, CLOSE, 'mot');
	});
	await t.test('triggers clean-span on deleting the last remaining character of a 1-char span', () => {
		const oneCharLine = 'Avant <span data-inkwell="1" style="color: #e03131;">x</span> après.';
		const oneSpans = findSimpleSpansInLine(oneCharLine, 0);
		const s = oneSpans[0];
		assert.ok(s);
		const res = checkChange(oneSpans, s.innerStart, s.innerEnd, '');
		assert.equal(res.type, 'clean-span');
	});
	await t.test('allows newline and rewrites <, >, & to safe entities inside span', () => {
		const resLt = checkChange(spans, INNER + 1, INNER + 1, 'a<b');
		assert.equal(resLt.type, 'rewrite');
		const resAmp = checkChange(spans, CLOSE, CLOSE, '&');
		assert.equal(resAmp.type, 'rewrite');
		ok(END, END, '\n');
		ok(OPEN, OPEN, '<');
	});
});

test('transaction filter integration (programmatic transactions)', async (t) => {
	let refused = 0;
	const make = (doc = LINE, active = true) =>
		EditorState.create({
			doc,
			extensions: createEditGuard({ isActive: () => active, onRefuse: () => refused++ }),
		});

	await t.test('cancels an unsafe user deletion without selection move or history', () => {
		const state = make();
		const tr = state.update({
			changes: { from: OPEN, to: INNER },
			selection: { anchor: OPEN },
			userEvent: 'delete.backward',
		});
		assert.equal(tr.docChanged, false);
		assert.equal(tr.newSelection.main.head, 0);
		assert.equal(refused, 1);
	});
	await t.test('rewrites deletion of entire visible word to clean tags and content in one step', () => {
		const state = make();
		const tr = state.update({
			changes: { from: INNER, to: CLOSE, insert: '' },
			selection: { anchor: INNER },
			userEvent: 'delete.backward',
		});
		assert.equal(tr.docChanged, true);
		// Span tags AND inner text removed completely
		assert.equal(tr.newDoc.toString(), 'Avant  après.');
		// Cursor placed exactly where span began
		assert.equal(tr.newSelection.main.head, OPEN);
	});
	await t.test('rewrites deletion of last letter (1-char span) with Backspace or Delete', () => {
		const oneCharLine = 'Avant <span data-inkwell="1" style="color: #e03131;">x</span> après.';
		const openPos = oneCharLine.indexOf('<span');
		const inPos = oneCharLine.indexOf('>') + 1;
		const state = make(oneCharLine);

		// Backspace on last letter
		const trBksp = state.update({
			changes: { from: inPos, to: inPos + 1, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(trBksp.newDoc.toString(), 'Avant  après.');
		assert.equal(trBksp.newSelection.main.head, openPos);

		// Delete on last letter
		const trDel = state.update({
			changes: { from: inPos, to: inPos + 1, insert: '' },
			userEvent: 'delete.forward',
		});
		assert.equal(trDel.newDoc.toString(), 'Avant  après.');
		assert.equal(trDel.newSelection.main.head, openPos);
	});
	await t.test('preserves span and style when replacing whole visible word with non-empty text', () => {
		const state = make();
		const tr = state.update({
			changes: { from: INNER, to: CLOSE, insert: 'nouveau' },
			userEvent: 'input.type',
		});
		assert.equal(tr.docChanged, true);
		assert.equal(
			tr.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">nouveau</span> après.',
		);
	});
	await t.test('lets safe internal edits through without removing tags', () => {
		const state = make();
		const tr = state.update({ changes: { from: INNER + 1, insert: 'X' }, userEvent: 'input.type' });
		assert.equal(tr.newDoc.toString(), LINE.slice(0, INNER + 1) + 'X' + LINE.slice(INNER + 1));
	});
	await t.test('does not filter non-user (plugin) transactions, undo or redo', () => {
		const state = make();
		for (const userEvent of [undefined, 'undo', 'redo']) {
			const tr = state.update({ changes: { from: OPEN, to: INNER }, userEvent });
			assert.equal(tr.docChanged, true, String(userEvent));
		}
	});
	await t.test('does nothing when inactive (source mode)', () => {
		const tr = make(LINE, false).update({ changes: { from: OPEN, to: INNER }, userEvent: 'delete.backward' });
		assert.equal(tr.docChanged, true);
	});
});

test('bold + color combinations (Cas 1 and Cas 6)', async (t) => {
	const lineCas6 = 'Avant **<span data-inkwell="1" style="color: #e03131;">texte</span>** après.';
	const lineCas1 = 'Avant <span data-inkwell="1" style="color: #e03131;">**texte**</span> après.';

	await t.test('detects enclosedInBold (Cas 6)', () => {
		const [s] = findSimpleSpansInLine(lineCas6, 0);
		assert.ok(s);
		assert.equal(s.enclosedInBold, true);
		assert.equal(s.innerBold, undefined);
	});

	await t.test('detects innerBold (Cas 1)', () => {
		const [s] = findSimpleSpansInLine(lineCas1, 0);
		assert.ok(s);
		assert.equal(s.innerBold, true);
		assert.equal(s.enclosedInBold, undefined);
	});

	await t.test('Cas 6: deleting visible word cleans span AND surrounding bold markers in 1 step', () => {
		const state = EditorState.create({
			doc: lineCas6,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const [s] = findSimpleSpansInLine(lineCas6, 0);
		assert.ok(s);
		const tr = state.update({
			changes: { from: s.innerStart, to: s.innerEnd, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(tr.docChanged, true);
		assert.equal(tr.newDoc.toString(), 'Avant  après.');
		assert.equal(tr.newSelection.main.head, s.spanStart - 2);
	});

	await t.test('Cas 1: deleting visible word (excluding masked asterisks) cleans entire span in 1 step', () => {
		const state = EditorState.create({
			doc: lineCas1,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const [s] = findSimpleSpansInLine(lineCas1, 0);
		assert.ok(s);
		const visStart = s.innerStart + 2;
		const visEnd = s.innerEnd - 2;
		const tr = state.update({
			changes: { from: visStart, to: visEnd, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(tr.docChanged, true);
		assert.equal(tr.newDoc.toString(), 'Avant  après.');
		assert.equal(tr.newSelection.main.head, s.spanStart);
	});

	await t.test('Cas 1: replacing visible word preserves delimiters and tags', () => {
		const state = EditorState.create({
			doc: lineCas1,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const [s] = findSimpleSpansInLine(lineCas1, 0);
		assert.ok(s);
		const visStart = s.innerStart + 2;
		const visEnd = s.innerEnd - 2;
		const tr = state.update({
			changes: { from: visStart, to: visEnd, insert: 'nouveau' },
			userEvent: 'input.type',
		});
		assert.equal(tr.docChanged, true);
		assert.equal(
			tr.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">**nouveau**</span> après.',
		);
	});

	await t.test('Cas 1: cutting into masked bold delimiters is refused', () => {
		let refused = false;
		const state = EditorState.create({
			doc: lineCas1,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {
						refused = true;
					},
				}),
			],
		});
		const [s] = findSimpleSpansInLine(lineCas1, 0);
		assert.ok(s);
		// Trying to delete into the opening **
		const tr = state.update({
			changes: { from: s.innerStart, to: s.innerStart + 3, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(tr.docChanged, false);
		assert.equal(refused, true);
	});

	await t.test('toggleBoldOnInkwellSpan: formats whole span in bold when cursor is inside or full word is selected', () => {
		let st = EditorState.create({
			doc: LINE,
			selection: { anchor: INNER + 1 }, // cursor inside "texte"
		});
		const mockView = {
			get state() {
				return st;
			},
			dispatch(tr: { state: EditorState }) {
				st = tr.state;
			},
		};
		// @ts-expect-error Mock minimal view
		const handled = toggleBoldOnInkwellSpan(mockView, () => true);
		assert.equal(handled, true);
		assert.equal(
			st.doc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131; font-weight: bold;">texte</span> après.',
		);
	});

	await t.test('toggleBoldOnInkwellSpan: partitions span on partial selection and applies bold via font-weight', () => {
		let st = EditorState.create({
			doc: LINE,
			selection: { anchor: INNER + 1, head: INNER + 3 }, // partial selection "ex" in "texte"
		});
		const mockView = {
			get state() {
				return st;
			},
			dispatch(tr: { state: EditorState }) {
				st = tr.state;
			},
		};
		// @ts-expect-error Mock minimal view
		const handled = toggleBoldOnInkwellSpan(mockView, () => true, () => true);
		assert.equal(handled, true);
		assert.equal(
			st.doc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">t</span><span data-inkwell="1" style="color: #e03131; font-weight: bold;">ex</span><span data-inkwell="1" style="color: #e03131;">te</span> après.',
		);
		// Selection is preserved strictly on "ex"
		const targetSpan = findFormattingSpansInDoc(st.doc.toString())[1]!;
		assert.equal(targetSpan.parsed?.fontWeight, 'bold');
		assert.equal(st.selection.main.from, targetSpan.innerStart);
		assert.equal(st.selection.main.to, targetSpan.innerEnd);
	});

	await t.test('toggleBoldOnInkwellSpan: toggles off bold on Cas 6', () => {
		let st = EditorState.create({
			doc: lineCas6,
			selection: { anchor: lineCas6.indexOf('texte') },
		});
		const mockView = {
			get state() {
				return st;
			},
			dispatch(tr: { state: EditorState }) {
				st = tr.state;
			},
		};
		// @ts-expect-error Mock minimal view
		const handled = toggleBoldOnInkwellSpan(mockView, () => true);
		assert.equal(handled, true);
		assert.equal(
			st.doc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">texte</span> après.',
		);
	});

	await t.test('toggleBoldOnInkwellSpan: toggles off inner bold on Cas 1', () => {
		let st = EditorState.create({
			doc: lineCas1,
			selection: { anchor: lineCas1.indexOf('texte') },
		});
		const mockView = {
			get state() {
				return st;
			},
			dispatch(tr: { state: EditorState }) {
				st = tr.state;
			},
		};
		// @ts-expect-error Mock minimal view
		const handled = toggleBoldOnInkwellSpan(mockView, () => true);
		assert.equal(handled, true);
		assert.equal(
			st.doc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">texte</span> après.',
		);
	});

	await t.test('toggleBoldOnInkwellSpan: returns false when outside span or inactive', () => {
		let st = EditorState.create({
			doc: LINE,
			selection: { anchor: 2 }, // on "Avant"
		});
		const mockView = {
			get state() {
				return st;
			},
			dispatch(tr: { state: EditorState }) {
				st = tr.state;
			},
		};
		// @ts-expect-error Mock minimal view
		assert.equal(toggleBoldOnInkwellSpan(mockView, () => true), false);
		// @ts-expect-error Mock minimal view
		assert.equal(toggleBoldOnInkwellSpan(mockView, () => false), false);
	});

	await t.test('createEditGuard: double bold toggle preserves selection without manual repair', () => {
		const state0 = EditorState.create({
			doc: lineCas6,
			selection: { anchor: lineCas6.indexOf('texte'), head: lineCas6.indexOf('texte') + 5 },
			extensions: [createEditGuard({ isActive: () => true, isBoldSupported: () => true, onRefuse: () => {} })],
		});

		// 1st toggle: Obsidian attempts to wrap visible word in **
		const s0 = findSimpleSpansInLine(lineCas6, 0)[0]!;
		const tr1 = state0.update({
			changes: [
				{ from: s0.innerStart, insert: '**' },
				{ from: s0.innerEnd, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(tr1.docChanged, true);
		assert.equal(tr1.newDoc.toString(), 'Avant <span data-inkwell="1" style="color: #e03131;">texte</span> après.');
		// Selection is mapped cleanly onto the visible word "texte"
		const s1 = findSimpleSpansInLine(tr1.newDoc.toString(), 0)[0]!;
		assert.equal(tr1.newSelection.main.from, s1.innerStart);
		assert.equal(tr1.newSelection.main.to, s1.innerEnd);

		// 2nd toggle directly on tr1.state WITHOUT any manual selection repair
		const tr2 = tr1.state.update({
			changes: [
				{ from: s1.innerStart, insert: '**' },
				{ from: s1.innerEnd, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(tr2.docChanged, true);
		assert.equal(tr2.newDoc.toString(), 'Avant **<span data-inkwell="1" style="color: #e03131;">texte</span>** après.');
		const s2 = findSimpleSpansInLine(tr2.newDoc.toString(), 0)[0]!;
		assert.equal(tr2.newSelection.main.from, s2.innerStart);
		assert.equal(tr2.newSelection.main.to, s2.innerEnd);
	});

	await t.test('createEditGuard: rewrites partial bold on non-bold span to partitioned spans and preserves selection', () => {
		const state = EditorState.create({
			doc: LINE,
			selection: { anchor: INNER + 1, head: INNER + 3 },
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		// Obsidian attempts to insert ** around partial selection "ex"
		const tr = state.update({
			changes: [
				{ from: INNER + 1, insert: '**' },
				{ from: INNER + 3, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(tr.docChanged, true);
		assert.equal(
			tr.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">t</span>**<span data-inkwell="1" style="color: #e03131;">ex</span>**<span data-inkwell="1" style="color: #e03131;">te</span> après.',
		);
		const targetSpan = findSimpleSpansInLine(tr.newDoc.toString(), 0)[1]!;
		assert.equal(targetSpan.enclosedInBold, true);
		assert.equal(tr.newSelection.main.from, targetSpan.innerStart);
		assert.equal(tr.newSelection.main.to, targetSpan.innerEnd);
	});

	await t.test('createEditGuard: rewrites partial bold on Cas 6 to unbold target portion and preserves selection', () => {
		const s = findSimpleSpansInLine(lineCas6, 0)[0]!;
		const partStart = s.innerStart + 1;
		const partEnd = s.innerStart + 3;
		const state = EditorState.create({
			doc: lineCas6,
			selection: { anchor: partStart, head: partEnd },
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});
		const tr = state.update({
			changes: [
				{ from: partStart, insert: '**' },
				{ from: partEnd, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(tr.docChanged, true);
		assert.equal(
			tr.newDoc.toString(),
			'Avant **<span data-inkwell="1" style="color: #e03131;">t</span>**<span data-inkwell="1" style="color: #e03131;">ex</span>**<span data-inkwell="1" style="color: #e03131;">te</span>** après.',
		);
		const targetSpan = findSimpleSpansInLine(tr.newDoc.toString(), 0)[1]!;
		assert.equal(targetSpan.enclosedInBold ?? false, false);
		assert.equal(tr.newSelection.main.from, targetSpan.innerStart);
		assert.equal(tr.newSelection.main.to, targetSpan.innerEnd);
	});

	await t.test('createEditGuard: still refuses partial bold on Cas 1 historique (innerBold)', () => {
		let refusedReason = '';
		const sCas1 = findSimpleSpansInLine(lineCas1, 0)[0]!;
		const partStart = sCas1.innerStart + 3; // inside **texte**
		const partEnd = sCas1.innerStart + 5;
		const state = EditorState.create({
			doc: lineCas1,
			selection: { anchor: partStart, head: partEnd },
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
		const tr = state.update({
			changes: [
				{ from: partStart, insert: '**' },
				{ from: partEnd, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(tr.docChanged, false);
		assert.equal(tr.newDoc.toString(), lineCas1);
		assert.equal(refusedReason, 'partial-bold');
	});

	await t.test('createEditGuard: still refuses collapsed cursor inside span', () => {
		let refusedReason = '';
		const state = EditorState.create({
			doc: LINE,
			selection: { anchor: INNER + 2, head: INNER + 2 },
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
		const tr = state.update({
			changes: [{ from: INNER + 2, insert: '****' }],
			userEvent: 'input',
		});
		assert.equal(tr.docChanged, false);
		assert.equal(tr.newDoc.toString(), LINE);
		assert.equal(refusedReason, 'partial-bold');
	});

	await t.test('createEditGuard: lets partial bold pass untouched in Source Mode', () => {
		let refusedReason = '';
		const state = EditorState.create({
			doc: LINE,
			selection: { anchor: INNER + 1, head: INNER + 3 },
			extensions: [
				createEditGuard({
					isActive: () => false, // Source mode
					onRefuse: (r) => {
						refusedReason = r;
					},
				}),
			],
		});
		const tr = state.update({
			changes: [
				{ from: INNER + 1, insert: '**' },
				{ from: INNER + 3, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(tr.docChanged, true);
		assert.equal(refusedReason, '');
	});
});

test('effective separation: color-only vs bold combinations (when bold option is disabled)', async (t) => {
	const lineCas6 = 'Avant **<span data-inkwell="1" style="color: #e03131;">texte</span>** après.';
	const lineCas1 = 'Avant <span data-inkwell="1" style="color: #e03131;">**texte**</span> après.';
	const linePlain = 'Avant <span data-inkwell="1" style="color: #e03131;">texte</span> après.';

	await t.test('findSimpleSpansInLine: excludes bold spans when allowBold is false', () => {
		assert.equal(findSimpleSpansInLine(lineCas6, 0, false).length, 0);
		assert.equal(findSimpleSpansInLine(lineCas1, 0, false).length, 0);
		assert.equal(findSimpleSpansInLine('Cas: <span data-inkwell="1" style="color: red;">a **b** c</span>', 0, false).length, 0);
		assert.equal(findSimpleSpansInLine(linePlain, 0, false).length, 1);
	});

	await t.test('evaluateBoldToggle: returns null when isBoldSupported is false', () => {
		const state = EditorState.create({ doc: linePlain });
		const [s] = findSimpleSpansInLine(linePlain, 0, true);
		assert.ok(s);
		// Toggle bold on full span
		const cs = ChangeSet.of(
			[
				{ from: s.innerStart, insert: '**' },
				{ from: s.innerEnd, insert: '**' },
			],
			linePlain.length,
		);
		// With isBoldSupported = false -> returns null immediately
		assert.equal(evaluateBoldToggle(state, cs, false), null);
		// With isBoldSupported = true -> returns rewrite
		const res = evaluateBoldToggle(state, cs, true);
		assert.ok(res && res.type === 'rewrite');
	});

	await t.test('createEditGuard: when bold is disabled, leaves bold spans 100% to native Obsidian', () => {
		let refused = false;
		const state = EditorState.create({
			doc: lineCas6,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => false, // Sub-option disabled
					onRefuse: () => {
						refused = true;
					},
				}),
			],
		});

		// 1. Partial bold action is NOT refused, but left to native Obsidian
		const trBold = state.update({
			changes: [
				{ from: lineCas6.indexOf('texte') + 1, insert: '**' },
				{ from: lineCas6.indexOf('texte') + 3, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(trBold.docChanged, true);
		assert.equal(refused, false);

		// 2. Deleting inner text is NOT rewritten to clean-span, but behaves natively
		const [s] = findSimpleSpansInLine(lineCas6, 0, true);
		assert.ok(s);
		const trDel = state.update({
			changes: { from: s.innerStart, to: s.innerEnd, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(trDel.docChanged, true);
		// Raw tags and ** remain because clean-span is NOT active for bold spans when disabled
		assert.equal(
			trDel.newDoc.toString(),
			'Avant **<span data-inkwell="1" style="color: #e03131;"></span>** après.',
		);
	});

	await t.test('transition from color-only to bold: applying Cmd+B hands passage over to native behavior', () => {
		const state0 = EditorState.create({
			doc: linePlain,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => false, // Sub-option disabled
					onRefuse: () => {},
				}),
			],
		});

		// 1. Initial color span IS protected
		const [sPlain] = findSimpleSpansInLine(linePlain, 0, false);
		assert.ok(sPlain);
		// Deleting visible text triggers clean-span
		const trClean = state0.update({
			changes: { from: sPlain.innerStart, to: sPlain.innerEnd, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(trClean.newDoc.toString(), 'Avant  après.');

		// 2. User applies Cmd+B on visible text: native Obsidian wraps in **
		const trBold = state0.update({
			changes: [
				{ from: sPlain.innerStart, insert: '**' },
				{ from: sPlain.innerEnd, insert: '**' },
			],
			userEvent: 'input',
		});
		assert.equal(
			trBold.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">**texte**</span> après.',
		);

		// 3. Now the document contains bold markdown inside the span.
		// On the resulting state, the span is automatically excluded from tag navigation:
		const boldSpans = findSimpleSpansInLine(trBold.newDoc.toString(), 0, false);
		assert.equal(boldSpans.length, 0); // Excluded!

		// Subsequent edits on this span are not intercepted by the guard:
		const trNext = trBold.state.update({
			changes: { from: trBold.newDoc.toString().indexOf('texte'), to: trBold.newDoc.toString().indexOf('texte') + 5, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(
			trNext.newDoc.toString(),
			'Avant <span data-inkwell="1" style="color: #e03131;">****</span> après.',
		);
	});
});

test('inactive bold sync: reversible lifecycle and precise widget matching', async (t) => {
	const { cleanupSyncedBold, INKWELL_BOLD_SYNCED_ATTR } = await import('../src/editor/tag-navigation/inactive-bold-sync');

	await t.test('cleanupSyncedBold: cleans only elements tagged with data-inkwell-bold-synced', () => {
		// Create mock container
		const container = {
			querySelectorAll<T>(selector: string): T[] {
				if (selector.includes(INKWELL_BOLD_SYNCED_ATTR)) {
					return [syncedEl] as unknown as T[];
				}
				return [];
			},
		} as unknown as HTMLElement;

		let removedClass = false;
		let removedAttr = false;
		const syncedEl = {
			classList: {
				remove(c: string) {
					if (c === 'cm-strong') removedClass = true;
				},
			},
			removeAttribute(a: string) {
				if (a === INKWELL_BOLD_SYNCED_ATTR) removedAttr = true;
			},
		};

		cleanupSyncedBold(container);
		assert.equal(removedClass, true);
		assert.equal(removedAttr, true);
	});

	await t.test('precise span matching: excludes plain spans and third-party spans on mixed line', () => {
		const mixedLine = 'Un **<span data-inkwell="1" style="color: #e03131;">gras</span>** et un <span data-inkwell="1" style="color: #12b886;">normal</span> et un <span style="color: blue;">tiers</span>';
		const spans = findSimpleSpansInLine(mixedLine, 0, true);

		// Exactly 2 Inkwell spans detected (third-party span is excluded)
		assert.equal(spans.length, 2);

		const grasSpan = spans.find((s) => s.spanStart === mixedLine.indexOf('<span data-inkwell="1" style="color: #e03131;"'));
		assert.ok(grasSpan);
		assert.equal(grasSpan.enclosedInBold, true);

		const normalSpan = spans.find((s) => s.spanStart === mixedLine.indexOf('<span data-inkwell="1" style="color: #12b886;"'));
		assert.ok(normalSpan);
		assert.equal(normalSpan.enclosedInBold, undefined);
	});

	await t.test('InactiveBoldSyncPluginValue: lifecycle, scheduling and cancellation', async () => {
		const { InactiveBoldSyncPluginValue } = await import('../src/editor/tag-navigation/inactive-bold-sync');

		let cancelledId: number | null = null;
		const mockScheduler = {
			requestAnimationFrame: () => 123,
			cancelAnimationFrame: (id: number) => {
				cancelledId = id;
			},
		};

		const mockState = EditorState.create({ doc: 'hello' });
		const mockView = {
			state: mockState,
			contentDOM: {
				querySelectorAll: () => [],
			},
		} as unknown as EditorView;

		const plugin = new InactiveBoldSyncPluginValue(
			mockView,
			{
				isActive: () => true,
				isBoldSupported: () => true,
				onRefuse: () => {},
			},
			mockScheduler,
		);

		// Schedule was requested in constructor
		assert.equal(plugin.scheduled, true);
		assert.equal(plugin.rafId, 123);

		// When deactivated, RAF is cancelled and state reset
		plugin.schedule(false, false);
		assert.equal(plugin.scheduled, false);
		assert.equal(plugin.rafId, null);
		assert.equal(cancelledId, 123);

		// Destroy cleans up
		plugin.destroy();
		assert.equal(plugin.scheduled, false);
		assert.equal(plugin.rafId, null);
	});
});

test('legacy spans without data-inkwell="1": masking, partial selection, and editing', async (t) => {
	const legacyLine = 'Avant <span style="color: #1971c2">texte coloré</span> après.';

	await t.test('findFormattingSpansInDoc detects compatible legacy formatting span without data-inkwell', () => {
		const spans = findFormattingSpansInDoc(legacyLine, true);
		assert.equal(spans.length, 1);
		assert.equal(spans[0]?.parsed?.color, '#1971c2');
		assert.equal(spans[0]?.parsed?.isInkwell, false);
	});

	await t.test('strictly excludes inline code, code blocks, third-party attributes, and non-formatting styles', () => {
		const doc = [
			'```',
			legacyLine,
			'```',
			'`' + legacyLine + '`',
			'<span id="custom" style="color: #1971c2">exclu tierce</span>',
			'<span class="badge" style="color: #1971c2">exclu class</span>',
			'<span style="display: none; color: #1971c2">exclu display</span>',
			legacyLine,
		].join('\n');

		const spans = findFormattingSpansInDoc(doc, true);
		// Only the last valid line is accepted
		assert.equal(spans.length, 1);
		assert.ok(spans[0] && spans[0].spanStart > doc.lastIndexOf('\n'));
	});

	await t.test('hides tags and applies color mark on legacy span without data-inkwell', () => {
		const state = EditorState.create({ doc: legacyLine });
		const mockView = { state, viewport: { from: 0, to: legacyLine.length } };
		// @ts-expect-error Mock minimal view
		const deco = buildUnfoldedTagDecorations(mockView, true, true);
		assert.ok(deco);

		let replacedCount = 0;
		let foundColor: string | null = null;
		deco.between(0, legacyLine.length, (_from, _to, value) => {
			const spec = value.spec as { attributes?: Record<string, string> };
			if (spec.attributes && spec.attributes['style']) {
				foundColor = spec.attributes['style'];
			} else {
				replacedCount++;
			}
		});

		assert.equal(replacedCount, 2); // opening and closing tag hidden
		assert.ok(foundColor);
		assert.match(foundColor, /color:\s*#1971c2/);
	});

	await t.test('partial deletion inside -> outside and outside -> inside on legacy span without adding data-inkwell', () => {
		const state = EditorState.create({
			doc: legacyLine,
			extensions: [
				createEditGuard({
					isActive: () => true,
					isBoldSupported: () => true,
					onRefuse: () => {},
				}),
			],
		});

		// 1. Partial deletion inside -> outside (coloré après)
		const fromA = legacyLine.indexOf('coloré');
		const toA = legacyLine.indexOf('après') + 'après'.length;
		const tr1 = state.update({
			changes: { from: fromA, to: toA, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(tr1.docChanged, true);
		assert.equal(tr1.newDoc.toString(), 'Avant <span style="color: #1971c2">texte </span>.');
		assert.ok(!tr1.newDoc.toString().includes('data-inkwell'));

		// 2. Partial deletion outside -> inside (Avant texte)
		const fromB = legacyLine.indexOf('ant');
		const toB = legacyLine.indexOf('texte') + 'texte'.length;
		const tr2 = state.update({
			changes: { from: fromB, to: toB, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.equal(tr2.docChanged, true);
		assert.equal(tr2.newDoc.toString(), 'Av<span style="color: #1971c2"> coloré</span> après.');
		assert.ok(!tr2.newDoc.toString().includes('data-inkwell'));

		// 3. Typing inside
		const posIn = legacyLine.indexOf('coloré');
		const tr3 = state.update({
			changes: { from: posIn, to: posIn, insert: 'beau ' },
			userEvent: 'input',
		});
		assert.equal(tr3.docChanged, true);
		assert.equal(tr3.newDoc.toString(), 'Avant <span style="color: #1971c2">texte beau coloré</span> après.');
		assert.ok(!tr3.newDoc.toString().includes('data-inkwell'));
	});
});




