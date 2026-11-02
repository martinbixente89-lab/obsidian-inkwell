import { MarkdownPostProcessorContext, Menu, Notice, setIcon } from 'obsidian';
import type InkwellPlugin from '../main';
import { serializeSyncedReference } from './synced-model';

export function registerSyncedPreviewPostProcessor(plugin: InkwellPlugin): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const callouts = el.querySelectorAll<HTMLElement>(
				'.callout[data-callout="synced"]',
			);
			if (callouts.length === 0) return;

			for (const callout of Array.from(callouts)) {
				decorateSyncedCalloutInReadingMode(callout, plugin, ctx);
			}
		},
	);
}

function decorateSyncedCalloutInReadingMode(
	callout: HTMLElement,
	plugin: InkwellPlugin,
	ctx: MarkdownPostProcessorContext,
): void {
	callout.addClass('inkwell-synced-callout-reading');

	const titleEl = callout.querySelector<HTMLElement>('.callout-title');
	if (!titleEl) return;

	// Update icon
	const iconEl = titleEl.querySelector<HTMLElement>('.callout-icon');
	if (iconEl) {
		setIcon(iconEl, 'refresh-cw');
	}

	// Add status badge
	let badge = titleEl.querySelector<HTMLElement>('.inkwell-synced-badge');
	if (!badge) {
		badge = titleEl.createSpan({
			cls: 'inkwell-synced-badge is-synced',
			text: 'Synchronisé',
		});
	}

	// Add actions button if not already present
	let actionsBtn = titleEl.querySelector<HTMLElement>('.inkwell-synced-actions-btn');
	if (!actionsBtn) {
		actionsBtn = titleEl.createDiv({
			cls: 'inkwell-synced-actions-btn',
			attr: {
				'aria-label': 'Options du bloc synchronisé',
				tabindex: '0',
				role: 'button',
			},
		});
		setIcon(actionsBtn, 'more-horizontal');

		actionsBtn.addEventListener('click', (e) => {
			e.stopPropagation();

			// Find embedded note path if present
			const embedEl = callout.querySelector<HTMLElement>('.internal-embed');
			const targetPath = embedEl?.getAttribute('src') || '';

			const rawTitle =
				titleEl.querySelector<HTMLElement>('.callout-title-inner')?.innerText.trim() ||
				'Bloc synchronisé';

			const menu = new Menu();
			if (targetPath) {
				menu.addItem((item) => {
					item.setTitle('Ouvrir la note source')
						.setIcon('external-link')
						.onClick(() => {
							void plugin.app.workspace.openLinkText(targetPath, ctx.sourcePath);
						});
				});

				menu.addItem((item) => {
					item.setTitle('Copier la référence')
						.setIcon('copy')
						.onClick(async () => {
							const text = serializeSyncedReference(targetPath, rawTitle);
							await navigator.clipboard.writeText(text);
							new Notice('Référence du bloc synchronisé copiée dans le presse-papiers.');
						});
				});
			}

			menu.showAtMouseEvent(e);
		});
	}
}
