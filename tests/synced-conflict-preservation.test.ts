import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncedHarness, FakeSyncedOccurrence } from './helpers/synced-harness';

const PATH = '_synced/Cadrage.md';

/** A edits, saves once, then the source is rewritten elsewhere while A has a pending draft. */
async function setupConflict(deferModifyEvent = false) {
	const h = createSyncedHarness(deferModifyEvent);
	const file = h.addFile(PATH, 'Version initiale');
	const a = new FakeSyncedOccurrence(h, PATH, 'occ-A');
	const b = new FakeSyncedOccurrence(h, PATH, 'occ-B');

	assert.equal(await a.startEditing(), true);
	a.type('Version initiale + A1');
	await a.save();
	await h.settle();

	h.externalWrite(file, 'Version écrite ailleurs');
	await h.settle();
	a.type('Brouillon A précieux');

	return { h, a, b };
}

function snapshotContent(h: ReturnType<typeof createSyncedHarness>, kind: string): string {
	const path = h.created().find((p) => p.includes(`-${kind}-`));
	assert.ok(path, `missing ${kind} snapshot`);
	return h.disk(path) ?? '';
}

void describe('synced conflict: draft preservation on exit', () => {
	void test('exiting edit mode during a conflict preserves both versions and leaves the source untouched', async () => {
		const { h, a } = await setupConflict();

		await a.exitEditing();

		assert.equal(a.isEditing, false, 'exit completes once recovery is confirmed');
		assert.equal(h.disk(PATH), 'Version écrite ailleurs', 'source not overwritten');
		assert.equal(h.manager.getLeaseInfo(PATH), undefined, 'lease released after recovery');
		assert.equal(h.created().length, 2);

		const local = snapshotContent(h, 'brouillon-local');
		assert.ok(local.includes('inkwell-recup-type: brouillon-local'));
		assert.ok(local.includes(`inkwell-source-fichier: "${PATH}"`));
		assert.ok(local.endsWith('Brouillon A précieux'));

		const source = snapshotContent(h, 'version-source');
		assert.ok(source.includes('inkwell-recup-type: version-source'));
		assert.ok(source.includes(`inkwell-source-fichier: "${PATH}"`));
		assert.ok(source.endsWith('Version écrite ailleurs'));
	});

	void test('conflict detected on the final flush of a pending draft is also preserved', async () => {
		const h = createSyncedHarness();
		const file = h.addFile(PATH, 'Version initiale');
		const a = new FakeSyncedOccurrence(h, PATH, 'occ-A');
		await a.startEditing();
		a.type('Brouillon jamais sauvegardé');
		// External write lands while A's save is still pending.
		h.externalWrite(file, 'Version écrite ailleurs');

		await a.exitEditing();

		assert.equal(a.lastSaveConflict, true);
		assert.equal(h.disk(PATH), 'Version écrite ailleurs');
		assert.ok(snapshotContent(h, 'brouillon-local').endsWith('Brouillon jamais sauvegardé'));
		assert.equal(a.isEditing, false);
	});

	void test('exit without conflict writes no recovery file', async () => {
		const h = createSyncedHarness();
		h.addFile(PATH, 'Version initiale');
		const a = new FakeSyncedOccurrence(h, PATH, 'occ-A');
		await a.startEditing();
		a.type('Texte normal');
		await a.exitEditing();

		assert.equal(h.disk(PATH), 'Texte normal');
		assert.equal(h.created().length, 0);
		assert.equal(h.manager.getLeaseInfo(PATH), undefined);
	});

	void test('another occurrence taking the lease during a conflict preserves the draft first', async () => {
		for (const defer of [false, true]) {
			const { h, a, b } = await setupConflict(defer);

			assert.equal(await b.startEditing(), true);

			assert.equal(a.isEditing, false);
			assert.equal(h.disk(PATH), 'Version écrite ailleurs', 'source not overwritten');
			assert.ok(snapshotContent(h, 'brouillon-local').endsWith('Brouillon A précieux'));
			assert.ok(snapshotContent(h, 'version-source').endsWith('Version écrite ailleurs'));

			const lease = h.manager.getLeaseInfo(PATH);
			assert.equal(lease?.occurrenceId, 'occ-B');
			assert.equal(lease?.hasConflict, false);
			assert.equal(b.draft, 'Version écrite ailleurs', 'B starts from the current source');
		}
	});

	void test('recovery write failure keeps the draft, the lease and the conflict, and refuses the transfer', async () => {
		const { h, a, b } = await setupConflict();
		h.setCreateFailure(() => new Error('Disque plein'));

		await a.exitEditing();
		assert.equal(a.exitRefusals, 1);
		assert.equal(a.isEditing, true, 'editor kept open');
		assert.equal(a.draft, 'Brouillon A précieux', 'draft kept in memory');

		assert.equal(await b.startEditing(), false, 'transfer refused');
		assert.equal(b.isEditing, false);

		const lease = h.manager.getLeaseInfo(PATH);
		assert.equal(lease?.occurrenceId, 'occ-A');
		assert.equal(lease?.hasConflict, true, 'conflict stays open');
		assert.equal(h.disk(PATH), 'Version écrite ailleurs', 'source not overwritten');
		assert.equal(h.created().length, 0);

		// Once writing works again, the same exit succeeds.
		h.setCreateFailure(null);
		await a.exitEditing();
		assert.equal(a.isEditing, false);
		assert.equal(h.created().length, 2);
	});

	void test('partial recovery failure: retry only writes the missing snapshot', async () => {
		const { h, a } = await setupConflict();
		h.setCreateFailure((p) => (p.includes('-version-source-') ? new Error('Refusé') : null));

		await a.exitEditing();
		assert.equal(a.isEditing, true);
		assert.equal(h.created().length, 1, 'local draft already secured');

		h.setCreateFailure(null);
		await a.exitEditing();
		assert.equal(a.isEditing, false);
		const created = h.created();
		assert.equal(created.length, 2);
		assert.equal(created.filter((p) => p.includes('-brouillon-local-')).length, 1, 'no duplicate');
		assert.equal(created.filter((p) => p.includes('-version-source-')).length, 1);
	});

	void test('repeated and concurrent preservation attempts do not duplicate snapshots', async () => {
		const { h, a } = await setupConflict();
		const draft = a.draft ?? '';

		const results = await Promise.all([
			h.manager.preserveConflictDraft(PATH, 'occ-A', draft),
			h.manager.preserveConflictDraft(PATH, 'occ-A', draft),
			h.manager.preserveConflictDraft(PATH, 'occ-A', draft),
		]);
		assert.ok(results.every((r) => r.success));
		assert.equal(results.filter((r) => r.alreadyPreserved).length, 2);
		assert.equal(h.created().length, 2);

		const again = await h.manager.preserveConflictDraft(PATH, 'occ-A', draft);
		assert.equal(again.alreadyPreserved, true);
		assert.equal(h.created().length, 2);

		// A changed draft gets its own snapshot; the unchanged source version is reused.
		const changed = await h.manager.preserveConflictDraft(PATH, 'occ-A', `${draft} (suite)`);
		assert.equal(changed.success, true);
		assert.equal(h.created().length, 3);
		assert.equal(changed.sourceBackupPath, results[0]?.sourceBackupPath);

		assert.equal(h.disk(PATH), 'Version écrite ailleurs');
	});

	void test('explicit resolution still writes both snapshots in the shared format', async () => {
		const { h, a } = await setupConflict();
		const res = await h.manager.resolveConflict(PATH, 'occ-A', 'reload-source', a.draft ?? '');
		assert.equal(res.success, true);
		assert.equal(h.created().length, 2);
		assert.ok(res.localBackupPath?.startsWith('_synced/conflits/Cadrage-brouillon-local-'));
		assert.ok(res.sourceBackupPath?.startsWith('_synced/conflits/Cadrage-version-source-'));
		const local = snapshotContent(h, 'brouillon-local');
		assert.ok(local.includes('# Récupération de conflit — Brouillon local'));
		assert.ok(local.includes(`- Source : [[${PATH}]]`));
		assert.ok(local.includes('- Choix appliqué : Charger la version source'));
		assert.ok(local.endsWith('Brouillon A précieux'));
		const source = snapshotContent(h, 'version-source');
		assert.ok(source.includes('# Récupération de conflit — Version source (disque)'));
		assert.ok(source.endsWith('Version écrite ailleurs'));
		assert.equal(h.disk(PATH), 'Version écrite ailleurs');
		assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, false);
	});

	void test('preservation is refused for an occurrence that does not hold the lease', async () => {
		const { h } = await setupConflict();
		const res = await h.manager.preserveConflictDraft(PATH, 'occ-intrus', 'x');
		assert.equal(res.success, true, 'no-op: nothing of this occurrence to preserve');
		assert.equal(h.created().length, 0);
		assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, true, 'conflict untouched');
	});
});

