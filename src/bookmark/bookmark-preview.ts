import { MarkdownPostProcessorContext, Menu, Notice, setIcon } from 'obsidian';
import type InkwellPlugin from '../main';
import { extractDomain, serializeBookmark } from './bookmark-model';

export function registerBookmarkPostProcessor(plugin: InkwellPlugin): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const callouts = el.querySelectorAll<HTMLElement>(
				'.callout[data-callout="bookmark"]',
			);
			if (callouts.length === 0) return;

			for (const callout of Array.from(callouts)) {
				decorateBookmarkCalloutInReadingMode(callout, plugin, ctx);
			}
		},
	);
}

function decorateBookmarkCalloutInReadingMode(
	callout: HTMLElement,
	_plugin: InkwellPlugin,
	_ctx: MarkdownPostProcessorContext,
): void {
	if (callout.dataset.inkwellProcessed === 'true') return;
	callout.dataset.inkwellProcessed = 'true';

	// Extract title, url, description from Obsidian's rendered callout
	let url = '';
	let title = '';
	let description = '';

	const linkEl = callout.querySelector<HTMLAnchorElement>('.callout-title-inner a, a.external-link');
	if (linkEl) {
		url = linkEl.getAttribute('href') || linkEl.innerText.trim();
		title = linkEl.innerText.trim();
	} else {
		const titleInner = callout.querySelector<HTMLElement>('.callout-title-inner');
		if (titleInner) {
			title = titleInner.innerText.trim();
		}
	}

	const contentEl = callout.querySelector<HTMLElement>('.callout-content');
	if (contentEl) {
		description = contentEl.innerText.trim();
	}

	if (!url && title.startsWith('http')) {
		url = title;
	}

	const domain = extractDomain(url);
	if (!title) {
		title = domain || url || 'Lien';
	}

	// Transform callout into our sober visual card
	callout.empty();
	callout.addClass('inkwell-bookmark-card-root');
	callout.setAttribute('role', 'link');
	callout.setAttribute('tabindex', '0');
	callout.setAttribute('aria-label', `${title} - ${domain}`);

	// Main card click -> open destination in new tab
	callout.addEventListener('click', () => {
		if (url) {
			window.open(url, '_blank');
		}
	});

	callout.addEventListener('keydown', (e: KeyboardEvent) => {
		if ((e.key === 'Enter' || e.key === ' ') && url) {
			e.preventDefault();
			window.open(url, '_blank');
		}
	});

	// Left content
	const contentWrap = callout.createDiv({ cls: 'inkwell-bookmark-card-content' });

	const titleRow = contentWrap.createDiv({ cls: 'inkwell-bookmark-card-title' });
	titleRow.createEl('strong', { text: title });

	if (description) {
		const descEl = contentWrap.createDiv({ cls: 'inkwell-bookmark-card-desc' });
		descEl.setText(description);
	}

	const metaRow = contentWrap.createDiv({ cls: 'inkwell-bookmark-card-meta' });
	const domainIcon = metaRow.createSpan({ cls: 'inkwell-bookmark-card-domain-icon' });
	setIcon(domainIcon, 'globe');
	const domainText = metaRow.createSpan({ cls: 'inkwell-bookmark-card-domain' });
	domainText.setText(domain || url);

	// Right actions menu (⋯)
	const actionsWrap = callout.createDiv({ cls: 'inkwell-bookmark-card-actions' });
	const menuBtn = actionsWrap.createDiv({
		cls: 'inkwell-bookmark-menu-btn',
		attr: {
			'aria-label': 'Options du lien',
			tabindex: '0',
			role: 'button',
		},
	});
	setIcon(menuBtn, 'more-horizontal');

	const openMenu = (e: MouseEvent): void => {
		e.stopPropagation();
		e.preventDefault();

		const menu = new Menu();

		if (url) {
			menu.addItem((item) => {
				item.setTitle('Ouvrir dans le navigateur')
					.setIcon('external-link')
					.onClick(() => {
						window.open(url, '_blank');
					});
			});

			menu.addItem((item) => {
				item.setTitle('Copier l’URL')
					.setIcon('copy')
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(url);
							new Notice('URL copiée dans le presse-papiers.');
						} catch {
							new Notice('Impossible de copier l’URL.');
						}
					});
			});

			menu.addItem((item) => {
				item.setTitle('Copier la carte Markdown')
					.setIcon('file-text')
					.onClick(async () => {
						const md = serializeBookmark({ url, title, description });
						try {
							await navigator.clipboard.writeText(md);
							new Notice('Carte Markdown copiée.');
						} catch {
							new Notice('Impossible de copier la carte.');
						}
					});
			});
		}

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
}
