import {
	EditorSelection,
	EditorState,
	Extension,
	Prec,
	Range,
	RangeSet,
	StateField,
} from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	keymap,
	WidgetType,
} from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	getStateHeadingFoldSnapshot,
	refreshHeadingFoldEffect,
	toggleHeadingFoldAtLine,
} from '../blocks/heading-fold';
import {
	isTableDelimiterLine,
	parseStandaloneMediaEmbedLine,
	VisualColumnTocWidget,
	VisualMathMermaidWidget,
	VisualMediaEmbedWidget,
	VisualTableWidget,
} from '../blocks/visual-embed-widgets';

const HIDE_SYNTAX = Decoration.replace({});
let activeVisualDecoPlugin: InkwellPlugin | null = null;

class HeadingFoldWidget extends WidgetType {
	constructor(
		private readonly lineNumber: number,
		private readonly level: number,
		private readonly isToggle: boolean,
		private readonly collapsed: boolean,
		private readonly hasContent: boolean,
		private readonly plugin: InkwellPlugin | null,
	) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'inkwell-heading-fold-btn';
		if (this.isToggle || this.collapsed) {
			btn.classList.add('is-persistent-toggle');
		} else {
			btn.classList.add('is-hover-toggle');
		}
		if (this.collapsed) {
			btn.classList.add('is-collapsed');
		}
		btn.textContent = this.collapsed ? '▸' : '▾';
		btn.title = this.collapsed
			? `Déplier la section H${this.level}`
			: `Replier la section H${this.level}`;
		btn.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
		btn.setAttribute('aria-label', btn.title);

		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.plugin) {
				toggleHeadingFoldAtLine(view, this.lineNumber, this.plugin);
			}
		});

		return btn;
	}

	eq(other: HeadingFoldWidget): boolean {
		return (
			other.lineNumber === this.lineNumber &&
			other.level === this.level &&
			other.isToggle === this.isToggle &&
			other.collapsed === this.collapsed &&
			other.hasContent === this.hasContent
		);
	}

	ignoreEvent(): boolean {
		return true;
	}
}

class BulletDotWidget extends WidgetType {
	constructor(private readonly indentSpaces: number) {
		super();
	}
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'inkwell-col-list-bullet';
		if (this.indentSpaces > 0) {
			span.style.paddingLeft = `${Math.min(6, Math.floor(this.indentSpaces / 2)) * 14}px`;
		}
		span.textContent = '• ';
		return span;
	}
	eq(other: BulletDotWidget): boolean {
		return other.indentSpaces === this.indentSpaces;
	}
}

class TaskCheckboxWidget extends WidgetType {
	constructor(
		private readonly bracketPos: number,
		private readonly checked: boolean,
		private readonly indentSpaces: number,
	) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('span');
		wrap.className = 'inkwell-col-task-checkbox-wrap';
		if (this.indentSpaces > 0) {
			wrap.style.paddingLeft = `${Math.min(6, Math.floor(this.indentSpaces / 2)) * 14}px`;
		}

		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'task-list-item-checkbox inkwell-col-task-checkbox';
		checkbox.checked = this.checked;
		checkbox.setAttribute(
			'aria-label',
			this.checked ? 'Marquer la tâche comme non terminée' : 'Marquer la tâche comme terminée',
		);

		checkbox.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const docLen = view.state.doc.length;
			const charPos = this.bracketPos + 1;
			if (charPos >= 0 && charPos < docLen) {
				const nextChar = this.checked ? ' ' : 'x';
				view.dispatch({
					changes: { from: charPos, to: charPos + 1, insert: nextChar },
					userEvent: 'input.task.toggle',
				});
			}
		});

		wrap.appendChild(checkbox);
		return wrap;
	}

	eq(other: TaskCheckboxWidget): boolean {
		return (
			other.bracketPos === this.bracketPos &&
			other.checked === this.checked &&
			other.indentSpaces === this.indentSpaces
		);
	}

	ignoreEvent(): boolean {
		return true;
	}
}

class ToggleChevronWidget extends WidgetType {
	constructor(
		private readonly foldCharPos: number,
		private readonly collapsed: boolean,
	) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'inkwell-col-toggle-chevron-btn';
		btn.textContent = this.collapsed ? '▸' : '▾';
		btn.title = this.collapsed ? 'Déplier ce bloc' : 'Replier ce bloc';
		btn.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');

		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.foldCharPos >= 0 && this.foldCharPos < view.state.doc.length) {
				const nextFold = this.collapsed ? '+' : '-';
				view.dispatch({
					changes: { from: this.foldCharPos, to: this.foldCharPos + 1, insert: nextFold },
					userEvent: 'input.toggle.fold',
				});
			}
		});

		return btn;
	}

	eq(other: ToggleChevronWidget): boolean {
		return other.foldCharPos === this.foldCharPos && other.collapsed === this.collapsed;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

class CalloutBadgeWidget extends WidgetType {
	constructor(private readonly calloutType: string) {
		super();
	}

	toDOM(): HTMLElement {
		const badge = document.createElement('span');
		badge.className = 'inkwell-col-callout-badge';
		const lower = this.calloutType.toLowerCase();
		badge.textContent =
			lower === 'warning' || lower === 'caution'
				? '⚠ '
				: lower === 'tip' || lower === 'hint'
					? '💡 '
					: 'ℹ ';
		return badge;
	}

	eq(other: CalloutBadgeWidget): boolean {
		return other.calloutType === this.calloutType;
	}
}

class HorizontalRuleWidget extends WidgetType {
	toDOM(): HTMLElement {
		const wrap = document.createElement('span');
		wrap.className = 'inkwell-visual-hr-widget';
		const hr = document.createElement('hr');
		hr.className = 'inkwell-visual-hr-el';
		wrap.appendChild(hr);
		return wrap;
	}

	eq(): boolean {
		return true;
	}
}

class CodeFenceBadgeWidget extends WidgetType {
	constructor(
		private readonly language: string,
		private readonly fenceChars: string,
		private readonly lineFrom: number,
		private readonly lineTo: number,
		private readonly firstCodeLinePos: number,
	) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const bar = document.createElement('span');
		bar.className = 'inkwell-visual-code-header-bar';

		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'inkwell-visual-code-lang-input';
		input.value = this.language.trim();
		input.placeholder = 'code';
		input.title = 'Langage du bloc de code';
		input.style.width = `${Math.max(4, (this.language.trim().length || 4) + 1)}ch`;

		input.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Escape') {
				e.preventDefault();
				const nextLang = input.value.trim();
				const newLineText = `${this.fenceChars}${nextLang}`;
				const safeFrom = Math.max(0, Math.min(this.lineFrom, view.state.doc.length));
				const safeTo = Math.max(safeFrom, Math.min(this.lineTo, view.state.doc.length));
				const delta = newLineText.length - (safeTo - safeFrom);
				const targetPos = Math.max(
					0,
					Math.min(this.firstCodeLinePos + delta, view.state.doc.length + delta),
				);
				view.dispatch({
					changes: { from: safeFrom, to: safeTo, insert: newLineText },
					selection: EditorSelection.cursor(targetPos),
					userEvent: 'input.type',
				});
				view.focus();
			}
		});
		input.addEventListener('change', () => {
			const nextLang = input.value.trim();
			const newLineText = `${this.fenceChars}${nextLang}`;
			const safeFrom = Math.max(0, Math.min(this.lineFrom, view.state.doc.length));
			const safeTo = Math.max(safeFrom, Math.min(this.lineTo, view.state.doc.length));
			if (view.state.sliceDoc(safeFrom, safeTo) !== newLineText) {
				view.dispatch({
					changes: { from: safeFrom, to: safeTo, insert: newLineText },
					userEvent: 'input.type',
				});
			}
		});

		bar.appendChild(input);
		bar.addEventListener('mousedown', (e) => {
			if (e.target === input) return;
			e.preventDefault();
			e.stopPropagation();
			const safePos = Math.max(0, Math.min(this.firstCodeLinePos, view.state.doc.length));
			view.dispatch({
				selection: EditorSelection.cursor(safePos),
			});
			view.focus();
		});

		return bar;
	}

	eq(other: CodeFenceBadgeWidget): boolean {
		return (
			other.language === this.language &&
			other.fenceChars === this.fenceChars &&
			other.lineFrom === this.lineFrom &&
			other.lineTo === this.lineTo &&
			other.firstCodeLinePos === this.firstCodeLinePos
		);
	}

	ignoreEvent(): boolean {
		return true;
	}
}

