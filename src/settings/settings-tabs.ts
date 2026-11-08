/**
 * Top-level navigation of Inkwell's settings (2.0.0): three tabs.
 * The "Toolbar" tab is only shown while the toolbar is enabled.
 */

export type SettingsTabId = 'general' | 'toolbar' | 'slash';

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTabId; label: string }> = [
	{ id: 'general', label: 'Paramètres généraux' },
	{ id: 'toolbar', label: 'Toolbar' },
	{ id: 'slash', label: 'Menu /' },
];

export function getVisibleSettingsTabs(settings: { toolbarEnabled: boolean }): SettingsTabId[] {
	return SETTINGS_TABS.map((t) => t.id).filter((id) => id !== 'toolbar' || settings.toolbarEnabled);
}

/** Falls back to "Paramètres généraux" when the requested tab is not visible. */
export function resolveSettingsTab(
	requested: SettingsTabId | null | undefined,
	settings: { toolbarEnabled: boolean },
): SettingsTabId {
	const visible = getVisibleSettingsTabs(settings);
	return requested && visible.includes(requested) ? requested : 'general';
}

/**
 * Host row of the tab bar. Obsidian 1.15+ enters a settings page (Tab or Enter from
 * the sidebar) on the first non-heading `.setting-item`, and only tabs through
 * controls inside such rows. The row therefore is an ordinary setting row with
 * tabindex="-1" (like rows created by Obsidian's Setting): Tab goes row → active tab.
 */
export const TABS_ROW_CLASSES = ['setting-item', 'inkwell-settings-tabs-row'] as const;
export const TABS_ROW_ATTRIBUTES: Readonly<Record<string, string>> = { tabindex: '-1' };

/** Keyboard navigation in the tab list (ArrowLeft/Right wrap, Home/End). */
export function nextTabIndex(key: string, current: number, count: number): number | null {
	if (count <= 0) return null;
	switch (key) {
		case 'ArrowRight':
			return (current + 1) % count;
		case 'ArrowLeft':
			return (current - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}

/** Renders an accessible tab list; `onSelect` is called with the chosen tab id. */
export function renderSettingsTabBar(
	containerEl: HTMLElement,
	visible: SettingsTabId[],
	active: SettingsTabId,
	onSelect: (id: SettingsTabId, focus: boolean) => void,
): void {
	const bar = containerEl.createDiv({
		cls: 'inkwell-settings-tabs',
		attr: { role: 'tablist', 'aria-label': 'Sections des réglages d’Inkwell' },
	});
	const tabs = SETTINGS_TABS.filter((t) => visible.includes(t.id));
	tabs.forEach((tab, index) => {
		const isActive = tab.id === active;
		const btn = bar.createEl('button', {
			cls: 'inkwell-settings-tab',
			text: tab.label,
			attr: {
				type: 'button',
				role: 'tab',
				'aria-selected': isActive ? 'true' : 'false',
				tabindex: isActive ? '0' : '-1',
				'data-tab': tab.id,
				'data-inkwell-focus-id': `tab:${tab.id}`,
			},
		});
		btn.toggleClass('is-active', isActive);
		btn.addEventListener('click', () => onSelect(tab.id, false));
		btn.addEventListener('keydown', (e) => {
			const next = nextTabIndex(e.key, index, tabs.length);
			if (next === null) return;
			e.preventDefault();
			const target = tabs[next];
			if (target) onSelect(target.id, true);
		});
	});
}
