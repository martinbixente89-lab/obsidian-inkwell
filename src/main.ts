import { Plugin } from 'obsidian';
import { registerCommands } from './commands';
import {
	EmbedSelectionTracker,
	registerEmbedSelectionTracking,
} from './editor/embed-selection';
import { registerLivePreviewExtension } from './editor/live-preview-extension';
import { TagNavigationManager } from './editor/tag-navigation/manager';
import {
	InkwellSettings,
	InkwellSettingTab,
	sanitizeSettings,
} from './settings';
import { FloatingToolbarManager } from './ui/floating-toolbar';
import { EditStyledTextPopover } from './ui/edit-styled-text-popover';
import { isLightBackground } from './format/color-spans';
import { loadAllCustomFonts } from './fonts/font-manager';
import { createSlashMenuExtension } from './slash-menu/extension';
import { createVisualColumnsExtension } from './columns/extension';
import { createColumnKeymapExtension } from './columns/callout-keymap';
import { CalloutColumnResizer } from './columns/callout-resizer';
import { createRootVisualMarkdownExtension } from './columns/column-markdown-deco';
import { createVisualCalloutsExtension } from './blocks/callout-widget';
import { registerCalloutPreviewManager } from './blocks/callout-preview';
import { createVisualTabsExtension } from './tabs/tab-widget';
import { registerTabsPreviewManager } from './tabs/tab-preview';
import { createBlockGutterExtension } from './blocks/block-gutter-ext';

export default class InkwellPlugin extends Plugin {
	settings!: InkwellSettings;
	tracker!: EmbedSelectionTracker;
	toolbarManager!: FloatingToolbarManager;
	editPopover!: EditStyledTextPopover;
	tagNavigation!: TagNavigationManager;
	calloutResizer!: CalloutColumnResizer;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new InkwellSettingTab(this.app, this));

		await loadAllCustomFonts(this.app.vault, this.settings.customFonts, undefined, this.app);
		this.registerEvent(
			this.app.workspace.on('window-open', (win) => {
				void loadAllCustomFonts(
					this.app.vault,
					this.settings.customFonts,
					win.win.document,
					this.app,
				);
			}),
		);

		registerLivePreviewExtension(this);
		this.calloutResizer = new CalloutColumnResizer(this.app);
		this.registerMarkdownPostProcessor((el, ctx) => {
			const spans = el.querySelectorAll('span[data-inkwell], span[style*="background-color"]');
			spans.forEach((span) => {
				if (span instanceof HTMLElement) {
					const bg = span.style.backgroundColor;
					const color = span.style.color;
					if (bg && isLightBackground(bg) && !color) {
						span.classList.add('inkwell-highlight-light');
					} else {
						span.classList.remove('inkwell-highlight-light');
					}
				}
			});

			this.calloutResizer.attachResizers(el);
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.calloutResizer.attachResizers(document.body);
			}),
		);
		registerCalloutPreviewManager(this);
		registerTabsPreviewManager(this);
		this.tagNavigation = new TagNavigationManager(this);
		this.tagNavigation.setEnabled(
			this.settings.experimentalTagNavigation,
			this.settings.experimentalColorBoldSupport,
		);
		this.editPopover = new EditStyledTextPopover(this);
		this.tracker = registerEmbedSelectionTracking(this);
		registerCommands(this, this.tracker);

		this.toolbarManager = new FloatingToolbarManager(this, this.tracker);
		this.registerEditorExtension(createSlashMenuExtension(this));

		// Register comparative prototype extensions ('notion', 'widget', 'callout')
		this.registerEditorExtension(createColumnKeymapExtension());
		this.registerEditorExtension(createVisualColumnsExtension(this));
		this.registerEditorExtension(createVisualCalloutsExtension(this));
		this.registerEditorExtension(createVisualTabsExtension(this));
		this.registerEditorExtension(createRootVisualMarkdownExtension(this));
		this.registerEditorExtension(createBlockGutterExtension(this));
		this.updateColumnPrototypeBodyClass();
	}

	onunload(): void {
		document.body.classList.remove('inkwell-proto-widget-active');
		document.body.classList.remove('inkwell-proto-notion-active');
		document.body.classList.remove('inkwell-page-full-width');
		this.editPopover?.close(false);
		this.toolbarManager?.destroy();
	}

	updateColumnPrototypeBodyClass(): void {
		const mode = this.settings.columnPrototypeMode;
		document.body.classList.toggle(
			'inkwell-proto-widget-active',
			mode === 'widget' || mode === 'notion',
		);
		document.body.classList.toggle('inkwell-proto-notion-active', mode === 'notion');
		document.body.classList.toggle(
			'inkwell-page-full-width',
			this.settings.pageWidthMode === 'full',
		);
		document.querySelectorAll('.inkwell-visual-columns-root').forEach((el) => {
			el.classList.toggle('is-notion-mode', mode === 'notion');
		});
		this.app.workspace.updateOptions();
		window.dispatchEvent(new Event('resize'));
	}

	async loadSettings(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	onToolbarSettingChanged(): void {
		this.toolbarManager?.onSettingChanged();
	}

	onTagNavigationSettingChanged(): void {
		this.tagNavigation?.setEnabled(
			this.settings.experimentalTagNavigation,
			this.settings.experimentalColorBoldSupport,
		);
	}
}
