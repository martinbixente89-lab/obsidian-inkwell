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

export default class InkwellPlugin extends Plugin {
	settings!: InkwellSettings;
	tracker!: EmbedSelectionTracker;
	toolbarManager!: FloatingToolbarManager;
	editPopover!: EditStyledTextPopover;
	tagNavigation!: TagNavigationManager;

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
		this.registerMarkdownPostProcessor((el) => {
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
		});
		this.tagNavigation = new TagNavigationManager(this);
		this.tagNavigation.setEnabled(
			this.settings.experimentalTagNavigation,
			this.settings.experimentalColorBoldSupport,
		);
		this.editPopover = new EditStyledTextPopover(this);
		this.tracker = registerEmbedSelectionTracking(this);
		registerCommands(this, this.tracker);

		this.toolbarManager = new FloatingToolbarManager(this, this.tracker);
	}

	onunload(): void {
		this.editPopover?.close(false);
		this.toolbarManager?.destroy();
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
