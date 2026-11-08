import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	derivedFocusKey,
	normalizeSettingName,
	pickFocusTarget,
} from '../src/settings/focus-restore';

void describe('settings focus restoration (pure choice)', () => {
	const order = [
		'tab:general',
		'tab:toolbar',
		'toolbar-enabled',
		'font:f1:rename',
		'font:f1:remove',
		'font:f2:rename',
		'font:f2:remove',
		'setting:Importation des polices:button:Importer une police…',
	];

	void test('the toolbar toggle keeps focus when the Toolbar tab disappears', () => {
		const after = new Set(order.filter((id) => id !== 'tab:toolbar'));
		assert.equal(pickFocusTarget({ id: 'toolbar-enabled', order }, after), 'toolbar-enabled');
	});

	void test('ids are stable when a list changes: same font action found after another font is removed', () => {
		const after = new Set(order.filter((id) => !id.startsWith('font:f1:')));
		assert.equal(pickFocusTarget({ id: 'font:f2:remove', order }, after), 'font:f2:remove');
	});

	void test('removed control: focus goes to the next relevant neighbour, then the previous one', () => {
		const afterRemoveF1 = new Set(order.filter((id) => !id.startsWith('font:f1:')));
		assert.equal(pickFocusTarget({ id: 'font:f1:remove', order }, afterRemoveF1), 'font:f2:rename');
		const lastRemoved = new Set(order.filter((id) => !id.startsWith('font:f2:') && !id.startsWith('setting:')));
		assert.equal(pickFocusTarget({ id: 'font:f2:remove', order }, lastRemoved), 'font:f1:remove');
	});

	void test('nothing left from the old order: caller falls back to the active tab', () => {
		assert.equal(pickFocusTarget({ id: 'gone', order: ['gone'] }, new Set(['tab:general'])), null);
		assert.equal(pickFocusTarget({ id: 'unknown', order }, new Set(['tab:general'])), null);
	});

	void test('derived ids ignore changing counts in setting names', () => {
		assert.equal(normalizeSettingName('Couleurs disponibles (12)'), 'Couleurs disponibles');
		assert.equal(normalizeSettingName('Forme de la toolbar'), 'Forme de la toolbar');
		assert.equal(
			derivedFocusKey('Couleurs disponibles (3)', 'button', 'Ajouter une couleur'),
			derivedFocusKey('Couleurs disponibles (4)', 'button', 'Ajouter une couleur'),
		);
	});
});

void describe('settings tabs row (Obsidian keyboard navigation)', () => {
	void test('the tab bar row is an ordinary, programmatically focusable setting row', async () => {
		const { TABS_ROW_ATTRIBUTES, TABS_ROW_CLASSES } = await import('../src/settings/settings-tabs');
		assert.ok(TABS_ROW_CLASSES.includes('setting-item'));
		assert.ok(!(TABS_ROW_CLASSES as readonly string[]).includes('setting-item-heading'));
		assert.equal(TABS_ROW_ATTRIBUTES.tabindex, '-1');
	});
});
