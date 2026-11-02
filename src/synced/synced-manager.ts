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
}

export interface ConflictRecoveryResult {
	success: boolean;
	resolvedBody: string;
	discardedBody: string;
	localBackupPath?: string;
	sourceBackupPath?: string;
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
		if (existing && existing.occurrenceId !== occurrenceId) {
			if (existing.flushAndRelease) {
				try {
					await existing.flushAndRelease();
				} catch (e) {
					console.error('[Inkwell] Error during lease flush:', e);
				}
			} else {
				return false;
			}
		}

		this.leases.set(norm, {
			occurrenceId,
			lastSavedContent: initialContent,
			lastSeenMtime: mtime,
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
	 * Explicitly resolves an active conflict with durable recovery snapshots.
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

		// Read current source content from disk
		let diskBody = '';
		try {
			const diskRaw = await this.app.vault.read(file);
			diskBody = extractSourceContent(diskRaw).body;
		} catch (e) {
			return {
				success: false,
				resolvedBody: localDraft,
				discardedBody: '',
				error: `Lecture de la source impossible : ${(e as Error).message}`,
			};
		}

		// Prepare recovery snapshots in _synced/conflits/
		const folder = `${this.defaultFolder}/conflits`;
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}h${pad(now.getMinutes())}m${pad(now.getSeconds())}s`;
		const baseName = file.basename.replace(/[/\\:*?"<>|]/g, '-');

		let localBackupPath = '';
		let sourceBackupPath = '';

		try {
			await this.ensureFolderExists(folder);

			localBackupPath = await this.getUniqueSourcePath(
				`${baseName}-brouillon-local-${dateStr}`,
				folder,
			);
			sourceBackupPath = await this.getUniqueSourcePath(
				`${baseName}-version-source-${dateStr}`,
				folder,
			);

			const localHeader =
				`---\ninkwell-recup-type: brouillon-local\ninkwell-source-fichier: "${file.path}"\ndate-recup: "${now.toISOString()}"\n---\n` +
				`# Récupération de conflit — Brouillon local\n` +
				`- Source : [[${file.path}]]\n` +
				`- Date : ${now.toLocaleString()}\n` +
				`- Choix appliqué : ${choice === 'keep-mine' ? 'Conserver ma version' : 'Charger la version source'}\n\n` +
				`---\n\n`;

			const sourceHeader =
				`---\ninkwell-recup-type: version-source\ninkwell-source-fichier: "${file.path}"\ndate-recup: "${now.toISOString()}"\n---\n` +
				`# Récupération de conflit — Version source (disque)\n` +
				`- Source : [[${file.path}]]\n` +
				`- Date : ${now.toLocaleString()}\n` +
				`- Choix appliqué : ${choice === 'keep-mine' ? 'Conserver ma version' : 'Charger la version source'}\n\n` +
				`---\n\n`;

			// Create both recovery snapshot files and confirm their existence on disk
			await this.app.vault.create(localBackupPath, localHeader + localDraft);
			await this.app.vault.create(sourceBackupPath, sourceHeader + diskBody);

			const checkLocal = this.app.vault.getAbstractFileByPath(localBackupPath);
			const checkSource = this.app.vault.getAbstractFileByPath(sourceBackupPath);
			if (!checkLocal || !checkSource) {
				throw new Error('Les fichiers de sauvegarde n’ont pas pu être confirmés sur le disque.');
			}
		} catch (e) {
			// CRITICAL: If backup fails, DO NOT OVERWRITE! Keep conflict state open!
			console.error('[Inkwell] Échec de la sauvegarde de récupération:', e);
			return {
				success: false,
				resolvedBody: localDraft,
				discardedBody: diskBody,
				error: `Échec de l’enregistrement de sécurité : ${(e as Error).message}. Le remplacement est annulé et le conflit reste ouvert pour préserver vos données.`,
			};
		}

		// Recovery files confirmed on disk. Now proceed with applying the chosen resolution:
		if (choice === 'keep-mine') {
			lease.hasConflict = false;
			const saveRes = await this.saveSource(sourcePath, localDraft);
			if (!saveRes.success) {
				return {
					success: false,
					resolvedBody: localDraft,
					discardedBody: diskBody,
					localBackupPath,
					sourceBackupPath,
					error: saveRes.error,
				};
			}
			return {
				success: true,
				resolvedBody: localDraft,
				discardedBody: diskBody,
				localBackupPath,
				sourceBackupPath,
			};
		} else {
			lease.hasConflict = false;
			lease.lastSavedContent = diskBody;
			lease.lastSeenMtime = file.stat.mtime;
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
