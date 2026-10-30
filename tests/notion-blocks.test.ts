import test from 'node:test';
import assert from 'node:assert';
import {
	findBlockById,
	isMovableBlock,
	parseColumnInnerBlocks,
	parseDocumentBlocks,
	parseMarkdownTable,
	parseStandaloneMediaEmbedLine,
	serializeMarkdownTable,
} from '../src/blocks/block-model';
import {
	computeDocumentHeadingSections,
	computeFoldedLineNumbers,
} from '../src/blocks/heading-fold';
import {
	convertBlockKind,
	insertBlockRelative,
	moveBlock,
	moveBlockRelative,
} from '../src/blocks/block-operations';
import {
	parseSingleCalloutMarkdown,
	serializeSingleCalloutMarkdown,
} from '../src/blocks/callout-parser';
import {
	localOffsetToParentOffset,
	parentOffsetToLocalOffset,
} from '../src/columns/parser';

void test('Notion blocks: segments paragraphs (including multi-line) and headings H1-H6 as distinct movable blocks', () => {
	const doc = [
		'# Titre principal',
		'## Sous-titre collé sans ligne vide',
		'',
		'Première ligne du paragraphe',
		'Deuxième ligne du même paragraphe avec <span data-inkwell="1" style="color: #e03131">couleur</span>.',
		'',
		'Second paragraphe distinct.',
	].join('\n');

	const blocks = parseDocumentBlocks(doc);
	assert.strictEqual(blocks.length, 4);

	assert.strictEqual(blocks[0]?.kind, 'heading');
	if (blocks[0]?.kind === 'heading') {
		assert.strictEqual(blocks[0].headingLevel, 1);
		assert.strictEqual(blocks[0].markdown, '# Titre principal');
	}

	assert.strictEqual(blocks[1]?.kind, 'heading');
	if (blocks[1]?.kind === 'heading') {
		assert.strictEqual(blocks[1].headingLevel, 2);
		assert.strictEqual(blocks[1].markdown, '## Sous-titre collé sans ligne vide');
	}

	assert.strictEqual(blocks[2]?.kind, 'paragraph');
	assert.strictEqual(blocks[2]?.fromLine, 3);
	assert.strictEqual(blocks[2]?.toLine, 4);
	assert.ok(blocks[2]?.markdown.includes('Première ligne du paragraphe\nDeuxième ligne'));

	assert.strictEqual(blocks[3]?.kind, 'paragraph');
	assert.strictEqual(blocks[3]?.markdown, 'Second paragraphe distinct.');
});

void test('Notion blocks: segments movable whole-block units (list, code, quote/callout/toggle, hr) and protects unsupported blocks (frontmatter, math, tables, images)', () => {
	const doc = [
		'---',
		'title: Démo',
		'---',
		'',
		'# Introduction',
		'',
		'- Élément 1',
		'  - Sous-élément indenté',
		'- [ ] Tâche à faire',
		'',
		'```ts',
		'const x = 1;',
		'```',
		'',
		'$$',
		'E = mc^2',
		'$$',
		'',
		'| Col A | Col B |',
		'| --- | --- |',
		'| 1 | 2 |',
		'',
		'> Citation classique',
		'> Seconde ligne de citation',
		'',
		'![Image](photo.png)',
		'',
		'---',
		'',
		'Paragraphe final.',
	].join('\n');

	const blocks = parseDocumentBlocks(doc);
	const kinds = blocks.map((b) =>
		b.kind === 'unsupported' ? `unsupported:${b.reason}` : b.kind,
	);
	assert.deepStrictEqual(kinds, [
		'unsupported:frontmatter',
		'heading',
		'list',
		'code',
		'math',
		'table',
		'quote',
		'media',
		'hr',
		'paragraph',
	]);

	// Verify that moving the complete list into a column beside 'Paragraphe final.' moves all 3 list lines together
	const listBlock = blocks[2]!;
	const finalPara = blocks[9]!;
	const movedList = moveBlock(doc, listBlock.id, finalPara.id, 'left');
	assert.ok(movedList !== null);
	assert.ok(movedList.docText.includes('> > - Élément 1\n> >   - Sous-élément indenté\n> > - [ ] Tâche à faire'));
});

