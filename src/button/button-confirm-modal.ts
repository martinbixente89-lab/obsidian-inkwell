import { App, Modal, Notice } from 'obsidian';
import {
	CommandExecutionContext,
	ObsidianCommandItem,
	validateCommandExecution,
} from './command-adapter';

export interface CommandConfirmModalOptions {
	commandItem: ObsidianCommandItem;
	context: CommandExecutionContext;
	onConfirm: () => void;
	onCancel?: () => void;
}

export class CommandConfirmModal extends Modal {
	private isActionLocked = false;

	constructor(
		app: App,
		private options: CommandConfirmModalOptions,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('inkwell-button-confirm-modal');

		contentEl.createEl('h2', { text: 'Exécuter la commande ?' });

		const infoBox = contentEl.createDiv({ cls: 'inkwell-button-confirm-info' });

		const addInfoRow = (label: string, value: string) => {
			const row = infoBox.createDiv({ cls: 'inkwell-button-confirm-row' });
			row.createSpan({ cls: 'inkwell-button-confirm-label', text: label });
			row.createSpan({ cls: 'inkwell-button-confirm-val', text: value });
		};

		addInfoRow('Commande :', this.options.commandItem.name);
		addInfoRow('Identifiant :', this.options.commandItem.id);
		addInfoRow('Origine :', this.options.commandItem.origin);
		addInfoRow(
			'Note source :',
			this.options.context.sourcePath || 'Non spécifiée',
		);

		const warningBox = contentEl.createDiv({ cls: 'inkwell-button-confirm-warning' });
		warningBox.createEl('strong', { text: '⚠️ Avertissement d’exécution' });
		warningBox.createEl('p', {
			text: 'Cette commande peut modifier des fichiers ou déclencher des actions externes. Ses effets ne sont pas automatiquement annulables par le bouton.',
		});

		const btnRow = contentEl.createDiv({ cls: 'inkwell-button-confirm-btn-row' });

		const cancelBtn = btnRow.createEl('button', {
			cls: 'mod-cancel',
			text: 'Annuler',
		});
		cancelBtn.addEventListener('click', () => {
			this.close();
			this.options.onCancel?.();
		});

		const confirmBtn = btnRow.createEl('button', {
			cls: 'mod-warning',
			text: 'Confirmer et exécuter',
		});
		confirmBtn.addEventListener('click', () => {
			if (this.isActionLocked) return;
			this.isActionLocked = true;

			// Re-verify that the active note or view hasn't changed during modal display
			const activeFile = this.app.workspace.getActiveFile();
			if (
				this.options.context.sourcePath &&
				(!activeFile || activeFile.path !== this.options.context.sourcePath)
			) {
				new Notice(
					'La note active a changé pendant la confirmation. Exécution annulée par sécurité.',
					6000,
				);
				this.close();
				this.options.onCancel?.();
				return;
			}

			// Final validation check before execution
			const validation = validateCommandExecution(
				this.app,
				this.options.commandItem.id,
				this.options.context,
			);
			if (!validation.canExecute) {
				new Notice(validation.reason || 'Exécution impossible dans le contexte actuel.', 6000);
				this.close();
				this.options.onCancel?.();
				return;
			}

			this.close();
			this.options.onConfirm();
		});

		// Auto-focus Cancel button for safety
		window.setTimeout(() => cancelBtn.focus(), 50);
	}
}
