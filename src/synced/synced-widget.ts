import {
	EditorSelection,
	EditorState,
	Extension,
	Prec,
	Range,
	StateField,
} from '@codemirror/state';
import {
	defaultKeymap,
	history,
	historyKeymap,
} from '@codemirror/commands';
import {
	Decoration,
	DecorationSet,
	EditorView,
	keymap,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import {
	Component,
	editorLivePreviewField,
	MarkdownRenderer,
	Menu,
	Notice,
	setIcon,
} from 'obsidian';
import type InkwellPlugin from '../main';
import { createSlashMenuExtension } from '../slash-menu/extension';
import { createColumnVisualMarkdownExtension } from '../columns/column-markdown-deco';
import {
	extractSourceContent,
	parseSyncedBlockFromLines,
	serializeSyncedReference,
	SyncedBlockReference,
} from './synced-model';

/**
 * Controller map per parent EditorView: maps syncedBlockIndex -> VisualSyncedBlockController
 */
const syncedControllersByParentView = new WeakMap<
	EditorView,
	Map<number, VisualSyncedBlockController>
>();

export function getSyncedController(
	parentView: EditorView,
	index: number,
): VisualSyncedBlockController | undefined {
	return syncedControllersByParentView.get(parentView)?.get(index);
}

function registerSyncedController(
	parentView: EditorView,
	index: number,
	controller: VisualSyncedBlockController,
): void {
	let map = syncedControllersByParentView.get(parentView);
	if (!map) {
		map = new Map();
		syncedControllersByParentView.set(parentView, map);
	}
	map.set(index, controller);
}

function cleanupExcessSyncedControllers(
	parentView: EditorView,
	activeCount: number,
): void {
	const map = syncedControllersByParentView.get(parentView);
	if (!map) return;
	for (const [idx, ctrl] of map.entries()) {
		if (idx >= activeCount) {
			ctrl.destroy();
			map.delete(idx);
		}
	}
}

export class VisualSyncedBlockController {
	public readonly rootEl: HTMLElement;
	public blockFrom: number;
	public blockTo: number;
	public blockIndex: number;
	public parentView: EditorView;
	public readonly plugin: InkwellPlugin;

	private reference: SyncedBlockReference;
	private occurrenceId: string;
	private activeEditorView: EditorView | null = null;
	private previewComponent: Component | null = null;
	private isEditing = false;
	private saveTimeout: number | null = null;
	private unsubscribeManager: (() => void) | null = null;

	// UI elements
	private headerEl!: HTMLElement;
	private titleEl!: HTMLElement;
	private badgeEl!: HTMLElement;
	private actionsBtnEl!: HTMLElement;
	private conflictBannerEl: HTMLElement | null = null;
	private contentHostEl!: HTMLElement;

	private lastSavedBody = '';
	private isUpdatingFromParent = false;

	constructor(
		reference: SyncedBlockReference,
		blockFrom: number,
		blockTo: number,
		blockIndex: number,
		parentView: EditorView,
		plugin: InkwellPlugin,
	) {
		this.reference = reference;
		this.blockFrom = blockFrom;
		this.blockTo = blockTo;
		this.blockIndex = blockIndex;
		this.parentView = parentView;
		this.plugin = plugin;
		this.occurrenceId = `occ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

		this.rootEl = createDiv({ cls: 'inkwell-synced-block-root' });

		this.buildHeader();
		this.buildContentHost();

		this.setupManagerListener();
		void this.initContent();
	}

	private setupManagerListener(): void {
		this.unsubscribeManager = this.plugin.syncedBlockManager.addListener(
			(sourcePath, event) => {
				const normTarget = this.plugin.syncedBlockManager.normalizePath(
					this.reference.targetPath,
				);
				if (sourcePath !== normTarget) return;

				if (event === 'conflict') {
					this.showConflictBanner();
					this.updateBadge();
				} else if (event === 'lease-change') {
					const lease = this.plugin.syncedBlockManager.getLeaseInfo(sourcePath);
					if (this.isEditing && lease && lease.occurrenceId !== this.occurrenceId) {
						// Another occurrence took the lease cleanly
						void this.switchToPreview();
					} else {
						this.updateBadge();
					}
				} else if (event === 'modify') {
					if (!this.isEditing) {
						void this.renderPreview();
					}
				} else if (event === 'rename') {
					this.reference.targetPath = sourcePath;
					this.updateBadge();
					if (!this.isEditing) {
						void this.renderPreview();
					}
				}
			},
		);
	}

	private buildHeader(): void {
		this.headerEl = this.rootEl.createDiv({ cls: 'inkwell-synced-header' });

		const leftEl = this.headerEl.createDiv({ cls: 'inkwell-synced-header-left' });
		const iconEl = leftEl.createSpan({ cls: 'inkwell-synced-icon' });
		setIcon(iconEl, 'refresh-cw');

		this.titleEl = leftEl.createSpan({
			cls: 'inkwell-synced-title',
			text: this.reference.title,
		});

		const rightEl = this.headerEl.createDiv({ cls: 'inkwell-synced-header-right' });
		this.badgeEl = rightEl.createSpan({ cls: 'inkwell-synced-badge' });
		this.badgeEl.addEventListener('click', (e) => {
			e.stopPropagation();
			if (!this.isEditing) {
				void this.startEditing();
			} else {
				void this.switchToPreview();
			}
		});

		this.actionsBtnEl = rightEl.createDiv({
			cls: 'inkwell-synced-actions-btn',
			attr: {
				'aria-label': 'Options du bloc synchronisé',
				tabindex: '0',
				role: 'button',
			},
		});
		setIcon(this.actionsBtnEl, 'more-horizontal');

		this.actionsBtnEl.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});
		this.actionsBtnEl.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openActionsMenu(e);
		});
	}

	private buildContentHost(): void {
		this.contentHostEl = this.rootEl.createDiv({ cls: 'inkwell-synced-content-host' });
	}

	private updateBadge(): void {
		const sourceFile = this.plugin.syncedBlockManager.resolveSourceFile(
			this.reference.targetPath,
			this.reference.syncId,
		);
		if (!sourceFile) {
			this.badgeEl.className = 'inkwell-synced-badge is-missing';
			this.badgeEl.setText('Source introuvable');
			return;
		}

		const lease = this.plugin.syncedBlockManager.getLeaseInfo(this.reference.targetPath);
		if (lease?.hasConflict) {
			this.badgeEl.className = 'inkwell-synced-badge is-conflict';
			this.badgeEl.setText('Conflit détecté');
			return;
		}

		if (this.isEditing) {
			this.badgeEl.className = 'inkwell-synced-badge is-editing';
			this.badgeEl.setText('Édition en cours');
		} else if (lease) {
			this.badgeEl.className = 'inkwell-synced-badge is-locked';
			this.badgeEl.setText('Édité ailleurs');
		} else {
			this.badgeEl.className = 'inkwell-synced-badge is-synced';
			this.badgeEl.setText('Synchronisé');
		}
	}

	private async initContent(): Promise<void> {
		this.updateBadge();
		await this.renderPreview();
	}

	private async renderPreview(): Promise<void> {
		if (this.previewComponent) {
			this.previewComponent.unload();
			this.previewComponent = null;
		}
		this.contentHostEl.empty();

		const sourceFile = this.plugin.syncedBlockManager.resolveSourceFile(
			this.reference.targetPath,
			this.reference.syncId,
		);

		if (!sourceFile) {
			const missingEl = this.contentHostEl.createDiv({
				cls: 'inkwell-synced-missing-box',
			});
			const warnIcon = missingEl.createSpan({ cls: 'inkwell-synced-missing-icon' });
			setIcon(warnIcon, 'alert-circle');
			missingEl.createSpan({
				cls: 'inkwell-synced-missing-text',
				text: `Note source introuvable : ${this.reference.targetPath}`,
			});

			const createBtn = missingEl.createEl('button', {
				cls: 'mod-cta inkwell-synced-create-source-btn',
				text: 'Créer la note',
			});
			createBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.createMissingSourceFile();
			});
			this.updateBadge();
			return;
		}

		// Check for cycle prevention
		if (!this.plugin.syncedBlockManager.beginResolution(sourceFile.path)) {
			this.contentHostEl.createDiv({
				cls: 'inkwell-synced-cycle-warning',
				text: '⚠️ Référence circulaire détectée sur ce bloc synchronisé.',
			});
			return;
		}

		let body = '';
		try {
			const raw = await this.plugin.app.vault.read(sourceFile);
			const parsed = extractSourceContent(raw);
			body = parsed.body;
			this.lastSavedBody = body;
		} catch (e) {
			console.error('[Inkwell] Failed to read source file:', e);
		} finally {
			this.plugin.syncedBlockManager.endResolution(sourceFile.path);
		}

		const previewContainer = this.contentHostEl.createDiv({
			cls: 'inkwell-synced-preview-container',
		});

		previewContainer.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});
		previewContainer.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.startEditing();
		});

		this.previewComponent = new Component();
		this.previewComponent.load();

		if (body.trim().length === 0) {
			previewContainer.createDiv({
				cls: 'inkwell-synced-empty-hint',
				text: 'Bloc synchronisé vide — Cliquez pour écrire du contenu.',
			});
		} else {
			await MarkdownRenderer.render(
				this.plugin.app,
				body,
				previewContainer,
				sourceFile.path,
				this.previewComponent,
			);
		}

		// Click to edit banner / overlay
		const editOverlay = previewContainer.createDiv({
			cls: 'inkwell-synced-edit-overlay',
			text: 'Cliquer pour éditer ce bloc',
		});
		editOverlay.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.startEditing();
		});

		this.updateBadge();
	}

	public async startEditing(): Promise<void> {
		if (this.isEditing) return;

		const sourceFile = this.plugin.syncedBlockManager.resolveSourceFile(
			this.reference.targetPath,
			this.reference.syncId,
		);
		if (!sourceFile) {
			new Notice(`Source introuvable : ${this.reference.targetPath}`);
			return;
		}

		const raw = await this.plugin.app.vault.read(sourceFile);
		const { body } = extractSourceContent(raw);
		this.lastSavedBody = body;

		const acquired = await this.plugin.syncedBlockManager.acquireLease(
			sourceFile.path,
			this.occurrenceId,
			body,
			sourceFile.stat.mtime,
			() => this.switchToPreview(),
		);

		if (!acquired) {
			new Notice(
				'Ce bloc synchronisé est déjà en cours d’édition dans un autre onglet.',
			);
			return;
		}

		if (this.previewComponent) {
			this.previewComponent.unload();
			this.previewComponent = null;
		}
		this.contentHostEl.empty();

		this.isEditing = true;
		this.updateBadge();

		this.mountSubEditor(body);
	}

	private mountSubEditor(initialBody: string): void {
		const editorWrapper = this.contentHostEl.createDiv({
			cls: 'inkwell-synced-editor-wrapper',
		});

		const state = EditorState.create({
			doc: initialBody,
			extensions: [
				history(),
				Prec.highest(
					keymap.of([
						...historyKeymap,
						...defaultKeymap,
						{
							key: 'ArrowUp',
							run: (view) => {
								const sel = view.state.selection.main;
								if (!sel.empty) return false;
								const line = view.state.doc.lineAt(sel.head);
								if (line.number === 1) {
									return this.exitAbove();
								}
								return false;
							},
						},
						{
							key: 'ArrowDown',
							run: (view) => {
								const sel = view.state.selection.main;
								if (!sel.empty) return false;
								const line = view.state.doc.lineAt(sel.head);
								if (line.number === view.state.doc.lines) {
									return this.exitBelow();
								}
								return false;
							},
						},
						{
							key: 'Escape',
							run: () => {
								void this.switchToPreview();
								return true;
							},
						},
					]),
				),
				createColumnVisualMarkdownExtension(),
				createSlashMenuExtension(this.plugin),
				EditorView.updateListener.of((update) => this.onSubEditorUpdate(update)),
			],
		});

		this.activeEditorView = new EditorView({
			state,
			parent: editorWrapper,
		});

		// Focus the new sub-editor
		window.setTimeout(() => {
			this.activeEditorView?.focus();
		}, 10);
	}

	private onSubEditorUpdate(update: ViewUpdate): void {
		if (update.docChanged && !this.isUpdatingFromParent) {
			const newBody = update.view.state.doc.toString();
			this.lastSavedBody = newBody;

			if (this.saveTimeout !== null) {
				window.clearTimeout(this.saveTimeout);
			}

			this.saveTimeout = window.setTimeout(() => {
				this.saveTimeout = null;
				void this.flushSave();
			}, 350);
		}
	}

	private async flushSave(): Promise<void> {
		if (!this.activeEditorView) return;
		const body = this.activeEditorView.state.doc.toString();
		const res = await this.plugin.syncedBlockManager.saveSource(
			this.reference.targetPath,
			body,
			this.reference.syncId,
		);
		if (res.conflict) {
			this.showConflictBanner();
			this.updateBadge();
		}
	}

	private showConflictBanner(): void {
		if (this.conflictBannerEl) return;

		this.conflictBannerEl = createDiv({ cls: 'inkwell-synced-conflict-banner' });

		this.conflictBannerEl.createDiv({
			cls: 'inkwell-synced-conflict-msg',
			text: '⚠️ La note source a été modifiée ailleurs pendant votre édition.',
		});

		const btnsEl = this.conflictBannerEl.createDiv({
			cls: 'inkwell-synced-conflict-actions',
		});

		const keepMineBtn = btnsEl.createEl('button', {
			cls: 'mod-cta',
			text: 'Conserver ma version',
		});
		keepMineBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.resolveConflictChoice('keep-mine');
		});

		const reloadSourceBtn = btnsEl.createEl('button', {
			text: 'Charger la version source',
		});
		reloadSourceBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.resolveConflictChoice('reload-source');
		});

		this.rootEl.insertBefore(this.conflictBannerEl, this.contentHostEl);
	}

	private hideConflictBanner(): void {
		if (this.conflictBannerEl) {
			this.conflictBannerEl.remove();
			this.conflictBannerEl = null;
		}
	}

	private async resolveConflictChoice(
		choice: 'keep-mine' | 'reload-source',
	): Promise<void> {
		const currentDraft = this.activeEditorView
			? this.activeEditorView.state.doc.toString()
			: this.lastSavedBody;

		const result = await this.plugin.syncedBlockManager.resolveConflict(
			this.reference.targetPath,
			this.occurrenceId,
			choice,
			currentDraft,
		);

		if (!result.success) {
			new Notice(
				result.error ||
					'Échec de la sauvegarde de récupération. Le conflit reste actif pour protéger vos données.',
				8000,
			);
			return;
		}

		this.hideConflictBanner();

		if (choice === 'reload-source') {
			if (this.activeEditorView) {
				this.isUpdatingFromParent = true;
				try {
					this.activeEditorView.dispatch({
						changes: {
							from: 0,
							to: this.activeEditorView.state.doc.length,
							insert: result.resolvedBody,
						},
					});
				} finally {
					this.isUpdatingFromParent = false;
				}
			}
			// Copy discarded draft to clipboard as complementary convenience
			if (result.discardedBody) {
				try {
					await navigator.clipboard.writeText(result.discardedBody);
				} catch {
					// clipboard fallback
				}
			}
		}

		const actionLabel =
			choice === 'keep-mine' ? 'Brouillon local conservé' : 'Version source rechargée';
		const noticeMsg =
			`Conflit résolu (${actionLabel}).\n` +
			`Deux sauvegardes créées dans ${this.plugin.syncedBlockManager.getDefaultFolder()}/conflits/ :\n` +
			`• ${result.localBackupPath}\n` +
			`• ${result.sourceBackupPath}`;

		new Notice(noticeMsg, 10000);
		this.updateBadge();
	}

	public async switchToPreview(): Promise<void> {
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
			await this.flushSave();
		}

		if (this.activeEditorView) {
			this.activeEditorView.destroy();
			this.activeEditorView = null;
		}

		this.isEditing = false;
		this.plugin.syncedBlockManager.releaseLease(
			this.reference.targetPath,
			this.occurrenceId,
		);

		this.updateBadge();
		await this.renderPreview();
	}

	private openActionsMenu(e: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle('Ouvrir la note source')
				.setIcon('external-link')
				.onClick(() => {
					void this.plugin.app.workspace.openLinkText(
						this.reference.targetPath,
						'',
					);
				});
		});

		menu.addItem((item) => {
			item.setTitle('Copier la référence')
				.setIcon('copy')
				.onClick(async () => {
					const text = serializeSyncedReference(
						this.reference.targetPath,
						this.reference.title,
						this.reference.syncId,
					);
					await navigator.clipboard.writeText(text);
					new Notice('Référence du bloc synchronisé copiée dans le presse-papiers.');
				});
		});

		menu.addItem((item) => {
			item.setTitle('Dissocier cette occurrence')
				.setIcon('unlink')
				.onClick(async () => {
					await this.dissociateOccurrence();
				});
		});

		if (!this.isEditing) {
			menu.addItem((item) => {
				item.setTitle('Éditer ici')
					.setIcon('edit-3')
					.onClick(() => {
						void this.startEditing();
					});
			});
		} else {
			menu.addItem((item) => {
				item.setTitle('Terminer l’édition')
					.setIcon('check')
					.onClick(() => {
						void this.switchToPreview();
					});
			});
		}

		menu.showAtMouseEvent(e);
	}

	public async dissociateOccurrence(): Promise<void> {
		if (this.isEditing) {
			await this.switchToPreview();
		}

		const sourceFile = this.plugin.syncedBlockManager.resolveSourceFile(
			this.reference.targetPath,
			this.reference.syncId,
		);

		let body = this.lastSavedBody;
		if (sourceFile) {
			try {
				const raw = await this.plugin.app.vault.read(sourceFile);
				body = extractSourceContent(raw).body;
			} catch (e) {
				console.error('[Inkwell] Failed to read source for dissociation:', e);
			}
		}

		this.parentView.dispatch({
			changes: {
				from: this.blockFrom,
				to: this.blockTo,
				insert: body.trim(),
			},
			userEvent: 'inkwell.synced.dissociate',
		});

		new Notice('Occurrence dissociée : le bloc est désormais un texte indépendant.');
	}

	private async createMissingSourceFile(): Promise<void> {
		await this.plugin.syncedBlockManager.ensureFolderExists(
			this.plugin.syncedBlockManager.getDefaultFolder(),
		);
		const fullMarkdown = this.reference.syncId
			? `---\ninkwell-sync-id: ${this.reference.syncId}\n---\n`
			: '';

		try {
			await this.plugin.app.vault.create(
				this.reference.targetPath,
				fullMarkdown,
			);
			new Notice(`Note source créée : ${this.reference.targetPath}`);
			await this.renderPreview();
		} catch (e) {
			new Notice(`Impossible de créer la source : ${(e as Error).message}`);
		}
	}

	public updateFromParent(
		reference: SyncedBlockReference,
		blockFrom: number,
		blockTo: number,
		parentView: EditorView,
	): void {
		this.blockFrom = blockFrom;
		this.blockTo = blockTo;
		this.parentView = parentView;

		if (
			reference.title !== this.reference.title ||
			reference.targetPath !== this.reference.targetPath ||
			reference.syncId !== this.reference.syncId
		) {
			this.reference = reference;
			this.titleEl.setText(reference.title);
			this.updateBadge();
			if (!this.isEditing) {
				void this.renderPreview();
			}
		}
	}

	public exitAbove(): boolean {
		if (this.blockFrom <= 0) return false;
		const prevPos = Math.max(0, this.blockFrom - 1);
		this.parentView.dispatch({
			selection: EditorSelection.cursor(prevPos),
			scrollIntoView: true,
		});
		this.parentView.focus();
		return true;
	}

	public exitBelow(): boolean {
		const nextPos = Math.min(this.blockTo + 1, this.parentView.state.doc.length);
		this.parentView.dispatch({
			selection: EditorSelection.cursor(nextPos),
			scrollIntoView: true,
		});
		this.parentView.focus();
		return true;
	}

	public destroy(): void {
		if (this.unsubscribeManager) {
			this.unsubscribeManager();
			this.unsubscribeManager = null;
		}
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
			void this.flushSave();
		}
		if (this.activeEditorView) {
			this.activeEditorView.destroy();
			this.activeEditorView = null;
		}
		if (this.previewComponent) {
			this.previewComponent.unload();
			this.previewComponent = null;
		}
		if (this.isEditing) {
			this.plugin.syncedBlockManager.releaseLease(
				this.reference.targetPath,
				this.occurrenceId,
			);
		}
		this.hideConflictBanner();
	}
}

export class VisualSyncedBlockWidget extends WidgetType {
	constructor(
		public readonly reference: SyncedBlockReference,
		public readonly blockFrom: number,
		public readonly blockTo: number,
		public readonly blockIndex: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	override eq(other: VisualSyncedBlockWidget): boolean {
		return (
			other.blockFrom === this.blockFrom &&
			other.blockTo === this.blockTo &&
			other.blockIndex === this.blockIndex &&
			other.reference.rawMarkdown === this.reference.rawMarkdown
		);
	}

	override toDOM(view: EditorView): HTMLElement {
		let ctrl = getSyncedController(view, this.blockIndex);
		if (ctrl) {
			ctrl.updateFromParent(
				this.reference,
				this.blockFrom,
				this.blockTo,
				view,
			);
			return ctrl.rootEl;
		}

		ctrl = new VisualSyncedBlockController(
			this.reference,
			this.blockFrom,
			this.blockTo,
			this.blockIndex,
			view,
			this.plugin,
		);
		registerSyncedController(view, this.blockIndex, ctrl);
		return ctrl.rootEl;
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

let activeSyncedPlugin: InkwellPlugin | null = null;

function buildSyncedDecorations(
	doc: {
		lines: number;
		line: (n: number) => { from: number; to: number; text: string };
	},
	plugin: InkwellPlugin,
): { decorations: DecorationSet; count: number } {
	const decorations: Range<Decoration>[] = [];
	let i = 1;
	let blockIndex = 0;

	while (i <= doc.lines) {
		const line = doc.line(i);
		const lineText = line.text;

		// Check if line begins a synced callout: `> [!synced...]`
		if (/^\s*>\s*\[!synced/i.test(lineText)) {
			const startPos = line.from;
			let endPos = line.to;
			let endLineNum = i;
			const lines: string[] = [lineText];

			for (let j = i + 1; j <= doc.lines; j++) {
				const nextLine = doc.line(j);
				if (/^\s*>/.test(nextLine.text)) {
					lines.push(nextLine.text);
					endPos = nextLine.to;
					endLineNum = j;
				} else {
					break;
				}
			}

			const ref = parseSyncedBlockFromLines(lines, startPos);
			if (ref) {
				decorations.push(
					Decoration.replace({
						widget: new VisualSyncedBlockWidget(
							ref,
							startPos,
							endPos,
							blockIndex,
							plugin,
						),
						block: true,
					}).range(startPos, endPos),
				);
				blockIndex++;
				i = endLineNum + 1;
				continue;
			}
		}

		i++;
	}

	return {
		decorations: Decoration.set(decorations, true),
		count: blockIndex,
	};
}

export const visualSyncedField = StateField.define<DecorationSet>({
	create(state) {
		if (!activeSyncedPlugin) {
			return Decoration.none;
		}
		if (state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		try {
			return buildSyncedDecorations(state.doc, activeSyncedPlugin).decorations;
		} catch {
			return Decoration.none;
		}
	},
	update(decorations, tr) {
		if (!activeSyncedPlugin) {
			return Decoration.none;
		}
		if (tr.state.field(editorLivePreviewField, false) === false) {
			return Decoration.none;
		}
		if (tr.docChanged || decorations === Decoration.none) {
			try {
				return buildSyncedDecorations(tr.state.doc, activeSyncedPlugin).decorations;
			} catch {
				return Decoration.none;
			}
		}
		return decorations.map(tr.changes);
	},
	provide: (f) => [
		Prec.highest(EditorView.decorations.from(f)),
		EditorView.atomicRanges.of((view) => {
			if (activeSyncedPlugin) {
				const count = buildSyncedDecorations(
					view.state.doc,
					activeSyncedPlugin,
				).count;
				cleanupExcessSyncedControllers(view, count);
			}
			return view.state.field(f, false) ?? Decoration.none;
		}),
	],
});

export function createVisualSyncedExtension(plugin: InkwellPlugin): Extension {
	activeSyncedPlugin = plugin;
	return [visualSyncedField];
}
