import { App, TFile, TFolder } from 'obsidian';
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
	public acquireLease(
		sourcePath: string,
		occurrenceId: string,
		initialContent: string,
		mtime: number,
	): boolean {
		const norm = this.normalizePath(sourcePath);
		const existing = this.leases.get(norm);
		if (existing && existing.occurrenceId !== occurrenceId) {
			return false;
		}

		this.leases.set(norm, {
			occurrenceId,
			lastSavedContent: initialContent,
			lastSeenMtime: mtime,
			hasConflict: false,
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

		try {
			await this.app.vault.modify(file, fullMarkdown);
			if (lease) {
				lease.lastSavedContent = bodyText;
				lease.lastSeenMtime = file.stat.mtime;
			}
			return { success: true };
		} catch (e) {
			return {
				success: false,
				error: (e as Error).message || 'Échec de l’enregistrement de la source',
			};
		}
	}

	/**
	 * Explicitly resolves an active conflict.
	 */
	public async resolveConflict(
		sourcePath: string,
		occurrenceId: string,
		choice: 'keep-mine' | 'reload-source',
		localDraft: string,
	): Promise<string> {
		const norm = this.normalizePath(sourcePath);
		const lease = this.leases.get(norm);
		const file = this.resolveSourceFile(sourcePath);

		if (!lease || !file) {
			return localDraft;
		}

		if (choice === 'keep-mine') {
			lease.hasConflict = false;
			await this.saveSource(sourcePath, localDraft);
			return localDraft;
		} else {
			lease.hasConflict = false;
			const diskRaw = await this.app.vault.read(file);
			const { body } = extractSourceContent(diskRaw);
			lease.lastSavedContent = body;
			lease.lastSeenMtime = file.stat.mtime;
			this.notify(norm, 'modify');
			return body;
		}
	}

	/**
	 * Ensures the destination folder exists, creating it only when explicitly needed.
	 */
	public async ensureFolderExists(folderPath: string): Promise<void> {
		const clean = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		if (!clean) return;

		const existing = this.app.vault.getAbstractFileByPath(clean);
		if (existing instanceof TFolder) return;

		await this.app.vault.createFolder(clean);
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