interface MarkdownDecoSets {
	lineAndMarkSet: DecorationSet;
	replaceSet: DecorationSet;
	atomicSet: RangeSet<Decoration>;
}

/**
 * Computes visual Markdown decorations (headings with fold chevrons, bold, italic, strikethrough,
 * inline code, task lists with clickable checkboxes, bullet/numbered lists, quotes without '>',
 * callouts/toggles without '>', horizontal rules, code blocks without fence markers,
 * interactive cell tables, rendered media embeds, equations, Mermaid diagrams, and dynamic TOC)
 * for a column or callout sub-EditorView.
 */
function buildColumnMarkdownDecos(state: EditorState): MarkdownDecoSets {
	const doc = state.doc;

	const foldSnap = activeVisualDecoPlugin
		? getStateHeadingFoldSnapshot(state, activeVisualDecoPlugin)
		: null;
	const foldedLines = foldSnap?.foldedLines ?? new Set<number>();
	const headingSectionByLine = new Map<number, { sectionEndLine: number }>();
	if (foldSnap) {
		for (const sec of foldSnap.sections) {
			headingSectionByLine.set(sec.lineNumber, sec);
		}
	}

	const lineAndMarkEntries: Array<{ from: number; to: number; deco: Decoration }> = [];
	const replaceEntries: Array<{ from: number; to: number; deco: Decoration }> = [];
	const atomicEntries: Array<{ from: number; to: number }> = [];

	let tableBlockIdx = 0;
	let mathBlockIdx = 0;
	let mermaidBlockIdx = 0;

	let i = 1;
	while (i <= doc.lines) {
		if (foldedLines.has(i)) {
			const foldedLine = doc.line(i);
			lineAndMarkEntries.push({
				from: foldedLine.from,
				to: foldedLine.from,
				deco: Decoration.line({ class: 'inkwell-heading-folded-line' }),
			});
			i++;
			continue;
		}

		const line = doc.line(i);
		const text = line.text;
		const trimmed = text.trim();

		// 1. Fenced code block or Mermaid diagram: ```lang ... ```
		const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(text);
		if (fenceMatch && fenceMatch[2]) {
			const fence = fenceMatch[2];
			const lang = (fenceMatch[3] ?? '').trim();
			const startLineNum = i;
			let endLineNum = i;

			i++;
			while (i <= doc.lines) {
				const nextLine = doc.line(i);
				if (nextLine.text.trim().startsWith(fence)) {
					endLineNum = i;
					i++;
					break;
				}
				i++;
			}

			// 1a. Mermaid diagram block: render interactive preview + source editor
			if (
				lang.toLowerCase() === 'mermaid' &&
				endLineNum > startLineNum &&
				activeVisualDecoPlugin
			) {
				const closeLine = doc.line(endLineNum);
				const rawBlock = doc.sliceString(line.from, closeLine.to);
				const innerLines: string[] = [];
				for (let k = startLineNum + 1; k < endLineNum; k++) {
					innerLines.push(doc.line(k).text);
				}
				const innerSource = innerLines.join('\n');
				replaceEntries.push({
					from: line.from,
					to: closeLine.to,
					deco: Decoration.replace({
						widget: new VisualMathMermaidWidget(
							'mermaid',
							rawBlock,
							innerSource,
							line.from,
							closeLine.to,
							mermaidBlockIdx++,
							activeVisualDecoPlugin,
						),
					}),
				});
				atomicEntries.push({
					from: line.from,
					to: closeLine.to,
				});
				continue;
			}

			// 1b. Standard code block: always hide opening/closing ``` fences, keep inner code lines editable
			const firstCodePos =
				startLineNum + 1 <= doc.lines ? doc.line(startLineNum + 1).from : line.to;
			if (line.to > line.from) {
				replaceEntries.push({
					from: line.from,
					to: line.to,
					deco: Decoration.replace({
						widget: new CodeFenceBadgeWidget(
							lang,
							`${fenceMatch[1] ?? ''}${fence}`,
							line.from,
							line.to,
							firstCodePos,
						),
					}),
				});
				atomicEntries.push({
					from: line.from,
					to: line.to,
				});
			}

			// Decorate inner editable code lines
			for (let codeLineIdx = startLineNum + 1; codeLineIdx < endLineNum; codeLineIdx++) {
				const cLine = doc.line(codeLineIdx);
				lineAndMarkEntries.push({
					from: cLine.from,
					to: cLine.from,
					deco: Decoration.line({ class: 'inkwell-visual-code-line' }),
				});
			}

			// Always hide closing fence line so raw ``` never reappears on click
			if (endLineNum > startLineNum) {
				const closeLine = doc.line(endLineNum);
				if (closeLine.to > closeLine.from) {
					replaceEntries.push({
						from: closeLine.from,
						to: closeLine.to,
						deco: HIDE_SYNTAX,
					});
					atomicEntries.push({
						from: closeLine.from,
						to: closeLine.to,
					});
				}
			}
			continue;
		}

		// 1c. Math equation block: $$ ... $$ (single-line or multi-line)
		if (trimmed.startsWith('$$') && activeVisualDecoPlugin) {
			let endLineNum = i;
			let innerSource = '';

			if (trimmed.length > 4 && trimmed.endsWith('$$')) {
				innerSource = trimmed.slice(2, -2).trim();
				i++;
			} else {
				const innerLines: string[] = [];
				const firstRest = trimmed.slice(2).trim();
				if (firstRest) innerLines.push(firstRest);
				i++;
				while (i <= doc.lines) {
					const nextLine = doc.line(i);
					const nTrim = nextLine.text.trim();
					if (nTrim.endsWith('$$')) {
						const beforeClose = nTrim.slice(0, -2).trim();
						if (beforeClose) innerLines.push(beforeClose);
						endLineNum = i;
						i++;
						break;
					}
					innerLines.push(nextLine.text);
					endLineNum = i;
					i++;
				}
				innerSource = innerLines.join('\n');
			}

			const endLine = doc.line(endLineNum);
			const rawBlock = doc.sliceString(line.from, endLine.to);
			replaceEntries.push({
				from: line.from,
				to: endLine.to,
				deco: Decoration.replace({
					widget: new VisualMathMermaidWidget(
						'math',
						rawBlock,
						innerSource,
						line.from,
						endLine.to,
						mathBlockIdx++,
						activeVisualDecoPlugin,
					),
				}),
			});
			atomicEntries.push({
				from: line.from,
				to: endLine.to,
			});
			continue;
		}

		// 1d. GFM Pipe Table: header line with '|' followed by delimiter line '| --- | --- |'
		if (
			trimmed.includes('|') &&
			i + 1 <= doc.lines &&
			isTableDelimiterLine(doc.line(i + 1).text)
		) {
			let endTableLineNum = i + 1;
			let j = i + 2;
			while (j <= doc.lines) {
				const rowText = doc.line(j).text.trim();
				if (!rowText.includes('|') || rowText.startsWith('>')) break;
				endTableLineNum = j;
				j++;
			}
			const endTableLine = doc.line(endTableLineNum);
			const rawTable = doc.sliceString(line.from, endTableLine.to);
			replaceEntries.push({
				from: line.from,
				to: endTableLine.to,
				deco: Decoration.replace({
					widget: new VisualTableWidget(
						rawTable,
						line.from,
						endTableLine.to,
						tableBlockIdx++,
					),
				}),
			});
			atomicEntries.push({
				from: line.from,
				to: endTableLine.to,
			});
			i = endTableLineNum + 1;
			continue;
		}

		// 1e. Standalone Media Embed line: ![[file.ext]] or ![alt](url)
		if (activeVisualDecoPlugin) {
			const mediaEmbed = parseStandaloneMediaEmbedLine(text);
			if (mediaEmbed && line.to > line.from) {
				replaceEntries.push({
					from: line.from,
					to: line.to,
					deco: Decoration.replace({
						widget: new VisualMediaEmbedWidget(
							mediaEmbed,
							line.from,
							line.to,
							activeVisualDecoPlugin,
						),
					}),
				});
				atomicEntries.push({
					from: line.from,
					to: line.to,
				});
				i++;
				continue;
			}
		}

		// 2. Callout, Collapsible Toggle, or Dynamic TOC block inside column: > [!TYPE] or > [!TYPE]- / > [!TYPE]+
		const calloutMatch = /^(\s*>\s*\[!([a-zA-Z0-9_-]+)(?:\|[^\]]*)?\])([+-])?([ \t]*)(.*)$/.exec(
			text,
		);
		if (calloutMatch && calloutMatch[2]) {
			const prefixBeforeFold = calloutMatch[1] ?? '';
			const calloutType = calloutMatch[2];
			const foldSymbol = calloutMatch[3] ?? '';
			const spaceAfter = calloutMatch[4] ?? '';
			const titleText = calloutMatch[5] ?? '';
			const isToggle = foldSymbol === '-' || foldSymbol === '+';
			const isCollapsed = foldSymbol === '-';

			// Dynamic TOC inside column (> [!toc])
			if (calloutType.toLowerCase() === 'toc' && activeVisualDecoPlugin) {
				let endTocLine = i;
				i++;
				while (i <= doc.lines) {
					const bLine = doc.line(i);
					if (!/^\s*>/.test(bLine.text) || /^\s*>\s*\[!/.test(bLine.text)) break;
					endTocLine = i;
					i++;
				}
				const endPos = doc.line(endTocLine).to;
				replaceEntries.push({
					from: line.from,
					to: endPos,
					deco: Decoration.replace({
						widget: new VisualColumnTocWidget(
							titleText,
							line.from,
							endPos,
							activeVisualDecoPlugin,
						),
					}),
				});
				atomicEntries.push({
					from: line.from,
					to: endPos,
				});
				continue;
			}

			const prefixTotalLen =
				prefixBeforeFold.length + foldSymbol.length + spaceAfter.length;

			if (isToggle) {
				const foldCharPos = line.from + prefixBeforeFold.length;
				lineAndMarkEntries.push({
					from: line.from,
					to: line.from,
					deco: Decoration.line({
						class: isCollapsed
							? 'inkwell-col-toggle-header is-collapsed'
							: 'inkwell-col-toggle-header is-expanded',
					}),
				});
				replaceEntries.push({
					from: line.from,
					to: line.from + prefixTotalLen,
					deco: Decoration.replace({
						widget: new ToggleChevronWidget(foldCharPos, isCollapsed),
					}),
				});
				atomicEntries.push({
					from: line.from,
					to: line.from + prefixTotalLen,
				});
			} else {
				lineAndMarkEntries.push({
					from: line.from,
					to: line.from,
					deco: Decoration.line({ class: 'inkwell-col-callout-header' }),
				});
				const replaceTo =
					titleText.length > 0 ? line.from + prefixTotalLen : line.to;
				if (replaceTo > line.from) {
					replaceEntries.push({
						from: line.from,
						to: replaceTo,
						deco: Decoration.replace({
							widget: new CalloutBadgeWidget(calloutType),
						}),
					});
					atomicEntries.push({
						from: line.from,
						to: replaceTo,
					});
				}
			}

			i++;
			while (i <= doc.lines) {
				const bodyLine = doc.line(i);
				const bodyMatch = /^(\s*>\s?)(.*)$/.exec(bodyLine.text);
				if (!bodyMatch || /^\s*>\s*\[!/.test(bodyLine.text)) {
					break;
				}
				const bPrefix = bodyMatch[1] ?? '';
				if (isToggle && isCollapsed) {
					lineAndMarkEntries.push({
						from: bodyLine.from,
						to: bodyLine.from,
						deco: Decoration.line({ class: 'inkwell-col-toggle-body-collapsed' }),
					});
				} else {
					lineAndMarkEntries.push({
						from: bodyLine.from,
						to: bodyLine.from,
						deco: Decoration.line({
							class: isToggle
								? 'inkwell-col-toggle-body'
								: 'inkwell-col-callout-body',
						}),
					});
					if (bPrefix.length > 0) {
						replaceEntries.push({
							from: bodyLine.from,
							to: bodyLine.from + bPrefix.length,
							deco: HIDE_SYNTAX,
						});
						atomicEntries.push({
							from: bodyLine.from,
							to: bodyLine.from + bPrefix.length,
						});
					}
				}
				i++;
			}
			continue;
		}

		// 3. Simple Quote line (> Citation): hide '>' and show visual quote border
		const quoteMatch = /^(\s*>\s?)(.*)$/.exec(text);
		if (quoteMatch && quoteMatch[1]) {
			const qPrefixLen = quoteMatch[1].length;
			lineAndMarkEntries.push({
				from: line.from,
				to: line.from,
				deco: Decoration.line({ class: 'inkwell-visual-quote-line' }),
			});
			replaceEntries.push({
				from: line.from,
				to: line.from + qPrefixLen,
				deco: HIDE_SYNTAX,
			});
			atomicEntries.push({
				from: line.from,
				to: line.from + qPrefixLen,
			});
			thisDecorateInlineFormatting(
				line.from + qPrefixLen,
				text.slice(qPrefixLen),
				lineAndMarkEntries,
				replaceEntries,
				atomicEntries,
			);
			i++;
			continue;
		}

		// 4. Horizontal Rule / Séparateur: ---, ***, ___
		if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
			if (line.to > line.from) {
				replaceEntries.push({
					from: line.from,
					to: line.to,
					deco: Decoration.replace({ widget: new HorizontalRuleWidget() }),
				});
				atomicEntries.push({
					from: line.from,
					to: line.to,
				});
			}
			i++;
			continue;
		}

		// 5. Headings: # to ###### (H1-H3 get collapsible chevron widget; H4-H6 get hidden prefix)
		const headingMatch = /^(#{1,6})\s+/.exec(text);
		if (headingMatch && headingMatch[1]) {
			const level = headingMatch[1].length;
			const prefixLen = headingMatch[0].length;
			const hState = foldSnap?.statesByLine.get(i);
			const secInfo = headingSectionByLine.get(i);
			const hasContent = secInfo ? secInfo.sectionEndLine > i : false;
			const isCollapsedHeading = Boolean(hState?.collapsed);

			lineAndMarkEntries.push({
				from: line.from,
				to: line.from,
				deco: Decoration.line({
					class: `HyperMD-header HyperMD-header-${level} inkwell-col-heading-${level}${
						isCollapsedHeading ? ' is-heading-collapsed' : ''
					}`,
				}),
			});

			if (level <= 3) {
				replaceEntries.push({
					from: line.from,
					to: line.from + prefixLen,
					deco: Decoration.replace({
						widget: new HeadingFoldWidget(
							i,
							level,
							Boolean(hState?.isToggle),
							isCollapsedHeading,
							hasContent,
							activeVisualDecoPlugin,
						),
					}),
				});
			} else {
				replaceEntries.push({
					from: line.from,
					to: line.from + prefixLen,
					deco: HIDE_SYNTAX,
				});
			}
			atomicEntries.push({
				from: line.from,
				to: line.from + prefixLen,
			});
			thisDecorateInlineFormatting(
				line.from + prefixLen,
				text.slice(prefixLen),
				lineAndMarkEntries,
				replaceEntries,
				atomicEntries,
			);

			if (isCollapsedHeading && hasContent && secInfo) {
				const foldStart = line.to;
				const foldEnd = doc.line(secInfo.sectionEndLine).to;
				if (foldEnd > foldStart) {
					replaceEntries.push({
						from: foldStart,
						to: foldEnd,
						deco: HIDE_SYNTAX,
					});
					atomicEntries.push({
						from: foldStart,
						to: foldEnd,
					});
				}
				i = secInfo.sectionEndLine + 1;
				continue;
			}

			i++;
			continue;
		}

		// 6. Task list item: '- [ ] ' or '- [x] '
		const taskMatch = /^(\s*)([-*+]\s+\[([ xX])\]\s+)/.exec(text);
		if (taskMatch && taskMatch[2]) {
			const indentStr = taskMatch[1] ?? '';
			const markerStr = taskMatch[2];
			const checkChar = taskMatch[3] ?? ' ';
			const isChecked = checkChar.toLowerCase() === 'x';
			const indentLen = indentStr.length;
			const bracketRelIdx = markerStr.indexOf('[');
			const bracketPos = line.from + indentLen + bracketRelIdx;
			const markerEnd = line.from + indentLen + markerStr.length;

			lineAndMarkEntries.push({
				from: line.from,
				to: line.from,
				deco: Decoration.line({ class: 'inkwell-col-task-line' }),
			});
			replaceEntries.push({
				from: line.from,
				to: markerEnd,
				deco: Decoration.replace({
					widget: new TaskCheckboxWidget(bracketPos, isChecked, indentLen),
				}),
			});
			atomicEntries.push({
				from: line.from,
				to: markerEnd,
			});
			if (isChecked && line.to > markerEnd) {
				lineAndMarkEntries.push({
					from: markerEnd,
					to: line.to,
					deco: Decoration.mark({ class: 'inkwell-task-checked-text' }),
				});
			}
			thisDecorateInlineFormatting(
				markerEnd,
				text.slice(indentLen + markerStr.length),
				lineAndMarkEntries,
				replaceEntries,
				atomicEntries,
			);
			i++;
			continue;
		}

		// 7. Unordered list bullet: '- ' or '* ' or '+ '
		const bulletMatch = /^(\s*)([-*+]\s+)/.exec(text);
		if (bulletMatch && bulletMatch[2]) {
			const indentLen = bulletMatch[1]?.length ?? 0;
			const markerEnd = line.from + bulletMatch[0].length;
			lineAndMarkEntries.push({
				from: line.from,
				to: line.from,
				deco: Decoration.line({ class: 'inkwell-col-list-line' }),
			});
			replaceEntries.push({
				from: line.from,
				to: markerEnd,
				deco: Decoration.replace({ widget: new BulletDotWidget(indentLen) }),
			});
			atomicEntries.push({
				from: line.from,
				to: markerEnd,
			});
			thisDecorateInlineFormatting(
				markerEnd,
				text.slice(bulletMatch[0].length),
				lineAndMarkEntries,
				replaceEntries,
				atomicEntries,
			);
			i++;
			continue;
		}

		// 8. Ordered list item: '1. ', '2. '
		const orderedMatch = /^(\s*)(\d+\.\s+)/.exec(text);
		if (orderedMatch && orderedMatch[2]) {
			const indentLen = orderedMatch[1]?.length ?? 0;
			const markerStart = line.from + indentLen;
			const markerEnd = line.from + orderedMatch[0].length;
			lineAndMarkEntries.push({
				from: line.from,
				to: line.from,
				deco: Decoration.line({ class: 'inkwell-col-list-line' }),
			});
			lineAndMarkEntries.push({
				from: markerStart,
				to: markerEnd,
				deco: Decoration.mark({ class: 'inkwell-col-list-number' }),
			});
			atomicEntries.push({
				from: markerStart,
				to: markerEnd,
			});
			thisDecorateInlineFormatting(
				markerEnd,
				text.slice(orderedMatch[0].length),
				lineAndMarkEntries,
				replaceEntries,
				atomicEntries,
			);
			i++;
			continue;
		}

		// 9. Standard paragraph line: decorate inline Markdown emphasis
		thisDecorateInlineFormatting(
			line.from,
			text,
			lineAndMarkEntries,
			replaceEntries,
			atomicEntries,
		);
		i++;
	}

	return finalizeDecoSets(lineAndMarkEntries, replaceEntries, atomicEntries);
}

function thisDecorateInlineFormatting(
	baseFrom: number,
	text: string,
	lineAndMarkEntries: Array<{ from: number; to: number; deco: Decoration }>,
	replaceEntries: Array<{ from: number; to: number; deco: Decoration }>,
	atomicEntries: Array<{ from: number; to: number }>,
): void {
	// Bold: **text**
	const boldRegex = /\*\*([^*<]+)\*\*/g;
	let m: RegExpExecArray | null;
	while ((m = boldRegex.exec(text)) !== null) {
		const start = baseFrom + m.index;
		const end = start + m[0].length;
		replaceEntries.push({ from: start, to: start + 2, deco: HIDE_SYNTAX });
		replaceEntries.push({ from: end - 2, to: end, deco: HIDE_SYNTAX });
		atomicEntries.push({ from: start, to: start + 2 });
		atomicEntries.push({ from: end - 2, to: end });
		lineAndMarkEntries.push({
			from: start + 2,
			to: end - 2,
			deco: Decoration.mark({ class: 'cm-strong', attributes: { style: 'font-weight: bold;' } }),
		});
	}

	// Strikethrough: ~~text~~
	const strikeRegex = /~~([^~<]+)~~/g;
	while ((m = strikeRegex.exec(text)) !== null) {
		const start = baseFrom + m.index;
		const end = start + m[0].length;
		replaceEntries.push({ from: start, to: start + 2, deco: HIDE_SYNTAX });
		replaceEntries.push({ from: end - 2, to: end, deco: HIDE_SYNTAX });
		atomicEntries.push({ from: start, to: start + 2 });
		atomicEntries.push({ from: end - 2, to: end });
		lineAndMarkEntries.push({
			from: start + 2,
			to: end - 2,
			deco: Decoration.mark({
				class: 'cm-strikethrough',
				attributes: { style: 'text-decoration: line-through;' },
			}),
		});
	}

	// Inline code: `code`
	const codeRegex = /`([^`<]+)`/g;
	while ((m = codeRegex.exec(text)) !== null) {
		const start = baseFrom + m.index;
		const end = start + m[0].length;
		replaceEntries.push({ from: start, to: start + 1, deco: HIDE_SYNTAX });
		replaceEntries.push({ from: end - 1, to: end, deco: HIDE_SYNTAX });
		atomicEntries.push({ from: start, to: start + 1 });
		atomicEntries.push({ from: end - 1, to: end });
		lineAndMarkEntries.push({
			from: start + 1,
			to: end - 1,
			deco: Decoration.mark({ class: 'cm-inline-code inkwell-col-inline-code' }),
		});
	}
}

function finalizeDecoSets(
	lineAndMarkEntries: Array<{ from: number; to: number; deco: Decoration }>,
	replaceEntries: Array<{ from: number; to: number; deco: Decoration }>,
	atomicEntries: Array<{ from: number; to: number }>,
): MarkdownDecoSets {
	lineAndMarkEntries.sort((a, b) => a.from - b.from || a.to - b.to);
	const lineAndMarkRanges: Range<Decoration>[] = [];
	for (const e of lineAndMarkEntries) {
		lineAndMarkRanges.push(e.deco.range(e.from, e.to));
	}
	const lineAndMarkSet = Decoration.set(lineAndMarkRanges, true);

	replaceEntries.sort((a, b) => a.from - b.from || a.to - b.to);
	const replaceRanges: Range<Decoration>[] = [];
	let lastRepTo = -1;
	for (const e of replaceEntries) {
		if (e.from >= lastRepTo && e.to > e.from) {
			replaceRanges.push(e.deco.range(e.from, e.to));
			lastRepTo = e.to;
		}
	}
	const replaceSet = Decoration.set(replaceRanges, true);

	atomicEntries.sort((a, b) => a.from - b.from || a.to - b.to);
	const atomicRanges: Range<Decoration>[] = [];
	let lastAtomTo = -1;
	for (const e of atomicEntries) {
		if (e.from >= lastAtomTo && e.to > e.from) {
			atomicRanges.push(HIDE_SYNTAX.range(e.from, e.to));
			lastAtomTo = e.to;
		}
	}
	const atomicSet = Decoration.set(atomicRanges, true);

	return {
		lineAndMarkSet,
		replaceSet,
		atomicSet,
	};
}

/**
 * Handles Enter, Backspace, Tab, and Shift-Tab ergonomics on headings, lists, tasks, and quotes
 * inside a column or callout EditorView.
 */
function createColumnMarkdownKeymap(): Extension {
	return Prec.high(
		keymap.of([
			{
				key: 'Tab',
				run(view: EditorView): boolean {
					const sel = view.state.selection.main;
					const line = view.state.doc.lineAt(sel.head);
					if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line.text)) {
						view.dispatch({
							changes: { from: line.from, to: line.from, insert: '  ' },
							selection: EditorSelection.cursor(sel.head + 2),
							userEvent: 'input.indent',
						});
						return true;
					}
					return false;
				},
			},
			{
				key: 'Shift-Tab',
				run(view: EditorView): boolean {
					const sel = view.state.selection.main;
					const line = view.state.doc.lineAt(sel.head);
					const indentMatch = /^( {1,2}|\t)(?=(?:\s*(?:[-*+]|\d+\.)\s+))/.exec(line.text);
					if (indentMatch && indentMatch[1]) {
						const removeLen = indentMatch[1].length;
						view.dispatch({
							changes: { from: line.from, to: line.from + removeLen, insert: '' },
							selection: EditorSelection.cursor(Math.max(line.from, sel.head - removeLen)),
							userEvent: 'input.unindent',
						});
						return true;
					}
					return false;
				},
			},
			{
				key: 'Backspace',
				run(view: EditorView): boolean {
					const sel = view.state.selection.main;
					if (!sel.empty) {
						view.dispatch({
							changes: { from: sel.from, to: sel.to, insert: '' },
							selection: EditorSelection.cursor(sel.from),
							userEvent: 'delete.backward',
						});
						return true;
					}
					const line = view.state.doc.lineAt(sel.head);
					const offsetInLine = sel.head - line.from;

					// 1. Heading prefix (# to ######)
					const headingMatch = /^(#{1,6}\s+)/.exec(line.text);
					if (headingMatch && headingMatch[1] && offsetInLine === headingMatch[1].length) {
						view.dispatch({
							changes: { from: line.from, to: line.from + headingMatch[1].length, insert: '' },
							selection: EditorSelection.cursor(line.from),
							userEvent: 'delete.backward',
						});
						return true;
					}

					// 2. Task list marker ('- [ ] ' or '- [x] ')
					const taskMatch = /^(\s*[-*+]\s+\[[ xX]\]\s+)/.exec(line.text);
					if (taskMatch && taskMatch[1] && offsetInLine === taskMatch[1].length) {
						view.dispatch({
							changes: { from: line.from, to: line.from + taskMatch[1].length, insert: '' },
							selection: EditorSelection.cursor(line.from),
							userEvent: 'delete.backward',
						});
						return true;
					}

					// 3. Bullet or numbered list marker ('- ' or '1. ')
					const listMatch = /^(\s*(?:[-*+]|\d+\.)\s+)/.exec(line.text);
					if (listMatch && listMatch[1] && offsetInLine === listMatch[1].length) {
						view.dispatch({
							changes: { from: line.from, to: line.from + listMatch[1].length, insert: '' },
							selection: EditorSelection.cursor(line.from),
							userEvent: 'delete.backward',
						});
						return true;
					}

					// 4. Quote prefix ('> ')
					const quoteMatch = /^(\s*>\s?)/.exec(line.text);
					if (quoteMatch && quoteMatch[1] && offsetInLine === quoteMatch[1].length) {
						view.dispatch({
							changes: { from: line.from, to: line.from + quoteMatch[1].length, insert: '' },
							selection: EditorSelection.cursor(line.from),
							userEvent: 'delete.backward',
						});
						return true;
					}

					if (sel.head === 0) {
						return true;
					}

					view.dispatch({
						changes: { from: sel.head - 1, to: sel.head, insert: '' },
						selection: EditorSelection.cursor(sel.head - 1),
						userEvent: 'delete.backward',
					});
					return true;
				},
			},
			{
				key: 'Delete',
				run(view: EditorView): boolean {
					const sel = view.state.selection.main;
					if (!sel.empty) {
						view.dispatch({
							changes: { from: sel.from, to: sel.to, insert: '' },
							selection: EditorSelection.cursor(sel.from),
							userEvent: 'delete.forward',
						});
						return true;
					}
					if (sel.head >= view.state.doc.length) return true;
					view.dispatch({
						changes: { from: sel.head, to: sel.head + 1, insert: '' },
						selection: EditorSelection.cursor(sel.head),
						userEvent: 'delete.forward',
					});
					return true;
				},
			},
			{
				key: 'Mod-a',
				run(view: EditorView): boolean {
					view.dispatch({
						selection: EditorSelection.single(0, view.state.doc.length),
					});
					return true;
				},
			},
			{
				key: 'ArrowLeft',
				run(view: EditorView): boolean {
					const sel = view.state.selection.main;
					if (!sel.empty) {
						view.dispatch({ selection: EditorSelection.cursor(sel.from) });
						return true;
					}
					const next = view.moveByChar(sel, false);
					if (next.head !== sel.head) {
						view.dispatch({ selection: EditorSelection.cursor(next.head) });
						return true;
					}
					return false;
				},
			},
			{
				key: 'ArrowRight',
				run(view: EditorView): boolean {
					const sel = view.state.selection.main;
					if (!sel.empty) {
						view.dispatch({ selection: EditorSelection.cursor(sel.to) });
						return true;
					}
					const next = view.moveByChar(sel, true);
					if (next.head !== sel.head) {
						view.dispatch({ selection: EditorSelection.cursor(next.head) });
						return true;
					}
					return false;
				},
			},
			{
				key: 'Enter',
				run(view: EditorView): boolean {
					const sel = view.state.selection.main;
					if (!sel.empty) {
						view.dispatch({
							changes: { from: sel.from, to: sel.to, insert: '\n' },
							selection: EditorSelection.cursor(sel.from + 1),
							userEvent: 'input',
						});
						return true;
					}
					const line = view.state.doc.lineAt(sel.head);

					// 1. Task list continuation: '- [ ] item' or '- [x] item' -> '\n- [ ] '
					const taskMatch = /^(\s*[-*+]\s+)\[[ xX]\]\s+(.*)$/.exec(line.text);
					if (taskMatch) {
						const bulletPart = taskMatch[1] ?? '- ';
						const content = taskMatch[2] ?? '';
						const prefixLen = bulletPart.length + 4; // '[ ] '
						if (content.trim().length === 0) {
							view.dispatch({
								changes: { from: line.from, to: line.to, insert: '' },
								selection: EditorSelection.cursor(line.from),
								userEvent: 'input',
							});
							return true;
						}
						if (sel.head >= line.from + prefixLen) {
							const nextPrefix = `\n${bulletPart}[ ] `;
							view.dispatch({
								changes: { from: sel.head, to: sel.head, insert: nextPrefix },
								selection: EditorSelection.cursor(sel.head + nextPrefix.length),
								userEvent: 'input',
							});
							return true;
						}
					}

					// 2. Ordered list continuation: '1. item' -> '\n2. '
					const orderedMatch = /^(\s*)(\d+)\.\s+(.*)$/.exec(line.text);
					if (orderedMatch) {
						const indent = orderedMatch[1] ?? '';
						const num = parseInt(orderedMatch[2] ?? '1', 10);
						const content = orderedMatch[3] ?? '';
						if (content.trim().length === 0) {
							view.dispatch({
								changes: { from: line.from, to: line.to, insert: '' },
								selection: EditorSelection.cursor(line.from),
								userEvent: 'input',
							});
							return true;
						}
						if (sel.head >= line.from + line.text.length - content.length) {
							const nextPrefix = `\n${indent}${num + 1}. `;
							view.dispatch({
								changes: { from: sel.head, to: sel.head, insert: nextPrefix },
								selection: EditorSelection.cursor(sel.head + nextPrefix.length),
								userEvent: 'input',
							});
							return true;
						}
					}

					// 3. Unordered list continuation: '- item' -> '\n- '
					const bulletMatch = /^(\s*[-*+]\s+)(.*)$/.exec(line.text);
					if (bulletMatch) {
						const prefix = bulletMatch[1] ?? '- ';
						const content = bulletMatch[2] ?? '';
						if (content.trim().length === 0) {
							view.dispatch({
								changes: { from: line.from, to: line.to, insert: '' },
								selection: EditorSelection.cursor(line.from),
								userEvent: 'input',
							});
							return true;
						}
						if (sel.head >= line.from + prefix.length) {
							const nextPrefix = `\n${prefix}`;
							view.dispatch({
								changes: { from: sel.head, to: sel.head, insert: nextPrefix },
								selection: EditorSelection.cursor(sel.head + nextPrefix.length),
								userEvent: 'input',
							});
							return true;
						}
					}

					// 4. Quote or Callout continuation inside column: '> text' -> '\n> ' (or exit on empty '> ')
					const quoteMatch = /^(\s*>\s?)(.*)$/.exec(line.text);
					if (quoteMatch) {
						const prefix = quoteMatch[1] ?? '> ';
						const content = quoteMatch[2] ?? '';
						if (content.trim().length === 0) {
							// Empty quote line: exit quote cleanly
							view.dispatch({
								changes: { from: line.from, to: line.to, insert: '' },
								selection: EditorSelection.cursor(line.from),
								userEvent: 'input',
							});
							return true;
						}
						if (sel.head >= line.from + prefix.length) {
							view.dispatch({
								changes: { from: sel.head, to: sel.head, insert: '\n> ' },
								selection: EditorSelection.cursor(sel.head + 3),
								userEvent: 'input',
							});
							return true;
						}
					}

					// Default Enter: if on a collapsed heading, unfold it first
					const headingMatch = /^(#{1,3})\s+/.exec(line.text);
					if (headingMatch && activeVisualDecoPlugin) {
						const snap = getStateHeadingFoldSnapshot(view.state, activeVisualDecoPlugin);
						if (snap.statesByLine.get(line.number)?.collapsed) {
							toggleHeadingFoldAtLine(view, line.number, activeVisualDecoPlugin);
						}
					}

					// Insert normal newline inside the column
					view.dispatch({
						changes: { from: sel.head, to: sel.head, insert: '\n' },
						selection: EditorSelection.cursor(sel.head + 1),
						userEvent: 'input',
					});
					return true;
				},
			},
		]),
	);
}

export const columnVisualMarkdownField = StateField.define<MarkdownDecoSets>({
	create(state) {
		return buildColumnMarkdownDecos(state);
	},
	update(sets, tr) {
		const hasFoldEffect = tr.effects.some((e) => e.is(refreshHeadingFoldEffect));
		if (tr.docChanged || hasFoldEffect) {
			return buildColumnMarkdownDecos(tr.state);
		}
		return sets;
	},
	provide: (f) => [
		EditorView.decorations.from(f, (v) => v.lineAndMarkSet),
		EditorView.decorations.from(f, (v) => v.replaceSet),
		EditorView.atomicRanges.of((view) => view.state.field(f, false)?.atomicSet ?? Decoration.none),
	],
});

export function createColumnVisualMarkdownExtension(): Extension {
	return [
		columnVisualMarkdownField,
		createColumnMarkdownKeymap(),
	];
}

/**
 * Root-editor extension for Notion visual mode:
 * - Hides raw '#' prefixes on headings even when focused, and provides H1-H3 fold chevrons + hierarchical section folding
 * - Hides raw '>' prefixes on regular blockquotes even when focused
 * - Hides opening/closing ``` fences on code blocks while keeping inner code lines 100% visible & editable
 * - Renders interactive cell-by-cell tables, equations ($$), Mermaid diagrams, and horizontal rules without raw syntax
 */
