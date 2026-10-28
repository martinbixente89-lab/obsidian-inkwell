import test from 'node:test';
import assert from 'node:assert/strict';
import {
	transformLine,
	parseLine,
	buildSpan,
	serializeStyleAttr,
	OperationType,
} from '../src/format/color-spans';

test('Highlight Appearance: serializes and parses custom appearance (radius, thickness, position)', () => {
	const appearance = { radius: 6, thickness: 35, position: 10 };
	const style = serializeStyleAttr(null, 'rgba(255, 230, 0, 0.4)', null, null, {}, appearance);

	assert.ok(style?.includes('background-image: linear-gradient(to top, transparent 10%, rgba(255, 230, 0, 0.4) 10%, rgba(255, 230, 0, 0.4) 45%, transparent 45%)'));
	assert.ok(style?.includes('border-radius: 6px'));
	assert.ok(style?.includes('-webkit-box-decoration-break: clone'));
	assert.ok(style?.includes('box-decoration-break: clone'));

	const spanHtml = buildSpan('Custom Highlight', {
		isInkwell: true,
		color: null,
		highlight: 'rgba(255, 230, 0, 0.4)',
		highlightAppearance: appearance,
	});

	const line = `Prefix ${spanHtml} Suffix`;
	const parsed = parseLine(line);
	const targetSeg = parsed.find((s) => s.text === 'Custom Highlight');

	assert.ok(targetSeg);
	assert.equal(targetSeg?.isInkwell, true);
	assert.equal(targetSeg?.highlight, 'rgba(255, 230, 0, 0.4)');
	assert.equal(targetSeg?.highlightAppearance?.radius, 6);
	assert.equal(targetSeg?.highlightAppearance?.thickness, 35);
	assert.equal(targetSeg?.highlightAppearance?.position, 10);
});

test('Highlight Appearance: transformLine applies custom appearance on selection', () => {
	const initial = 'Hello world of highlights';
	const op: OperationType = {
		type: 'set-highlight',
		highlight: '#ffd43b',
		appearance: { radius: 4, thickness: 50, position: 0 },
	};

	// Select "world" (indices 6 to 11)
	const res = transformLine(initial, 6, 11, op);
	assert.equal(res.success, true);
	assert.ok(res.result?.text.includes('data-inkwell="1"'));
	assert.ok(res.result?.text.includes('background-image: linear-gradient'));
	assert.ok(res.result?.text.includes('border-radius: 4px'));
	assert.ok(res.result?.text.includes('>world</span>'));
});

test('Highlight Appearance: remove-highlight-appearance restores default background-color without removing highlight', () => {
	const styledLine =
		'Hello <span data-inkwell="1" style="color: #ff0000; background-image: linear-gradient(to top, transparent 0%, #ffd43b 0%, #ffd43b 30%, transparent 30%); border-radius: 4px; -webkit-box-decoration-break: clone; box-decoration-break: clone;">world</span> test';

	// Select "world" (indices 6 to 11)
	const op: OperationType = { type: 'remove-highlight-appearance' };
	const res = transformLine(styledLine, 6, 11, op);

	assert.equal(res.success, true);
	const resultText = res.result?.text ?? '';
	assert.ok(resultText.includes('background-color: #ffd43b;'));
	assert.ok(resultText.includes('color: #ff0000;'));
	assert.ok(!resultText.includes('background-image'));
	assert.ok(!resultText.includes('border-radius'));
	assert.ok(!resultText.includes('box-decoration-break'));
});

test('Highlight Appearance: full height with rounded corners uses background-color and border-radius', () => {
	const appearance = { radius: 8, thickness: 100, position: 0 };
	const style = serializeStyleAttr(null, '#ffd43b', null, null, {}, appearance);

	assert.ok(style?.includes('background-color: #ffd43b;'));
	assert.ok(style?.includes('border-radius: 8px;'));
	assert.ok(!style?.includes('background-image'));
});

test('Highlight Appearance: remove-highlight removes color and appearance completely', () => {
	const styledLine =
		'Hello <span data-inkwell="1" style="background-image: linear-gradient(to top, transparent 0%, #ffd43b 0%, #ffd43b 30%, transparent 30%); border-radius: 4px;">world</span> test';

	const op: OperationType = { type: 'remove-highlight' };
	const res = transformLine(styledLine, 6, 11, op);

	assert.equal(res.success, true);
	assert.equal(res.result?.text, 'Hello world test');
});