void test('Notion blocks: preserves existing 2-column notes, their content, and their proportions', () => {
	const doc = [
		'# Haut de page',
		'',
		'> [!multi-column|60-40]',
		'>',
		'> > [!col|60]',
		'> > ### Colonne gauche',
		'> > ',
		'> > Texte gauche avec **gras**.',
		'>',
		'> > [!col|40]',
		'> > Texte droite.',
	].join('\n');

	const blocks = parseDocumentBlocks(doc);
	assert.strictEqual(blocks.length, 2);
	const mc = blocks[1]!;
	assert.strictEqual(mc.kind, 'multi-column');
	if (mc.kind === 'multi-column') {
		assert.deepStrictEqual(mc.ratios, [60, 40]);
		assert.strictEqual(mc.columns.length, 2);
		assert.strictEqual(mc.col1Blocks.length, 2);
		assert.strictEqual(mc.col1Blocks[0]?.kind, 'heading');
		assert.strictEqual(mc.col1Blocks[1]?.kind, 'paragraph');
		assert.strictEqual(mc.col2Blocks.length, 1);
		assert.strictEqual(mc.col2Blocks[0]?.markdown, 'Texte droite.');
	}
});

void test('Notion blocks: reorders blocks vertically (before / after) in root flow', () => {
	const doc = '# Titre\n\nParagraphe A\n\nParagraphe B';
	const blocks = parseDocumentBlocks(doc);
	const res = moveBlock(doc, blocks[2]!.id, blocks[1]!.id, 'before');
	assert.ok(res !== null);
	assert.strictEqual(res.docText, '# Titre\n\nParagraphe B\n\nParagraphe A');
});

void test('Notion blocks: creates 2, 3, and 4 columns via lateral drop (including inserting between two columns) without nesting', () => {
	const doc0 = 'Bloc A\n\nBloc B\n\nBloc C\n\nBloc D';
	const b0 = parseDocumentBlocks(doc0);

	// 1. Create 2 columns: drop Bloc B to the right of Bloc A
	const step2Col = moveBlock(doc0, b0[1]!.id, b0[0]!.id, 'right');
	assert.ok(step2Col !== null);
	const b2 = parseDocumentBlocks(step2Col.docText);
	assert.strictEqual(b2[0]?.kind, 'multi-column');
	if (b2[0]?.kind === 'multi-column') {
		assert.strictEqual(b2[0].columns.length, 2);
		assert.deepStrictEqual(b2[0].ratios, [50, 50]);
	}

	// 2. Create 3 columns by dropping Bloc C to the right of Col 2 (Bloc B)
	const mc2 = b2[0];
	assert.strictEqual(mc2.kind, 'multi-column');
	const blocC = b2[1]!;
	const col2TargetId = mc2.columns[1]![0]!.id;
	const step3Col = moveBlock(step2Col.docText, blocC.id, col2TargetId, 'right');
	assert.ok(step3Col !== null);

	const b3 = parseDocumentBlocks(step3Col.docText);
	const mc3 = b3[0]!;
	assert.strictEqual(mc3.kind, 'multi-column');
	if (mc3.kind === 'multi-column') {
		assert.strictEqual(mc3.columns.length, 3);
		assert.deepStrictEqual(mc3.ratios, [34, 33, 33]);
		assert.strictEqual(
			mc3.ratios.reduce((a, b) => a + b, 0),
			100,
		);
		assert.deepStrictEqual(
			mc3.columns.map((c) => c[0]?.markdown),
			['Bloc A', 'Bloc B', 'Bloc C'],
		);
	}

	// 3. Create 4 columns by inserting Bloc D BETWEEN Col 1 (Bloc A) and Col 2 (Bloc B)
	const blocD = b3[1]!;
	const col2In3Id = mc3.columns[1]![0]!.id;
	const step4Col = moveBlock(step3Col.docText, blocD.id, col2In3Id, 'left');
	assert.ok(step4Col !== null);

	const b4 = parseDocumentBlocks(step4Col.docText);
	assert.strictEqual(b4.length, 1);
	const mc4 = b4[0]!;
	assert.strictEqual(mc4.kind, 'multi-column');
	if (mc4.kind === 'multi-column') {
		assert.strictEqual(mc4.columns.length, 4);
		assert.deepStrictEqual(mc4.ratios, [25, 25, 25, 25]);
		assert.deepStrictEqual(
			mc4.columns.map((c) => c[0]?.markdown),
			['Bloc A', 'Bloc D', 'Bloc B', 'Bloc C'],
		);
	}
});

