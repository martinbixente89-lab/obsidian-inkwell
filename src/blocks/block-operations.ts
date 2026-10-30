import {
	canAddColumnToGroup,
	getBalancedRatios,
	normalizeRatiosTo100,
	redistributeRatiosAfterRemoval,
	serializeMultiColumnMarkdown,
} from '../columns/parser';
import {
	DocumentBlock,
	DropZone,
	findBlockById,
	isMovableBlock,
	parseDocumentBlocks,
} from './block-model';

export interface BlockOperationResult {
	docText: string;
	/** Approximate character offset in the new document where focus/cursor can be placed */
	focusOffset: number;
}

export interface MoveBlockOptions {
	/** Measured pixel width of the editor/column container to enforce minimum usable column width */
	availableWidthPx?: number;
}

export type RelativeBlockAction =
	| 'up'
	| 'down'
	| 'pair-left'
	| 'pair-right'
	| 'to-prev-col'
	| 'to-next-col'
	| 'to-other-col'
	| 'split-col-left'
	| 'split-col-right'
	| 'exit-above'
	| 'exit-below';

export type ConvertibleBlockKind =
	| 'paragraph'
	| 'h1'
	| 'h2'
	| 'h3'
	| 'h4'
	| 'toggle-h1'
	| 'toggle-h2'
	| 'toggle-h3'
	| 'bullet-list'
	| 'numbered-list'
	| 'task-list'
	| 'quote'
	| 'callout'
	| 'toggle';

interface LeafNode {
	id: string;
	markdown: string;
}

type RootNode =
	| {
			type: 'single';
			id: string;
			markdown: string;
	  }
	| {
			type: 'multi-column';
			id: string;
			ratios: number[];
			colTag: 'col' | 'column';
			columns: LeafNode[][];
			initialColCount: number;
			columnAdded?: boolean;
	  };

function toRootNodes(blocks: DocumentBlock[]): RootNode[] {
	return blocks.map((b) => {
		if (b.kind === 'multi-column') {
			const cols = b.columns.map((col) =>
				col.map((cb) => ({ id: cb.id, markdown: cb.markdown })),
			);
			return {
				type: 'multi-column',
				id: b.id,
				ratios: [...b.ratios],
				colTag: b.colTag,
				columns: cols,
				initialColCount: cols.length,
			};
		}
		return {
			type: 'single',
			id: b.id,
			markdown: b.markdown,
		};
	});
}

/**
 * Simplifies and normalizes multi-column containers after a block operation:
 * - Removes any empty column.
 * - If 0 columns remain: removes the container.
 * - If 1 column remains: unwraps its blocks into normal top-level flow.
 * - If >= 2 columns remain:
 *   - When a column was added (`columnAdded` and count increased): distributes widths evenly (`getBalancedRatios`).
 *   - When an empty column was removed: redistributes its width among remaining columns (`redistributeRatiosAfterRemoval`).
 *   - Otherwise preserves existing normalized ratios summing to 100%.
 */
function simplifyMultiColumnNodes(nodes: RootNode[]): RootNode[] {
	const simplified: RootNode[] = [];
	for (const node of nodes) {
		if (node.type !== 'multi-column') {
			simplified.push(node);
			continue;
		}

		const nonEmptyCols: LeafNode[][] = [];
		const keptIndices: number[] = [];
		node.columns.forEach((col, idx) => {
			const filtered = col.filter((b) => b.markdown.trim().length > 0);
			if (filtered.length > 0) {
				nonEmptyCols.push(filtered);
				keptIndices.push(idx);
			}
		});

		if (nonEmptyCols.length === 0) {
			continue;
		}
		if (nonEmptyCols.length === 1) {
			for (const b of nonEmptyCols[0]!) {
				simplified.push({ type: 'single', id: b.id, markdown: b.markdown });
			}
			continue;
		}

		let nextRatios: number[];
		if (node.columnAdded && nonEmptyCols.length > node.initialColCount) {
			nextRatios = getBalancedRatios(nonEmptyCols.length);
		} else if (nonEmptyCols.length < node.initialColCount && !node.columnAdded) {
			nextRatios = redistributeRatiosAfterRemoval(node.ratios, keptIndices);
		} else if (node.columnAdded && nonEmptyCols.length === node.initialColCount) {
			// A single-block column within the same group was moved to another column slot
			nextRatios = normalizeRatiosTo100(node.ratios, nonEmptyCols.length);
		} else {
			nextRatios = normalizeRatiosTo100(node.ratios, nonEmptyCols.length);
		}

		simplified.push({
			...node,
			ratios: nextRatios,
			columns: nonEmptyCols,
			initialColCount: nonEmptyCols.length,
			columnAdded: false,
		});
	}
	return simplified;
}

