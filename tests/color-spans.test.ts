import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	adoptCandidateSpan,
	embedOffsetToRaw,
	findLegacySpansInLines,
	fixInvertedMarkdownSpans,
	recolorLine,
	recolorLineWithDelimiters,
	splitSelectionAroundDelimiters,
	transformLine,
	transformLineWithDelimiters,
} from '../src/format/color-spans';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings/types';
import {
	COLOR_PALETTE,
	DEFAULT_HIGHLIGHT_COLOR,
	DEFAULT_TEXT_COLOR,
	getHighlightColorByValue,
	HIGHLIGHT_PALETTE,
	isValidHighlightColor,
} from '../src/utils/constants';

const RED = '#e03131';
const BLUE = '#1971c2';
const TURQUOISE = '#0ca678';
const HL_YELLOW = 'rgba(255, 212, 59, 0.35)';
const HL_GREEN = 'rgba(81, 207, 102, 0.35)';

const inkwellSpan = (text: string, color = BLUE, hl?: string) => {
	const styles: string[] = [];
	if (color) styles.push(`color: ${color}`);
	if (hl) styles.push(`background-color: ${hl}`);
	return `<span data-inkwell="1" style="${styles.join('; ')};">${text}</span>`;
};

const hlSpan = (text: string, hl = HL_YELLOW) =>
	`<span data-inkwell="1" style="background-color: ${hl};">${text}</span>`;

function removeFromWidgetSelection(
	line: string,
	visible: string,
	visibleFrom: number,
	visibleTo: number,
): string | null {
	const spanStart = line.indexOf('<span');
	const from = embedOffsetToRaw(line, spanStart, visible, visibleFrom, 'start');
	const to =
		visibleFrom === visibleTo
			? from
			: embedOffsetToRaw(line, spanStart, visible, visibleTo, 'end');
	assert.notEqual(from, null);
	assert.notEqual(to, null);
	return recolorLine(line, from ?? 0, to ?? 0, null)?.text ?? null;
}

describe('remove color: selection made inside an Inkwell Live Preview widget (regression)', () => {
	const line = `This line has ${inkwellSpan('blue words')} in the middle.`;

	it('removes color from the selected part only ("words")', () => {
		assert.equal(
			removeFromWidgetSelection(line, 'blue words', 5, 10),
			`This line has ${inkwellSpan('blue ')}words in the middle.`,
		);
	});

	it('removes color from a middle part ("ue wo")', () => {
		assert.equal(
			removeFromWidgetSelection(line, 'blue words', 2, 7),
			`This line has ${inkwellSpan('bl')}ue wo${inkwellSpan('rds')} in the middle.`,
		);
	});

	it('removes the whole passage when the whole rendered text is selected', () => {
		assert.equal(
			removeFromWidgetSelection(line, 'blue words', 0, 10),
			'This line has blue words in the middle.',
		);
	});

	it('removes the whole passage for a caret inside the widget', () => {
		assert.equal(
			removeFromWidgetSelection(line, 'blue words', 4, 4),
			'This line has blue words in the middle.',
		);
	});

	it('works on the line from the reported bug with data-inkwell="1"', () => {
		const reported = `C${inkwellSpan('eci est un test de coloration.', RED)}`;
		const visible = 'eci est un test de coloration.';
		assert.equal(
			removeFromWidgetSelection(reported, visible, 8, 15),
			`C${inkwellSpan('eci est ', RED)}un test${inkwellSpan(' de coloration.', RED)}`,
		);
	});
});