void test('Notion blocks: moves blocks between first and last column (4 cols), removes empty columns redistributing width, and unwraps when 1 column remains', () => {
	const doc4 = [
		'> [!multi-column|20-20-30-30]',
		'>',
		'> > [!col|20]',
		'> > ### Col 1 Titre',
		'> > ',
		'> > Col 1 Paragraphe mobile',
		'>',
		'> > [!col|20]',
		'> > Col 2 Unique',
		'>',
		'> > [!col|30]',
		'> > Col 3 Unique',
		'>',
		'> > [!col|30]',
		'> > Col 4 Destination',
	].join('\n');

	const bInit = parseDocumentBlocks(doc4);
	const mcInit = bInit[0]!;
	assert.strictEqual(mcInit.kind, 'multi-column');
	if (mcInit.kind !== 'multi-column') return;

	// 1. Move 'Col 1 Paragraphe mobile' from Col 1 (index 0) to Col 4 (index 3)
	const col1MobileId = mcInit.columns[0]![1]!.id;
	const col4TargetId = mcInit.columns[3]![0]!.id;
	const moved1To4 = moveBlock(doc4, col1MobileId, col4TargetId, 'after');
	assert.ok(moved1To4 !== null);

	const bAfter1To4 = parseDocumentBlocks(moved1To4.docText);
	const mcAfter1To4 = bAfter1To4[0]!;
	assert.strictEqual(mcAfter1To4.kind, 'multi-column');
	if (mcAfter1To4.kind !== 'multi-column') return;
	assert.strictEqual(mcAfter1To4.columns.length, 4);
	assert.deepStrictEqual(mcAfter1To4.ratios, [20, 20, 30, 30]);
	assert.strictEqual(mcAfter1To4.columns[0]!.length, 1);
	assert.strictEqual(mcAfter1To4.columns[3]!.length, 2);

	// 2. Move 'Col 2 Unique' into Col 3 -> Col 2 becomes empty and is removed; widths of remaining 3 columns redistribute to sum 100%
	const col2UniqueId = mcAfter1To4.columns[1]![0]!.id;
	const col3TargetId = mcAfter1To4.columns[2]![0]!.id;
	const movedEmptyCol2 = moveBlock(moved1To4.docText, col2UniqueId, col3TargetId, 'after');
	assert.ok(movedEmptyCol2 !== null);

	const b3Cols = parseDocumentBlocks(movedEmptyCol2.docText);
	const mc3Cols = b3Cols[0]!;
	assert.strictEqual(mc3Cols.kind, 'multi-column');
	if (mc3Cols.kind !== 'multi-column') return;
	assert.strictEqual(mc3Cols.columns.length, 3);
	assert.strictEqual(
		mc3Cols.ratios.reduce((a, b) => a + b, 0),
		100,
	);
	assert.deepStrictEqual(mc3Cols.ratios, [25, 37, 38]);
});

void test('Notion blocks: rejects self-drop, unsupported blocks, and lateral drops when availableWidthPx is too narrow', () => {
	const doc = [
		'Paragraphe externe',
		'',
		'<div>Bloc HTML brut non supporté</div>',
		'',
		'> [!multi-column|34-33-33]',
		'>',
		'> > [!col|34]',
		'> > Col 1 Texte',
		'>',
		'> > [!col|33]',
		'> > Col 2 Texte',
		'>',
		'> > [!col|33]',
		'> > Col 3 Texte',
	].join('\n');

	const blocks = parseDocumentBlocks(doc);
	const p1 = blocks[0]!;
	const htmlBlock = blocks[1]!;
	const mc = blocks[2]!;
	assert.strictEqual(mc.kind, 'multi-column');

	assert.strictEqual(moveBlock(doc, p1.id, p1.id, 'before'), null);
	assert.strictEqual(moveBlock(doc, htmlBlock.id, p1.id, 'before'), null);
	assert.strictEqual(moveBlock(doc, p1.id, htmlBlock.id, 'after'), null);

	if (mc.kind === 'multi-column') {
		const col3Block = mc.columns[2]![0]!;
		// Refuses adding a 4th column when availableWidthPx is 420px (< 588px required for 4 usable columns)
		assert.strictEqual(
			moveBlock(doc, p1.id, col3Block.id, 'right', { availableWidthPx: 420 }),
			null,
		);
		// Allows adding a 4th column when availableWidthPx is 750px (>= 588px)
		const allowedRes = moveBlock(doc, p1.id, col3Block.id, 'right', {
			availableWidthPx: 750,
		});
		assert.ok(allowedRes !== null);
		const parsed4 = parseDocumentBlocks(allowedRes.docText);
		assert.strictEqual(
			parsed4[1]?.kind === 'multi-column' ? parsed4[1].columns.length : 0,
			4,
		);
	}
});

