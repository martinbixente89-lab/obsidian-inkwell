import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncedHarness, FakeSyncedOccurrence } from './helpers/synced-harness';

const PATH = '_synced/Cadrage.md';

for (const deferModifyEvent of [false, true]) {
	const label = deferModifyEvent ? 'modify event deferred' : 'modify event synchronous';

	void describe(`synced lease transfer with pending draft (${label})`, () => {
		void test('second occurrence starts from the flushed draft and saves without loss or false conflict', async () => {
			const h = createSyncedHarness(deferModifyEvent);
			h.addFile(PATH, 'Version initiale');
			const a = new FakeSyncedOccurrence(h, PATH, 'occ-A');
			const b = new FakeSyncedOccurrence(h, PATH, 'occ-B');

			assert.equal(await a.startEditing(), true);
			a.type('Version initiale + A1');
			await a.save();
			await h.settle();

			// A types again; the 350 ms debounced save has not fired yet.
			const lastA = 'Version initiale + A1 + A2 (dernière frappe)';
			a.type(lastA);

			// Occurrence B takes the lease immediately.
			assert.equal(await b.startEditing(), true);
			assert.equal(h.disk(PATH), lastA, 'A pending draft must be flushed to disk');
			assert.equal(b.draft, lastA, 'B must start editing from the flushed content');

			await h.settle();

			const editedB = `${lastA}\nAjout B`;
			b.type(editedB);
			const res = await h.manager.saveSource(PATH, editedB);
			assert.equal(res.conflict, undefined, 'no false conflict on B first save');
			assert.equal(res.success, true);
			assert.equal(h.disk(PATH), editedB);
			assert.ok(h.disk(PATH)?.includes('A2 (dernière frappe)'), 'A last keystrokes kept');
			assert.equal(h.created().length, 0, 'no recovery file without conflict');
		});

		void test('a genuine external edit during B lease is still reported as a conflict', async () => {
			const h = createSyncedHarness(deferModifyEvent);
			const file = h.addFile(PATH, 'Version initiale');
			const a = new FakeSyncedOccurrence(h, PATH, 'occ-A');
			const b = new FakeSyncedOccurrence(h, PATH, 'occ-B');

			await a.startEditing();
			a.type('Version initiale + A');
			await b.startEditing();
			await h.settle();

			h.externalWrite(file, 'Réécrit ailleurs');
			await h.settle();

			const res = await h.manager.saveSource(PATH, `${b.draft ?? ''} + B`);
			assert.equal(res.success, false);
			assert.equal(res.conflict, true);
			assert.equal(h.disk(PATH), 'Réécrit ailleurs', 'external version never overwritten');
			assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, true);
		});
	});
}
