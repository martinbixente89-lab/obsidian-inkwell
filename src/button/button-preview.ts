import { MarkdownPostProcessorContext, Notice } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	isValidWebUrl,
	parseButton,
	sanitizeColor,
} from './button-model';
import {
	CommandExecutionContext,
	executeCommandSafely,
	getCommandInfo,
	validateCommandExecution,
} from './command-adapter';
import { CommandConfirmModal } from './button-confirm-modal';

export function registerButtonPostProcessor(plugin: InkwellPlugin): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const callouts = el.querySelectorAll<HTMLElement>(
				'.callout[data-callout="button"]',
			);
			if (callouts.length === 0) return;

			for (const callout of Array.from(callouts)) {
				decorateButtonCalloutInReadingMode(callout, plugin, ctx);
			}
		},
	);
}

function decorateButtonCalloutInReadingMode(
	callout: HTMLElement,
	plugin: InkwellPlugin,
	ctx: MarkdownPostProcessorContext,
): void {
	if (callout.dataset.inkwellProcessed === 'true') return;
	callout.dataset.inkwellProcessed = 'true';

	// Extract title, metadata, and body
	const metadataAttr = callout.getAttribute('data-callout-metadata') || '';
	const titleInner = callout.querySelector<HTMLElement>('.callout-title-inner');
	const label = titleInner?.innerText.trim() || 'Action';

	const contentEl = callout.querySelector<HTMLElement>('.callout-content');
	let bodyText = contentEl?.innerText.trim() || '';

	// If there's an internal link, get its target path
	const internalLink = contentEl?.querySelector<HTMLAnchorElement>('a.internal-link');
	if (internalLink) {
		const href = internalLink.getAttribute('data-href') || internalLink.innerText.trim();
		if (href) {
			bodyText = `[[${href}]]`;
		}
	} else {
		const externalLink = contentEl?.querySelector<HTMLAnchorElement>('a.external-link');
		if (externalLink) {
			const href = externalLink.getAttribute('href') || externalLink.innerText.trim();
			if (href) {
				bodyText = href;
			}
		}
	}

	const reconstructed = `> [!button|${metadataAttr}] ${label}\n> ${bodyText}`;
	const parseResult = parseButton(reconstructed);

	// Transform callout into our clean button container
	callout.empty();
	callout.addClass('inkwell-button-root', 'inkwell-button-reading');

	const btnEl = callout.createEl('button', {
		cls: 'inkwell-action-btn',
		attr: {
			type: 'button',
			tabindex: '0',
		},
	});

	if (!parseResult.isValid || !parseResult.data) {
		btnEl.addClass('is-disabled');
		btnEl.createSpan({ cls: 'inkwell-btn-icon', text: '⚠️ ' });
		btnEl.createSpan({ text: `${label} (invalide)` });
		btnEl.setAttribute('title', parseResult.validationError || 'Bouton invalide');

		btnEl.addEventListener('click', () => {
			new Notice(
				`Bouton désactivé : ${parseResult.validationError || 'configuration invalide'}.`,
				6000,
			);
		});
		return;
	}

	const data = parseResult.data;
	btnEl.setText(data.label);
	btnEl.addClass(data.variant === 'outline' ? 'is-outline' : 'is-filled');

	const cleanColor = sanitizeColor(data.color);
	if (cleanColor) {
		btnEl.style.setProperty('--inkwell-btn-color', cleanColor);
	}

	let isActionLocked = false;
	const runAction = () => {
		if (isActionLocked) return;
		const sourcePath = ctx.sourcePath || plugin.app.workspace.getActiveFile()?.path || '';

		switch (data.actionType) {
			case 'note': {
				const targetPath = data.target.trim();
				const destFile = plugin.app.metadataCache.getFirstLinkpathDest(
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
				void plugin.app.workspace.openLinkText(targetPath, sourcePath);
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
					isSubEditor: false,
				};

				const validation = validateCommandExecution(
					plugin.app,
					commandId,
					context,
				);
				if (!validation.canExecute) {
					new Notice(validation.reason || 'Commande non exécutable.', 6000);
					return;
				}

				const cmdItem =
					validation.command ||
					getCommandInfo(plugin.app, commandId) || {
						id: commandId,
						name: commandId,
						origin: 'Origine non déterminée',
						requiresEditor: false,
					};

				isActionLocked = true;
				const confirmModal = new CommandConfirmModal(plugin.app, {
					commandItem: cmdItem,
					context,
					onConfirm: () => {
						isActionLocked = false;
						const res = executeCommandSafely(plugin.app, commandId, context);
						if (!res.success) {
							new Notice(res.error || 'Erreur lors de l’exécution de la commande.', 6000);
						}
					},
					onCancel: () => {
						isActionLocked = false;
					},
				});
				confirmModal.open();
				break;
			}
		}
	};

	btnEl.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		runAction();
	});

	btnEl.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			runAction();
		}
	});
}