void test('Notion blocks: automatically unwraps the multi-column container when moving a block leaves only one non-empty column', () => {
	const doc = [
		'# En-tête',
		'',
		'> [!multi-column]',
		'>',
		'> > [!col|50]',
		'> > Unique bloc gauche',
		'>',
		'> > [!col|50]',
		'> > Unique bloc droite',
	].join('\n');

	const blocks = parseDocumentBlocks(doc);
	const headingId = blocks[0]!.id;
	const mc = blocks[1]!;
	assert.strictEqual(mc.kind, 'multi-column');
	if (mc.kind === 'multi-column') {
		const leftBlockId = mc.col1Blocks[0]!.id;
		const res = moveBlock(doc, leftBlockId, headingId, 'after');
		assert.ok(res !== null);

		assert.ok(!res.docText.includes('[!multi-column]'));
		assert.strictEqual(
			res.docText,
			'# En-tête\n\nUnique bloc gauche\n\nUnique bloc droite',
		);
	}
});

void test('Notion blocks: supports moveBlockRelative (including to-prev-col, to-next-col, split-col), insertBlockRelative, and convertBlockKind across N columns', () => {
	const spanText =
		'Texte avec **gras** et <span data-inkwell="1" style="color: #2f9e44">vert</span>.';
	const doc = `# Titre\n\n${spanText}\n\nAutre bloc`;
	const blocks = parseDocumentBlocks(doc);

	const conv = convertBlockKind(doc, blocks[1]!.id, 'h2');
	assert.ok(conv !== null);
	assert.ok(conv.docText.includes(`## ${spanText}`));

	const paired = moveBlockRelative(conv.docText, 'root-b1', 'pair-left');
	assert.ok(paired !== null);
	assert.ok(paired.docText.includes('> [!multi-column]'));
	assert.ok(paired.docText.includes(spanText));

	const parsedPaired = parseDocumentBlocks(paired.docText);
	const mc = parsedPaired[1]!;
	assert.strictEqual(mc.kind, 'multi-column');
	if (mc.kind === 'multi-column') {
		const inserted = insertBlockRelative(
			paired.docText,
			mc.col1Blocks[0]!.id,
			'after',
			'Nouveau paragraphe inséré',
		);
		assert.ok(inserted !== null);
		assert.ok(inserted.docText.includes('> > Nouveau paragraphe inséré'));

		// Split the newly inserted block into a 3rd column to the right of column 1
		const parsedWithInserted = parseDocumentBlocks(inserted.docText);
		const mcWithInserted = parsedWithInserted[1]!;
		if (mcWithInserted.kind === 'multi-column') {
			const secondBlockInCol1 = mcWithInserted.columns[0]![1]!.id;
			const splitTo3Cols = moveBlockRelative(
				inserted.docText,
				secondBlockInCol1,
				'split-col-right',
			);
			assert.ok(splitTo3Cols !== null);
			const parsed3 = parseDocumentBlocks(splitTo3Cols.docText);
			const mc3 = parsed3[1]!;
			assert.strictEqual(mc3.kind, 'multi-column');
			if (mc3.kind === 'multi-column') {
				assert.strictEqual(mc3.columns.length, 3);
				assert.deepStrictEqual(mc3.ratios, [34, 33, 33]);
			}
		}
	}
});

