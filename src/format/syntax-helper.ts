import type { EditorView } from '@codemirror/view';

export interface FormattingBoundary {
	/** Relative offset within line */
	from: number;
	to: number;
	type: 'delimiter' | 'link' | 'wikilink';
	name: string;
}

export interface LineSyntaxInfo {
	wikilinks: Array<{ from: number; to: number }>;
	links: Array<{ from: number; to: number }>;
	delimiters: Array<{ from: number; to: number; text: string }>;
}

export function getLineSyntaxInfo(
	view: EditorView,
	lineFrom: number,
	lineTo: number,
): LineSyntaxInfo {
	const info: LineSyntaxInfo = {
		wikilinks: [],
		links: [],
		delimiters: [],
	};

	const values = (view.state as unknown as { values?: unknown[] }).values;
	if (!Array.isArray(values)) return info;

	const treeField = values.find(
		(v) =>
			v &&
			typeof v === 'object' &&
			'tree' in v &&
			typeof (v as { tree: { iterate: unknown } }).tree?.iterate === 'function',
	) as
		| {
				tree: {
					iterate: (spec: {
						from: number;
						to: number;
						enter: (node: { name: string; from: number; to: number }) => void;
					}) => void;
				};
		  }
		| undefined;

	if (!treeField?.tree) return info;

	const lineText = view.state.doc.sliceString(lineFrom, lineTo);

	treeField.tree.iterate({
		from: lineFrom,
		to: lineTo,
		enter(node) {
			const relFrom = Math.max(0, node.from - lineFrom);
			const relTo = Math.min(lineText.length, node.to - lineFrom);
			if (relTo <= relFrom) return;

			const name = node.name;

			// Internal wikilinks: [[...]]
			if (name.includes('internal-link') || name.includes('formatting-link')) {
				if (!name.includes('formatting-strong') && !name.includes('formatting-em')) {
					info.wikilinks.push({ from: relFrom, to: relTo });
				}
			}

			// Standard markdown links or URLs: [...](...)
			if (name.includes('string_url') || (name.includes('link') && name.includes('url'))) {
				info.links.push({ from: relFrom, to: relTo });
			}

			// Bold / Italic delimiters (** or * or __ or _)
			if (
				name.includes('formatting-strong') ||
				name.includes('formatting-em') ||
				name.includes('formatting_formatting-strong') ||
				name.includes('formatting_formatting-em')
			) {
				const text = lineText.slice(relFrom, relTo);
				if (text === '**' || text === '*' || text === '***' || text === '__' || text === '_' || text === '___') {
					info.delimiters.push({ from: relFrom, to: relTo, text });
				}
			}
		},
	});

	return info;
}
