import test from 'node:test';
import assert from 'node:assert/strict';
import {
	isTabsHeaderLine,
	isTabSubheaderLine,
	sanitizeTabTitle,
	parseTabsMarkdown,
	serializeTabsMarkdown,
	addTab,
	renameTab,
	reorderTab,
	deleteTab,
} from '../src/tabs/tab-parser';
import { localOffsetToParentOffset, parentOffsetToLocalOffset } from '../src/columns/parser';

test('tab-parser: header detection and title sanitization', () => {
	assert.strictEqual(isTabsHeaderLine('> [!tabs]'), true);
	assert.strictEqual(isTabsHeaderLine('> [!tabs|custom-id]'), true);
	assert.strictEqual(isTabsHeaderLine('>[!tabs]'), true);
	assert.strictEqual(isTabsHeaderLine('> [!tab]'), false);
	assert.strictEqual(isTabsHeaderLine('> [!note]'), false);

	const sub1 = isTabSubheaderLine('> > [!tab|Mon premier onglet]');
	assert.strictEqual(sub1.isTab, true);
	assert.strictEqual(sub1.title, 'Mon premier onglet');

	const sub2 = isTabSubheaderLine('> > [!tab] Titre alternatif');
	assert.strictEqual(sub2.isTab, true);
	assert.strictEqual(sub2.title, 'Titre alternatif');

	assert.strictEqual(sanitizeTabTitle(' Onglet [1] | test \n'), 'Onglet 1 test');
	assert.strictEqual(sanitizeTabTitle(''), 'Onglet');
});

test('tab-parser: parses multi-tab markdown with contents and source map', () => {
	const raw = [
		'> [!tabs]',
		'>',
		'> > [!tab|Onglet 1]',
		'> > Ligne 1 onglet 1',
		'> > Ligne 2 onglet 1',
		'>',
		'> > [!tab|Onglet 2]',
		'> > Première ligne onglet 2',
	].join('\n');

	const parsed = parseTabsMarkdown(raw);
	assert.strictEqual(parsed.tabs.length, 2);
	assert.strictEqual(parsed.tabs[0]!.title, 'Onglet 1');
	assert.strictEqual(
		parsed.tabs[0]!.text,
		'Ligne 1 onglet 1\nLigne 2 onglet 1',
	);
	assert.strictEqual(parsed.tabs[1]!.title, 'Onglet 2');
	assert.strictEqual(parsed.tabs[1]!.text, 'Première ligne onglet 2');

	// Verify line mapping for tab 0
	const map0 = parsed.tabs[0]!.map;
	assert.strictEqual(map0.length, 2);
	assert.strictEqual(map0[0]!.contentLength, 'Ligne 1 onglet 1'.length);
	assert.strictEqual(map0[1]!.contentLength, 'Ligne 2 onglet 1'.length);

	// Test localOffsetToParentOffset
	const localDoc0 = parsed.tabs[0]!.text;
	const parentOffset = localOffsetToParentOffset(map0, localDoc0, 5, 0);
	assert.strictEqual(typeof parentOffset, 'number');
	assert.ok(parentOffset > 0);

	// Test parentOffsetToLocalOffset
	const backLocal = parentOffsetToLocalOffset(map0, localDoc0, parentOffset, 0);
	assert.strictEqual(backLocal, 5);
});

test('tab-parser: serialization preserves tabs and contents cleanly', () => {
	const tabs = [
		{ title: 'Notes', text: 'Premier paragraphe\nDeuxième ligne' },
		{ title: 'Synthèse', text: 'Résumé des points clés' },
	];

	const serialized = serializeTabsMarkdown(tabs);
	assert.ok(serialized.includes('> [!tabs]'));
	assert.ok(serialized.includes('> > [!tab|Notes]'));
	assert.ok(serialized.includes('> > Premier paragraphe'));
	assert.ok(serialized.includes('> > [!tab|Synthèse]'));
	assert.ok(serialized.includes('> > Résumé des points clés'));

	const roundTrip = parseTabsMarkdown(serialized);
	assert.strictEqual(roundTrip.tabs.length, 2);
	assert.strictEqual(roundTrip.tabs[0]!.title, 'Notes');
	assert.strictEqual(roundTrip.tabs[0]!.text, tabs[0]!.text);
	assert.strictEqual(roundTrip.tabs[1]!.title, 'Synthèse');
	assert.strictEqual(roundTrip.tabs[1]!.text, tabs[1]!.text);
});

test('tab-parser: operations add, rename, reorder, delete', () => {
	let tabs = [
		{ title: 'A', text: 'Alpha' },
		{ title: 'B', text: 'Bravo' },
	];

	// Add tab
	tabs = addTab(tabs, 'C');
	assert.strictEqual(tabs.length, 3);
	assert.strictEqual(tabs[2]!.title, 'C');
	assert.strictEqual(tabs[2]!.text, '');

	// Rename tab
	tabs = renameTab(tabs, 1, 'B Renommé');
	assert.strictEqual(tabs[1]!.title, 'B Renommé');
	assert.strictEqual(tabs[1]!.text, 'Bravo');

	// Reorder tab (move C from index 2 to index 0)
	tabs = reorderTab(tabs, 2, 0);
	assert.strictEqual(tabs[0]!.title, 'C');
	assert.strictEqual(tabs[1]!.title, 'A');
	assert.strictEqual(tabs[2]!.title, 'B Renommé');

	// Delete tab (delete index 1: 'A')
	tabs = deleteTab(tabs, 1);
	assert.strictEqual(tabs.length, 2);
	assert.strictEqual(tabs[0]!.title, 'C');
	assert.strictEqual(tabs[1]!.title, 'B Renommé');
});