void test('Notion blocks: finds blocks by ID and checks isMovableBlock accurately', () => {
	const inner = parseColumnInnerBlocks('### Sous-titre\n\nParagraphe', 0, 2);
	assert.strictEqual(inner.length, 2);
	assert.strictEqual(inner[0]?.location.scope === 'column' ? inner[0].location.colIndex : -1, 2);
	assert.strictEqual(isMovableBlock(inner[0]!), true);

	const docBlocks = parseDocumentBlocks('# A\n\n- Liste');
	assert.strictEqual(findBlockById(docBlocks, 'root-b0')?.block.kind, 'heading');
	assert.strictEqual(findBlockById(docBlocks, 'root-b1')?.block.kind, 'list');
	assert.strictEqual(findBlockById(docBlocks, 'non-existent'), null);
});

void test('Notion blocks: parses and serializes single callout (Encadré) and collapsible toggle (Menu dépliant) with accurate offset maps', () => {
	const rawToggle = '> [!NOTE]+ Menu dépliant test\n> Ligne 1 avec **gras**\n> Ligne 2';
	const parsed = parseSingleCalloutMarkdown(rawToggle);
	assert.strictEqual(parsed.calloutType, 'NOTE');
	assert.strictEqual(parsed.foldMode, 'expanded');
	assert.strictEqual(parsed.title, 'Menu dépliant test');
	assert.strictEqual(parsed.bodyText, 'Ligne 1 avec **gras**\nLigne 2');

	// Verify offset mapping between body editor and parent document
	const localPos = parsed.bodyText.indexOf('**gras**');
	const parentPos = localOffsetToParentOffset(parsed.bodyMap, parsed.bodyText, localPos, 100);
	assert.strictEqual(rawToggle.slice(parentPos - 100, parentPos - 100 + 8), '**gras**');
	const backToLocal = parentOffsetToLocalOffset(parsed.bodyMap, parsed.bodyText, parentPos, 100);
	assert.strictEqual(backToLocal, localPos);

	// Toggle foldMode to collapsed and serialize
	parsed.foldMode = 'collapsed';
	const serialized = serializeSingleCalloutMarkdown(parsed);
	assert.strictEqual(
		serialized,
		'> [!NOTE]- Menu dépliant test\n> Ligne 1 avec **gras**\n> Ligne 2',
	);

	// Convert block between paragraph, task-list, quote, callout, and toggle
	const baseDoc = 'Élément important';
	const b0 = parseDocumentBlocks(baseDoc);
	const asTask = convertBlockKind(baseDoc, b0[0]!.id, 'task-list');
	assert.strictEqual(asTask?.docText, '- [ ] Élément important');
	const asQuote = convertBlockKind(asTask.docText, 'root-b0', 'quote');
	assert.strictEqual(asQuote?.docText, '> Élément important');
	const asCallout = convertBlockKind(asQuote.docText, 'root-b0', 'callout');
	assert.strictEqual(asCallout?.docText, '> [!NOTE]\n> Élément important');
});