function serializeRootNodes(nodes: RootNode[], focusNodeId?: string): BlockOperationResult {
	const chunks: string[] = [];
	let currentOffset = 0;
	let focusOffset = 0;

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;
		if (i > 0) {
			chunks.push('\n\n');
			currentOffset += 2;
		}

		if (node.type === 'single') {
			if (node.id === focusNodeId) {
				focusOffset = currentOffset;
			}
			chunks.push(node.markdown);
			currentOffset += node.markdown.length;
		} else {
			const serialized = serializeMultiColumnMarkdown({
				ratios: node.ratios,
				columns: node.columns.map((col) => ({
					blocks: [],
					text: col.map((b) => b.markdown).join('\n\n'),
					map: [],
				})),
				col1: [],
				col2: [],
				colTag: node.colTag,
			});
			if (
				node.id === focusNodeId ||
				node.columns.some((col) => col.some((b) => b.id === focusNodeId))
			) {
				focusOffset = currentOffset;
			}
			chunks.push(serialized);
			currentOffset += serialized.length;
		}
	}

	return {
		docText: chunks.join(''),
		focusOffset,
	};
}

function extractLeafById(nodes: RootNode[], id: string): LeafNode | null {
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;
		if (node.type === 'single' && node.id === id) {
			nodes.splice(i, 1);
			return { id: node.id, markdown: node.markdown };
		}
		if (node.type === 'multi-column') {
			for (const col of node.columns) {
				const idx = col.findIndex((b) => b.id === id);
				if (idx !== -1) {
					const [removed] = col.splice(idx, 1);
					return removed ?? null;
				}
			}
		}
	}
	return null;
}

/**
 * Moves a supported movable block (`sourceId`) relative to `targetId` in the given `zone`
 * (`'before' | 'after' | 'left' | 'right'`).
 *
 * Rules enforced:
 * - Rejects self-drop (`sourceId === targetId`).
 * - Source block must be a movable block (Paragraph or Heading H1–H6).
 * - Target block must be a movable block (or a multi-column container).
 * - Lateral drop (`'left' | 'right'`):
 *   - On a root movable block: creates a 2-column layout (`50% / 50%`).
 *   - On a column block (or multi-column container): inserts a new sibling column at that position
 *     in the SAME multi-column group (1 level of columns, never nested) and balances widths,
 *     provided `canAddColumnToGroup` allows adding a usable column for the available width.
 * - Automatically removes any empty column (redistributing its width) and unwraps the container
 *   if only 1 non-empty column remains.
 */
