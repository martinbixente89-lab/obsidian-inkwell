import {
	EditorState,
	Extension,
	Range,
	StateField,
} from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	WidgetType,
} from '@codemirror/view';
import {
	editorLivePreviewField,
	Menu,
	Notice,
	setIcon,
} from 'obsidian';
import type InkwellPlugin from '../main';
import {
	ButtonParseResult,
	isValidWebUrl,
	parseButton,
	sanitizeColor,
} from './button-model';
import { ButtonModal } from './button-modal';
import {
	CommandExecutionContext,
	executeCommandSafely,
	getCommandInfo,
	validateCommandExecution,
} from './command-adapter';
import { CommandConfirmModal } from './button-confirm-modal';

export class VisualButtonWidget extends WidgetType {
	private isActionLocked = false;

	constructor(
		public readonly parseResult: ButtonParseResult,
		public readonly blockFrom: number,
		public readonly blockTo: number,
		public readonly blockIndex: number,
		public readonly plugin: InkwellPlugin,
		public readonly isSubEditor: boolean = false,
	) {
		super();
	}

	override eq(other: VisualButtonWidget): boolean {
		return (
			other.blockFrom === this.blockFrom &&
			other.blockTo === this.blockTo &&
			other.parseResult.rawMarkdown === this.parseResult.rawMarkdown &&
			other.isSubEditor === this.isSubEditor
		);
	}

