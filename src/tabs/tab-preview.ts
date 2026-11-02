import { MarkdownPostProcessorContext, Plugin } from 'obsidian';
import { sanitizeTabTitle } from './tab-parser';
import { tabStateStore } from './tab-state';

/**
 * Harmonizes and enlivens tabbed blocks (`> [!tabs]`) in Reading Mode (`.markdown-rendered`).
 * Restructures native nested callouts into a clean tab bar with interactive panes.
 */
export function harmonizeTabsPreview(
	rootEl: HTMLElement = document.body,
	ctx?: MarkdownPostProcessorContext,
): void {
	const tabsContainers: HTMLElement[] = [];
	if (rootEl.matches?.('.callout[data-callout="tabs"]')) {
		tabsContainers.push(rootEl);
	}
	rootEl.querySelectorAll?.('.callout[data-callout="tabs"]').forEach((node) => {
		if (node instanceof HTMLElement) {
			tabsContainers.push(node);
		}
	});

	let tabsBlockIdx = 0;
	const filePath = ctx?.sourcePath ?? 'preview-doc';

	for (const tabsEl of tabsContainers) {
		const currentBlockIdx = tabsBlockIdx++;
		tabsEl.classList.add('inkwell-tabs-harmonized');

		// Find direct or immediate nested callouts with data-callout="tab"
		const tabElements: HTMLElement[] = [];
		tabsEl.querySelectorAll(':scope > .callout-content > .callout[data-callout="tab"]').forEach((node) => {
			if (node instanceof HTMLElement) {
				tabElements.push(node);
			}
		});

		// Fallback query if Obsidian DOM structure is slightly different
		if (tabElements.length === 0) {
			tabsEl.querySelectorAll('.callout[data-callout="tab"]').forEach((node) => {
				if (node instanceof HTMLElement) {
					tabElements.push(node);
				}
			});
		}

		if (tabElements.length === 0) {
			continue;
		}

		// Read previously selected tab or default to 0
		let activeIndex = Math.min(
			Math.max(0, tabStateStore.getActiveTabIndex(filePath, currentBlockIdx)),
			tabElements.length - 1,
		);

		// Extract tab titles
		const tabTitles: string[] = tabElements.map((el, idx) => {
			const titleInner = el.querySelector('.callout-title-inner');
			const titleText = titleInner?.textContent?.trim();
			if (titleText && titleText.toLowerCase() !== 'tab') {
				return sanitizeTabTitle(titleText);
			}
			const meta = el.getAttribute('data-callout-metadata');
			if (meta && meta.trim().length > 0) {
				return sanitizeTabTitle(meta);
			}
			return `Onglet ${idx + 1}`;
		});

		// Hide default callout title of the container (> [!tabs])
		const containerTitle = tabsEl.querySelector(':scope > .callout-title');
		if (containerTitle instanceof HTMLElement) {
			containerTitle.classList.add('inkwell-tabs-hidden');
		}

		// Check if tab bar is already rendered
		let tabBar = tabsEl.querySelector(':scope > .inkwell-reading-tabs-bar');
		if (!tabBar) {
			tabBar = createDiv({ cls: 'inkwell-reading-tabs-bar' });
			tabsEl.prepend(tabBar);
		} else {
			tabBar.empty();
		}

		const buttons: HTMLButtonElement[] = [];

		const updateActiveTab = (newIndex: number) => {
			activeIndex = newIndex;
			tabStateStore.setActiveTabIndex(filePath, currentBlockIdx, newIndex);

			buttons.forEach((btn, idx) => {
				const isActive = idx === activeIndex;
				btn.classList.toggle('is-active', isActive);
				btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
				btn.tabIndex = isActive ? 0 : -1;
			});

			tabElements.forEach((tabPane, idx) => {
				const isActive = idx === activeIndex;
				tabPane.classList.toggle('is-active-tab-pane', isActive);
				tabPane.classList.toggle('inkwell-tabs-hidden', !isActive);

				// Hide the redundant inner tab header in Reading Mode
				const innerTitle = tabPane.querySelector('.callout-title');
				if (innerTitle instanceof HTMLElement) {
					innerTitle.classList.add('inkwell-tabs-hidden');
				}
			});
		};

		// Render tab buttons in the tab bar
		tabTitles.forEach((title, idx) => {
			const btn = tabBar.createEl('button', {
				cls: 'inkwell-reading-tab-btn',
				type: 'button',
				text: title,
				attr: {
					role: 'tab',
					'aria-selected': idx === activeIndex ? 'true' : 'false',
					tabindex: idx === activeIndex ? '0' : '-1',
				},
			});

			btn.addEventListener('click', (e) => {
				e.preventDefault();
				updateActiveTab(idx);
			});

			btn.addEventListener('keydown', (e) => {
				if (e.key === 'ArrowRight' && idx < tabTitles.length - 1) {
					e.preventDefault();
					buttons[idx + 1]?.focus();
					updateActiveTab(idx + 1);
				} else if (e.key === 'ArrowLeft' && idx > 0) {
					e.preventDefault();
					buttons[idx - 1]?.focus();
					updateActiveTab(idx - 1);
				}
			});

			buttons.push(btn);
		});

		// Initial display sync
		updateActiveTab(activeIndex);
	}
}

/**
 * Registers Reading Mode post-processor for tabbed blocks.
 */
export function registerTabsPreviewManager(plugin: Plugin): void {
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		harmonizeTabsPreview(el, ctx);
	});
}
