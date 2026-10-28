import type { EditorView } from '@codemirror/view';
import { ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Plugin } from 'obsidian';
import { isLightBackground } from '../format/color-spans';

/**
 * Live Preview extension for Inkwell:
 * Finds .cm-html-embed elements that contain an Inkwell color span (<span style="color: ...">)
 * and checks whether they are inside bold/italic Markdown context in the syntax tree.
 * When found, adds .cm-strong and/or .cm-em to the embed element so that it matches
 * the active Obsidian theme's font weight and style.
 *
 * This extension is strictly scoped to Inkwell spans, never affects other HTML embeds,
 * and is automatically removed when the plugin is disabled.
 */

interface LezerNode {
	name: string;
	from: number;
	to: number;
}

function getSyntaxTreeFromView(view: EditorView) {
	const values = (view.state as unknown as { values?: unknown[] }).values;
	if (!Array.isArray(values)) return null;
	const treeField = values.find(
		(v) =>
			v &&
			typeof v === 'object' &&
			'tree' in v &&
			typeof (v as { tree: { iterate: unknown } }).tree?.iterate === 'function',
	) as { tree: { iterate: (spec: { from: number; to: number; enter: (node: LezerNode) => void }) => void } } | undefined;
	return treeField?.tree ?? null;
}

export function createInkwellLivePreviewPlugin() {
	return ViewPlugin.fromClass(
		class {
			constructor(view: EditorView) {
				this.updateEmbedStyles(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.geometryChanged) {
					this.updateEmbedStyles(update.view);
				}
			}

			destroy() {
				// Cleanup is handled by CodeMirror DOM lifecycle when plugin unloads
			}

			private updateEmbedStyles(view: EditorView) {
				const dom = view.contentDOM;
				const embeds = dom.querySelectorAll('.cm-html-embed');
				if (embeds.length === 0) return;

				const tree = getSyntaxTreeFromView(view);

				for (let i = 0; i < embeds.length; i++) {
					const embed = embeds[i];
					if (!(embed instanceof HTMLElement)) continue;

					// Scope to Inkwell color & highlight spans, or underline elements:
					const targetElement = embed.querySelector(
						'span[data-inkwell], :scope > u, span[style*="color:"], span[style*="background-color:"]',
					);
					if (!targetElement) {
						// Not an Inkwell span or managed element: do not touch
						continue;
					}

					let isStrong = false;
					let isEm = false;
					let isStrike = false;

					if (tree) {
						const pos = view.posAtDOM(embed);
						const line = view.state.doc.lineAt(pos);
						let strongCount = 0;
						let emCount = 0;
						let strikeCount = 0;

						// Inspect nodes on the line preceding the embed
						tree.iterate({
							from: line.from,
							to: pos,
							enter(node: LezerNode) {
								if (node.name.includes('formatting-strong')) strongCount++;
								else if (node.name.includes('strong') && !node.name.includes('formatting')) {
									if (node.to > pos) isStrong = true;
								}
								if (node.name.includes('formatting-em')) emCount++;
								if (node.name.includes('formatting-strikethrough')) strikeCount++;
							},
						});

						if (strongCount % 2 === 1) isStrong = true;
						if (emCount % 2 === 1) isEm = true;
						if (strikeCount % 2 === 1) isStrike = true;
					}

					if (isStrong) embed.classList.add('cm-strong');
					else embed.classList.remove('cm-strong');

					if (isEm) embed.classList.add('cm-em');
					else embed.classList.remove('cm-em');

					if (isStrike) embed.classList.add('cm-strikethrough');
					else embed.classList.remove('cm-strikethrough');

					const hlSpan = embed.querySelector('span[data-inkwell], span[style*="background-color"]');
					if (hlSpan instanceof HTMLElement) {
						const bg = hlSpan.style.backgroundColor;
						const color = hlSpan.style.color;
						if (bg && isLightBackground(bg) && !color) {
							hlSpan.classList.add('inkwell-highlight-light');
						} else {
							hlSpan.classList.remove('inkwell-highlight-light');
						}
					}
				}
			}
		},
	);
}

export function registerLivePreviewExtension(plugin: Plugin): void {
	plugin.registerEditorExtension(createInkwellLivePreviewPlugin());
}
