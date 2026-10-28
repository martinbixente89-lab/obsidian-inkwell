import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { findFormattingSpansInDoc } from '../src/editor/tag-navigation/simple-spans';
import { buildSplitTagDecorations, buildUnfoldedTagDecorations } from '../src/editor/tag-navigation/unfolded-decorations';

test('V1.4.1 Corrective: HTML Tag Hiding and Presentation Preservation', async (t) => {
	await t.test('1. Spans without data-inkwell are detected and hidden (legacy formatting spans)', () => {
		const doc = 'Un passage avec <span style="color: #1971c2">texte en bleu</span> ordinaire.';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 1);
		const s = spans[0]!;
		assert.equal(doc.slice(s.innerStart, s.innerEnd), 'texte en bleu');
		assert.equal(s.parsed?.color, '#1971c2');

		const state = EditorState.create({ doc });
		const mockView = {
			state,
			viewport: { from: 0, to: doc.length },
		};
		// @ts-expect-error mock minimal view
		const split = buildSplitTagDecorations(mockView, true, true);
		assert.ok(split.replaceSet.size >= 2); // open and close tags hidden
		assert.ok(split.markSet.size >= 1); // color style applied

		// @ts-expect-error mock minimal view
		const unified = buildUnfoldedTagDecorations(mockView, true, true);
		let styleFound: string | null = null;
		unified.between(0, doc.length, (from, to, val) => {
			const spec = val.spec as { attributes?: Record<string, string> };
			if (spec.attributes?.['style']) styleFound = spec.attributes['style'];
		});
		assert.ok(styleFound);
		assert.match(styleFound, /color:\s*#1971c2/);
	});

	await t.test('2. Nested spans (outer and inner) are both detected and styled', () => {
		const doc = 'Texte <span style="color: red"><span style="font-size: 20pt">nested text</span></span> fin.';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 2);

		const outerSpan = spans[0]!;
		assert.equal(outerSpan.parsed?.color, 'red');

		const innerSpan = spans[1]!;
		assert.equal(doc.slice(innerSpan.innerStart, innerSpan.innerEnd), 'nested text');
		assert.equal(innerSpan.parsed?.fontSize, '20pt');

		const state = EditorState.create({ doc });
		const mockView = {
			state,
			viewport: { from: 0, to: doc.length },
		};
		// @ts-expect-error mock minimal view
		const split = buildSplitTagDecorations(mockView, true, true);
		// Replace set contains 4 disjoint tag boundaries: outer-open, inner-open, inner-close, outer-close
		assert.equal(split.replaceSet.size, 4);
		// Mark set contains 2 nested marks: outer color, inner size
		assert.equal(split.markSet.size, 2);
	});

	await t.test('3. Multi-line spans are detected and decorated across newlines', () => {
		const doc = 'Début <span style="color: green">\nligne 1\nligne 2\n</span> fin.';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 1);
		const s = spans[0]!;
		assert.equal(doc.slice(s.innerStart, s.innerEnd), '\nligne 1\nligne 2\n');
		assert.equal(s.parsed?.color, 'green');

		const state = EditorState.create({ doc });
		const mockView = {
			state,
			viewport: { from: 0, to: doc.length },
		};
		// @ts-expect-error mock minimal view
		const split = buildSplitTagDecorations(mockView, true, true);
		assert.equal(split.replaceSet.size, 2);
		assert.equal(split.markSet.size, 1);
	});

	await t.test('4. Code blocks and inline code are strictly preserved (never hidden)', () => {
		const doc = 'Texte avant\n```html\n<span style="color: red">code block</span>\n```\nEt inline `<span style="color: red">inline</span>` après.';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 0); // No spans matched inside code

		const state = EditorState.create({ doc });
		const mockView = {
			state,
			viewport: { from: 0, to: doc.length },
		};
		// @ts-expect-error mock minimal view
		const split = buildSplitTagDecorations(mockView, true, true);
		assert.equal(split.replaceSet.size, 0);
		assert.equal(split.markSet.size, 0);
	});

	await t.test('5. Non-formatting HTML tags (div, table, script, or span with id/class) remain visible', () => {
		const doc = '<div class="box">Contenu</div> et <span id="anchor" class="custom">texte</span> et <table><tr><td>Cell</td></tr></table>';
		const spans = findFormattingSpansInDoc(doc);
		assert.equal(spans.length, 0); // Strictly not hidden

		const state = EditorState.create({ doc });
		const mockView = {
			state,
			viewport: { from: 0, to: doc.length },
		};
		// @ts-expect-error mock minimal view
		const split = buildSplitTagDecorations(mockView, true, true);
		assert.equal(split.replaceSet.size, 0);
		assert.equal(split.markSet.size, 0);
	});

	await t.test('6. In Source Mode vs Live Preview: Source Mode decorates entire viewport', () => {
		const doc = 'Line 1: <span style="color: red">Un</span>\nLine 2: <span style="color: blue">Deux</span>\nLine 3: <span style="color: green">Trois</span>\n';
		const state = EditorState.create({ doc, selection: { anchor: 0 } });
		// Source mode view (isLivePreview check returns false)
		const sourceView = {
			state,
			viewport: { from: 0, to: doc.length },
		};
		// @ts-expect-error mock view
		const sourceSplit = buildSplitTagDecorations(sourceView, true, true, () => false);
		// All 3 spans across the document are decorated in Source Mode!
		assert.equal(sourceSplit.replaceSet.size, 6);
		assert.equal(sourceSplit.markSet.size, 3);

		// Live Preview mode view: now that Obsidian's embed widget is filtered out,
		// Live Preview decorates all visible spans in viewport uniformly so that text remains real and selectable.
		// @ts-expect-error mock view
		const lpSplit = buildSplitTagDecorations(sourceView, true, true, () => true);
		assert.equal(lpSplit.replaceSet.size, 6);
		assert.equal(lpSplit.markSet.size, 3);
	});
});
