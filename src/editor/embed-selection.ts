import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Plugin } from 'obsidian';
import { embedOffsetToRaw } from '../format/color-spans';

/** Class of the widget Obsidian uses to render inline HTML in Live Preview. */
const HTML_EMBED_SELECTOR = '.cm-html-embed';

interface CapturedSelection {
	view: EditorView;
	doc: Text;
	/** Editor selection at capture time, used to detect it has moved since. */
	editorFrom: number;
	editorTo: number;
	/** Selection mapped to document offsets. */
	from: number;
	to: number;
}

function toElement(node: Node): Element | null {
	return node.instanceOf(Element) ? node : node.parentElement;
}

/** Text length from the start of `container` to the DOM point (node, offset). */
function visibleOffsetIn(container: Element, node: Node, offset: number): number {
	const range = container.ownerDocument.createRange();
	range.setStart(container, 0);
	range.setEnd(node, offset);
	return range.toString().length;
}

/** Maps a DOM point to a document offset, including points inside an HTML widget. */
function domPointToPos(
	view: EditorView,
	node: Node,
	offset: number,
	edge: 'start' | 'end',
): number {
	const embed = toElement(node)?.closest(HTML_EMBED_SELECTOR);
	if (!embed || !view.contentDOM.contains(embed)) {
		return view.posAtDOM(node, offset);
	}
	const widgetStart = view.posAtDOM(embed);
	const line = view.state.doc.lineAt(widgetStart);
	const raw = embedOffsetToRaw(
		line.text,
		widgetStart - line.from,
		embed.textContent ?? '',
		visibleOffsetIn(embed, node, offset),
		edge,
	);
	return raw === null ? widgetStart : line.from + raw;
}

/**
 * In Live Preview, a colored span is rendered as a non-editable widget. A
 * mouse selection made inside it exists only in the DOM: the editor selection
 * does not move. And opening the command palette then clears the DOM
 * selection. So we remember such selections as they happen.
 */
export class EmbedSelectionTracker {
	private captured: CapturedSelection | null = null;

	handleSelectionChange(doc: Document): void {
		const selection = doc.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);
		const startEl = toElement(range.startContainer);
		const endEl = toElement(range.endContainer);

		const content = startEl?.closest('.cm-content');
		// Focus left the editor (e.g. command palette input): keep the capture.
		if (!content?.instanceOf(HTMLElement)) return;

		const inEmbed =
			!!startEl?.closest(HTML_EMBED_SELECTOR) || !!endEl?.closest(HTML_EMBED_SELECTOR);
		const view = EditorView.findFromDOM(content);
		if (!inEmbed || !view) {
			// The editor handles this selection itself.
			this.captured = null;
			return;
		}

		// DOM ranges are always ordered (start before end).
		const from = domPointToPos(view, range.startContainer, range.startOffset, 'start');
		const to = range.collapsed
			? from
			: domPointToPos(view, range.endContainer, range.endOffset, 'end');
		const main = view.state.selection.main;
		this.captured = {
			view,
			doc: view.state.doc,
			editorFrom: main.from,
			editorTo: main.to,
			from,
			to,
		};
	}

	/**
	 * Returns the remembered widget selection for `view`, if it is still valid:
	 * same document content and editor selection unchanged since capture.
	 */
	getSelection(view: EditorView): { from: number; to: number } | null {
		const c = this.captured;
		if (!c || c.view !== view || c.doc !== view.state.doc) return null;
		const main = view.state.selection.main;
		if (main.from !== c.editorFrom || main.to !== c.editorTo) return null;
		return { from: c.from, to: c.to };
	}
}

/** Starts tracking selections in the main window and in pop-out windows. */
export function registerEmbedSelectionTracking(plugin: Plugin): EmbedSelectionTracker {
	const tracker = new EmbedSelectionTracker();
	const listen = (doc: Document) =>
		plugin.registerDomEvent(doc, 'selectionchange', () =>
			tracker.handleSelectionChange(doc),
		);
	listen(activeDocument);
	plugin.registerEvent(plugin.app.workspace.on('window-open', (win) => listen(win.doc)));
	return tracker;
}
