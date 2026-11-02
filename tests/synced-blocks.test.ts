import test, { describe } from 'node:test';
import assert from 'node:assert';
import {
	extractSourceContent,
	formatSourceContent,
	generateSyncId,
	isSyncedHeaderLine,
	parseSyncedBlockFromLines,
	parseSyncedEmbedLine,
	parseSyncedHeader,
	serializeSyncedReference,
} from '../src/synced/synced-model';

void describe('synced blocks model & parser', () => {
	void test('identifies synced header lines correctly', () => {
		assert.strictEqual(isSyncedHeaderLine('> [!synced] Titre'), true);
		assert.strictEqual(isSyncedHeaderLine('>   [!synced]   Titre du bloc  '), true);
		assert.strictEqual(isSyncedHeaderLine('>[!synced|id:sync-123] Mon titre'), true);
		assert.strictEqual(isSyncedHeaderLine('> [!SYNCED] Majuscules'), true);
		assert.strictEqual(isSyncedHeaderLine('> [!note] Pas un synced'), false);
		assert.strictEqual(isSyncedHeaderLine('> [!tabs] Pas un synced'), false);
		assert.strictEqual(isSyncedHeaderLine('Texte normal'), false);
	});

	void test('parses synced header attributes', () => {
		const simple = parseSyncedHeader('> [!synced] Cadrage projet');
		assert.strictEqual(simple.isSynced, true);
		assert.strictEqual(simple.title, 'Cadrage projet');
		assert.strictEqual(simple.syncId, undefined);

		const withId = parseSyncedHeader('> [!synced|id:sync-abc-456] Titre avec ID');
		assert.strictEqual(withId.isSynced, true);
		assert.strictEqual(withId.title, 'Titre avec ID');
		assert.strictEqual(withId.syncId, 'sync-abc-456');

		const shortId = parseSyncedHeader('> [!synced|sync-xyz] Titre court');
		assert.strictEqual(shortId.isSynced, true);
		assert.strictEqual(shortId.title, 'Titre court');
		assert.strictEqual(shortId.syncId, 'sync-xyz');

		const noTitle = parseSyncedHeader('> [!synced]');
		assert.strictEqual(noTitle.isSynced, true);
		assert.strictEqual(noTitle.title, 'Bloc synchronisé');
	});

	void test('parses embed line inside synced callout', () => {
		assert.strictEqual(
			parseSyncedEmbedLine('> ![[_synced/Cadrage.md]]'),
			'_synced/Cadrage.md',
		);
		assert.strictEqual(
			parseSyncedEmbedLine('> ![[_synced/Cadrage]]'),
			'_synced/Cadrage',
		);
		assert.strictEqual(
			parseSyncedEmbedLine('>   ![[_synced/Cadrage.md|alias]]  '),
			'_synced/Cadrage.md',
		);
		assert.strictEqual(parseSyncedEmbedLine('> Texte ordinaire'), null);
		assert.strictEqual(parseSyncedEmbedLine('![[PasDansCallout.md]]'), null);
	});

	void test('serializes synced reference with single source of truth format', () => {
		const withoutId = serializeSyncedReference(
			'_synced/Ma Note.md',
			'Ma Note',
		);
		assert.strictEqual(
			withoutId,
			'> [!synced] Ma Note\n> ![[_synced/Ma Note.md]]',
		);

		const withId = serializeSyncedReference(
			'_synced/Ma Note.md',
			'Ma Note',
			'sync-12345',
		);
		assert.strictEqual(
			withId,
			'> [!synced|id:sync-12345] Ma Note\n> ![[_synced/Ma Note.md]]',
		);
	});

	void test('parses full synced block from lines', () => {
		const lines = [
			'> [!synced|id:sync-test-99] Bloc important',
			'> ![[_synced/Bloc important.md]]',
		];
		const ref = parseSyncedBlockFromLines(lines, 10);
		assert.ok(ref);
		assert.strictEqual(ref.from, 10);
		assert.strictEqual(ref.to, 10 + lines.join('\n').length);
		assert.strictEqual(ref.title, 'Bloc important');
		assert.strictEqual(ref.syncId, 'sync-test-99');
		assert.strictEqual(ref.targetPath, '_synced/Bloc important.md');
	});

	void test('handles frontmatter extraction and serialization without leaking into sub-editor', () => {
		const rawWithFm = `---
inkwell-sync-id: sync-k8s-001
---
# Contenu du bloc synchronisé

Voici le premier paragraphe partagé.
`;
		const parsed = extractSourceContent(rawWithFm);
		assert.strictEqual(parsed.syncId, 'sync-k8s-001');
		assert.strictEqual(
			parsed.body,
			'# Contenu du bloc synchronisé\n\nVoici le premier paragraphe partagé.\n',
		);

		const formatted = formatSourceContent(parsed.syncId, parsed.body);
		assert.strictEqual(formatted.trim(), rawWithFm.trim());
	});

	void test('handles source content without frontmatter gracefully', () => {
		const plainBody = 'Paragraphe sans aucun frontmatter.\nDeuxième ligne.';
		const parsed = extractSourceContent(plainBody);
		assert.strictEqual(parsed.syncId, null);
		assert.strictEqual(parsed.body, plainBody);

		const formatted = formatSourceContent(null, plainBody);
		assert.strictEqual(formatted, plainBody);
	});

	void test('generates unique sync identifiers', () => {
		const id1 = generateSyncId();
		const id2 = generateSyncId();
		assert.ok(id1.startsWith('sync-'));
		assert.ok(id2.startsWith('sync-'));
		assert.notStrictEqual(id1, id2);
	});
});