void test('Notion blocks: hierarchical folding of H1, H2, H3 headings preserves real Markdown headings and stops at next heading of level <= L', () => {
	const doc = [
		'# Chapitre 1',
		'Paragraphe sous chapitre 1',
		'## Section 1.1',
		'Texte section 1.1',
		'### Sous-section 1.1.1',
		'Détail sous-section 1.1.1',
		'## Section 1.2',
		'Texte section 1.2',
		'# Chapitre 2',
		'Texte chapitre 2',
	].join('\n');

	const sections = computeDocumentHeadingSections(doc);
	assert.strictEqual(sections.length, 5);

	// 1. '# Chapitre 1' (line 1, L=1) folds lines 2..8 (stops before '# Chapitre 2' at line 9)
	assert.strictEqual(sections[0]?.lineNumber, 1);
	assert.strictEqual(sections[0]?.level, 1);
	assert.strictEqual(sections[0]?.sectionEndLine, 8);

	// 2. '## Section 1.1' (line 3, L=2) folds lines 4..6 (includes '### Sous-section 1.1.1', stops before '## Section 1.2' at line 7)
	assert.strictEqual(sections[1]?.lineNumber, 3);
	assert.strictEqual(sections[1]?.level, 2);
	assert.strictEqual(sections[1]?.sectionEndLine, 6);

	// 3. '### Sous-section 1.1.1' (line 5, L=3) folds line 6 (stops before '## Section 1.2' at line 7)
	assert.strictEqual(sections[2]?.lineNumber, 5);
	assert.strictEqual(sections[2]?.level, 3);
	assert.strictEqual(sections[2]?.sectionEndLine, 6);

	// 4. '## Section 1.2' (line 7, L=2) folds line 8 (stops before '# Chapitre 2' at line 9)
	assert.strictEqual(sections[3]?.lineNumber, 7);
	assert.strictEqual(sections[3]?.level, 2);
	assert.strictEqual(sections[3]?.sectionEndLine, 8);

	// 5. '# Chapitre 2' (line 9, L=1) folds up to end of doc (line 10)
	assert.strictEqual(sections[4]?.lineNumber, 9);
	assert.strictEqual(sections[4]?.level, 1);
	assert.strictEqual(sections[4]?.sectionEndLine, 10);

	// Verify folded line set when Section 1.1 (line 3) is collapsed: lines 4, 5, 6 are hidden, line 7 ('## Section 1.2') remains visible
	const foldedWhenH2Collapsed = computeFoldedLineNumbers(sections, new Set([3]));
	assert.deepStrictEqual([...foldedWhenH2Collapsed].sort((a, b) => a - b), [4, 5, 6]);
	assert.strictEqual(foldedWhenH2Collapsed.has(7), false);

	// Verify folded line set when Chapitre 1 (line 1) is collapsed: lines 2..8 are hidden, line 9 ('# Chapitre 2') remains visible
	const foldedWhenH1Collapsed = computeFoldedLineNumbers(sections, new Set([1]));
	assert.deepStrictEqual(
		[...foldedWhenH1Collapsed].sort((a, b) => a - b),
		[2, 3, 4, 5, 6, 7, 8],
	);
	assert.strictEqual(foldedWhenH1Collapsed.has(9), false);
});

void test('Notion blocks: parses and serializes editable Markdown tables and standalone media embeds accurately', () => {
	const rawTable = [
		'| Produit | Prix | Statut |',
		'| :--- | ---: | :---: |',
		'| Stylo | 12 € | En stock |',
		'| Carnet \\| A5 | 18 € | Épuisé |',
	].join('\n');

	const parsed = parseMarkdownTable(rawTable);
	assert.deepStrictEqual(parsed.headers, ['Produit', 'Prix', 'Statut']);
	assert.deepStrictEqual(parsed.alignments, ['left', 'right', 'center']);
	assert.strictEqual(parsed.rows.length, 2);
	assert.deepStrictEqual(parsed.rows[0], ['Stylo', '12 €', 'En stock']);
	assert.deepStrictEqual(parsed.rows[1], ['Carnet | A5', '18 €', 'Épuisé']);

	// Modify a cell and re-serialize (verify pipe escaping)
	if (parsed.rows[0]) {
		parsed.rows[0][1] = '15 €';
	}
	const serialized = serializeMarkdownTable(parsed);
	assert.ok(serialized.includes('| Stylo | 15 € | En stock |'));
	assert.ok(serialized.includes('| Carnet \\| A5 | 18 € | Épuisé |'));

	// Media embeds detection (image, video, audio, file)
	const imgEmbed = parseStandaloneMediaEmbedLine('![[schéma-architecture.svg|320]]');
	assert.strictEqual(imgEmbed?.kind, 'image');
	assert.strictEqual(imgEmbed?.target, 'schéma-architecture.svg');
	assert.strictEqual(imgEmbed?.aliasOrSize, '320');

	const videoEmbed = parseStandaloneMediaEmbedLine('![[presentation.mp4]]');
	assert.strictEqual(videoEmbed?.kind, 'video');

	const audioEmbed = parseStandaloneMediaEmbedLine('![[note-vocale.wav]]');
	assert.strictEqual(audioEmbed?.kind, 'audio');

	const fileEmbed = parseStandaloneMediaEmbedLine('![[cahier-des-charges.pdf]]');
	assert.strictEqual(fileEmbed?.kind, 'file');
});