export function moveBlock(
	docText: string,
	sourceId: string,
	targetId: string,
	zone: DropZone,
	options?: MoveBlockOptions,
): BlockOperationResult | null {
	if (sourceId === targetId) return null;

	const blocks = parseDocumentBlocks(docText);
	const sourceFound = findBlockById(blocks, sourceId);
	const targetFound = findBlockById(blocks, targetId);

	if (!sourceFound || !targetFound) return null;
	if (!isMovableBlock(sourceFound.block)) return null;

	const targetBlock = targetFound.block;
	const isTargetMultiColContainer = targetBlock.kind === 'multi-column';

	if (!isTargetMultiColContainer && !isMovableBlock(targetBlock)) {
		return null;
	}

	// Check width constraints if lateral drop ('left' | 'right') will increase column count
	if (zone === 'left' || zone === 'right') {
		if (targetBlock.location.scope === 'root' && !isTargetMultiColContainer) {
			const check = canAddColumnToGroup(1, options?.availableWidthPx);
			if (!check.allowed) return null;
		} else {
			const targetMc = isTargetMultiColContainer
				? targetBlock
				: targetFound.parentMultiCol;
			if (!targetMc) return null;

			// Check if source is the sole block of a column inside the same multi-column group
			let sourceEmptiesColumnInSameGroup = false;
			if (
				sourceFound.parentMultiCol &&
				sourceFound.parentMultiCol.id === targetMc.id &&
				sourceFound.block.location.scope === 'column'
			) {
				const srcColIdx = sourceFound.block.location.colIndex;
				const srcCol = targetMc.columns[srcColIdx] ?? [];
				if (srcCol.length <= 1) {
					sourceEmptiesColumnInSameGroup = true;
					// If dropping to the left/right of the ONLY block in the same column, reject no-op
					if (
						targetBlock.location.scope === 'column' &&
						targetBlock.location.colIndex === srcColIdx
					) {
						return null;
					}
				}
			}

			const effectiveCurrentCols = sourceEmptiesColumnInSameGroup
				? targetMc.columns.length - 1
				: targetMc.columns.length;
			const check = canAddColumnToGroup(effectiveCurrentCols, options?.availableWidthPx);
			if (!check.allowed) return null;
		}
	}

	const nodes = toRootNodes(blocks);
	const sourceLeaf = extractLeafById(nodes, sourceId);
	if (!sourceLeaf) return null;

	let inserted = false;

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;

		// Case 1: Target is a top-level block or multi-column container
		if (node.id === targetId) {
			if (zone === 'before') {
				nodes.splice(i, 0, {
					type: 'single',
					id: sourceLeaf.id,
					markdown: sourceLeaf.markdown,
				});
				inserted = true;
				break;
			}
			if (zone === 'after') {
				nodes.splice(i + 1, 0, {
					type: 'single',
					id: sourceLeaf.id,
					markdown: sourceLeaf.markdown,
				});
				inserted = true;
				break;
			}
			if ((zone === 'left' || zone === 'right') && node.type === 'single') {
				const targetLeaf: LeafNode = { id: node.id, markdown: node.markdown };
				const cols =
					zone === 'left'
						? [[sourceLeaf], [targetLeaf]]
						: [[targetLeaf], [sourceLeaf]];
				nodes.splice(i, 1, {
					type: 'multi-column',
					id: `mc-${sourceLeaf.id}-${targetLeaf.id}`,
					ratios: [50, 50],
					colTag: 'col',
					columns: cols,
					initialColCount: 2,
					columnAdded: true,
				});
				inserted = true;
				break;
			}
			if ((zone === 'left' || zone === 'right') && node.type === 'multi-column') {
				const insertColIdx = zone === 'left' ? 0 : node.columns.length;
				node.columns.splice(insertColIdx, 0, [sourceLeaf]);
				node.columnAdded = true;
				inserted = true;
				break;
			}
		}

		// Case 2: Target is inside a column of `node`
		if (node.type === 'multi-column') {
			let foundColIdx = -1;
			let foundInnerIdx = -1;
			for (let cIdx = 0; cIdx < node.columns.length; cIdx++) {
				const innerIdx = node.columns[cIdx]!.findIndex((b) => b.id === targetId);
				if (innerIdx !== -1) {
					foundColIdx = cIdx;
					foundInnerIdx = innerIdx;
					break;
				}
			}

			if (foundColIdx !== -1 && foundInnerIdx !== -1) {
				if (zone === 'before' || zone === 'after') {
					const insertIdx = zone === 'before' ? foundInnerIdx : foundInnerIdx + 1;
					node.columns[foundColIdx]!.splice(insertIdx, 0, sourceLeaf);
					inserted = true;
					break;
				}
				if (zone === 'left' || zone === 'right') {
					// Add a new sibling column in the SAME group at `foundColIdx` (left) or `foundColIdx + 1` (right)
					const insertColIdx = zone === 'left' ? foundColIdx : foundColIdx + 1;
					node.columns.splice(insertColIdx, 0, [sourceLeaf]);
					node.columnAdded = true;
					inserted = true;
					break;
				}
			}
		}
	}

	if (!inserted) return null;

	const simplified = simplifyMultiColumnNodes(nodes);
	return serializeRootNodes(simplified, sourceLeaf.id);
}

/**
 * Performs a non-drag relative block operation triggered from the block handle context menu.
 */
