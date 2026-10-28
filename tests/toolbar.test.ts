import test from 'node:test';
import assert from 'node:assert/strict';
import {
	calculatePopoverPosition,
	calculateToolbarPosition,
	Rect,
} from '../src/ui/toolbar-positioning';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../src/settings/types';
import { parseLine } from '../src/format/color-spans';

test('toolbar positioning logic (V0.4.0)', async (t) => {
	const boundary: Rect = {
		top: 10,
		bottom: 800,
		left: 20,
		right: 900,
		width: 880,
		height: 790,
	};

	await t.test('places toolbar above selection when there is sufficient vertical space', () => {
		const sel: Rect = {
			top: 200,
			bottom: 220,
			left: 300,
			right: 400,
			width: 100,
			height: 20,
		};
		const toolbarWidth = 180;
		const toolbarHeight = 36;
		const offset = 8;

		const pos = calculateToolbarPosition(sel, toolbarWidth, toolbarHeight, boundary, offset);

		assert.equal(pos.placement, 'top');
		assert.equal(pos.top, sel.top - toolbarHeight - offset); // 200 - 36 - 8 = 156
		// Center: 300 + 50 = 350. Left: 350 - 90 = 260
		assert.equal(pos.left, 260);
	});

	await t.test('flips toolbar below selection when there is insufficient space above', () => {
		const sel: Rect = {
			top: 25, // only 15px above boundary.top (10)
			bottom: 45,
			left: 300,
			right: 400,
			width: 100,
			height: 20,
		};
		const toolbarWidth = 180;
		const toolbarHeight = 36;
		const offset = 8;

		const pos = calculateToolbarPosition(sel, toolbarWidth, toolbarHeight, boundary, offset);

		assert.equal(pos.placement, 'bottom');
		assert.equal(pos.top, sel.bottom + offset); // 45 + 8 = 53
		assert.equal(pos.left, 260);
	});

	await t.test('clamps toolbar left to prevent overflowing the left boundary margin', () => {
		const sel: Rect = {
			top: 200,
			bottom: 220,
			left: 25,
			right: 50,
			width: 25,
			height: 20,
		};
		const toolbarWidth = 180;
		const toolbarHeight = 36;
		const margin = 10;

		const pos = calculateToolbarPosition(sel, toolbarWidth, toolbarHeight, boundary, 8, margin);

		assert.equal(pos.left, boundary.left + margin); // 20 + 10 = 30
	});

	await t.test('clamps toolbar left to prevent overflowing the right boundary margin', () => {
		const sel: Rect = {
			top: 200,
			bottom: 220,
			left: 850,
			right: 890,
			width: 40,
			height: 20,
		};
		const toolbarWidth = 180;
		const toolbarHeight = 36;
		const margin = 10;

		const pos = calculateToolbarPosition(sel, toolbarWidth, toolbarHeight, boundary, 8, margin);

		// maxLeft = boundary.right - toolbarWidth - margin = 900 - 180 - 10 = 710
		assert.equal(pos.left, 710);
	});
});

test('popover positioning logic (V0.4.0)', async (t) => {
	const boundary: Rect = {
		top: 0,
		bottom: 600,
		left: 0,
		right: 800,
		width: 800,
		height: 600,
	};

	await t.test('places popover below anchor when space is available', () => {
		const anchor: Rect = {
			top: 100,
			bottom: 128,
			left: 200,
			right: 228,
			width: 28,
			height: 28,
		};
		const popoverWidth = 160;
		const popoverHeight = 72;
		const offset = 4;

		const pos = calculatePopoverPosition(anchor, popoverWidth, popoverHeight, boundary, 'bottom', offset);

		assert.equal(pos.placement, 'bottom');
		assert.equal(pos.top, anchor.bottom + offset); // 128 + 4 = 132
		// Center: 200 + 14 = 214. Left: 214 - 80 = 134
		assert.equal(pos.left, 134);
	});

	await t.test('flips popover above anchor when near the bottom boundary', () => {
		const anchor: Rect = {
			top: 550,
			bottom: 578,
			left: 200,
			right: 228,
			width: 28,
			height: 28,
		};
		const popoverWidth = 160;
		const popoverHeight = 72;
		const offset = 4;

		const pos = calculatePopoverPosition(anchor, popoverWidth, popoverHeight, boundary, 'bottom', offset);

		assert.equal(pos.placement, 'top');
		assert.equal(pos.top, anchor.top - popoverHeight - offset); // 550 - 72 - 4 = 474
	});
});

test('settings: toolbarEnabled setting lifecycle (V0.4.0)', async (t) => {
	await t.test('defaults toolbarEnabled to true', () => {
		assert.equal(DEFAULT_SETTINGS.toolbarEnabled, true);
	});

	await t.test('sanitizes undefined / null data with toolbarEnabled default', () => {
		const sanitized = sanitizeSettings(null);
		assert.equal(sanitized.toolbarEnabled, true);
	});

	await t.test('preserves user explicit setting when toolbarEnabled is false', () => {
		const sanitized = sanitizeSettings({ toolbarEnabled: false });
		assert.equal(sanitized.toolbarEnabled, false);
	});

	await t.test('coerces non-boolean values safely', () => {
		const sanitized = sanitizeSettings({ toolbarEnabled: 'invalid' as unknown as boolean });
		assert.equal(sanitized.toolbarEnabled, true);
	});

	await t.test('defaults tag navigation and bold support to true in V1.0.0', () => {
		assert.equal(DEFAULT_SETTINGS.experimentalTagNavigation, true);
		assert.equal(DEFAULT_SETTINGS.experimentalColorBoldSupport, true);
	});

	await t.test('preserves explicit false choices from existing users', () => {
		const sanitized = sanitizeSettings({
			experimentalTagNavigation: false,
			experimentalColorBoldSupport: false,
		});
		assert.equal(sanitized.experimentalTagNavigation, false);
		assert.equal(sanitized.experimentalColorBoldSupport, false);
	});

	await t.test('defaults missing fields to true for new installs', () => {
		const sanitized = sanitizeSettings({});
		assert.equal(sanitized.experimentalTagNavigation, true);
		assert.equal(sanitized.experimentalColorBoldSupport, true);
	});
});

test('selection validation checks: unmarked spans (V0.4.0)', async (t) => {
	await t.test('identifies unmarked third-party spans that must disable toolbar actions', () => {
		const line = 'Voici un <span class="external" style="color: #e03131">texte legacy</span> normal.';
		const parsed = parseLine(line);
		const unmarked = parsed.filter((s) => s.isUnmarked);

		assert.equal(unmarked.length, 1);
		assert.equal(unmarked[0]?.text, 'texte legacy');
		assert.equal(unmarked[0]?.isInkwell, false);
	});

	await t.test('recognizes compatible legacy formatting span without data-inkwell as managed', () => {
		const line = 'Voici un <span style="color: #e03131">texte legacy</span> normal.';
		const parsed = parseLine(line);
		const managed = parsed.filter((s) => s.isInkwell);
		const unmarked = parsed.filter((s) => s.isUnmarked);

		assert.equal(managed.length, 1);
		assert.equal(unmarked.length, 0);
	});

	await t.test('recognizes valid Inkwell span with data-inkwell="1"', () => {
		const line = 'Voici un <span data-inkwell="1" style="color: #e03131">texte inkwell</span> normal.';
		const parsed = parseLine(line);
		const inkwellSpans = parsed.filter((s) => s.isInkwell);
		const unmarked = parsed.filter((s) => s.isUnmarked);

		assert.equal(inkwellSpans.length, 1);
		assert.equal(unmarked.length, 0);
	});
});
