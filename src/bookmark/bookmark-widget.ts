import {
	EditorSelection,
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
	BookmarkData,
	convertBookmarkToSimpleLink,
	extractDomain,
	parseBookmark,
} from './bookmark-model';
import { BookmarkModal } from './bookmark-modal';

export class VisualBookmarkWidget extends WidgetType {
	constructor(
		public readonly data: BookmarkData,
		public readonly blockFrom: number,
		public readonly blockTo: number,
		public readonly blockIndex: number,
		public readonly plugin: InkwellPlugin,
	) {
		super();
	}

	override eq(other: VisualBookmarkWidget): boolean {
		return (
			other.blockFrom === this.blockFrom &&
			other.blockTo === this.blockTo &&
			other.data.url === this.data.url &&
			other.data.title === this.data.title &&
			other.data.description === this.data.description
		);
	}

	override toDOM(view: EditorView): HTMLElement {
		const root = createDiv({ cls: 'inkwell-bookmark-card-root' });
		root.setAttribute('role', 'link');
		root.setAttribute('tabindex', '0');
		root.setAttribute(
			'aria-label',
			`${this.data.title} - ${extractDomain(this.data.url)}`,
		);

		// Click opens the destination URL in browser
		root.addEventListener('click', (e) => {
			// Do not trigger if click originated on actions menu
			if ((e.target as HTMLElement).closest('.inkwell-bookmark-card-actions')) {
				return;
			}
			if (this.data.url) {
				window.open(this.data.url, '_blank');
			}
		});

		root.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.target !== root) return;
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				if (this.data.url) {
					window.open(this.data.url, '_blank');
				}
			}
		});

		// Content section
		const contentWrap = root.createDiv({ cls: 'inkwell-bookmark-card-content' });

		const titleRow = contentWrap.createDiv({ cls: 'inkwell-bookmark-card-title' });
		titleRow.createEl('strong', { text: this.data.title });

		if (this.data.description) {
			const descEl = contentWrap.createDiv({ cls: 'inkwell-bookmark-card-desc' });
			descEl.setText(this.data.description);
		}

		const domain = extractDomain(this.data.url);
		const metaRow = contentWrap.createDiv({ cls: 'inkwell-bookmark-card-meta' });
		const domainIcon = metaRow.createSpan({ cls: 'inkwell-bookmark-card-domain-icon' });
		setIcon(domainIcon, 'globe');
		const domainText = metaRow.createSpan({ cls: 'inkwell-bookmark-card-domain' });
		domainText.setText(domain || this.data.url);

		// Actions menu (⋯)
		const actionsWrap = root.createDiv({ cls: 'inkwell-bookmark-card-actions' });
		const menuBtn = actionsWrap.createDiv({
			cls: 'inkwell-bookmark-menu-btn',
			attr: {
				'aria-label': 'Options de l’aperçu de lien',
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
				item.setTitle('Modifier les informations')
					.setIcon('pencil')
					.onClick(() => {
						const modal = new BookmarkModal(this.plugin.app, {
							initialData: this.data,
							onSave: (_newData, markdown) => {
								view.dispatch({
									changes: {
										from: this.blockFrom,
										to: this.blockTo,
										insert: markdown,
									},
									userEvent: 'inkwell.bookmark.edit',
								});
								new Notice('Aperçu de lien mis à jour.');
							},
						});
						modal.open();
					});
			});

			menu.addItem((item) => {
				item.setTitle('Ouvrir dans le navigateur')
					.setIcon('external-link')
					.onClick(() => {
						if (this.data.url) {
							window.open(this.data.url, '_blank');
						}
					});
			});

			menu.addItem((item) => {
				item.setTitle('Copier l’URL')
					.setIcon('copy')
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(this.data.url);
							new Notice('URL copiée dans le presse-papiers.');
						} catch {
							new Notice('Impossible de copier l’URL.');
						}
					});
			});

			menu.addItem((item) => {
				item.setTitle('Convertir en lien simple')
					.setIcon('link')
					.onClick(() => {
						const simpleLink = convertBookmarkToSimpleLink(this.data);
						view.dispatch({
							changes: {
								from: this.blockFrom,
								to: this.blockTo,
								insert: simpleLink,
							},
							selection: EditorSelection.cursor(
								this.blockFrom + simpleLink.length,
							),
							userEvent: 'inkwell.bookmark.convert',
						});
						new Notice('Aperçu converti en lien simple.');
					});
			});

			menu.addItem((item) => {
				item.setTitle('Récupération automatique (désactivée)')
					.setIcon('refresh-cw')
					.onClick(() => {
						new Notice(
							'Mode 100% hors-ligne : la récupération automatique est désactivée par sécurité.',
						);
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

	override ignoreEvent(): boolean {
		return true;
	}
}

let activeBookmarkPlugin: InkwellPlugin | null = null;

function buildBookmarkDecorations(
	doc: {
		lines: number;
		line: (n: number) => { from: number; to: number; text: string };
	},
	plugin: InkwellPlugin,
): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	let i = 1;
	let blockIndex = 0;

	while (i <= doc.lines) {
		const line = doc.line(i);
		const lineText = line.text;

		if (/^\s*>\s*\[!bookmark\]/i.test(lineText)) {
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

			const data = parseBookmark(lines.join('\n'));
			if (data) {
				decorations.push(
					Decoration.replace({
						widget: new VisualBookmarkWidget(
							data,
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

	return Decoration.set(decorations, true);
}

function isLivePreview(state: EditorState): boolean {
	const val = state.field(editorLivePreviewField, false);
	return val !== false;
}

export const visualBookmarkField = StateField.define<DecorationSet>({
	create(state: EditorState) {
		if (!isLivePreview(state)) {
			return Decoration.none;
		}
		if (!activeBookmarkPlugin) return Decoration.none;
		return buildBookmarkDecorations(state.doc, activeBookmarkPlugin);
	},
	update(decorations: DecorationSet, tr) {
		if (!isLivePreview(tr.state)) {
			return Decoration.none;
		}
		if (!activeBookmarkPlugin) return Decoration.none;
		if (tr.docChanged) {
			return buildBookmarkDecorations(tr.state.doc, activeBookmarkPlugin);
		}
		return decorations;
	},
	provide(field) {
		return EditorView.decorations.from(field);
	},
});

export function createVisualBookmarkExtension(plugin: InkwellPlugin): Extension {
	activeBookmarkPlugin = plugin;
	return [visualBookmarkField];
}
