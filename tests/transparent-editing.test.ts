import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { findFormattingSpansInDoc } from '../src/editor/tag-navigation/simple-spans';
import { createEditGuard } from '../src/editor/tag-navigation/extension';

describe('Transparent Editing Engine: no keystroke drops, safe tag preservation', () => {
	const refusals: string[] = [];
	const options = {
		isActive: () => true,
		isLivePreview: () => false,
		isBoldSupported: () => true,
		onRefuse: (r: string) => refusals.push(r),
	};

	function createEditor(initialDoc: string, cursorOffset = 0) {
		refusals.length = 0;
		return EditorState.create({
			doc: initialDoc,
			selection: EditorSelection.cursor(cursorOffset),
			extensions: [createEditGuard(options)],
		});
	}

	it('1. Backspace at visual start of span deletes preceding character in plain text', () => {
		// "Hello <span ...>world</span>"
		// Visually, cursor is before "world" (at innerStart)
		const doc = 'Hello <span style="color: red">world</span> there';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc, s.innerStart);

		// Default CodeMirror backspace deletes [s.innerStart - 1, s.innerStart)
		const tr = st.update({
			changes: { from: s.innerStart - 1, to: s.innerStart, insert: '' },
			userEvent: 'delete',
		});

		assert.ok(tr.docChanged, 'Transaction must not be blocked');
		assert.equal(refusals.length, 0, 'No refusal notice must be shown');
		// The space before the span must be deleted, span must stay intact!
		assert.equal(tr.newDoc.toString(), 'Hello<span style="color: red">world</span> there');
	});

	it('2. Backspace at pos 0 on span at document start does nothing safely without corrupting tag', () => {
		const doc = '<span style="color: red">world</span> there';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc, s.innerStart);

		const tr = st.update({
			changes: { from: s.innerStart - 1, to: s.innerStart, insert: '' },
			userEvent: 'delete',
		});

		// Pos 0 has no preceding character: transaction must safely produce no change or keep doc intact
		assert.equal(refusals.length, 0);
		assert.equal(tr.newDoc.toString(), doc);
	});

	it('3. Backspace at boundary between two adjacent spans deletes last character of first span', () => {
		const doc = 'Avant <span style="color: red">un</span><span style="color: blue">deux</span> après';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 2);
		const s1 = spans[0]!;
		assert.ok(s1);
		const s2 = spans[1]!;
		const st = createEditor(doc, s2.innerStart);

		// Backspace before "deux" tries to delete char before s2.innerStart
		const tr = st.update({
			changes: { from: s2.innerStart - 1, to: s2.innerStart, insert: '' },
			userEvent: 'delete',
		});

		assert.ok(tr.docChanged);
		assert.equal(refusals.length, 0);
		// 'n' of "un" should be deleted, leaving "u"
		assert.equal(tr.newDoc.toString(), 'Avant <span style="color: red">u</span><span style="color: blue">deux</span> après');
	});

	it('4. Delete (Suppr) at visual end of span deletes following character in plain text', () => {
		const doc = 'Hello <span style="color: red">world</span> there';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc, s.innerEnd);

		// Default CodeMirror delete forward deletes [s.innerEnd, s.innerEnd + 1)
		const tr = st.update({
			changes: { from: s.innerEnd, to: s.innerEnd + 1, insert: '' },
			userEvent: 'delete',
		});

		assert.ok(tr.docChanged);
		assert.equal(refusals.length, 0);
		// The space after the span must be deleted!
		assert.equal(tr.newDoc.toString(), 'Hello <span style="color: red">world</span>there');
	});

	it('5. Delete (Suppr) at end of document does nothing safely without corrupting tag', () => {
		const doc = 'Hello <span style="color: red">world</span>';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc, s.innerEnd);

		const tr = st.update({
			changes: { from: s.innerEnd, to: s.innerEnd + 1, insert: '' },
			userEvent: 'delete',
		});

		assert.equal(refusals.length, 0);
		assert.equal(tr.newDoc.toString(), doc);
	});

	it('6. Delete (Suppr) between two adjacent spans deletes first character of second span', () => {
		const doc = 'Avant <span style="color: red">un</span><span style="color: blue">deux</span> après';
		const spans = findFormattingSpansInDoc(doc);
		const s1 = spans[0]!;
		const st = createEditor(doc, s1.innerEnd);

		// Suppr after "un" tries to delete char at s1.innerEnd
		const tr = st.update({
			changes: { from: s1.innerEnd, to: s1.innerEnd + 1, insert: '' },
			userEvent: 'delete',
		});

		assert.ok(tr.docChanged);
		assert.equal(refusals.length, 0);
		// 'd' of "deux" should be deleted, leaving "eux"
		assert.equal(tr.newDoc.toString(), 'Avant <span style="color: red">un</span><span style="color: blue">eux</span> après');
	});

	it('7. Deleting entire inner content removes tags completely (no orphaned tags)', () => {
		const doc = 'Hello <span style="color: red">world</span> there';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc);

		const tr = st.update({
			changes: { from: s.innerStart, to: s.innerEnd, insert: '' },
			userEvent: 'delete',
		});

		assert.ok(tr.docChanged);
		assert.equal(tr.newDoc.toString(), 'Hello  there');
	});

	it('8. Replacing entire inner content keeps formatting tags', () => {
		const doc = 'Hello <span style="color: red">world</span> there';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc);

		const tr = st.update({
			changes: { from: s.innerStart, to: s.innerEnd, insert: 'monde' },
			userEvent: 'input',
		});

		assert.ok(tr.docChanged);
		assert.equal(tr.newDoc.toString(), 'Hello <span style="color: red">monde</span> there');
	});

	it('9. Hitting Enter inside a span splits it cleanly across two lines', () => {
		const doc = 'Hello <span style="color: red">deux mots</span> there';
		const s = findFormattingSpansInDoc(doc)[0]!;
		// Split between "deux" and " mots"
		const splitPos = s.innerStart + 4;
		const st = createEditor(doc, splitPos);

		const tr = st.update({
			changes: { from: splitPos, insert: '\n' },
			userEvent: 'input',
		});

		assert.ok(tr.docChanged);
		assert.equal(refusals.length, 0);
		assert.equal(
			tr.newDoc.toString(),
			'Hello <span style="color: red">deux</span>\n<span style="color: red"> mots</span> there',
		);
		// Both lines must be valid spans!
		const newSpans = findFormattingSpansInDoc(tr.newDoc.toString());
		assert.equal(newSpans.length, 2);
	});

	it('10. Typing <, >, & inside a span converts to safe HTML entities without double-encoding and without touching outside text', () => {
		const doc = 'Calcul: <span style="color: blue">x  y</span> fin';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const insertPos = s.innerStart + 2;
		const st = createEditor(doc, insertPos);

		// Inside span: typing '<' is encoded as '&lt;'
		const tr1 = st.update({
			changes: { from: insertPos, insert: '<' },
			userEvent: 'input',
		});
		assert.ok(tr1.docChanged);
		assert.equal(refusals.length, 0);
		assert.equal(tr1.newDoc.toString(), 'Calcul: <span style="color: blue">x &lt; y</span> fin');

		// Typing or pasting literal '&lt;' in plain text inside span encodes '&' to '&amp;' so on disk it is '&amp;lt;', displaying literal '&lt;' on screen
		const st2 = createEditor(tr1.newDoc.toString(), insertPos + 4);
		const tr2 = st2.update({
			changes: { from: insertPos + 4, insert: ' &lt;' },
			userEvent: 'input',
		});
		assert.ok(tr2.docChanged);
		assert.equal(tr2.newDoc.toString(), 'Calcul: <span style="color: blue">x &lt; &amp;lt; y</span> fin');

		// Single-step Backspace on entity: cursor right after '&lt;' in first entity deletes '&lt;' (4 chars) in 1 backspace
		const st3 = createEditor(tr1.newDoc.toString(), insertPos + 4);
		const trBksp = st3.update({
			changes: { from: insertPos + 3, to: insertPos + 4, insert: '' },
			userEvent: 'delete.backward',
		});
		assert.ok(trBksp.docChanged);
		assert.equal(trBksp.newDoc.toString(), 'Calcul: <span style="color: blue">x  y</span> fin');

		// Outside span: typing '<' is NOT converted to entity (remains literal '<')
		const stOutside = createEditor(doc, 0);
		const trOutside = stOutside.update({
			changes: { from: 0, insert: 'A < B : ' },
			userEvent: 'input',
		});
		assert.ok(trOutside.docChanged);
		assert.ok(trOutside.newDoc.toString().startsWith('A < B : Calcul:'));
	});

	it('11. Accents and special characters are preserved', () => {
		const doc = 'Texte: <span style="color: green">mot</span> fin';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc, s.innerEnd);

		const tr = st.update({
			changes: { from: s.innerEnd, insert: ' à côté de l’été & ça' },
			userEvent: 'input',
		});

		assert.ok(tr.docChanged);
		assert.equal(refusals.length, 0);
		// & inside span is encoded to &amp; to avoid HTML parsing issues, accents are preserved
		assert.equal(
			tr.newDoc.toString(),
			'Texte: <span style="color: green">mot à côté de l’été &amp; ça</span> fin',
		);
	});

	it('12. Code blocks and inline code are never touched or masked', () => {
		const doc = 'Inline `code <span style="color: red">test</span>` and block:\n```html\n<span style="color: blue">code</span>\n```';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 0, 'Spans in code blocks/inline code must be completely ignored');
	});

	it('14. Nested spans (<u> enclosing <span>) protect both opening and closing tags at boundaries', () => {
		const doc = 'Avant <u><span style="color: red">mot</span></u> après';
		const spans = findFormattingSpansInDoc(doc);
		const s = spans[0]!;
		assert.ok(s.enclosedInUnderline);
		const st = createEditor(doc, s.innerStart);

		// Backspace at innerStart
		const trBksp = st.update({
			changes: { from: s.innerStart - 1, to: s.innerStart, insert: '' },
			userEvent: 'delete',
		});
		assert.ok(trBksp.docChanged);
		// Space before <u> is deleted, <u> and <span> both stay intact!
		assert.equal(trBksp.newDoc.toString(), 'Avant<u><span style="color: red">mot</span></u> après');

		// Delete at innerEnd
		const trDel = st.update({
			changes: { from: s.innerEnd, to: s.innerEnd + 1, insert: '' },
			userEvent: 'delete',
		});
		assert.ok(trDel.docChanged);
		// Space after </u> is deleted, <u> and <span> both stay intact!
		assert.equal(trDel.newDoc.toString(), 'Avant <u><span style="color: red">mot</span></u>après');

		// Clean entire nested word
		const trClean = st.update({
			changes: { from: s.innerStart, to: s.innerEnd, insert: '' },
			userEvent: 'delete',
		});
		assert.ok(trClean.docChanged);
		assert.equal(trClean.newDoc.toString(), 'Avant  après');
	});

	it('15. Multi-line selection across lines and spans cleans and bridges correctly', () => {
		const doc = 'Ligne 1 <span style="color: red">rouge</span> fin1\nLigne 2 <span style="color: blue">bleu</span> fin2';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 2);
		const s1 = spans[0]!;
		const s2 = spans[1]!;
		const st = createEditor(doc);

		// Select from middle of "rouge" (innerStart + 3) to middle of "bleu" (innerStart + 2)
		const fromA = s1.innerStart + 3;
		const toA = s2.innerStart + 2;

		const tr = st.update({
			changes: { from: fromA, to: toA, insert: '' },
			userEvent: 'delete',
		});

		assert.ok(tr.docChanged);
		assert.equal(refusals.length, 0);
		// First span keeps "rou", second span keeps "eu", tags remain valid!
		assert.equal(
			tr.newDoc.toString(),
			'Ligne 1 <span style="color: red">rou</span><span style="color: blue">eu</span> fin2',
		);
	});

	it('16. Undo and Redo restore original state with 100% precision', () => {
		const doc = 'Hello <span style="color: red">world</span> there';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc, s.innerStart);

		// Boundary backspace
		const tr = st.update({
			changes: { from: s.innerStart - 1, to: s.innerStart, insert: '' },
			userEvent: 'delete',
		});
		assert.equal(tr.newDoc.toString(), 'Hello<span style="color: red">world</span> there');

		// Invert transaction (simulate Undo)
		const undoTr = tr.state.update({
			changes: tr.changes.invert(tr.startState.doc),
			userEvent: 'undo',
		});
		assert.equal(undoTr.newDoc.toString(), doc);

		// Invert again (simulate Redo)
		const redoTr = undoTr.state.update({
			changes: undoTr.changes.invert(undoTr.startState.doc),
			userEvent: 'redo',
		});
		assert.equal(redoTr.newDoc.toString(), 'Hello<span style="color: red">world</span> there');
	});

	it('17. Pasting text into a styled span preserves surrounding tags and styles', () => {
		const doc = 'Texte <span style="color: red">original</span> fin';
		const s = findFormattingSpansInDoc(doc)[0]!;
		const st = createEditor(doc);

		const tr = st.update({
			changes: { from: s.innerStart, to: s.innerEnd, insert: 'collé depuis le presse-papier' },
			userEvent: 'input.paste',
		});

		assert.ok(tr.docChanged);
		assert.equal(
			tr.newDoc.toString(),
			'Texte <span style="color: red">collé depuis le presse-papier</span> fin',
		);
	});
});