void describe('synced conflict: explicit resolution', () => {
	const DRAFT = 'Brouillon A précieux';
	const EXTERNAL = 'Version écrite ailleurs';
	const NEWER = 'Version modifiée pendant la résolution';

	for (const defer of [false, true]) {
		void test(`keep-mine applies the local draft in a real conflict (${defer ? 'deferred' : 'sync'} event)`, async () => {
			const { h, a } = await setupConflict(defer);
			const writesBefore = h.writes(PATH);

			const res = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', DRAFT);

			assert.equal(res.success, true, res.error);
			assert.equal(h.disk(PATH), DRAFT);
			assert.equal(h.writes(PATH), writesBefore + 1, 'exactly one replacement write');
			assert.equal(h.created().length, 2, 'both versions saved before replacing');
			assert.ok(snapshotContent(h, 'brouillon-local').endsWith(DRAFT));
			assert.ok(snapshotContent(h, 'version-source').endsWith(EXTERNAL));
			assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, false);

			// Editing continues normally after the resolution, without a false conflict.
			await h.settle();
			a.type(`${DRAFT} + suite`);
			await a.save();
			assert.equal(a.lastSaveConflict, false);
			assert.equal(h.disk(PATH), `${DRAFT} + suite`);
		});
	}

	void test('keep-mine with total recovery failure never replaces the source', async () => {
		const { h } = await setupConflict();
		h.setCreateFailure(() => new Error('Disque plein'));
		const writesBefore = h.writes(PATH);

		const res = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', DRAFT);

		assert.equal(res.success, false);
		assert.ok(res.error?.includes('Disque plein'));
		assert.equal(h.writes(PATH), writesBefore, 'no replacement write');
		assert.equal(h.disk(PATH), EXTERNAL);
		assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, true);
		assert.equal(h.created().length, 0);
	});

	void test('keep-mine with partial recovery failure never replaces the source, retry reuses the written snapshot', async () => {
		const { h } = await setupConflict();
		h.setCreateFailure((p) => (p.includes('-version-source-') ? new Error('Refusé') : null));
		const writesBefore = h.writes(PATH);

		const failed = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', DRAFT);
		assert.equal(failed.success, false);
		assert.equal(h.writes(PATH), writesBefore, 'no replacement write');
		assert.equal(h.disk(PATH), EXTERNAL);
		assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, true);
		assert.equal(h.created().length, 1);

		h.setCreateFailure(null);
		const retried = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', DRAFT);
		assert.equal(retried.success, true, retried.error);
		assert.equal(h.disk(PATH), DRAFT);
		const created = h.created();
		assert.equal(created.length, 2, 'local draft snapshot not duplicated');
		assert.equal(retried.localBackupPath, failed.localBackupPath);
	});

	void test('resolution reuses the snapshots written by a refused exit', async () => {
		const { h, a } = await setupConflict();
		h.setCreateFailure((p) => (p.includes('-version-source-') ? new Error('Refusé') : null));
		await a.exitEditing();
		assert.equal(a.isEditing, true);
		assert.equal(h.created().length, 1);

		h.setCreateFailure(null);
		const res = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', a.draft ?? '');
		assert.equal(res.success, true, res.error);
		assert.equal(h.created().length, 2);
		assert.equal(h.disk(PATH), DRAFT);
	});

	void test('external change while recovery files are written: no overwrite, conflict updated, draft kept', async () => {
		const { h } = await setupConflict();
		const file = h.manager.resolveSourceFile(PATH);
		assert.ok(file);
		h.setCreateFailure((p) => {
			if (p.includes('-version-source-')) h.externalWrite(file, NEWER);
			return null;
		});

		const res = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', DRAFT);

		assert.equal(res.success, false);
		assert.equal(res.conflictChanged, true);
		assert.equal(res.resolvedBody, DRAFT, 'draft handed back to the caller');
		assert.equal(h.disk(PATH), NEWER, 'newer external version not overwritten');
		const lease = h.manager.getLeaseInfo(PATH);
		assert.equal(lease?.hasConflict, true);
		assert.equal(lease?.externalDiskContent, NEWER);

		// Retry: the local snapshot is reused, only the new source version is saved.
		h.setCreateFailure(null);
		await h.settle();
		const retried = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', DRAFT);
		assert.equal(retried.success, true, retried.error);
		assert.equal(h.created().filter((p) => p.includes('-brouillon-local-')).length, 1);
		assert.equal(h.created().filter((p) => p.includes('-version-source-')).length, 2);
		assert.ok(h.disk(retried.sourceBackupPath ?? '')?.endsWith(NEWER));
		assert.equal(h.disk(PATH), DRAFT);
	});

	void test('external change right before the final write: no overwrite', async () => {
		const { h } = await setupConflict();
		const file = h.manager.resolveSourceFile(PATH);
		assert.ok(file);
		h.setBeforeProcess(() => {
			h.setBeforeProcess(null);
			h.externalWrite(file, NEWER);
		});

		const res = await h.manager.resolveConflict(PATH, 'occ-A', 'keep-mine', DRAFT);

		assert.equal(res.success, false);
		assert.equal(res.conflictChanged, true);
		assert.equal(h.disk(PATH), NEWER);
		assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, true);
	});

	void test('reload-source: external change during recovery keeps the conflict open', async () => {
		const { h } = await setupConflict();
		const file = h.manager.resolveSourceFile(PATH);
		assert.ok(file);
		h.setCreateFailure((p) => {
			if (p.includes('-version-source-')) h.externalWrite(file, NEWER);
			return null;
		});

		const res = await h.manager.resolveConflict(PATH, 'occ-A', 'reload-source', DRAFT);

		assert.equal(res.success, false);
		assert.equal(res.conflictChanged, true);
		assert.equal(h.disk(PATH), NEWER);
		assert.equal(h.manager.getLeaseInfo(PATH)?.hasConflict, true);
	});

	void test('reload-source keeps the source and lets editing resume without false conflict', async () => {
		const { h, a } = await setupConflict();
		const writesBefore = h.writes(PATH);
		const res = await h.manager.resolveConflict(PATH, 'occ-A', 'reload-source', DRAFT);
		assert.equal(res.success, true, res.error);
		assert.equal(res.resolvedBody, EXTERNAL);
		assert.equal(res.discardedBody, DRAFT);
		assert.equal(h.writes(PATH), writesBefore, 'source not rewritten');

		a.type(`${EXTERNAL} + suite`);
		await a.save();
		assert.equal(a.lastSaveConflict, false);
		assert.equal(h.disk(PATH), `${EXTERNAL} + suite`);
	});
});
