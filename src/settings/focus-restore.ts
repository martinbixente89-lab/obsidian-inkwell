/**
 * Keeps keyboard focus on the same logical control when Inkwell's settings page
 * is rebuilt (display()). Controls are identified by stable ids:
 * - explicit `data-inkwell-focus-id` (tabs, toolbar toggle, palette options, font
 *   and colour actions keyed by their own ids), or
 * - an id derived from the setting name + control kind + label for other controls
 *   inside a `.setting-item` (counts such as "(3)" are ignored in names).
 * Nothing is restored when focus was outside the settings page at rebuild time,
 * so focus is never pulled back after the user moved it elsewhere.
 */

export const FOCUS_ATTR = 'data-inkwell-focus-id';

const FOCUSABLE =
	'button, select, textarea, input:not([type="file"]), .checkbox-container, [role="option"], [role="tab"], [tabindex]:not([tabindex="-1"])';

export interface FocusSnapshot {
	id: string;
	/** All focus ids in document order at capture time (to find a neighbour). */
	order: string[];
}

/** Setting names may contain counts that change ("Couleurs disponibles (3)"). */
export function normalizeSettingName(name: string): string {
	return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

export function derivedFocusKey(settingName: string, kind: string, label: string): string {
	return `setting:${normalizeSettingName(settingName)}:${kind}:${label.trim()}`;
}

/**
 * Chooses the control to focus after a rebuild: the same id if it still exists,
 * otherwise the nearest following then preceding control from the old order,
 * otherwise null (caller falls back to the active tab).
 */
export function pickFocusTarget(snapshot: FocusSnapshot, available: ReadonlySet<string>): string | null {
	if (available.has(snapshot.id)) return snapshot.id;
	const index = snapshot.order.indexOf(snapshot.id);
	if (index === -1) return null;
	for (let i = index + 1; i < snapshot.order.length; i++) {
		const id = snapshot.order[i];
		if (id !== undefined && available.has(id)) return id;
	}
	for (let i = index - 1; i >= 0; i--) {
		const id = snapshot.order[i];
		if (id !== undefined && available.has(id)) return id;
	}
	return null;
}

/** Gives every focusable control inside a setting row a derived id (explicit ids win). */
export function stampFocusIds(container: HTMLElement): void {
	const seen = new Map<string, number>();
	container.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
		if (el.hasAttribute(FOCUS_ATTR)) return;
		const setting = el.closest('.setting-item');
		if (!setting || !container.contains(setting)) return;
		const name = setting.querySelector('.setting-item-name')?.textContent ?? '';
		const kind = el.classList.contains('checkbox-container') ? 'toggle' : el.tagName.toLowerCase();
		const label =
			el.getAttribute('aria-label') ?? (el.tagName === 'BUTTON' ? (el.textContent ?? '') : '');
		const base = derivedFocusKey(name, kind, label);
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		el.setAttribute(FOCUS_ATTR, n === 1 ? base : `${base}#${n}`);
	});
}

function idsInOrder(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll<HTMLElement>(`[${FOCUS_ATTR}]`))
		.map((el) => el.getAttribute(FOCUS_ATTR) ?? '')
		.filter((id) => id.length > 0);
}

/** Returns null when the focused element is not inside the settings page. */
export function captureFocus(container: HTMLElement): FocusSnapshot | null {
	const active = container.doc.activeElement;
	if (!active || !container.contains(active)) return null;
	const owner = active.closest(`[${FOCUS_ATTR}]`);
	const id = owner && container.contains(owner) ? owner.getAttribute(FOCUS_ATTR) : null;
	if (!id) return null;
	return { id, order: idsInOrder(container) };
}

export function restoreFocus(
	container: HTMLElement,
	snapshot: FocusSnapshot | null,
	fallback: () => HTMLElement | null,
): void {
	if (!snapshot) return;
	// The user may have moved focus out of the page meanwhile: leave it there.
	// Focus is "lost" when on <body> or on an ancestor (Obsidian may move it to the
	// settings content container); anything else means the user moved it elsewhere.
	const active = container.doc.activeElement;
	const lost = !active || active === container.doc.body || active.contains(container);
	if (!lost && !container.contains(active)) return;
	const available = new Set(idsInOrder(container));
	const targetId = pickFocusTarget(snapshot, available);
	const target = targetId
		? container.querySelector<HTMLElement>(`[${FOCUS_ATTR}="${CSS.escape(targetId)}"]`)
		: fallback();
	target?.focus({ preventScroll: true });
}