describe('unmarked span protection (V0.3)', () => {
	it('refuses to modify an unmarked third-party span without adoption', () => {
		const unmarked = 'C<span class="external" style="color: #e03131">eci est un test</span>';
		const res = transformLine(unmarked, 2, 8, { type: 'set-color', color: BLUE });
		assert.equal(res.success, false);
		assert.equal(res.errorReason, 'unmarked_span');
	});

	it('refuses to remove style from an unmarked third-party span under caret', () => {
		const unmarked = 'Voici <span class="external" style="color: #e03131">texte</span>';
		const res = transformLine(unmarked, 10, 10, { type: 'remove-color' });
		assert.equal(res.success, false);
		assert.equal(res.errorReason, 'unmarked_span');
	});

	it('refuses to clear styles from an unmarked third-party span', () => {
		const unmarked = 'Voici <span class="external" style="color: #e03131">texte</span>';
		const res = transformLine(unmarked, 8, 11, { type: 'clear-all' });
		assert.equal(res.success, false);
		assert.equal(res.errorReason, 'unmarked_span');
	});

	it('allows modifying compatible legacy formatting span without data-inkwell', () => {
		const legacy = 'Voici <span style="color: #e03131">texte</span>';
		const from = legacy.indexOf('texte');
		const to = from + 'texte'.length;
		const res = transformLine(legacy, from, to, { type: 'set-color', color: BLUE });
		assert.equal(res.success, true);
		assert.equal(res.result?.text, 'Voici <span data-inkwell="1" style="color: #1971c2;">texte</span>');
	});
});

describe('delimiter-aware coloring & highlighting: keeping Markdown markers outside spans', () => {
	it('splits selection around bold delimiters when whole bold block is selected', () => {
		const delimiters = [
			{ from: 0, to: 2 },
			{ from: 7, to: 9 },
		];
		const ranges = splitSelectionAroundDelimiters(0, 9, delimiters);
		assert.deepEqual(ranges, [{ from: 2, to: 7 }]);
	});

	it('recolors whole bold block keeping asterisks outside', () => {
		const line = '**texte en gras**';
		const delimiters = [
			{ from: 0, to: 2 },
			{ from: 15, to: 17 },
		];
		const res = recolorLineWithDelimiters(line, 0, 17, delimiters, RED);
		assert.equal(res?.text, '<span data-inkwell="1" style="color: #e03131; font-weight: bold;">texte en gras</span>');
	});

	it('recolors partial text inside bold block with turquoise', () => {
		const line = '**Un grand texte**';
		const delimiters = [
			{ from: 0, to: 2 },
			{ from: 16, to: 18 },
		];
		const res = recolorLineWithDelimiters(line, 5, 10, delimiters, TURQUOISE);
		assert.equal(res?.text, `**Un ${inkwellSpan('grand', TURQUOISE)} texte**`);
	});

	it('splits selection crossing a formatting boundary', () => {
		const line = 'debut **gras** fin';
		const delimiters = [
			{ from: 6, to: 8 },
			{ from: 12, to: 14 },
		];
		const res = recolorLineWithDelimiters(line, 2, 10, delimiters, RED);
		assert.equal(res?.text, `de${inkwellSpan('but ', RED)}**${inkwellSpan('gr', RED)}as** fin`);
	});

	it('highlights whole bold block keeping asterisks outside', () => {
		const line = '**texte en gras**';
		const delimiters = [
			{ from: 0, to: 2 },
			{ from: 15, to: 17 },
		];
		const res = transformLineWithDelimiters(line, 0, 17, delimiters, {
			type: 'set-highlight',
			highlight: HL_YELLOW,
		});
		assert.equal(
			res.result?.text,
			'<span data-inkwell="1" style="background-color: rgba(255, 212, 59, 0.35); font-weight: bold;">texte en gras</span>',
		);
	});
});

