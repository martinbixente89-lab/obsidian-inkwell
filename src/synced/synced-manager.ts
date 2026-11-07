import { App, TFile } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	extractSourceContent,
	formatSourceContent,
} from './synced-model';

export interface SyncedLeaseInfo {
	occurrenceId: string;
	lastSavedContent: string;
	lastSeenMtime: number;
	hasConflict: boolean;
	externalDiskContent?: string;
	flushAndRelease?: () => Promise<void>;
	/** Snapshots written for this conflict when leaving edit mode (deduplication). */
	preservation?: ConflictPreservationRecord;
}

export interface ConflictPreservationRecord {
	localDraft: string;
	diskBody: string | null;
	localBackupPath?: string;
	sourceBackupPath?: string;
}

export interface ConflictPreservationResult {
	success: boolean;
	/** True when identical snapshots already existed and nothing new was written. */
	alreadyPreserved?: boolean;
	localBackupPath?: string;
	sourceBackupPath?: string;
	error?: string;
}

export interface ConflictRecoveryResult {
	success: boolean;
	resolvedBody: string;
	discardedBody: string;
	localBackupPath?: string;
	sourceBackupPath?: string;
	/** True when the source changed again during the resolution: nothing was replaced. */
	conflictChanged?: boolean;
	error?: string;
}

export type SyncedBlockEventListener = (
	sourcePath: string,
	event: 'modify' | 'lease-change' | 'conflict' | 'rename',
) => void;

export class SyncedBlockManager {
	private leases = new Map<string, SyncedLeaseInfo>();
	private listeners = new Set<SyncedBlockEventListener>();
	private activeResolutionStack = new Set<string>();
	private defaultFolder = '_synced';
	private internalSavePaths = new Set<string>();
	private preservationQueue = new Map<string, Promise<void>>();

	constructor(private plugin: InkwellPlugin) {
		this.registerVaultListeners();
	}

	private get app(): App {
		return this.plugin.app;
	}

	public getDefaultFolder(): string {
		return this.defaultFolder;
	}