export function moveBlockRelative(
	docText: string,
	sourceId: string,
	action: RelativeBlockAction,
	options?: MoveBlockOptions,
): BlockOperationResult | null {
	const blocks = parseDocumentBlocks(docText);
	const found = findBlockById(blocks, sourceId);
	if (!found || !isMovableBlock(found.block)) return null;

	const { block, parentMultiCol } = found;

	if (block.location.scope === 'root') {
		const idx = block.location.blockIndex;
		if (action === 'up') {
			if (idx <= 0) return null;
			const prev = blocks[idx - 1]!;
			if (!isMovableBlock(prev) && prev.kind !== 'multi-column') return null;
			return moveBlock(docText, sourceId, prev.id, 'before', options);
		}
		if (action === 'down') {
			if (idx >= blocks.length - 1) return null;
			const next = blocks[idx + 1]!;
			if (!isMovableBlock(next) && next.kind !== 'multi-column') return null;
			return moveBlock(docText, sourceId, next.id, 'after', options);
		}
		if (action === 'pair-left' || action === 'pair-right') {
			const nextBlock = idx + 1 < blocks.length ? blocks[idx + 1]! : null;
			const prevBlock = idx - 1 >= 0 ? blocks[idx - 1]! : null;
			const neighbor =
				(nextBlock && (isMovableBlock(nextBlock) || nextBlock.kind === 'multi-column')
					? nextBlock
					: null) ??
				(prevBlock && (isMovableBlock(prevBlock) || prevBlock.kind === 'multi-column')
					? prevBlock
					: null);
			if (!neighbor) return null;
			return moveBlock(
				docText,
				sourceId,
				neighbor.id,
				action === 'pair-left' ? 'left' : 'right',
				options,
			);
		}
		return null;
	}

	// Block is inside a column
	if (!parentMultiCol) return null;
	const colIdx = block.location.colIndex;
	const totalCols = parentMultiCol.columns.length;
	const colBlocks = parentMultiCol.columns[colIdx] ?? [];
	const innerIdx = block.location.innerBlockIndex;

	if (action === 'up') {
		if (innerIdx <= 0) return null;
		const prev = colBlocks[innerIdx - 1]!;
		if (!isMovableBlock(prev)) return null;
		return moveBlock(docText, sourceId, prev.id, 'before', options);
	}
	if (action === 'down') {
		if (innerIdx >= colBlocks.length - 1) return null;
		const next = colBlocks[innerIdx + 1]!;
		if (!isMovableBlock(next)) return null;
		return moveBlock(docText, sourceId, next.id, 'after', options);
	}
	if (action === 'to-prev-col') {
		if (colIdx <= 0) return null;
		const prevCol = parentMultiCol.columns[colIdx - 1] ?? [];
		const lastMovable = [...prevCol].reverse().find((b) => isMovableBlock(b));
		if (lastMovable) {
			return moveBlock(docText, sourceId, lastMovable.id, 'after', options);
		}
		return null;
	}
	if (action === 'to-next-col') {
		if (colIdx >= totalCols - 1) return null;
		const nextCol = parentMultiCol.columns[colIdx + 1] ?? [];
		const lastMovable = [...nextCol].reverse().find((b) => isMovableBlock(b));
		if (lastMovable) {
			return moveBlock(docText, sourceId, lastMovable.id, 'after', options);
		}
		return null;
	}
	if (action === 'to-other-col') {
		const targetColIdx = colIdx + 1 < totalCols ? colIdx + 1 : colIdx - 1;
		if (targetColIdx < 0 || targetColIdx >= totalCols) return null;
		const targetCol = parentMultiCol.columns[targetColIdx] ?? [];
		const lastMovable = [...targetCol].reverse().find((b) => isMovableBlock(b));
		if (lastMovable) {
			return moveBlock(docText, sourceId, lastMovable.id, 'after', options);
		}
		return null;
	}
	if (action === 'split-col-left' || action === 'split-col-right') {
		// Find another block in the same column to anchor the lateral split
		const sibling = colBlocks.find((b) => b.id !== sourceId && isMovableBlock(b));
		if (!sibling) return null;
		return moveBlock(
			docText,
			sourceId,
			sibling.id,
			action === 'split-col-left' ? 'left' : 'right',
			options,
		);
	}
	if (action === 'exit-above') {
		return moveBlock(docText, sourceId, parentMultiCol.id, 'before', options);
	}
	if (action === 'exit-below') {
		return moveBlock(docText, sourceId, parentMultiCol.id, 'after', options);
	}

	return null;
}

/**
 * Inserts a new block (given by `templateMarkdown`) right before or after `targetId`.
 */
export function insertBlockRelative(
	docText: string,
	targetId: string,
	position: 'before' | 'after',
	templateMarkdown: string,
): BlockOperationResult | null {
	const blocks = parseDocumentBlocks(docText);
	const found = findBlockById(blocks, targetId);
	if (!found) return null;

	const nodes = toRootNodes(blocks);
	const newLeaf: LeafNode = {
		id: `inserted-${Date.now()}`,
		markdown: templateMarkdown,
	};

	let inserted = false;
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;
		if (node.id === targetId) {
			const insertIdx = position === 'before' ? i : i + 1;
			nodes.splice(insertIdx, 0, {
				type: 'single',
				id: newLeaf.id,
				markdown: newLeaf.markdown,
			});
			inserted = true;
			break;
		}
		if (node.type === 'multi-column') {
			for (const col of node.columns) {
				const idx = col.findIndex((b) => b.id === targetId);
				if (idx !== -1) {
					const insertIdx = position === 'before' ? idx : idx + 1;
					col.splice(insertIdx, 0, newLeaf);
					inserted = true;
					break;
				}
			}
			if (inserted) break;
		}
	}

	if (!inserted) return null;
	return serializeRootNodes(nodes, newLeaf.id);
}

