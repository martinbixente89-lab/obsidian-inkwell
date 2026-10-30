import { setIcon } from 'obsidian';
import type { SlashMenuItem, SlashMenuSection } from './types';

export interface SlashMenuViewCallbacks {
	onSelect: (item: SlashMenuItem) => void;
	onClose: () => void;
}

export class SlashMenuView {
	public readonly dom: HTMLDivElement;
	private readonly scrollArea: HTMLDivElement;
	private readonly footer: HTMLDivElement;
	private filteredItems: SlashMenuItem[] = [];
	private itemElements: HTMLDivElement[] = [];
	private selectedIndex = 0;
	private isVisible = false;

	constructor(private readonly callbacks: SlashMenuViewCallbacks) {
		this.dom = createDiv({ cls: 'inkwell-slash-menu' });

		this.scrollArea = this.dom.createDiv({ cls: 'inkwell-slash-scroll-area' });

		this.footer = this.dom.createDiv({ cls: 'inkwell-slash-footer' });

		this.footer.createSpan({
			cls: 'inkwell-slash-footer-text',
			text: 'Fermer le menu',
		});

		this.footer.createSpan({
			cls: 'inkwell-slash-footer-kbd',
			text: 'esc',
		});

		this.footer.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.callbacks.onClose();
		});

		// Prevent click in menu from stealing editor focus / closing prematurely
		this.dom.addEventListener('mousedown', (e) => {
			e.preventDefault();
		});

		document.body.appendChild(this.dom);
	}

	isOpen(): boolean {
		return this.isVisible;
	}

	show(): void {
		if (!this.isVisible) {
			this.dom.addClass('is-open');
			this.isVisible = true;
		}
	}

	hide(): void {
		if (this.isVisible) {
			this.dom.removeClass('is-open');
			this.isVisible = false;
			this.selectedIndex = 0;
		}
	}

	updateItems(items: SlashMenuItem[]): void {
		this.filteredItems = items;
		this.scrollArea.empty();
		this.itemElements = [];

		if (items.length === 0) {
			this.selectedIndex = -1;
			this.scrollArea.createDiv({
				cls: 'inkwell-slash-empty',
				text: 'Aucun résultat trouvé',
			});
			return;
		}

		if (this.selectedIndex < 0 || this.selectedIndex >= items.length) {
			this.selectedIndex = 0;
		}

		let currentSection: SlashMenuSection | null = null;

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (!item) continue;

			// Render section header or divider
			if (item.section !== currentSection) {
				if (currentSection !== null) {
					this.scrollArea.createDiv({ cls: 'inkwell-slash-divider' });
				}
				currentSection = item.section;
				let sectionTitle = 'Blocs de base';
				if (currentSection === 'advanced') {
					sectionTitle = 'Blocs avancés';
				} else if (currentSection === 'media') {
					sectionTitle = 'Média';
				}
				this.scrollArea.createDiv({
					cls: 'inkwell-slash-section-header',
					text: sectionTitle,
				});
			}

			const itemEl = this.scrollArea.createDiv({
				cls: 'inkwell-slash-item',
			});
			itemEl.dataset.index = String(i);

			if (i === this.selectedIndex) {
				itemEl.addClass('is-selected');
			}

			// Icon
			const iconSpan = itemEl.createSpan({ cls: 'inkwell-slash-icon' });
			setIcon(iconSpan, item.icon);

			// Label
			itemEl.createSpan({
				cls: 'inkwell-slash-label',
				text: item.label,
			});

			// Syntax indicator if present
			if (item.syntax) {
				itemEl.createSpan({
					cls: 'inkwell-slash-syntax',
					text: item.syntax,
				});
			}

			// Interaction
			itemEl.addEventListener('mouseenter', () => {
				this.setSelectedIndex(i, false);
			});

			itemEl.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.callbacks.onSelect(item);
			});

			this.itemElements.push(itemEl);
		}

		this.scrollSelectedItemIntoView();
	}

	setSelectedIndex(index: number, scroll = true): void {
		if (this.filteredItems.length === 0) return;
		const prev = this.selectedIndex;
		this.selectedIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1));

		if (prev !== this.selectedIndex) {
			const prevEl = this.itemElements[prev];
			if (prevEl) {
				prevEl.removeClass('is-selected');
			}
			const nextEl = this.itemElements[this.selectedIndex];
			if (nextEl) {
				nextEl.addClass('is-selected');
			}
		}

		if (scroll) {
			this.scrollSelectedItemIntoView();
		}
	}

	selectNext(): void {
		if (this.filteredItems.length === 0) return;
		const next = (this.selectedIndex + 1) % this.filteredItems.length;
		this.setSelectedIndex(next, true);
	}

	selectPrevious(): void {
		if (this.filteredItems.length === 0) return;
		const prev = (this.selectedIndex - 1 + this.filteredItems.length) % this.filteredItems.length;
		this.setSelectedIndex(prev, true);
	}

	getSelectedItem(): SlashMenuItem | null {
		if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
			return this.filteredItems[this.selectedIndex] ?? null;
		}
		return null;
	}

	private scrollSelectedItemIntoView(): void {
		const el = this.itemElements[this.selectedIndex];
		if (el) {
			el.scrollIntoView({ block: 'nearest' });
		}
	}

	position(cursorRect: { top: number; bottom: number; left: number; right: number }, win: Window): void {
		const menuWidth = 290;
		// Measure or approximate height
		const rect = this.dom.getBoundingClientRect();
		const menuHeight = rect.height > 0 ? rect.height : 320;

		const viewportWidth = win.innerWidth;
		const viewportHeight = win.innerHeight;
		const margin = 12;

		// Calculate horizontal position clamped to viewport
		let left = cursorRect.left;
		if (left + menuWidth > viewportWidth - margin) {
			left = viewportWidth - menuWidth - margin;
		}
		if (left < margin) {
			left = margin;
		}

		// Calculate vertical position: prefer below cursor, flip above if not enough space
		const spaceBelow = viewportHeight - cursorRect.bottom;
		const spaceAbove = cursorRect.top;

		let top: number;
		if (spaceBelow >= menuHeight + margin || spaceBelow >= spaceAbove) {
			// Place below
			top = cursorRect.bottom + 6;
			if (top + menuHeight > viewportHeight - margin) {
				top = Math.max(margin, viewportHeight - menuHeight - margin);
			}
		} else {
			// Flip above
			top = cursorRect.top - menuHeight - 6;
			if (top < margin) {
				top = margin;
			}
		}

		this.dom.style.left = `${Math.round(left)}px`;
		this.dom.style.top = `${Math.round(top)}px`;
	}

	destroy(): void {
		this.dom.remove();
	}
}