	public addListener(listener: SyncedBlockEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(
		sourcePath: string,
		event: 'modify' | 'lease-change' | 'conflict' | 'rename',
	): void {
		for (const listener of this.listeners) {
			try {
				listener(sourcePath, event);
			} catch (e) {
				console.error('[Inkwell] Error in synced block listener:', e);
			}
		}
	}

	private registerVaultListeners(): void {
		this.plugin.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;

				const normPath = this.normalizePath(file.path);

				// Ignore internal saves initiated by Inkwell to prevent false conflicts
				if (this.internalSavePaths.has(normPath)) {
					this.internalSavePaths.delete(normPath);
					const lease = this.leases.get(normPath);
					if (lease) {
						lease.lastSeenMtime = file.stat.mtime;
					}
					this.notify(normPath, 'modify');
					return;
				}

				const lease = this.leases.get(normPath);

				if (lease) {
					// Check if modified externally while leased
					if (file.stat.mtime !== lease.lastSeenMtime) {
						try {
							const raw = await this.app.vault.read(file);
							const { body } = extractSourceContent(raw);
							if (body !== lease.lastSavedContent) {
								lease.hasConflict = true;
								lease.externalDiskContent = body;
								this.notify(normPath, 'conflict');
								return;
							}
						} catch (e) {
							console.error('[Inkwell] Failed to check external modification:', e);
						}
					}
				}

				this.notify(normPath, 'modify');
			}),
		);

		this.plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				const oldNorm = this.normalizePath(oldPath);
				const newNorm = this.normalizePath(file.path);

				const lease = this.leases.get(oldNorm);
				if (lease) {
					this.leases.delete(oldNorm);
					this.leases.set(newNorm, lease);
				}

				this.notify(newNorm, 'rename');
			}),
		);
	}

	public normalizePath(path: string): string {
		let clean = path.replace(/\\/g, '/').trim();
		if (!clean.endsWith('.md')) {
			clean += '.md';
		}
		return clean;
	}

	/**
	 * Resolves a target file in the vault using path and fallback syncId.
	 */
	public resolveSourceFile(
		targetPath: string,
		syncId?: string,
	): TFile | null {
		// 1. Direct path lookup
		let file = this.app.vault.getAbstractFileByPath(targetPath);
		if (file instanceof TFile) return file;

		const withMd = targetPath.endsWith('.md') ? targetPath : `${targetPath}.md`;
		file = this.app.vault.getAbstractFileByPath(withMd);
		if (file instanceof TFile) return file;

		// 2. MetadataCache linkpath lookup
		const dest = this.app.metadataCache.getFirstLinkpathDest(targetPath, '');
		if (dest instanceof TFile) return dest;

		// 3. Fallback search by persistent syncId in frontmatter
		if (syncId) {
			const mdFiles = this.app.vault.getMarkdownFiles();
			for (const f of mdFiles) {
				const cache = this.app.metadataCache.getFileCache(f);
				if (cache?.frontmatter && cache.frontmatter['inkwell-sync-id'] === syncId) {
					return f;
				}
			}
		}

		return null;
	}

	/**
	 * Checks whether an occurrence can acquire the edit lease.
	 */
	public canAcquireLease(
		sourcePath: string,
		occurrenceId: string,
	): { canAcquire: boolean; currentHolder?: string } {
		const norm = this.normalizePath(sourcePath);
		const existing = this.leases.get(norm);
		if (!existing || existing.occurrenceId === occurrenceId) {
			return { canAcquire: true };
		}
		return { canAcquire: false, currentHolder: existing.occurrenceId };
	}

	/**
	 * Acquires the single edit lease for a source file.
	 */
	public async acquireLease(
		sourcePath: string,
		occurrenceId: string,
		initialContent: string,
		mtime: number,
		flushAndRelease?: () => Promise<void>,
	): Promise<boolean> {
		const norm = this.normalizePath(sourcePath);
		const existing = this.leases.get(norm);
		let baselineContent = initialContent;
		let baselineMtime = mtime;
		if (existing && existing.occurrenceId !== occurrenceId) {
			if (existing.flushAndRelease) {
				try {
					await existing.flushAndRelease();
				} catch (e) {
					console.error('[Inkwell] Error during lease flush:', e);
				}
				// The previous holder refused to release (e.g. its conflicting draft
				// could not be preserved): do not take the lease over it.
				const stillHeld = this.leases.get(norm);
				if (stillHeld && stillHeld.occurrenceId !== occurrenceId) {
					return false;
				}
				// The previous holder may have just written its pending draft:
				// start the new lease from the source as it is now on disk,
				// not from the content read before the flush.
				const file = this.resolveSourceFile(sourcePath);
				if (file) {
					try {
						baselineContent = extractSourceContent(await this.app.vault.read(file)).body;
						baselineMtime = file.stat.mtime;
					} catch (e) {
						console.error('[Inkwell] Failed to re-read source after lease flush:', e);
					}
				}
			} else {
				return false;
			}
		}

		this.leases.set(norm, {
			occurrenceId,
			lastSavedContent: baselineContent,
			lastSeenMtime: baselineMtime,
			hasConflict: false,
			flushAndRelease,
		});

		this.notify(norm, 'lease-change');
		return true;
	}

	/**
	 * Releases the edit lease for a source file.
	 */
	public releaseLease(sourcePath: string, occurrenceId: string): void {
		const norm = this.normalizePath(sourcePath);
		const existing = this.leases.get(norm);
		if (existing && existing.occurrenceId === occurrenceId) {
			this.leases.delete(norm);
			this.notify(norm, 'lease-change');
		}
	}

	public getLeaseInfo(sourcePath: string): SyncedLeaseInfo | undefined {
		return this.leases.get(this.normalizePath(sourcePath));
	}

	/**
	 * Writes body text to source file safely, avoiding race conditions and conflicts.
	 */
	public async saveSource(
		sourcePath: string,
		bodyText: string,
		syncId?: string,
	): Promise<{ success: boolean; conflict?: boolean; error?: string }> {
		const file = this.resolveSourceFile(sourcePath, syncId);
		if (!file) {
			return {
				success: false,
				error: `Source introuvable : ${sourcePath}`,
			};
		}

		const norm = this.normalizePath(file.path);
		const lease = this.leases.get(norm);

		// If a conflict was already detected, refuse silent save
		if (lease?.hasConflict) {
			return { success: false, conflict: true };
		}

		// Check if external modification happened since last seen
		if (lease && file.stat.mtime !== lease.lastSeenMtime) {
			const currentRaw = await this.app.vault.read(file);
			const { body: currentBody } = extractSourceContent(currentRaw);
			if (currentBody !== lease.lastSavedContent && currentBody !== bodyText) {
				lease.hasConflict = true;
				lease.externalDiskContent = currentBody;
				this.notify(norm, 'conflict');
				return { success: false, conflict: true };
			}
		}

		// Read existing frontmatter syncId if not passed
		let effectiveSyncId = syncId;
		if (!effectiveSyncId) {
			const existingRaw = await this.app.vault.read(file);
			const { syncId: existingSyncId } = extractSourceContent(existingRaw);
			effectiveSyncId = existingSyncId ?? undefined;
		}

		const fullMarkdown = formatSourceContent(effectiveSyncId ?? null, bodyText);

		this.internalSavePaths.add(norm);
		if (lease) {
			lease.lastSavedContent = bodyText;
		}

		try {
			await this.app.vault.modify(file, fullMarkdown);
			if (lease) {
				lease.lastSeenMtime = file.stat.mtime;
			}
			return { success: true };
		} catch (e) {
			this.internalSavePaths.delete(norm);
			return {
				success: false,
				error: (e as Error).message || 'Échec de l’enregistrement de la source',
			};
		}
	}

	/**
	 * Writes one recovery snapshot in `_synced/conflits/` and confirms it exists.
	 * Shared by explicit conflict resolution and draft preservation on exit.
	 * Throws when the file cannot be created or confirmed.
	 */
	private async writeConflictSnapshot(
		kind: 'brouillon-local' | 'version-source',
		sourceFilePath: string,
		content: string,
		choiceLabel: string,
		now: Date,
	): Promise<string> {
		const folder = `${this.defaultFolder}/conflits`;
		const pad = (n: number) => n.toString().padStart(2, '0');
		const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}h${pad(now.getMinutes())}m${pad(now.getSeconds())}s`;
		const fileName = sourceFilePath.split('/').pop() ?? sourceFilePath;
		const baseName = fileName.replace(/\.md$/i, '').replace(/[/\\:*?"<>|]/g, '-');
		const title =
			kind === 'brouillon-local' ? 'Brouillon local' : 'Version source (disque)';

		await this.ensureFolderExists(folder);
		const path = await this.getUniqueSourcePath(`${baseName}-${kind}-${dateStr}`, folder);

		const header =
			`---\ninkwell-recup-type: ${kind}\ninkwell-source-fichier: "${sourceFilePath}"\ndate-recup: "${now.toISOString()}"\n---\n` +
			`# Récupération de conflit — ${title}\n` +
			`- Source : [[${sourceFilePath}]]\n` +
			`- Date : ${now.toLocaleString()}\n` +
			`- Choix appliqué : ${choiceLabel}\n\n` +
			`---\n\n`;

		await this.app.vault.create(path, header + content);
		if (!this.app.vault.getAbstractFileByPath(path)) {
			throw new Error('Les fichiers de sauvegarde n’ont pas pu être confirmés sur le disque.');
		}
		return path;
	}

	/**
	 * Durably preserves a conflicting local draft before its editor is closed
	 * (exit from edit mode or lease transfer), without touching the source.
	 *
	 * - No-op success when this occurrence holds no lease in conflict.
	 * - Writes the local draft and the current source version to `_synced/conflits/`
	 *   using the same snapshot format as explicit conflict resolution.
	 * - On failure, the lease and its conflict state are kept so the caller can
	 *   refuse to close the editor; snapshots already written are remembered so a
	 *   retry only writes what is missing.
	 * - Repeated or concurrent calls with the same draft and source version reuse
	 *   the existing snapshots instead of creating duplicates.
	 */
	public preserveConflictDraft(
		sourcePath: string,
		occurrenceId: string,
		localDraft: string,
	): Promise<ConflictPreservationResult> {
		const norm = this.normalizePath(sourcePath);
		const previous = this.preservationQueue.get(norm) ?? Promise.resolve();
		const run = previous.then(() =>
			this.doPreserveConflictDraft(sourcePath, occurrenceId, localDraft),
		);
		const tail = run.then(
			() => undefined,
			() => undefined,
		);
		this.preservationQueue.set(norm, tail);
		void tail.then(() => {
			if (this.preservationQueue.get(norm) === tail) {
				this.preservationQueue.delete(norm);
			}
		});
		return run;
	}

	private async doPreserveConflictDraft(
		sourcePath: string,
		occurrenceId: string,
		localDraft: string,
	): Promise<ConflictPreservationResult> {
		const file = this.resolveSourceFile(sourcePath);
		const sourceFilePath = file?.path ?? this.normalizePath(sourcePath);
		const lease =
			this.leases.get(this.normalizePath(sourcePath)) ??
			this.leases.get(this.normalizePath(sourceFilePath));

		if (!lease || lease.occurrenceId !== occurrenceId || !lease.hasConflict) {
			return { success: true };
		}

		let diskBody: string | null = null;
		if (file) {
			try {
				diskBody = extractSourceContent(await this.app.vault.read(file)).body;
			} catch (e) {
				return {
					success: false,
					error: `Lecture de la source impossible : ${(e as Error).message}`,
				};
			}
		}

		try {
			const snapshots = await this.ensureConflictSnapshots(
				lease,
				sourceFilePath,
				localDraft,
				diskBody,
				'Aucun — sortie d’édition pendant un conflit (source non modifiée)',
			);
			return {
				success: true,
				alreadyPreserved: !snapshots.wroteAny,
				localBackupPath: snapshots.localBackupPath,
				sourceBackupPath: snapshots.sourceBackupPath,
			};
		} catch (e) {
			console.error('[Inkwell] Échec de la sauvegarde de récupération:', e);
			return {
				success: false,
				localBackupPath: lease.preservation?.localBackupPath,
				sourceBackupPath: lease.preservation?.sourceBackupPath,
				error: `Échec de l’enregistrement de sécurité : ${(e as Error).message}`,
			};
		}
	}

	/**
	 * Ensures the local draft and the given source version are saved in
	 * `_synced/conflits/`, reusing snapshots already written in this conflict for
	 * identical content (retries, repeated exits, resolution after a refused exit).
	 * Throws on failure; snapshots written before the failure stay recorded on the lease.
	 */
	private async ensureConflictSnapshots(
		lease: SyncedLeaseInfo,
		sourceFilePath: string,
		localDraft: string,
		diskBody: string | null,
		choiceLabel: string,
	): Promise<{ localBackupPath?: string; sourceBackupPath?: string; wroteAny: boolean }> {
		const previous = lease.preservation;
		const record: ConflictPreservationRecord = {
			localDraft,
			diskBody,
			localBackupPath:
				previous?.localDraft === localDraft ? previous.localBackupPath : undefined,
			sourceBackupPath:
				previous && previous.diskBody === diskBody ? previous.sourceBackupPath : undefined,
		};
		lease.preservation = record;

		const exists = (p?: string) => !!p && !!this.app.vault.getAbstractFileByPath(p);
		const now = new Date();
		let wroteAny = false;
		if (!exists(record.localBackupPath)) {
			record.localBackupPath = await this.writeConflictSnapshot(
				'brouillon-local', sourceFilePath, localDraft, choiceLabel, now,
			);
			wroteAny = true;
		}
		if (diskBody !== null && !exists(record.sourceBackupPath)) {
			record.sourceBackupPath = await this.writeConflictSnapshot(
				'version-source', sourceFilePath, diskBody, choiceLabel, now,
			);
			wroteAny = true;
		}
		return {
			localBackupPath: record.localBackupPath,
			sourceBackupPath: record.sourceBackupPath,
			wroteAny,
		};
	}

	/**
	 * Explicitly resolves an active conflict with durable recovery snapshots.
	 *
	 * Order: read the source (body + mtime) → save both versions (reusing identical
	 * snapshots) → check the source did not change meanwhile → apply the choice.
	 * "keep-mine" writes through `vault.process`, which re-checks the source body in
	 * the same read-modify-write step, so a newer version is never overwritten by
	 * Obsidian-side writes. If the source changed, nothing is replaced, the conflict
	 * stays open with the newer content and `conflictChanged` is returned.
	 */
	public async resolveConflict(
		sourcePath: string,
		occurrenceId: string,
		choice: 'keep-mine' | 'reload-source',
		localDraft: string,
	): Promise<ConflictRecoveryResult> {
		const norm = this.normalizePath(sourcePath);
		const lease = this.leases.get(norm);
		const file = this.resolveSourceFile(sourcePath);

		if (!lease || !file) {
			return {
				success: false,
				resolvedBody: localDraft,
				discardedBody: '',
				error: 'Bail ou note source introuvable.',
			};
		}

		const conflictChanged = (newerBody: string): ConflictRecoveryResult => {
			lease.hasConflict = true;
			lease.externalDiskContent = newerBody;
			this.notify(norm, 'conflict');
			return {
				success: false,
				conflictChanged: true,
				resolvedBody: localDraft,
				discardedBody: newerBody,
				localBackupPath: lease.preservation?.localBackupPath,
				sourceBackupPath: lease.preservation?.sourceBackupPath,
				error:
					'La note source a de nouveau été modifiée pendant la résolution. ' +
					'Rien n’a été remplacé et votre brouillon est conservé. ' +
					'Relancez la résolution pour sauvegarder aussi la nouvelle version.',
			};
		};

		// Read current source content from disk, with the mtime it corresponds to
		let diskBody = '';
		let diskMtime = file.stat.mtime;
		try {
			const diskRaw = await this.app.vault.read(file);
			diskBody = extractSourceContent(diskRaw).body;
			if (file.stat.mtime !== diskMtime) {
				return conflictChanged(extractSourceContent(await this.app.vault.read(file)).body);
			}
		} catch (e) {
			return {
				success: false,
				resolvedBody: localDraft,
				discardedBody: '',
				error: `Lecture de la source impossible : ${(e as Error).message}`,
			};
		}

		// Recovery snapshots in _synced/conflits/ (reused when identical)
		const choiceLabel = choice === 'keep-mine' ? 'Conserver ma version' : 'Charger la version source';
		let localBackupPath: string | undefined;
		let sourceBackupPath: string | undefined;
		try {
			const snapshots = await this.ensureConflictSnapshots(
				lease, file.path, localDraft, diskBody, choiceLabel,
			);
			localBackupPath = snapshots.localBackupPath;
			sourceBackupPath = snapshots.sourceBackupPath;
		} catch (e) {
			// CRITICAL: If backup fails, DO NOT OVERWRITE! Keep conflict state open!
			console.error('[Inkwell] Échec de la sauvegarde de récupération:', e);
			return {
				success: false,
				resolvedBody: localDraft,
				discardedBody: diskBody,
				localBackupPath: lease.preservation?.localBackupPath,
				sourceBackupPath: lease.preservation?.sourceBackupPath,
				error: `Échec de l’enregistrement de sécurité : ${(e as Error).message}. Le remplacement est annulé et le conflit reste ouvert pour préserver vos données.`,
			};
		}

		// The source must not have changed while the recovery files were written
		if (file.stat.mtime !== diskMtime) {
			try {
				const currentBody = extractSourceContent(await this.app.vault.read(file)).body;
				if (currentBody !== diskBody) {
					return conflictChanged(currentBody);
				}
				diskMtime = file.stat.mtime;
			} catch (e) {
				return {
					success: false,
					resolvedBody: localDraft,
					discardedBody: diskBody,
					localBackupPath,
					sourceBackupPath,
					error: `Lecture de la source impossible : ${(e as Error).message}`,
				};
			}
		}

		// Recovery files confirmed on disk. Now proceed with applying the chosen resolution:
		if (choice === 'keep-mine') {
			const outcome: { newerBody: string | null; wrote: boolean } = {
				newerBody: null,
				wrote: false,
			};
			this.internalSavePaths.add(norm);
			try {
				await this.app.vault.process(file, (current) => {
					const parsed = extractSourceContent(current);
					if (parsed.body !== diskBody) {
						outcome.newerBody = parsed.body;
						return current;
					}
					const next = formatSourceContent(parsed.syncId, localDraft);
					outcome.wrote = next !== current;
					return next;
				});
			} catch (e) {
				this.internalSavePaths.delete(norm);
				return {
					success: false,
					resolvedBody: localDraft,
					discardedBody: diskBody,
					localBackupPath,
					sourceBackupPath,
					error: (e as Error).message || 'Échec de l’enregistrement de la source',
				};
			}
			if (!outcome.wrote) {
				this.internalSavePaths.delete(norm);
			}
			if (outcome.newerBody !== null) {
				return conflictChanged(outcome.newerBody);
			}

			lease.hasConflict = false;
			lease.externalDiskContent = undefined;
			lease.preservation = undefined;
			lease.lastSavedContent = localDraft;
			lease.lastSeenMtime = file.stat.mtime;
			return {
				success: true,
				resolvedBody: localDraft,
				discardedBody: diskBody,
				localBackupPath,
				sourceBackupPath,
			};
		} else {
			lease.hasConflict = false;
			lease.externalDiskContent = undefined;
			lease.preservation = undefined;
			lease.lastSavedContent = diskBody;
			lease.lastSeenMtime = diskMtime;
			this.notify(norm, 'modify');
			return {
				success: true,
				resolvedBody: diskBody,
				discardedBody: localDraft,
				localBackupPath,
				sourceBackupPath,
			};
		}
	}

	/**
	 * Ensures the destination folder exists recursively, creating it only when explicitly needed.
	 */
	public async ensureFolderExists(folderPath: string): Promise<void> {
		const clean = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		if (!clean) return;

		const parts = clean.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (!existing) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	/**
	 * Generates a unique, non-colliding file path for a new synced block.
	 */
	public async getUniqueSourcePath(
		name: string,
		folder: string = this.defaultFolder,
	): Promise<string> {
		const cleanFolder = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		const cleanName = name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'Bloc synchronisé';

		let candidate = `${cleanFolder}/${cleanName}.md`;
		let counter = 1;

		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = `${cleanFolder}/${cleanName}-${counter}.md`;
			counter++;
		}

		return candidate;
	}

	/**
	 * Cycle prevention helpers
	 */
	public beginResolution(sourcePath: string): boolean {
		const norm = this.normalizePath(sourcePath);
		if (this.activeResolutionStack.has(norm)) {
			return false; // Cycle detected!
		}
		this.activeResolutionStack.add(norm);
		return true;
	}

	public endResolution(sourcePath: string): void {
		const norm = this.normalizePath(sourcePath);
		this.activeResolutionStack.delete(norm);
	}
}
