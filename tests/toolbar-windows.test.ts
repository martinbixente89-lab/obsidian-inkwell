import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { PerDocumentAttachment, relocateToDocument } from '../src/ui/toolbar-windows';

/**
 * Regression: the floating toolbar was created and listened only in the window that
 * was active when Inkwell loaded (e.g. a popout during an in-session update), so it
 * never appeared in the main window afterwards. Reproduced in Obsidian 1.15.0.
 */

interface FakeEl {
	ownerDocument: FakeDoc;
	isConnected: boolean;
}
interface FakeDoc {
	name: string;
	children: FakeEl[];
	body: { appendChild(el: FakeEl): unknown } | null;
}

function fakeDoc(name: string): FakeDoc {
	const doc: FakeDoc = {
		name,
		children: [],
		body: {
			appendChild(el: FakeEl) {
				// DOM semantics: appendChild adopts the node into this document.
				el.ownerDocument.children = el.ownerDocument.children.filter((c) => c !== el);
				el.ownerDocument = doc;
				el.isConnected = true;
				doc.children.push(el);
				return el;
			},
		},
	};
	return doc;
}

void describe('toolbar windows: element follows the editor window', () => {
	void test('toolbar created in a popout is moved to the main window editor document', () => {
		const popout = fakeDoc('popout');
		const main = fakeDoc('main');
		const toolbar: FakeEl = { ownerDocument: popout, isConnected: true };
		popout.children.push(toolbar);

		assert.equal(relocateToDocument(toolbar, main), true);
		assert.equal(toolbar.ownerDocument, main);
		assert.deepEqual(popout.children, []);
		assert.deepEqual(main.children, [toolbar]);
	});

	void test('no move when already in the editor document', () => {
		const main = fakeDoc('main');
		const toolbar: FakeEl = { ownerDocument: main, isConnected: true };
		assert.equal(relocateToDocument(toolbar, main), false);
	});

	void test('re-attached when detached from its document', () => {
		const main = fakeDoc('main');
		const toolbar: FakeEl = { ownerDocument: main, isConnected: false };
		assert.equal(relocateToDocument(toolbar, main), true);
		assert.equal(toolbar.isConnected, true);
	});

	void test('unknown editor document: left untouched', () => {
		const popout = fakeDoc('popout');
		const toolbar: FakeEl = { ownerDocument: popout, isConnected: true };
		assert.equal(relocateToDocument<FakeDoc, FakeEl>(toolbar, null), false);
		assert.equal(relocateToDocument<FakeDoc, FakeEl>(toolbar, undefined), false);
		assert.equal(toolbar.ownerDocument, popout);
	});
});

void describe('toolbar windows: listeners attached once per window', () => {
	void test('each window document is attached exactly once, including popouts opened later', () => {
		const attached: string[] = [];
		const windows = new PerDocumentAttachment<FakeDoc>((doc) => attached.push(doc.name));
		const main = fakeDoc('main');
		const popout = fakeDoc('popout');

		assert.equal(windows.ensure(main), true);
		assert.equal(windows.ensure(main), false); // iterateAllLeaves may report it again
		assert.equal(windows.ensure(popout), true); // existing popout or 'window-open'
		assert.equal(windows.ensure(popout), false);
		assert.equal(windows.ensure(null), false);
		assert.deepEqual(attached, ['main', 'popout']);
	});
});