/**
 * Converts a movable block (`targetId`) to a paragraph, heading (`h1`–`h4`), list, quote, callout, or toggle,
 * preserving inline Markdown and Inkwell HTML spans.
 */
export function convertBlockKind(
	docText: string,
	targetId: string,
	targetKind: ConvertibleBlockKind,
): BlockOperationResult | null {
	const blocks = parseDocumentBlocks(docText);
	const found = findBlockById(blocks, targetId);
	if (!found || !isMovableBlock(found.block)) return null;
	if (
		found.block.kind === 'hr' ||
		found.block.kind === 'code' ||
		found.block.kind === 'table' ||
		found.block.kind === 'math' ||
		found.block.kind === 'media'
	) {
		return null;
	}

	// Strip existing block prefixes per line
	const rawLines = found.block.markdown.split('\n');
	const cleanedLines: string[] = [];
	for (let idx = 0; idx < rawLines.length; idx++) {
		const l = rawLines[idx] ?? '';
		if (idx === 0 && /^\s*>\s*\[![^\]]+\][+-]?[ \t]*(.*)$/.test(l)) {
			const m = /^\s*>\s*\[![^\]]+\][+-]?[ \t]*(.*)$/.exec(l);
			if (m?.[1]?.trim()) {
				cleanedLines.push(m[1].trim());
			}
			continue;
		}
		const stripped = l
			.replace(/^(#{1,6})\s+/, '')
			.replace(/^\s*>\s?/, '')
			.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
			.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
		cleanedLines.push(stripped);
	}
	const nonEmptyLines = cleanedLines.filter((l) => l.trim().length > 0);
	const effectiveLines = nonEmptyLines.length > 0 ? nonEmptyLines : [''];

	let updatedMarkdown: string;
	switch (targetKind) {
		case 'paragraph':
			updatedMarkdown = effectiveLines.join('\n');
			break;
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'toggle-h1':
		case 'toggle-h2':
		case 'toggle-h3': {
			const hPrefix =
				targetKind === 'h1' || targetKind === 'toggle-h1'
					? '# '
					: targetKind === 'h2' || targetKind === 'toggle-h2'
						? '## '
						: targetKind === 'h3' || targetKind === 'toggle-h3'
							? '### '
							: '#### ';
			updatedMarkdown = `${hPrefix}${effectiveLines.join(' ').trim()}`;
			break;
		}
		case 'bullet-list':
			updatedMarkdown = effectiveLines.map((l) => `- ${l}`).join('\n');
			break;
		case 'numbered-list':
			updatedMarkdown = effectiveLines.map((l, i) => `${i + 1}. ${l}`).join('\n');
			break;
		case 'task-list':
			updatedMarkdown = effectiveLines.map((l) => `- [ ] ${l}`).join('\n');
			break;
		case 'quote':
			updatedMarkdown = effectiveLines.map((l) => `> ${l}`).join('\n');
			break;
		case 'callout':
			updatedMarkdown = ['> [!NOTE]', ...effectiveLines.map((l) => `> ${l}`)].join('\n');
			break;
		case 'toggle': {
			const first = effectiveLines[0] || 'Menu dépliant';
			const rest = effectiveLines.slice(1);
			const bodyLines = rest.length > 0 ? rest : [''];
			updatedMarkdown = [
				`> [!NOTE]+ ${first}`,
				...bodyLines.map((l) => `> ${l}`),
			].join('\n');
			break;
		}
	}

	const nodes = toRootNodes(blocks);

	for (const node of nodes) {
		if (node.type === 'single' && node.id === targetId) {
			node.markdown = updatedMarkdown;
			return serializeRootNodes(nodes, node.id);
		}
		if (node.type === 'multi-column') {
			for (const col of node.columns) {
				const b = col.find((item) => item.id === targetId);
				if (b) {
					b.markdown = updatedMarkdown;
					return serializeRootNodes(nodes, b.id);
				}
			}
		}
	}

	return null;
}
