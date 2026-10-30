import { Prec, type Extension } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import type InkwellPlugin from '../main';
import { filterSlashItems, getSlashTriggerInfo } from './matcher';
import { createSlashMenuItems } from './items';
import { SlashMenuView } from './slash-menu-view';
import type { SlashMenuItem, SlashTriggerInfo } from './types';

class SlashPlaceholderWidget extends WidgetType {
	toDOM(): HTMLElement {
		return createSpan({
			cls: 'inkwell-slash-placeholder',
			text: 'Saisissez du texte pour chercher',
		});
	}

	ignoreEvent(): boolean {
		return true;
	}
}

interface PendingPlusInsertion {
	view: EditorView;
	removeFrom: number;
	removeTo: number;
	slashPos: number;
}

let pendingPlusInsertion: PendingPlusInsertion | null = null;

/**
 * Records a temporary slash insertion initiated by the gutter '+' button so that
 * cancelling the menu (Escape / click outside) cleans up the temporary '/' cleanly.
 */
export function registerPlusButtonSlashInsertion(
	view: EditorView,
	removeFrom: number,
	removeTo: number,
	slashPos: number,
): void {
	pendingPlusInsertion = { view, removeFrom, removeTo, slashPos };
}

/**
 * Checks whether an external suggester or command palette is currently open in the DOM.
 */
export function isExternalSuggesterActive(doc: Document): boolean {
	const el = doc.querySelector('.suggestion-container, .prompt');
	return !!el && (el as HTMLElement).offsetParent !== null;
}

export function createSlashMenuExtension(plugin: InkwellPlugin): Extension {
	const allItems = createSlashMenuItems();
	let activeMenuView: SlashMenuView | null = null;
	let currentTrigger: SlashTriggerInfo | null = null;
	let activeView: EditorView | null = null;

	const closeMenu = (reason?: string) => {
		if (activeMenuView?.isOpen()) {
			activeMenuView.hide();
		}
		if (
			(reason === 'escape' || reason === 'click-outside' || reason === 'footer-close') &&
			pendingPlusInsertion &&
			currentTrigger &&
			activeView === pendingPlusInsertion.view &&
			currentTrigger.from === pendingPlusInsertion.slashPos &&
			currentTrigger.query === ''
		) {
			const { view, removeFrom, removeTo } = pendingPlusInsertion;
			pendingPlusInsertion = null;
			currentTrigger = null;
			activeView = null;
			const safeFrom = Math.max(0, Math.min(removeFrom, view.state.doc.length));
			const safeTo = Math.max(safeFrom, Math.min(removeTo, view.state.doc.length));
			if (safeTo > safeFrom) {
				view.dispatch({
					changes: { from: safeFrom, to: safeTo, insert: '' },
				});
			}
			return;
		}
		if (reason === 'executeItem') {
			pendingPlusInsertion = null;
		}
		currentTrigger = null;
		activeView = null;
	};

	const executeItem = (item: SlashMenuItem) => {
		if (!currentTrigger || !activeView) return;
		const ctx = {
			plugin,
			view: activeView,
			from: currentTrigger.from,
			to: currentTrigger.to,
			indent: currentTrigger.indent,
		};
		closeMenu('executeItem');
		void item.execute(ctx);
	};

	const keyHandler = Prec.highest(
		EditorView.domEventHandlers({
			keydown(event, view) {
				if (!plugin.settings.slashMenuEnabled) return false;
				if (!activeMenuView || !activeMenuView.isOpen()) return false;
				if (activeView !== view) return false;

				if (event.key === 'ArrowDown') {
					event.preventDefault();
					event.stopPropagation();
					activeMenuView.selectNext();
					return true;
				}

				if (event.key === 'ArrowUp') {
					event.preventDefault();
					event.stopPropagation();
					activeMenuView.selectPrevious();
					return true;
				}

				if (event.key === 'Enter') {
					const item = activeMenuView.getSelectedItem();
					if (item) {
						event.preventDefault();
						event.stopPropagation();
						executeItem(item);
						return true;
					}
					// If no item selected (empty state), just close
					closeMenu('empty-enter');
					return false;
				}

				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					closeMenu('escape');
					return true;
				}

				return false;
			},
		}),
	);

	class SlashPluginValue implements PluginValue {
		public decorations: DecorationSet = Decoration.none;

		constructor(private readonly view: EditorView) {
			if (!activeMenuView) {
				activeMenuView = new SlashMenuView({
					onSelect: (item) => executeItem(item),
					onClose: () => closeMenu('footer-close'),
				});

				// Close on click outside
				const docOwner = view.dom.ownerDocument || document;
				docOwner.addEventListener('mousedown', (e) => {
					if (activeMenuView?.isOpen() && !activeMenuView.dom.contains(e.target as Node)) {
						closeMenu('click-outside');
					}
				});
			}
			this.evaluate(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet || update.viewportChanged) {
				this.evaluate(update.view);
			}
		}

		destroy() {
			if (activeView === this.view) {
				closeMenu('view-destroy');
			}
		}

		private evaluate(view: EditorView) {
			if (!plugin.settings.slashMenuEnabled) {
				if (activeView === view) closeMenu('disabled');
				this.decorations = Decoration.none;
				return;
			}

			// In Obsidian, only the currently focused editor should trigger or control the slash menu
			const isFocused =
				view.hasFocus || view.dom.ownerDocument.activeElement === view.contentDOM;
			if (!isFocused) {
				if (activeView === view) {
					closeMenu('no-focus');
				}
				this.decorations = Decoration.none;
				return;
			}

			// Check if another suggester is open
			const docOwner = view.dom.ownerDocument || document;
			if (isExternalSuggesterActive(docOwner)) {
				if (activeView === view) closeMenu('external-suggester');
				this.decorations = Decoration.none;
				return;
			}

			const sel = view.state.selection.main;
			if (!sel.empty) {
				if (activeView === view) closeMenu('sel-not-empty');
				this.decorations = Decoration.none;
				return;
			}

			const doc = view.state.doc;
			const line = doc.lineAt(sel.head);
			const trigger = getSlashTriggerInfo(doc.toString(), line.from, line.text, sel.head);

			if (!trigger) {
				if (activeView === view) closeMenu('no-trigger');
				this.decorations = Decoration.none;
				return;
			}

			currentTrigger = trigger;
			activeView = view;
			const filtered = filterSlashItems(allItems, trigger.query);

			if (!activeMenuView) {
				activeMenuView = new SlashMenuView({
					onSelect: (item) => executeItem(item),
					onClose: () => closeMenu(),
				});
			}

			activeMenuView.updateItems(filtered);
			activeMenuView.show();

			// Safely measure layout outside the synchronous update pass
			view.requestMeasure({
				read(v) {
					return v.coordsAtPos(trigger.from);
				},
				write(coords) {
					if (coords && activeMenuView?.isOpen()) {
						const win = view.dom.ownerDocument?.defaultView || window;
						activeMenuView.position(coords, win);
					}
				},
			});

			// Build placeholder widget if query is empty
			if (trigger.query === '') {
				const widgetDeco = Decoration.widget({
					widget: new SlashPlaceholderWidget(),
					side: 1,
				});
				this.decorations = Decoration.set([widgetDeco.range(trigger.from + 1)]);
			} else {
				this.decorations = Decoration.none;
			}
		}
	}

	const viewPlugin = ViewPlugin.fromClass(SlashPluginValue, {
		decorations: (v) => v.decorations,
	});

	return [keyHandler, viewPlugin];
}
