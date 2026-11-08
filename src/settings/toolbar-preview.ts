import type InkwellPlugin from '../main';
import { applyToolbarAppearance } from '../ui/toolbar-appearance';

/**
 * Interactive preview of the floating toolbar inside the settings.
 *
 * - Built from a static copy of the real toolbar markup (same groups, buttons,
 *   icons and CSS classes), so the organisation shown is the real one.
 * - The copy has no listeners; the preview container additionally stops mouse
 *   and keyboard events from propagating, so nothing reaches the editor or runs
 *   a command. It does not depend on the window where the real toolbar lives.
 * - Hover uses the real CSS; clicking a tool marks it as selected (preview only).
 * - `refresh()` re-applies the appearance on the same element, keeping the
 *   selected tool when visual settings change.
 */
export class ToolbarPreview {
	private toolbar: HTMLElement | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: InkwellPlugin,
		private readonly state: { selectedIndex: number | null },
	) {
		const wrap = containerEl.createDiv({ cls: 'inkwell-toolbar-preview' });
		wrap.createDiv({
			cls: 'inkwell-toolbar-preview-caption',
			text: 'Aperçu — survolez ou sélectionnez un outil. Aucune note n’est modifiée.',
		});
		const stage = wrap.createDiv({ cls: 'inkwell-toolbar-preview-stage' });

		const template = plugin.toolbarManager?.createPreviewTemplate(stage.doc) ?? null;
		if (!template) {
			stage.createDiv({
				cls: 'inkwell-toolbar-preview-unavailable',
				text: 'Aperçu indisponible : la barre d’outils n’est pas chargée.',
			});
			return;
		}
		this.toolbar = template;
		stage.appendChild(template);

		const buttons = Array.from(template.querySelectorAll('button'));
		const select = (index: number | null) => {
			this.state.selectedIndex = index;
			buttons.forEach((btn, i) => {
				const on = i === index;
				btn.toggleClass('is-active', on);
				if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
			});
		};

		// Isolation: keep focus/selection where it is and never let events bubble out.
		stage.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		stage.addEventListener('keydown', (e) => {
			e.stopPropagation();
		});
		stage.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const btn = (e.target as HTMLElement | null)?.closest('button');
			if (!btn || !template.contains(btn)) return;
			const index = buttons.indexOf(btn);
			select(index === this.state.selectedIndex ? null : index);
		});

		const restored = this.state.selectedIndex;
		select(restored !== null && restored < buttons.length ? restored : null);
		this.refresh();
	}

	/** Re-applies style, transparency and corner radius from the current settings. */
	refresh(): void {
		if (this.toolbar) applyToolbarAppearance(this.toolbar, this.plugin.settings);
	}
}