export function createRootVisualMarkdownExtension(inkwellPlugin: InkwellPlugin): Extension {
	activeVisualDecoPlugin = inkwellPlugin;

function isRootNotionActive(state: EditorState, inkwellPlugin: InkwellPlugin): boolean {
	if (inkwellPlugin.settings.columnPrototypeMode !== 'notion') return false;
	if (state.field(editorLivePreviewField, false) === false) return false;
	return true;
}

function buildRootQuoteDecos(state: EditorState, inkwellPlugin: InkwellPlugin): MarkdownDecoSets {
	if (!isRootNotionActive(state, inkwellPlugin)) {
		return {
			lineAndMarkSet: Decoration.none,
			replaceSet: Decoration.none,
			atomicSet: Decoration.none,
		};
	}

	const doc = state.doc;
	const foldSnap = getStateHeadingFoldSnapshot(state, inkwellPlugin);
		const foldedLines = foldSnap.foldedLines;
		const headingSectionByLine = new Map<number, { sectionEndLine: number }>();
		for (const sec of foldSnap.sections) {
			headingSectionByLine.set(sec.lineNumber, sec);
		}

		const lineAndMarkEntries: Array<{ from: number; to: number; deco: Decoration }> = [];
		const replaceEntries: Array<{ from: number; to: number; deco: Decoration }> = [];
		const atomicEntries: Array<{ from: number; to: number }> = [];

		let tableBlockIdx = 1000;
		let mathBlockIdx = 1000;
		let mermaidBlockIdx = 1000;

		let i = 1;

		// Skip YAML frontmatter at line 1
		if (doc.lines >= 1 && doc.line(1).text.trim() === '---') {
			i = 2;
			while (i <= doc.lines) {
				const t = doc.line(i).text.trim();
				i++;
				if (t === '---' || t === '...') break;
			}
		}

		while (i <= doc.lines) {
			if (foldedLines.has(i)) {
				const foldedLine = doc.line(i);
				lineAndMarkEntries.push({
					from: foldedLine.from,
					to: foldedLine.from,
					deco: Decoration.line({ class: 'inkwell-heading-folded-line' }),
				});
				i++;
				continue;
			}

			const line = doc.line(i);
			const text = line.text;
			const trimmed = text.trim();

			// 1. Skip any callout block (> [!TYPE]...) since those are handled by ColumnLayoutWidget or VisualCalloutWidget
			if (/^\s*>\s*\[!/.test(text)) {
				i++;
				while (i <= doc.lines && /^\s*>/.test(doc.line(i).text)) {
					if (foldedLines.has(i)) {
						const fl = doc.line(i);
						lineAndMarkEntries.push({
							from: fl.from,
							to: fl.from,
							deco: Decoration.line({ class: 'inkwell-heading-folded-line' }),
						});
					}
					i++;
				}
				continue;
			}

			// 2. Fenced code block or Mermaid block in root editor: ```lang ... ```
			const fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(text);
			if (fenceMatch && fenceMatch[2]) {
				const fence = fenceMatch[2];
				const lang = (fenceMatch[3] ?? '').trim();
				const startLineNum = i;
				let endLineNum = i;

				i++;
				while (i <= doc.lines) {
					const nextLine = doc.line(i);
					if (nextLine.text.trim().startsWith(fence)) {
						endLineNum = i;
						i++;
						break;
					}
					i++;
				}

				if (lang.toLowerCase() === 'mermaid' && endLineNum > startLineNum) {
					const closeLine = doc.line(endLineNum);
					const rawBlock = doc.sliceString(line.from, closeLine.to);
					const innerLines: string[] = [];
					for (let k = startLineNum + 1; k < endLineNum; k++) {
						innerLines.push(doc.line(k).text);
					}
					const innerSource = innerLines.join('\n');
					replaceEntries.push({
						from: line.from,
						to: closeLine.to,
						deco: Decoration.replace({
							widget: new VisualMathMermaidWidget(
								'mermaid',
								rawBlock,
								innerSource,
								line.from,
								closeLine.to,
								mermaidBlockIdx++,
								inkwellPlugin,
							),
						}),
					});
					atomicEntries.push({
						from: line.from,
						to: closeLine.to,
					});
					continue;
				}

				const firstCodePos =
					startLineNum + 1 <= doc.lines ? doc.line(startLineNum + 1).from : line.to;
				if (line.to > line.from) {
					replaceEntries.push({
						from: line.from,
						to: line.to,
						deco: Decoration.replace({
							widget: new CodeFenceBadgeWidget(
								lang,
								`${fenceMatch[1] ?? ''}${fence}`,
								line.from,
								line.to,
								firstCodePos,
							),
						}),
					});
					atomicEntries.push({
						from: line.from,
						to: line.to,
					});
				}

				for (let codeLineIdx = startLineNum + 1; codeLineIdx < endLineNum; codeLineIdx++) {
					const cLine = doc.line(codeLineIdx);
					lineAndMarkEntries.push({
						from: cLine.from,
						to: cLine.from,
						deco: Decoration.line({ class: 'inkwell-visual-code-line' }),
					});
				}

				if (endLineNum > startLineNum) {
					const closeLine = doc.line(endLineNum);
					if (closeLine.to > closeLine.from) {
						replaceEntries.push({
							from: closeLine.from,
							to: closeLine.to,
							deco: HIDE_SYNTAX,
						});
						atomicEntries.push({
							from: closeLine.from,
							to: closeLine.to,
						});
					}
				}
				continue;
			}

			// 3. Math equation block in root editor: $$ ... $$
			if (trimmed.startsWith('$$')) {
				let endLineNum = i;
				let innerSource = '';

				if (trimmed.length > 4 && trimmed.endsWith('$$')) {
					innerSource = trimmed.slice(2, -2).trim();
					i++;
				} else {
					const innerLines: string[] = [];
					const firstRest = trimmed.slice(2).trim();
					if (firstRest) innerLines.push(firstRest);
					i++;
					while (i <= doc.lines) {
						const nextLine = doc.line(i);
						const nTrim = nextLine.text.trim();
						if (nTrim.endsWith('$$')) {
							const beforeClose = nTrim.slice(0, -2).trim();
							if (beforeClose) innerLines.push(beforeClose);
							endLineNum = i;
							i++;
							break;
						}
						innerLines.push(nextLine.text);
						endLineNum = i;
						i++;
					}
					innerSource = innerLines.join('\n');
				}

				const endLine = doc.line(endLineNum);
				const rawBlock = doc.sliceString(line.from, endLine.to);
				replaceEntries.push({
					from: line.from,
					to: endLine.to,
					deco: Decoration.replace({
						widget: new VisualMathMermaidWidget(
							'math',
							rawBlock,
							innerSource,
							line.from,
							endLine.to,
							mathBlockIdx++,
							inkwellPlugin,
						),
					}),
				});
				atomicEntries.push({
					from: line.from,
					to: endLine.to,
				});
				continue;
			}

			// 4. GFM Pipe Table in root editor
			if (
				trimmed.includes('|') &&
				i + 1 <= doc.lines &&
				isTableDelimiterLine(doc.line(i + 1).text)
			) {
				let endTableLineNum = i + 1;
				let j = i + 2;
				while (j <= doc.lines) {
					const rowText = doc.line(j).text.trim();
					if (!rowText.includes('|') || rowText.startsWith('>')) break;
					endTableLineNum = j;
					j++;
				}
				const endTableLine = doc.line(endTableLineNum);
				const rawTable = doc.sliceString(line.from, endTableLine.to);
				replaceEntries.push({
					from: line.from,
					to: endTableLine.to,
					deco: Decoration.replace({
						widget: new VisualTableWidget(
							rawTable,
							line.from,
							endTableLine.to,
							tableBlockIdx++,
						),
					}),
				});
				atomicEntries.push({
					from: line.from,
					to: endTableLine.to,
				});
				i = endTableLineNum + 1;
				continue;
			}

			// 5. Headings (# to ######): hide '#' even when cursor is on the line, add H1-H3 fold chevron
			const headingMatch = /^(#{1,6})\s+/.exec(text);
			if (headingMatch && headingMatch[1]) {
				const level = headingMatch[1].length;
				const prefixLen = headingMatch[0].length;
				const hState = foldSnap.statesByLine.get(i);
				const secInfo = headingSectionByLine.get(i);
				const hasContent = secInfo ? secInfo.sectionEndLine > i : false;
				const isCollapsedHeading = Boolean(hState?.collapsed);

				lineAndMarkEntries.push({
					from: line.from,
					to: line.from,
					deco: Decoration.line({
						class: `HyperMD-header HyperMD-header-${level} inkwell-heading-${level}${
							isCollapsedHeading ? ' is-heading-collapsed' : ''
						}`,
					}),
				});

				if (level <= 3) {
					replaceEntries.push({
						from: line.from,
						to: line.from + prefixLen,
						deco: Decoration.replace({
							widget: new HeadingFoldWidget(
								i,
								level,
								Boolean(hState?.isToggle),
								isCollapsedHeading,
								hasContent,
								inkwellPlugin,
							),
						}),
					});
				} else {
					replaceEntries.push({
						from: line.from,
						to: line.from + prefixLen,
						deco: HIDE_SYNTAX,
					});
				}
				atomicEntries.push({
					from: line.from,
					to: line.from + prefixLen,
				});

				if (isCollapsedHeading && hasContent && secInfo) {
					const foldStart = line.to;
					const foldEnd = doc.line(secInfo.sectionEndLine).to;
					if (foldEnd > foldStart) {
						replaceEntries.push({
							from: foldStart,
							to: foldEnd,
							deco: HIDE_SYNTAX,
						});
						atomicEntries.push({
							from: foldStart,
							to: foldEnd,
						});
					}
					i = secInfo.sectionEndLine + 1;
					continue;
				}

				i++;
				continue;
			}

			// 6. Regular blockquote line (> Citation): hide '>' prefix and apply visual quote line class
			const quoteMatch = /^(\s*>\s?)(.*)$/.exec(text);
			if (quoteMatch && quoteMatch[1]) {
				const qLen = quoteMatch[1].length;
				lineAndMarkEntries.push({
					from: line.from,
					to: line.from,
					deco: Decoration.line({ class: 'inkwell-visual-quote-line' }),
				});
				replaceEntries.push({
					from: line.from,
					to: line.from + qLen,
					deco: HIDE_SYNTAX,
				});
				atomicEntries.push({
					from: line.from,
					to: line.from + qLen,
				});
				i++;
				continue;
			}

			// 7. Horizontal Rule (---, ***, ___): keep visual <hr> even when clicked
			if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
				if (line.to > line.from) {
					replaceEntries.push({
						from: line.from,
						to: line.to,
						deco: Decoration.replace({ widget: new HorizontalRuleWidget() }),
					});
					atomicEntries.push({
						from: line.from,
						to: line.to,
					});
				}
				i++;
				continue;
			}

			i++;
		}

		return finalizeDecoSets(lineAndMarkEntries, replaceEntries, atomicEntries);
	}

	const rootVisualMarkdownField = StateField.define<MarkdownDecoSets>({
		create(state) {
			return buildRootQuoteDecos(state, inkwellPlugin);
		},
		update(sets, tr) {
			const hasFoldEffect = tr.effects.some((e) => e.is(refreshHeadingFoldEffect));
			if (tr.docChanged || hasFoldEffect) {
				return buildRootQuoteDecos(tr.state, inkwellPlugin);
			}
			return sets;
		},
		provide: (f) => [
			EditorView.decorations.from(f, (v) => v.lineAndMarkSet),
			EditorView.decorations.from(f, (v) => v.replaceSet),
			EditorView.atomicRanges.of((view) => view.state.field(f, false)?.atomicSet ?? Decoration.none),
		],
	});

	const rootQuoteKeymap = Prec.high(
		keymap.of([
			{
				key: 'Backspace',
				run(view: EditorView): boolean {
					if (!isRootNotionActive(view.state, inkwellPlugin)) return false;
					const sel = view.state.selection.main;
					if (!sel.empty) return false;
					const line = view.state.doc.lineAt(sel.head);
					if (/^\s*>\s*\[!/.test(line.text)) return false;

					// Backspace at start of visible heading text removes '# ' prefix
					const headingMatch = /^(#{1,6}\s+)/.exec(line.text);
					if (headingMatch && headingMatch[1] && sel.head === line.from + headingMatch[1].length) {
						view.dispatch({
							changes: {
								from: line.from,
								to: line.from + headingMatch[1].length,
								insert: '',
							},
							selection: EditorSelection.cursor(line.from),
							userEvent: 'delete.backward',
						});
						return true;
					}

					const quoteMatch = /^(\s*>\s?)/.exec(line.text);
					if (quoteMatch && quoteMatch[1] && sel.head === line.from + quoteMatch[1].length) {
						view.dispatch({
							changes: { from: line.from, to: line.from + quoteMatch[1].length, insert: '' },
							selection: EditorSelection.cursor(line.from),
							userEvent: 'delete.backward',
						});
						return true;
					}
					return false;
				},
			},
			{
				key: 'Enter',
				run(view: EditorView): boolean {
					if (!isRootNotionActive(view.state, inkwellPlugin)) return false;
					const sel = view.state.selection.main;
					if (!sel.empty) return false;
					const line = view.state.doc.lineAt(sel.head);
					if (/^\s*>\s*\[!/.test(line.text)) return false;

					// Enter on a collapsed heading unfolds it first
					const headingMatch = /^(#{1,3})\s+/.exec(line.text);
					if (headingMatch) {
						const snap = getStateHeadingFoldSnapshot(view.state, inkwellPlugin);
						if (snap.statesByLine.get(line.number)?.collapsed) {
							toggleHeadingFoldAtLine(view, line.number, inkwellPlugin);
						}
					}

					const quoteMatch = /^(\s*>\s?)(.*)$/.exec(line.text);
					if (quoteMatch && quoteMatch[1]) {
						const prefix = quoteMatch[1];
						const content = quoteMatch[2] ?? '';
						if (content.trim().length === 0) {
							view.dispatch({
								changes: { from: line.from, to: line.to, insert: '' },
								selection: EditorSelection.cursor(line.from),
								userEvent: 'input',
							});
							return true;
						}
						if (sel.head >= line.from + prefix.length) {
							view.dispatch({
								changes: { from: sel.head, to: sel.head, insert: '\n> ' },
								selection: EditorSelection.cursor(sel.head + 3),
								userEvent: 'input',
							});
							return true;
						}
					}
					return false;
				},
			},
		]),
	);

	return [
		rootVisualMarkdownField,
		rootQuoteKeymap,
	];
}