	override toDOM(view: EditorView): HTMLElement {
		const root = createDiv({ cls: 'inkwell-button-root' });
		const data = this.parseResult.data;

		// Main Action Button Element
		const btnEl = root.createEl('button', {
			cls: 'inkwell-action-btn',
			attr: {
				type: 'button',
				tabindex: '0',
			},
		});

		if (!this.parseResult.isValid || !data) {
			btnEl.addClass('is-disabled');
			btnEl.createSpan({ cls: 'inkwell-btn-icon', text: '⚠️ ' });
			btnEl.createSpan({
				text: data?.label ? `${data.label} (invalide)` : 'Bouton invalide',
			});
			btnEl.setAttribute(
				'title',
				this.parseResult.validationError || 'Configuration de bouton invalide',
			);

			btnEl.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				new Notice(
					`Bouton désactivé : ${this.parseResult.validationError || 'configuration invalide'}. Utilisez le menu pour le modifier.`,
					6000,
				);
			});
		} else {
			btnEl.setText(data.label);
			btnEl.addClass(data.variant === 'outline' ? 'is-outline' : 'is-filled');

			const cleanColor = sanitizeColor(data.color);
			if (cleanColor) {
				btnEl.style.setProperty('--inkwell-btn-color', cleanColor);
			}

			// Click handler with debounce & context protection
			btnEl.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.executeButtonAction();
			});

			btnEl.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					e.stopPropagation();
					this.executeButtonAction();
				}
			});
		}

		// Edit / Options Menu Button (⋯)
		const actionsWrap = root.createDiv({ cls: 'inkwell-button-actions' });
		const menuBtn = actionsWrap.createDiv({
			cls: 'inkwell-button-menu-btn',
			attr: {
				'aria-label': 'Options du bouton',
				tabindex: '0',
				role: 'button',
			},
		});
		setIcon(menuBtn, 'more-horizontal');

		const openMenu = (e: MouseEvent): void => {
			e.stopPropagation();
			e.preventDefault();

			const menu = new Menu();

			menu.addItem((item) => {
				item.setTitle('Modifier le bouton')
					.setIcon('pencil')
					.onClick(() => {
						const modal = new ButtonModal(this.plugin.app, {
							initialData: data || undefined,
							onSave: (_newData, markdown) => {
								view.dispatch({
									changes: {
										from: this.blockFrom,
										to: this.blockTo,
										insert: markdown,
									},
									userEvent: 'inkwell.button.edit',
								});
								new Notice('Bouton d’action mis à jour.');
							},
						});
						modal.open();
					});
			});

			menu.addItem((item) => {
				item.setTitle('Dupliquer le bouton')
					.setIcon('copy')
					.onClick(() => {
						const textToInsert = '\n' + this.parseResult.rawMarkdown;
						view.dispatch({
							changes: {
								from: this.blockTo,
								to: this.blockTo,
								insert: textToInsert,
							},
							userEvent: 'inkwell.button.duplicate',
						});
						new Notice('Bouton dupliqué.');
					});
			});

			menu.addItem((item) => {
				item.setTitle('Supprimer le bouton')
					.setIcon('trash')
					.onClick(() => {
						view.dispatch({
							changes: {
								from: this.blockFrom,
								to: this.blockTo,
								insert: '',
							},
							userEvent: 'inkwell.button.delete',
						});
						new Notice('Bouton supprimé.');
					});
			});

			menu.showAtMouseEvent(e);
		};

		menuBtn.addEventListener('click', openMenu);
		menuBtn.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.stopPropagation();
				e.preventDefault();
				const rect = menuBtn.getBoundingClientRect();
				const fakeEvent = new MouseEvent('click', {
					clientX: rect.left,
					clientY: rect.bottom,
				});
				openMenu(fakeEvent);
			}
		});

		return root;
	}

	private executeButtonAction(): void {
		if (this.isActionLocked) return;
		const data = this.parseResult.data;
		if (!data) return;

		const activeFile = this.plugin.app.workspace.getActiveFile();
		const sourcePath = activeFile?.path || '';

		switch (data.actionType) {
			case 'note': {
				const targetPath = data.target.trim();
				const destFile = this.plugin.app.metadataCache.getFirstLinkpathDest(
					targetPath,
					sourcePath,
				);
				if (!destFile) {
					new Notice(
						`Note cible introuvable : « ${targetPath} ». Aucune note n’a été créée.`,
						6000,
					);
					return;
				}
				void this.plugin.app.workspace.openLinkText(targetPath, sourcePath);
				break;
			}
			case 'url': {
				const url = data.target.trim();
				if (!isValidWebUrl(url)) {
					new Notice(
						'Protocole de lien non autorisé. Seules les adresses HTTP et HTTPS sont acceptées.',
						6000,
					);
					return;
				}
				window.open(url, '_blank');
				break;
			}
			case 'command': {
				const commandId = data.target.trim();
				const context: CommandExecutionContext = {
					sourcePath,
					isSubEditor: this.isSubEditor,
				};

				const validation = validateCommandExecution(
					this.plugin.app,
					commandId,
					context,
				);
				if (!validation.canExecute) {
					new Notice(validation.reason || 'Commande non exécutable.', 6000);
					return;
				}

				const cmdItem =
					validation.command ||
					getCommandInfo(this.plugin.app, commandId) || {
						id: commandId,
						name: commandId,
						origin: 'Origine non déterminée',
						requiresEditor: false,
					};

				// Systemic confirmation modal before running any command
				this.isActionLocked = true;
				const confirmModal = new CommandConfirmModal(this.plugin.app, {
					commandItem: cmdItem,
					context,
					onConfirm: () => {
						this.isActionLocked = false;
						const res = executeCommandSafely(this.plugin.app, commandId, context);
						if (!res.success) {
							new Notice(res.error || 'Erreur lors de l’exécution de la commande.', 6000);
						}
					},
					onCancel: () => {
						this.isActionLocked = false;
					},
				});
				confirmModal.open();
				break;
			}
		}
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

let activeButtonPlugin: InkwellPlugin | null = null;

function isLivePreview(state: EditorState): boolean {
	const val = state.field(editorLivePreviewField, false);
	return val !== false;
}

function buildButtonDecorations(
	doc: {
		lines: number;
		line: (n: number) => { from: number; to: number; text: string };
	},
	plugin: InkwellPlugin,
	isSubEditor: boolean,
): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	let i = 1;
	let blockIndex = 0;

	while (i <= doc.lines) {
		const line = doc.line(i);
		const lineText = line.text;

		if (/^\s*>\s*\[!button/i.test(lineText)) {
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

			const rawMarkdown = lines.join('\n');
			const parseResult = parseButton(rawMarkdown);

			decorations.push(
				Decoration.replace({
					widget: new VisualButtonWidget(
						parseResult,
						startPos,
						endPos,
						blockIndex,
						plugin,
						isSubEditor,
					),
					block: true,
				}).range(startPos, endPos),
			);
			blockIndex++;
			i = endLineNum + 1;
			continue;
		}

		i++;
	}

	return Decoration.set(decorations, true);
}

export const visualButtonField = StateField.define<DecorationSet>({
	create(state: EditorState) {
		if (!isLivePreview(state)) {
			return Decoration.none;
		}
		if (!activeButtonPlugin) return Decoration.none;
		return buildButtonDecorations(state.doc, activeButtonPlugin, false);
	},
	update(decorations: DecorationSet, tr) {
		if (!isLivePreview(tr.state)) {
			return Decoration.none;
		}
		if (!activeButtonPlugin) return Decoration.none;
		if (tr.docChanged) {
			return buildButtonDecorations(tr.state.doc, activeButtonPlugin, false);
		}
		return decorations;
	},
	provide(field) {
		return EditorView.decorations.from(field);
	},
});

export const visualSubEditorButtonField = StateField.define<DecorationSet>({
	create(state: EditorState) {
		if (!activeButtonPlugin) return Decoration.none;
		return buildButtonDecorations(state.doc, activeButtonPlugin, true);
	},
	update(decorations: DecorationSet, tr) {
		if (!activeButtonPlugin) return Decoration.none;
		if (tr.docChanged) {
			return buildButtonDecorations(tr.state.doc, activeButtonPlugin, true);
		}
		return decorations;
	},
	provide(field) {
		return EditorView.decorations.from(field);
	},
});

export function createVisualButtonExtension(
	plugin: InkwellPlugin,
	isSubEditor: boolean = false,
): Extension {
	activeButtonPlugin = plugin;
	return isSubEditor ? [visualSubEditorButtonField] : [visualButtonField];
}