describe('highlight and color combination (V0.3)', () => {
	it('adds highlight to an already colored span without losing text color', () => {
		const line = `Un ${inkwellSpan('mot bleu', BLUE)} ici`;
		const from = line.indexOf('mot');
		const to = from + 'mot bleu'.length;
		const res = transformLine(line, from, to, {
			type: 'set-highlight',
			highlight: HL_YELLOW,
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			`Un <span data-inkwell="1" style="color: ${BLUE}; background-color: ${HL_YELLOW};">mot bleu</span> ici`,
		);
	});

	it('adds text color to an already highlighted span without losing highlight', () => {
		const line = `Un ${hlSpan('mot surligne', HL_YELLOW)} ici`;
		const from = line.indexOf('mot');
		const to = from + 'mot surligne'.length;
		const res = transformLine(line, from, to, {
			type: 'set-color',
			color: RED,
		});
		assert.equal(res.success, true);
		assert.equal(
			res.result?.text,
			`Un <span data-inkwell="1" style="color: ${RED}; background-color: ${HL_YELLOW};">mot surligne</span> ici`,
		);
	});

	it('replaces highlight without altering text color', () => {
		const line = `Un <span data-inkwell="1" style="color: ${BLUE}; background-color: ${HL_YELLOW};">texte</span>`;
		const from = line.indexOf('texte');
		const to = from + 'texte'.length;
		const res = transformLine(line, from, to, {
			type: 'set-highlight',
			highlight: HL_GREEN,
		});
		assert.equal(
			res.result?.text,
			`Un <span data-inkwell="1" style="color: ${BLUE}; background-color: ${HL_GREEN};">texte</span>`,
		);
	});

	it('removes color but retains highlight', () => {
		const line = `Un <span data-inkwell="1" style="color: ${BLUE}; background-color: ${HL_YELLOW};">texte</span>`;
		const from = line.indexOf('texte');
		const to = from + 'texte'.length;
		const res = transformLine(line, from, to, { type: 'remove-color' });
		assert.equal(
			res.result?.text,
			`Un <span data-inkwell="1" style="background-color: ${HL_YELLOW};">texte</span>`,
		);
	});

	it('removes highlight but retains text color', () => {
		const line = `Un <span data-inkwell="1" style="color: ${BLUE}; background-color: ${HL_YELLOW};">texte</span>`;
		const from = line.indexOf('texte');
		const to = from + 'texte'.length;
		const res = transformLine(line, from, to, { type: 'remove-highlight' });
		assert.equal(res.result?.text, `Un ${inkwellSpan('texte', BLUE)}`);
	});

	it('clears all Inkwell formatting, stripping span completely when no other attributes exist', () => {
		const line = `Un <span data-inkwell="1" style="color: ${BLUE}; background-color: ${HL_YELLOW};">texte</span>`;
		const from = line.indexOf('texte');
		const to = from + 'texte'.length;
		const res = transformLine(line, from, to, { type: 'clear-all' });
		assert.equal(res.result?.text, 'Un texte');
	});

	it('clears all Inkwell formatting, preserving other attributes and custom styles', () => {
		const line = `Un <span class="badge" data-inkwell="1" style="color: ${BLUE}; opacity: 0.5;">texte</span>`;
		const from = line.indexOf('texte');
		const to = from + 'texte'.length;
		const res = transformLine(line, from, to, { type: 'clear-all' });
		assert.equal(
			res.result?.text,
			'Un <span class="badge" style="opacity: 0.5;">texte</span>',
		);
	});
});

describe('legacy adoption and code exclusions (V0.3)', () => {
	it('detects candidate spans on plain lines', () => {
		const lines = [
			'Ligne 1 avec <span style="color: #e03131">rouge</span>',
			'Ligne 2 normale',
			'Ligne 3 avec <span style="background-color: rgba(255, 212, 59, 0.35)">surligne</span>',
		];
		const candidates = findLegacySpansInLines(lines);
		assert.equal(candidates.length, 2);
		assert.equal(candidates[0]?.innerText, 'rouge');
		assert.equal(candidates[1]?.innerText, 'surligne');
	});

	it('skips spans inside inline code backticks', () => {
		const lines = [
			'Voici du code `<span style="color: #e03131">exemple</span>` a ignorer.',
			'Et ici <span style="color: #e03131">a adopter</span>.',
		];
		const candidates = findLegacySpansInLines(lines);
		assert.equal(candidates.length, 1);
		assert.equal(candidates[0]?.innerText, 'a adopter');
	});

	it('skips spans inside fenced code blocks', () => {
		const lines = [
			'Avant le code',
			'```html',
			'<span style="color: #e03131">ne pas toucher</span>',
			'```',
			'Apres le code <span style="color: #1971c2">adopter</span>',
		];
		const candidates = findLegacySpansInLines(lines);
		assert.equal(candidates.length, 1);
		assert.equal(candidates[0]?.innerText, 'adopter');
	});

	it('adopts candidate span adding data-inkwell="1"', () => {
		const raw = '<span style="color: #e03131">texte</span>';
		const adopted = adoptCandidateSpan(raw);
		assert.equal(adopted, '<span data-inkwell="1" style="color: #e03131;">texte</span>');
	});
});

describe('legacy inverted formatting fixer', () => {
	it('fixes inverted bold span', () => {
		const legacy = '<span style="color: #e03131">**texte en gras**</span>';
		assert.equal(
			fixInvertedMarkdownSpans(legacy),
			'**<span style="color: #e03131">texte en gras</span>**',
		);
	});

	it('fixes inverted italic span', () => {
		const legacy = '<span style="color: #1971c2">*texte en italique*</span>';
		assert.equal(
			fixInvertedMarkdownSpans(legacy),
			'*<span style="color: #1971c2">texte en italique</span>*',
		);
	});

	it('returns null when there is nothing to fix', () => {
		assert.equal(fixInvertedMarkdownSpans('**<span style="color: red">deja propre</span>**'), null);
		assert.equal(fixInvertedMarkdownSpans('texte normal sans balise'), null);
	});
});

describe('palette and settings validation (V0.3.0)', () => {
	it('contains 8 text colors and 5 highlight colors', () => {
		assert.equal(COLOR_PALETTE.length, 8);
		assert.equal(HIGHLIGHT_PALETTE.length, 5);

		const hlIds = HIGHLIGHT_PALETTE.map((h) => h.id);
		assert.deepEqual(hlIds, ['yellow', 'green', 'blue', 'pink', 'orange']);
	});

	it('validates highlight colors', () => {
		assert.equal(isValidHighlightColor('rgba(255, 212, 59, 0.35)'), true);
		assert.equal(isValidHighlightColor('rgba(255,212,59,0.35)'), true);
		assert.equal(isValidHighlightColor('rgba(0,0,0,1)'), false);
	});

	it('finds highlight color info by value', () => {
		const info = getHighlightColorByValue('rgba(255, 212, 59, 0.35)');
		assert.equal(info?.name, 'Jaune');
	});

	it('preserves V0.2 defaultColor when updating to V0.3', () => {
		const v02Data = { defaultColor: '#1971c2' };
		const sanitized = sanitizeSettings(v02Data);
		assert.equal(sanitized.defaultColor, '#1971c2'); // Preserved!
		assert.equal(sanitized.defaultHighlightColor, DEFAULT_HIGHLIGHT_COLOR); // Filled with default!
	});

	it('falls back to defaults when corrupted', () => {
		const sanitized = sanitizeSettings({
			defaultColor: 'bad',
			defaultHighlightColor: 'bad',
		});
		assert.equal(sanitized.defaultColor, DEFAULT_TEXT_COLOR);
		assert.equal(sanitized.defaultHighlightColor, DEFAULT_HIGHLIGHT_COLOR);
	});

	it('retains DEFAULT_SETTINGS intact on reset', () => {
		assert.equal(DEFAULT_SETTINGS.defaultColor, '#e03131');
		assert.equal(DEFAULT_SETTINGS.defaultHighlightColor, 'rgba(255, 212, 59, 0.35)');
	});
});
