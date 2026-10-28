import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { editorLivePreviewField, Notice, Plugin } from 'obsidian';
import { REFUSAL_MESSAGES } from './edit-guard';
import { createTagNavigationExtension, toggleBoldOnInkwellSpan } from './extension';

const NOTICE_INTERVAL_MS = 1500;

/**
 * Registers the experimental tag navigation once, and lets the setting
 * add or remove it at runtime through Obsidian's public API
 * (registerEditorExtension + workspace.updateOptions). Never touches notes.
 */
export class TagNavigationManager {
	private readonly extensions: Extension[] = [];
	private lastNotice = 0;
	private enabled = false;
	private boldEnabled = false;

	constructor(private readonly plugin: Plugin) {
		plugin.registerEditorExtension(this.extensions);
	}

	setEnabled(enabled: boolean, boldEnabled = false): void {
		this.enabled = enabled;
		this.boldEnabled = boldEnabled;
		this.extensions.length = 0;
		if (enabled) {
			this.extensions.push(
				createTagNavigationExtension({
					// Active in both Live Preview and Source mode
					isActive: () => true,
					isLivePreview: (state) => state.field(editorLivePreviewField, false) === true,
					isBoldSupported: () => this.boldEnabled,
					onRefuse: (reason) => {
						const now = Date.now();
						if (now - this.lastNotice < NOTICE_INTERVAL_MS) return;
						this.lastNotice = now;
						new Notice(REFUSAL_MESSAGES[reason]);
					},
				}),
			);
		}
		this.plugin.app.workspace.updateOptions();
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	isBoldEnabled(): boolean {
		return this.boldEnabled;
	}

	toggleBold(editor: unknown): boolean {
		const cm = (editor as { cm?: EditorView })?.cm;
		if (!cm) return false;
		return toggleBoldOnInkwellSpan(
			cm,
			() => true,
			() => this.boldEnabled,
		);
	}
}

