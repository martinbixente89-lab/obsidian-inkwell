import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleFormat, FormatType } from '../src/format/markdown-formats';

// Simple seeded PRNG (Linear Congruential Generator)
function createPRNG(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

test('underline and markdown crossing regression tests (V1.0 hardening)', async (t) => {
	await t.test('Scenario 1: selection overlapping start delimiter * keeps * outside <u>', () => {
		const line = 'Un *grand passage* universel pour tester.';
		// Delimiter * is at [3, 4], "grand passag" is [4, 16]
		const res = toggleFormat(line, 3, 16, 'underline');
		assert.equal(res.success, true);
		assert.equal(res.line, 'Un *<u>grand passag</u>e* universel pour tester.');
		assert.ok(!/<u>.*\*.*<\/u>/.test(res.line), 'Markdown delimiter * must never be inside <u>');
	});

	await t.test('Scenario 2: selection crossing from inside italic to outside plain text partitions <u>', () => {
		const line = 'Un *grand passage* universel pour tester.';
		// from index of "grand" (4) to end of "universel" (28)
		const res = toggleFormat(line, 4, 28, 'underline');
		assert.equal(res.success, true);
		assert.equal(res.line, 'Un *<u>grand passage</u>*<u> universel</u> pour tester.');
		assert.ok(!/<u>[^<]*\*[^\n<]*<\/u>/.test(res.line), 'Markdown delimiter * must never be inside <u>');
	});

	await t.test('Scenario 3: selection covering full line partitions <u> across markdown delimiters', () => {
		const line = 'Un *grand passage* universel pour tester.';
		const res = toggleFormat(line, 0, line.length, 'underline');
		assert.equal(res.success, true);
		assert.equal(res.line, '<u>Un </u>*<u>grand passage</u>*<u> universel pour tester.</u>');
		assert.ok(!/<u>[^<]*\*[^\n<]*<\/u>/.test(res.line), 'Markdown delimiter * must never be inside <u>');
	});

	await t.test('Scenario 4: selection covering ONLY delimiter refuses cleanly without corruption', () => {
		const line = 'Un *grand passage* universel pour tester.';
		// Selecting only the '*' delimiter at [3, 4]
		const res = toggleFormat(line, 3, 4, 'underline');
		assert.equal(res.success, false);
		assert.equal(res.line, line);
	});

	await t.test('Scenario 5: seeded sequence test (seed 20261026) verifies invariants across 50 word operations', () => {
		const rng = createPRNG(20261026);
		const formats: FormatType[] = ['bold', 'italic', 'underline', 'strikethrough'];
		const targetWords = ['grand', 'passage', 'universel', 'tester'];

		let line = 'Un grand passage universel pour tester.';
		for (let step = 0; step < 50; step++) {
			const fmt = formats[Math.floor(rng() * formats.length)];
			const w = targetWords[Math.floor(rng() * targetWords.length)];
			if (!fmt || !w) continue;
			const from = line.indexOf(w);
			if (from === -1) continue;
			const to = from + w.length;

			const res = toggleFormat(line, from, to, fmt);
			if (!res.success) continue;
			line = res.line;

			// Invariant 1: no markdown markers inside <u>
			assert.ok(
				!/<u>[^\n<]*(\*\*|\*|~~)[^\n<]*<\/u>/.test(line),
				`Step ${step} (${fmt}) placed markdown delimiter inside <u>: "${line}"`,
			);

			// Invariant 2: no nested <u><u>
			assert.ok(
				!line.includes('<u><u>') && !line.includes('</u></u>'),
				`Step ${step} (${fmt}) created nested <u>: "${line}"`,
			);

			// Invariant 3: balanced <u> tags
			const uOpen = (line.match(/<u>/g) || []).length;
			const uClose = (line.match(/<\/u>/g) || []).length;
			assert.equal(
				uOpen,
				uClose,
				`Step ${step} (${fmt}) produced unbalanced <u> tags: "${line}"`,
			);
		}
	});
});
