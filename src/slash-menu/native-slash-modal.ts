import { App, Modal, Setting } from 'obsidian';
import { NATIVE_SLASH_MANUAL_PROCEDURE } from './native-slash';

export type NativeSlashModalMode = 'disable-native' | 'manual-confirm';

/**
 * Asks the user to confirm the switch to Inkwell's slash menu.
 * - 'disable-native': Inkwell will turn off Obsidian's "Slash commands" core plugin.
 * - 'manual-confirm': the native state is unreadable; the user confirms having
 *   disabled it manually (Inkwell changes nothing in Obsidian).
 * `onResolve` is called exactly once: true on confirmation, false otherwise.
 */
export class NativeSlashChoiceModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly mode: NativeSlashModalMode,
		private readonly onResolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.mode === 'disable-native') {
			contentEl.createEl('h3', { text: 'Utiliser le menu slash d’Inkwell ?' });
			contentEl.createEl('p', {
				text:
					'Le module « Commandes slash » d’Obsidian est actif. Pour éviter deux menus simultanés, Inkwell va le désactiver dans les réglages de ce coffre.',
			});
			contentEl.createEl('p', {
				text:
					'Vous pourrez le réactiver à tout moment dans les réglages d’Obsidian ; le menu slash d’Inkwell sera alors désactivé, sans toucher au reste d’Inkwell.',
			});
		} else {
			contentEl.createEl('h3', { text: 'Détection indisponible' });
			contentEl.createEl('p', {
				text:
					'Inkwell ne peut pas lire l’état du module « Commandes slash » d’Obsidian et ne le modifiera pas.',
			});
			contentEl.createEl('p', { text: NATIVE_SLASH_MANUAL_PROCEDURE });
		}

		const actions = new Setting(contentEl);
		actions.addButton((btn) => {
			btn.setButtonText('Annuler').onClick(() => this.close());
		});
		actions.addButton((btn) => {
			btn
				.setButtonText(
					this.mode === 'disable-native'
						? 'Désactiver le menu d’Obsidian'
						: 'Je l’ai désactivé',
				)
				.setCta()
				.onClick(() => {
					this.resolve(true);
					this.close();
				});
		});
	}

	override onClose(): void {
		this.contentEl.empty();
		this.resolve(false);
	}

	private resolve(confirmed: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.onResolve(confirmed);
	}
}
