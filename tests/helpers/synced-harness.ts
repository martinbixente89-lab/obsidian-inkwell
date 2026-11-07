import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { TFile, TFolder } from 'obsidian';
import { SyncedBlockManager } from '../../src/synced/synced-manager';
import type InkwellPlugin from '../../src/main';

/**
 * In-memory vault driving the real SyncedBlockManager.
 * `deferModifyEvent` controls whether the vault 'modify' event fires before
 * `vault.modify()` resolves (sync) or on a later macrotask (deferred), since
 * both orderings are plausible in Obsidian.
 */
export function createSyncedHarness(deferModifyEvent = false) {
	let clock = 1000;
	const contents = new Map<string, string>();
	const files = new Map<string, TFile>();
	const folders = new Map<string, TFolder>();
	const modifyHandlers: Array<(file: TFile) => unknown> = [];
	const created: string[] = [];
	/** Return an Error to make the next matching `vault.create` call fail. */
	let createFailure: ((path: string) => Error | null) | null = null;
	/** Called inside `vault.process` before the callback reads the content (race injection). */
	let beforeProcess: ((path: string) => void) | null = null;
	/** Writes performed through vault.modify / vault.process, per path. */
	const writes = new Map<string, number>();
	const countWrite = (p: string) => writes.set(p, (writes.get(p) ?? 0) + 1);

	const emitModify = (file: TFile) => {
		for (const h of modifyHandlers) void h(file);
	};

	const addFile = (path: string, body: string) => {
		const f = new TFile();
		f.path = path;
		f.name = path.split('/').pop() ?? path;
		f.basename = f.name.replace(/\.md$/, '');
		f.stat.mtime = ++clock;
		files.set(path, f);
		contents.set(path, body);
		return f;
	};

	const vault = {
		on(name: string, cb: (file: TFile) => unknown) {
			if (name === 'modify') modifyHandlers.push(cb);
			return { name };
		},
		getAbstractFileByPath: (p: string) => files.get(p) ?? folders.get(p) ?? null,
		getMarkdownFiles: () => [...files.values()],
		read: (f: TFile) => Promise.resolve(contents.get(f.path) ?? ''),
		modify: async (f: TFile, data: string) => {
			countWrite(f.path);
			contents.set(f.path, data);
			f.stat.mtime = ++clock;
			if (deferModifyEvent) {
				setImmediate(() => emitModify(f));
			} else {
				emitModify(f);
			}
			await Promise.resolve();
		},
		process: async (f: TFile, fn: (data: string) => string) => {
			await Promise.resolve();
			beforeProcess?.(f.path);
			// Read-modify-write without yielding, like Obsidian's atomic Vault.process().
			const current = contents.get(f.path) ?? '';
			const next = fn(current);
			if (next !== current) {
				countWrite(f.path);
				contents.set(f.path, next);
				f.stat.mtime = ++clock;
				if (deferModifyEvent) {
					setImmediate(() => emitModify(f));
				} else {
					emitModify(f);
				}
			}
			return next;
		},
		create: async (path: string, data: string) => {
			await Promise.resolve();
			const err = createFailure?.(path) ?? null;
			if (err) throw err;
			if (files.has(path)) throw new Error(`File already exists: ${path}`);
			created.push(path);
			return addFile(path, data);
		},
		createFolder: (path: string) => {
			const folder = new TFolder();
			folder.path = path;
			folders.set(path, folder);
			return Promise.resolve(folder);
		},
	};

	const plugin = {
		app: {
			vault,
			metadataCache: {
				getFirstLinkpathDest: () => null,
				getFileCache: () => null,
			},
		},
		registerEvent: () => undefined,
	} as unknown as InkwellPlugin;

	const manager = new SyncedBlockManager(plugin);

	return {
		manager,
		addFile,
		/** Simulates an edit made outside the leased occurrence (other pane, sync tool...). */
		externalWrite: (f: TFile, body: string) => {
			contents.set(f.path, body);
			f.stat.mtime = ++clock;
			emitModify(f);
		},
		disk: (p: string) => contents.get(p),
		/** Recovery files created through `vault.create`, in creation order. */
		created: () => created.filter((p) => p.startsWith('_synced/conflits/')),
		setCreateFailure: (fn: ((path: string) => Error | null) | null) => {
			createFailure = fn;
		},
		setBeforeProcess: (fn: ((path: string) => void) | null) => {
			beforeProcess = fn;
		},
		/** Number of writes made to `path` through vault.modify / vault.process. */
		writes: (path: string) => writes.get(path) ?? 0,
		settle: () => new Promise<void>((r) => setImmediate(() => setImmediate(r))),
	};
}

export type SyncedHarness = ReturnType<typeof createSyncedHarness>;

/**
 * Test double for VisualSyncedBlockController, limited to its lease/save logic.
 * It calls the real manager in the same order as the controller:
 * - startEditing(): read source, acquireLease(flushAndRelease = exitEditing), use lease baseline
 * - type(): updates the in-memory draft; save() mimics the debounced flushSave()
 * - exitEditing(): mirrors switchToPreview(): flush pending save, preserve a conflicting
 *   draft, refuse to close if that fails, otherwise release the lease.
 * The DOM, CodeMirror sub-editor, notices and timers are NOT exercised here.
 */
export class FakeSyncedOccurrence {
	draft: string | null = null;
	pendingSave = false;
	lastSaveConflict = false;
	exitRefusals = 0;

	constructor(
		private h: SyncedHarness,
		private path: string,
		readonly occurrenceId: string,
	) {}

	get isEditing(): boolean {
		return this.draft !== null;
	}

	async startEditing(): Promise<boolean> {
		const read = this.h.disk(this.path) ?? '';
		const file = this.h.manager.resolveSourceFile(this.path);
		assert.ok(file);
		const acquired = await this.h.manager.acquireLease(
			this.path,
			this.occurrenceId,
			read,
			file.stat.mtime,
			() => this.exitEditing(),
		);
		if (!acquired) return false;
		this.draft = this.h.manager.getLeaseInfo(this.path)?.lastSavedContent ?? read;
		return true;
	}

	type(text: string): void {
		assert.ok(this.draft !== null, 'occurrence is not editing');
		this.draft = text;
		this.pendingSave = true;
	}

	async save(): Promise<void> {
		this.pendingSave = false;
		if (this.draft === null) return;
		const res = await this.h.manager.saveSource(this.path, this.draft);
		this.lastSaveConflict = !!res.conflict;
	}

	async exitEditing(): Promise<void> {
		if (this.pendingSave) await this.save();
		if (this.draft !== null) {
			const res = await this.h.manager.preserveConflictDraft(
				this.path,
				this.occurrenceId,
				this.draft,
			);
			if (!res.success) {
				this.exitRefusals++;
				return;
			}
		}
		this.draft = null;
		this.h.manager.releaseLease(this.path, this.occurrenceId);
	}
}
