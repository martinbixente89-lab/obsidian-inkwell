import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { findSimpleSpansInLine } from './simple-spans';
import { TagNavigationOptions } from './extension';

export const INKWELL_BOLD_SYNCED_ATTR = 'data-inkwell-bold-synced';

/**
 * Removes `cm-strong` and tracking attribute from any embed element
 * that was previously styled by Inkwell. Never removes native classes
 * that were not added by Inkwell.
 */
export function cleanupSyncedBold(container: HTMLElement): void {
	const elements = container.querySelectorAll<HTMLElement>(`[${INKWELL_BOLD_SYNCED_ATTR}="1"]`);
	for (let i = 0; i < elements.length; i++) {
		const el = elements[i]!;
		el.classList.remove('cm-strong');
		el.removeAttribute(INKWELL_BOLD_SYNCED_ATTR);
	}
}

/**
 * Directly synchronizes the bold state of inactive `.cm-html-embed` widgets
 * with the underlying simple Inkwell spans.
 *
 * Each widget is precisely mapped to its document position via `view.posAtDOM(embed)`.
 */
export function syncInactiveEmbedBoldDirect(
	view: EditorView,
	isBoldSupported: boolean,
): void {
	const doc = view.state.doc;
	const embeds = view.contentDOM.querySelectorAll<HTMLElement>('.cm-html-embed');
	if (embeds.length === 0) return;

	for (let i = 0; i < embeds.length; i++) {
		const embed = embeds[i]!;
		const hasInkwellSpan = Boolean(embed.querySelector('span[data-inkwell]'));
		const isCurrentlySynced = embed.getAttribute(INKWELL_BOLD_SYNCED_ATTR) === '1';

		if (!hasInkwellSpan) {
			// Non-Inkwell widget: if previously synced by mistake, clean up; otherwise never touch
			if (isCurrentlySynced) {
				embed.classList.remove('cm-strong');
				embed.removeAttribute(INKWELL_BOLD_SYNCED_ATTR);
			}
			continue;
		}

		let pos: number;
		try {
			pos = view.posAtDOM(embed);
		} catch {
			continue;
		}

		if (pos < 0 || pos >= doc.length) continue;

		const line = doc.lineAt(pos);
		const spans = findSimpleSpansInLine(line.text, line.from, isBoldSupported);
		const match = spans.find((s) => s.spanStart === pos);

		if (match && match.enclosedInBold) {
			if (!embed.classList.contains('cm-strong') || !isCurrentlySynced) {
				embed.classList.add('cm-strong');
				embed.setAttribute(INKWELL_BOLD_SYNCED_ATTR, '1');
			}
		} else {
			if (isCurrentlySynced) {
				embed.classList.remove('cm-strong');
				embed.removeAttribute(INKWELL_BOLD_SYNCED_ATTR);
			}
		}
	}
}

/**
 * Creates the ViewPlugin responsible for synchronizing bold state
 * on inactive `.cm-html-embed` widgets in Live Preview.
 *
 * Uses requestAnimationFrame to execute post-render without interfering
 * with CodeMirror internal measure loops.
 */
export class InactiveBoldSyncPluginValue {
	view: EditorView;
	rafId: number | null = null;
	scheduled = false;
	private options: TagNavigationOptions;
	private customScheduler?: {
		requestAnimationFrame: (cb: () => void) => number;
		cancelAnimationFrame: (id: number) => void;
	};

	constructor(
		view: EditorView,
		options: TagNavigationOptions,
		scheduler?: {
			requestAnimationFrame: (cb: () => void) => number;
			cancelAnimationFrame: (id: number) => void;
		},
	) {
		this.view = view;
		this.options = options;
		this.customScheduler = scheduler;
		this.schedule(options.isActive(view.state), this.isBold());
	}

	private getScheduler(): {
		requestAnimationFrame: (cb: () => void) => number;
		cancelAnimationFrame: (id: number) => void;
	} {
		return this.customScheduler ?? window;
	}

	isBold(): boolean {
		return this.options.isBoldSupported?.() === true;
	}

	schedule(active: boolean, boldSupported: boolean): void {
		const s = this.getScheduler();
		if (!active || !boldSupported) {
			if (this.rafId !== null) {
				s.cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}
			this.scheduled = false;
			cleanupSyncedBold(this.view.contentDOM);
			return;
		}

		if (this.scheduled) return;
		this.scheduled = true;

		this.rafId = s.requestAnimationFrame(() => {
			this.scheduled = false;
			this.rafId = null;
			syncInactiveEmbedBoldDirect(this.view, boldSupported);
		});
	}

	update(u: ViewUpdate): void {
		const active = this.options.isActive(u.state);
		const boldSupported = this.isBold();

		if (!active || !boldSupported) {
			this.schedule(false, false);
			return;
		}

		if (
			u.docChanged ||
			u.viewportChanged ||
			u.selectionSet ||
			active !== this.options.isActive(u.startState)
		) {
			this.schedule(active, boldSupported);
		}
	}

	destroy(): void {
		if (this.rafId !== null) {
			this.getScheduler().cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.scheduled = false;
		cleanupSyncedBold(this.view.contentDOM);
	}
}

/**
 * Creates the ViewPlugin responsible for synchronizing bold state
 * on inactive `.cm-html-embed` widgets in Live Preview.
 */
export function createInactiveBoldSyncPlugin(
	options: TagNavigationOptions,
): ViewPlugin<InactiveBoldSyncPluginValue> {
	return ViewPlugin.define((view) => new InactiveBoldSyncPluginValue(view, options));
}

