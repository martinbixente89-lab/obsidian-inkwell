import { StateEffect } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type InkwellPlugin from '../main';

export interface HeadingSectionInfo {
	/** 1-based line number of the heading */
	lineNumber: number;
	/** Heading level 1..6 */
	level: number;
	/** Document offset of the start of the heading line */
	from: number;
	/** Document offset of the end of the heading line */
	to: number;
	/** Length of the '### ' prefix */
	prefixLen: number;
	/** Raw heading title text (after '### ') */
	titleText: string;
	/** 1-based occurrence index among headings of the same level in this document */
	levelOccurrenceIndex: number;
	/** 1-based last line number belonging to this heading's section (before the next heading of level <= this.level) */
	sectionEndLine: number;
}

export interface HeadingRuntimeState {
	isToggle: boolean;
	collapsed: boolean;
}

/**
 * StateEffect dispatched on an EditorView to force a decoration refresh when a heading fold state changes.
 */
export const refreshHeadingFoldEffect = StateEffect.define<number>();

/**
 * Runtime map from scopeId -> (lineNumber -> { isToggle, collapsed }).
 */
const scopeHeadingStates = new Map<string, Map<number, HeadingRuntimeState>>();
const initializedScopes = new Set<string>();

/**
 * Listeners notified when any heading fold state changes in the workspace.
 */
const foldChangeListeners = new Set<() => void>();

export function onHeadingFoldChange(listener: () => void): () => void {
	foldChangeListeners.add(listener);
	return () => foldChangeListeners.delete(listener);
}

function notifyHeadingFoldListeners(): void {
	for (const fn of foldChangeListeners) {
		try {
			fn();
		} catch {
			// Ignore listener errors
		}
	}
}

/**
 * Strips Inkwell HTML spans and Markdown emphasis from a heading title to form a stable key.
 */
export function normalizeHeadingTitleForKey(rawTitle: string): string {
	return rawTitle
		.replace(/<[^>]+>/g, '')
		.replace(/(\*\*|__|~~|\*|_)/g, '')
		.trim()
		.toLowerCase();
}

/**
 * Parses a Markdown document string and returns all real Markdown headings (H1-H6)
 * along with the exact hierarchical section range `[lineNumber + 1 .. sectionEndLine]`
 * governed by each heading.
 *
 * Folding rule:
 * A heading of level L (1..6) folds all following lines (including sub-headings of level > L)
 * up to the line immediately before the next heading of level <= L (or end of document).
 */
