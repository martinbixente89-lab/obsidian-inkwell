import type { EditorView } from '@codemirror/view';
import { MarkdownView, Notice } from 'obsidian';
import {
	canAddColumnToGroup,
	getBalancedRatios,
	serializeMultiColumnMarkdown,
} from '../columns/parser';
import { getColumnControllerAtOffset } from '../columns/column-widget';
import { markHeadingLineAsToggle } from '../blocks/heading-fold';
import type { SlashExecutionContext, SlashMenuItem } from './types';
import { NoteSuggestModal, VaultFileSuggestModal } from './modals';
import { PageModal } from './page-modal';
import { generateActiveNoteToc } from './toc-helper';
import {
	getStaticInsertTemplate,
	SLASH_ITEM_DEFINITIONS,
} from './item-definitions';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'];
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'mov', 'mkv'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac', 'aac'];

/**
 * Replaces the slash trigger range [from, to] with the inserted text in a single transaction.
 */
export function replaceSlashAndInsert(
	view: EditorView,
	from: number,
	to: number,
	insertText: string,
	cursorOffset = insertText.length,
): void {
	const safeFrom = Math.max(0, Math.min(from, view.state.doc.length));
	const safeTo = Math.max(safeFrom, Math.min(to, view.state.doc.length));
	const targetCursor = safeFrom + cursorOffset;
	view.dispatch({
		changes: { from: safeFrom, to: safeTo, insert: insertText },
		selection: { anchor: targetCursor },
		userEvent: 'input',
	});
	view.focus();
}

function executeMultiColumnSlashItem(ctx: SlashExecutionContext, colCount: number): void {
	const isInsideSubEditor =
		ctx.view.dom.closest('.inkwell-col-editor-host') !== null ||
		ctx.view.dom.closest('.inkwell-visual-callout-editor-host') !== null;

	if (isInsideSubEditor) {
		replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, '', 0);
		new Notice(
			'Les colonnes ne peuvent pas être imbriquées dans un autre bloc. Pour ajouter une colonne à ce groupe, glissez un bloc sur le bord gauche ou droit d’une colonne existante.',
		);
		return;
	}

	const availableWidthPx = ctx.view.contentDOM.getBoundingClientRect().width;
	const check = canAddColumnToGroup(colCount - 1, availableWidthPx);
	if (!check.allowed) {
		replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, '', 0);
		new Notice(
			check.reason ??
				`Largeur insuffisante pour créer ${colCount} colonnes dans ce panneau.`,
		);
		return;
	}

	const ratios = getBalancedRatios(colCount);
	const columns = Array.from({ length: colCount }, () => ({
		blocks: [],
		text: '',
		map: [],
	}));
	const multiColMarkdown = serializeMultiColumnMarkdown({
		ratios,
		columns,
		col1: [],
		col2: [],
		colTag: 'col',
	});

	const safeFrom = Math.max(0, Math.min(ctx.from, ctx.view.state.doc.length));
	replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, multiColMarkdown, 0);

	window.requestAnimationFrame(() => {
		const ctrl = getColumnControllerAtOffset(ctx.view, safeFrom);
		const firstColView = ctrl?.getColumnView(0);
		if (firstColView) {
			firstColView.focus();
		}
	});
}

/**
 * Creates the complete list of slash menu items for Inkwell.
 */
