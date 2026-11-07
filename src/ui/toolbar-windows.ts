/**
 * Multi-window helpers for the floating toolbar.
 *
 * Obsidian can have several windows (main + popouts). The toolbar must not stay
 * bound to whichever window happened to be active when the plugin loaded:
 * its listeners are attached once per window document, and the toolbar element
 * is moved into the document of the editor that holds the selection.
 */

/** Calls `attach` exactly once per document. */
export class PerDocumentAttachment<D extends object = Document> {
	private readonly attached = new WeakSet<D>();

	constructor(private readonly attach: (doc: D) => void) {}

	/** Returns true when `doc` was attached by this call. */
	ensure(doc: D | null | undefined): boolean {
		if (!doc || this.attached.has(doc)) return false;
		this.attached.add(doc);
		this.attach(doc);
		return true;
	}
}

interface RelocatableElement<D> {
	ownerDocument: D;
	isConnected: boolean;
}

interface DocumentWithBody<E> {
	body: { appendChild(el: E): unknown } | null;
}

/**
 * Ensures `el` is attached to `doc` (moving it from another window's document if needed).
 * Returns true when the element was moved or re-attached.
 */
export function relocateToDocument<D extends DocumentWithBody<E>, E extends RelocatableElement<D>>(
	el: E,
	doc: D | null | undefined,
): boolean {
	if (!doc?.body) return false;
	if (el.ownerDocument === doc && el.isConnected) return false;
	doc.body.appendChild(el);
	return true;
}