export function computeDocumentHeadingSections(docText: string): HeadingSectionInfo[] {
	const rawLines = docText.split('\n');
	const lineCount = rawLines.length;
	const headings: HeadingSectionInfo[] = [];
	const levelCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

	let offset = 0;
	let i = 0;

	// 1. Skip YAML frontmatter at start of document
	if (lineCount > 0 && rawLines[0]?.trim() === '---') {
		offset += rawLines[0].length + 1;
		i = 1;
		while (i < lineCount) {
			const lineStr = rawLines[i] ?? '';
			offset += lineStr.length + (i < lineCount - 1 ? 1 : 0);
			if (lineStr.trim() === '---' || lineStr.trim() === '...') {
				i++;
				break;
			}
			i++;
		}
	}

	let inFence: string | null = null;
	let inMathBlock = false;

	while (i < lineCount) {
		const lineStr = rawLines[i] ?? '';
		const lineFrom = offset;
		const lineTo = lineFrom + lineStr.length;
		const trimmed = lineStr.trim();

		// Track fenced code blocks (``` or ~~~)
		const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
		if (fenceMatch && fenceMatch[1]) {
			const fenceMarker = fenceMatch[1].charAt(0);
			if (!inFence) {
				inFence = fenceMarker;
			} else if (trimmed.startsWith(inFence.repeat(3))) {
				inFence = null;
			}
			offset = lineTo + (i < lineCount - 1 ? 1 : 0);
			i++;
			continue;
		}

		// Track multiline math blocks ($$)
		if (!inFence && trimmed.startsWith('$$')) {
			if (trimmed === '$$' || !trimmed.slice(2).trim().endsWith('$$')) {
				inMathBlock = !inMathBlock;
			}
			offset = lineTo + (i < lineCount - 1 ? 1 : 0);
			i++;
			continue;
		}

		if (!inFence && !inMathBlock) {
			const hMatch = /^(#{1,6})\s+(.*)$/.exec(lineStr);
			if (hMatch && hMatch[1]) {
				const level = hMatch[1].length;
				const prefixLen = hMatch[0].length - (hMatch[2]?.length ?? 0);
				const titleText = hMatch[2] ?? '';
				const nextCount = (levelCounts[level] ?? 0) + 1;
				levelCounts[level] = nextCount;
				headings.push({
					lineNumber: i + 1,
					level,
					from: lineFrom,
					to: lineTo,
					prefixLen,
					titleText,
					levelOccurrenceIndex: nextCount,
					sectionEndLine: lineCount,
				});
			}
		}

		offset = lineTo + (i < lineCount - 1 ? 1 : 0);
		i++;
	}

	// Compute hierarchical sectionEndLine for each heading:
	// Ends right before the next heading with level <= current.level
	for (let idx = 0; idx < headings.length; idx++) {
		const current = headings[idx]!;
		let endLine = lineCount;
		for (let nextIdx = idx + 1; nextIdx < headings.length; nextIdx++) {
			const nextHeading = headings[nextIdx]!;
			if (nextHeading.level <= current.level) {
				endLine = nextHeading.lineNumber - 1;
				break;
			}
		}
		current.sectionEndLine = Math.max(current.lineNumber, endLine);
	}

	return headings;
}

/**
 * Given the computed heading sections and the set of 1-based line numbers of collapsed headings,
 * returns the set of all 1-based line numbers that are hidden inside a collapsed section.
 */
export function computeFoldedLineNumbers(
	sections: HeadingSectionInfo[],
	collapsedHeadingLines: ReadonlySet<number>,
): Set<number> {
	const foldedLines = new Set<number>();
	if (collapsedHeadingLines.size === 0) return foldedLines;

	for (const sec of sections) {
		if (sec.level <= 3 && collapsedHeadingLines.has(sec.lineNumber)) {
			for (let lineNum = sec.lineNumber + 1; lineNum <= sec.sectionEndLine; lineNum++) {
				foldedLines.add(lineNum);
			}
		}
	}
	return foldedLines;
}

function getPersistentKeys(scopeId: string, sec: HeadingSectionInfo): {
	titleKey: string;
	indexKey: string;
} {
	const norm = normalizeHeadingTitleForKey(sec.titleText);
	return {
		titleKey: `${scopeId}::H${sec.level}::T:${norm}`,
		indexKey: `${scopeId}::H${sec.level}::#${sec.levelOccurrenceIndex}`,
	};
}

export function getEditorScopeId(viewOrState: EditorView | EditorState, plugin: InkwellPlugin): string {
	const activeFile = plugin.app?.workspace?.getActiveFile?.();
	const path = activeFile?.path ?? 'note';
	if ('dom' in viewOrState && viewOrState.dom) {
		const colHost = viewOrState.dom.closest('.inkwell-col-pane');
		if (colHost && colHost.parentElement) {
			const panes = Array.from(colHost.parentElement.children);
			const idx = panes.indexOf(colHost);
			return `${path}#col-${idx}`;
		}
	}
	return path;
}

function ensureScopeMap(
	scopeId: string,
	sections: HeadingSectionInfo[],
	plugin?: InkwellPlugin,
): Map<number, HeadingRuntimeState> {
	let map = scopeHeadingStates.get(scopeId);
	if (!map) {
		map = new Map<number, HeadingRuntimeState>();
		scopeHeadingStates.set(scopeId, map);
	}

	if (plugin && !initializedScopes.has(scopeId)) {
		initializedScopes.add(scopeId);
		const saved = plugin.settings.headingFoldStates ?? {};
		for (const sec of sections) {
			if (sec.level > 3) continue;
			const { titleKey, indexKey } = getPersistentKeys(scopeId, sec);
			const norm = normalizeHeadingTitleForKey(sec.titleText);
			const persisted = (norm.length > 0 ? saved[titleKey] : undefined) ?? saved[indexKey];
			if (persisted && (persisted.isToggle || persisted.collapsed)) {
				map.set(sec.lineNumber, {
					isToggle: Boolean(persisted.isToggle),
					collapsed: Boolean(persisted.collapsed),
				});
			}
		}
	}

	return map;
}

function persistScopeHeadingStates(
	scopeId: string,
	sections: HeadingSectionInfo[],
	plugin: InkwellPlugin,
): void {
	const map = scopeHeadingStates.get(scopeId);
	if (!map) return;

	if (!plugin.settings.headingFoldStates) {
		plugin.settings.headingFoldStates = {};
	}
	const saved = plugin.settings.headingFoldStates;

	// Clean old entries for this scopeId
	for (const key of Object.keys(saved)) {
		if (key.startsWith(`${scopeId}::`)) {
			delete saved[key];
		}
	}

	for (const sec of sections) {
		if (sec.level > 3) continue;
		const st = map.get(sec.lineNumber);
		if (st && (st.isToggle || st.collapsed)) {
			const { titleKey, indexKey } = getPersistentKeys(scopeId, sec);
			const norm = normalizeHeadingTitleForKey(sec.titleText);
			const payload = { isToggle: st.isToggle, collapsed: st.collapsed };
			if (norm.length > 0) {
				saved[titleKey] = payload;
			}
			saved[indexKey] = payload;
		}
	}

	void plugin.saveSettings();
}

/**
 * Updates the tracked heading line numbers when lines are inserted or deleted in `update`.
 */
export function remapViewHeadingStatesOnUpdate(
	update: ViewUpdate,
	plugin: InkwellPlugin,
): void {
	if (!update.docChanged) return;
	const scopeId = getEditorScopeId(update.view, plugin);
	const map = scopeHeadingStates.get(scopeId);
	if (!map || map.size === 0) return;

	const oldDoc = update.startState.doc;
	const newDoc = update.state.doc;
	const nextMap = new Map<number, HeadingRuntimeState>();

	for (const [oldLineNum, st] of map.entries()) {
		if (oldLineNum < 1 || oldLineNum > oldDoc.lines) continue;
		const oldLine = oldDoc.line(oldLineNum);
		const newPos = update.changes.mapPos(oldLine.from, 1);
		if (newPos >= 0 && newPos <= newDoc.length) {
			const newLine = newDoc.lineAt(newPos);
			if (/^#{1,3}\s+/.test(newLine.text)) {
				nextMap.set(newLine.number, st);
			}
		}
	}

	scopeHeadingStates.set(scopeId, nextMap);
	const sections = computeDocumentHeadingSections(newDoc.toString());
	persistScopeHeadingStates(scopeId, sections, plugin);
}

/**
 * Returns the runtime fold state for all headings in `state` (or `view`), plus the set of folded line numbers.
 */
export function getStateHeadingFoldSnapshot(
	state: EditorState,
	plugin: InkwellPlugin,
	customScopeId?: string,
): {
	sections: HeadingSectionInfo[];
	statesByLine: Map<number, HeadingRuntimeState>;
	foldedLines: Set<number>;
} {
	const sections = computeDocumentHeadingSections(state.doc.toString());
	const scopeId = customScopeId ?? getEditorScopeId(state, plugin);
	const map = ensureScopeMap(scopeId, sections, plugin);

	const collapsedLines = new Set<number>();
	for (const sec of sections) {
		if (sec.level <= 3) {
			const st = map.get(sec.lineNumber);
			if (st?.collapsed) {
				collapsedLines.add(sec.lineNumber);
			}
		}
	}

	const foldedLines = computeFoldedLineNumbers(sections, collapsedLines);
	return { sections, statesByLine: map, foldedLines };
}

/**
 * Returns the runtime fold state for all headings in `view`, plus the set of folded line numbers.
 */
export function getViewHeadingFoldSnapshot(
	view: EditorView,
	plugin: InkwellPlugin,
): {
	sections: HeadingSectionInfo[];
	statesByLine: Map<number, HeadingRuntimeState>;
	foldedLines: Set<number>;
} {
	const scopeId = getEditorScopeId(view, plugin);
	return getStateHeadingFoldSnapshot(view.state, plugin, scopeId);
}

/**
 * Checks whether a document character offset in `view` is currently hidden inside a folded heading section.
 */
export function isOffsetInFoldedHeadingSection(
	view: EditorView,
	offset: number,
	plugin?: InkwellPlugin,
): boolean {
	const safeOffset = Math.max(0, Math.min(offset, view.state.doc.length));
	const lineNum = view.state.doc.lineAt(safeOffset).number;
	const sections = computeDocumentHeadingSections(view.state.doc.toString());
	const scopeId = plugin ? getEditorScopeId(view, plugin) : 'note';
	const map = ensureScopeMap(scopeId, sections, plugin);
	const collapsedLines = new Set<number>();
	for (const sec of sections) {
		if (sec.level <= 3) {
			const st = map.get(sec.lineNumber);
			if (st?.collapsed) {
				collapsedLines.add(sec.lineNumber);
			}
		}
	}
	const foldedLines = computeFoldedLineNumbers(sections, collapsedLines);
	return foldedLines.has(lineNum);
}

/**
 * Marks a heading line or character offset in `view` as a persistent toggle heading (e.g. when inserted via /Titre dépliant 1..3).
 */
export function markHeadingLineAsToggle(
	view: EditorView,
	offsetOrLineNumber: number,
	plugin: InkwellPlugin,
	collapsed = false,
): void {
	const safePos = Math.max(0, Math.min(offsetOrLineNumber, view.state.doc.length));
	const lineNumber =
		offsetOrLineNumber <= view.state.doc.lines && offsetOrLineNumber >= 1
			? offsetOrLineNumber
			: view.state.doc.lineAt(safePos).number;
	const sections = computeDocumentHeadingSections(view.state.doc.toString());
	const scopeId = getEditorScopeId(view, plugin);
	const map = ensureScopeMap(scopeId, sections, plugin);
	map.set(lineNumber, { isToggle: true, collapsed });
	persistScopeHeadingStates(scopeId, sections, plugin);
	view.dispatch({
		effects: refreshHeadingFoldEffect.of(lineNumber),
	});
	notifyHeadingFoldListeners();
}

/**
 * Toggles the collapsed/expanded state of a heading at `lineNumber` in `view`.
 */
export function toggleHeadingFoldAtLine(
	view: EditorView,
	lineNumber: number,
	plugin: InkwellPlugin,
): boolean {
	const sections = computeDocumentHeadingSections(view.state.doc.toString());
	const scopeId = getEditorScopeId(view, plugin);
	const map = ensureScopeMap(scopeId, sections, plugin);
	const current = map.get(lineNumber) ?? { isToggle: true, collapsed: false };
	const nextCollapsed = !current.collapsed;
	map.set(lineNumber, { isToggle: true, collapsed: nextCollapsed });
	persistScopeHeadingStates(scopeId, sections, plugin);
	view.dispatch({
		effects: refreshHeadingFoldEffect.of(lineNumber),
	});
	notifyHeadingFoldListeners();
	return nextCollapsed;
}