export function createSlashMenuItems(): SlashMenuItem[] {
	return SLASH_ITEM_DEFINITIONS.map((def) => {
		const staticTemplate = getStaticInsertTemplate(def.id);
		if (staticTemplate) {
			return {
				...def,
				execute: (ctx) => {
					replaceSlashAndInsert(
						ctx.view,
						ctx.from,
						ctx.to,
						staticTemplate.text,
						staticTemplate.cursorOffset,
					);
				},
			};
		}

		// Dynamic and modal-based actions
		switch (def.id) {
			case 'toggle-h1':
			case 'toggle-h2':
			case 'toggle-h3': {
				const prefix =
					def.id === 'toggle-h1'
						? '# '
						: def.id === 'toggle-h2'
							? '## '
							: '### ';
				return {
					...def,
					execute: (ctx) => {
						const safeFrom = Math.max(0, Math.min(ctx.from, ctx.view.state.doc.length));
						replaceSlashAndInsert(
							ctx.view,
							ctx.from,
							ctx.to,
							prefix,
							prefix.length,
						);
						markHeadingLineAsToggle(ctx.view, safeFrom, ctx.plugin);
					},
				};
			}
			case 'cols-2':
				return {
					...def,
					execute: (ctx) => executeMultiColumnSlashItem(ctx, 2),
				};
			case 'cols-3':
				return {
					...def,
					execute: (ctx) => executeMultiColumnSlashItem(ctx, 3),
				};
			case 'cols-4':
				return {
					...def,
					execute: (ctx) => executeMultiColumnSlashItem(ctx, 4),
				};
			case 'cols-5':
				return {
					...def,
					execute: (ctx) => executeMultiColumnSlashItem(ctx, 5),
				};
			case 'page':
				return {
					...def,
					execute: (ctx) => {
						const activeFile = ctx.plugin.app.workspace.getActiveFile();
						const folder = activeFile?.parent?.path ?? '';
						const modal = new PageModal(ctx.plugin.app, folder, {
							onSubmit: (noteName) => {
								const linkText = `[[${noteName}]]`;
								replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, linkText);
							},
							onCancel: () => {
								ctx.view.focus();
							},
						});
						modal.open();
					},
				};
			case 'toc':
				return {
					...def,
					execute: (ctx) => {
						const dynamicTocBlock = '> [!toc] Table des matières\n> ';
						replaceSlashAndInsert(
							ctx.view,
							ctx.from,
							ctx.to,
							dynamicTocBlock,
							dynamicTocBlock.length,
						);
					},
				};
			case 'toc-static':
				return {
					...def,
					execute: (ctx) => {
						const activeMdView =
							ctx.plugin.app.workspace.getActiveViewOfType(MarkdownView);
						const fullNoteText =
							activeMdView?.editor.getValue() ?? ctx.view.state.doc.toString();
						const tocMarkdown = generateActiveNoteToc(
							ctx.plugin.app,
							fullNoteText,
						);
						replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, tocMarkdown);
					},
				};
			case 'link-note':
				return {
					...def,
					execute: (ctx) => {
						const modal = new NoteSuggestModal(ctx.plugin.app, (file) => {
							const linkText = `[[${file.basename}]]`;
							replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, linkText);
						});
						modal.open();
					},
				};
			case 'media-image':
				return {
					...def,
					execute: (ctx) => {
						const modal = new VaultFileSuggestModal(
							ctx.plugin.app,
							'Sélectionner une image du coffre...',
							IMAGE_EXTENSIONS,
							(file) => {
								const embedText = `![[${file.name}]]`;
								replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, embedText);
							},
						);
						modal.open();
					},
				};
			case 'media-video':
				return {
					...def,
					execute: (ctx) => {
						const modal = new VaultFileSuggestModal(
							ctx.plugin.app,
							'Sélectionner une vidéo du coffre...',
							VIDEO_EXTENSIONS,
							(file) => {
								const embedText = `![[${file.name}]]`;
								replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, embedText);
							},
						);
						modal.open();
					},
				};
			case 'media-audio':
				return {
					...def,
					execute: (ctx) => {
						const modal = new VaultFileSuggestModal(
							ctx.plugin.app,
							'Sélectionner un fichier audio du coffre...',
							AUDIO_EXTENSIONS,
							(file) => {
								const embedText = `![[${file.name}]]`;
								replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, embedText);
							},
						);
						modal.open();
					},
				};
			case 'media-file':
				return {
					...def,
					execute: (ctx) => {
						const modal = new VaultFileSuggestModal(
							ctx.plugin.app,
							'Sélectionner un fichier ou document du coffre...',
							null,
							(file) => {
								const embedText = `![[${file.name}]]`;
								replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, embedText);
							},
						);
						modal.open();
					},
				};
			default:
				return {
					...def,
					execute: (ctx) => {
						replaceSlashAndInsert(ctx.view, ctx.from, ctx.to, '', 0);
					},
				};
		}
	});
}
