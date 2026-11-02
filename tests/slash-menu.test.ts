import test from 'node:test';
import assert from 'node:assert/strict';
import {
	filterSlashItems,
	getSlashTriggerInfo,
	isInsideCodeBlock,
	isInsideHtmlTag,
	isInsideInlineCode,
	isInsideLink,
	isProtectedContext,
	normalizeText,
} from '../src/slash-menu/matcher';
import {
	getStaticInsertTemplate,
	SLASH_ITEM_DEFINITIONS,
} from '../src/slash-menu/item-definitions';
import {
	buildTableOfContentsMarkdown,
	extractHeadingsFromDoc,
} from '../src/slash-menu/toc-helper';

void test('slash menu matcher: text normalization', () => {
	assert.strictEqual(normalizeText('TITRE'), 'titre');
	assert.strictEqual(normalizeText('Élément Numéroté'), 'element numerote');
	assert.strictEqual(normalizeText('  À puces  '), 'a puces');
	assert.strictEqual(normalizeText('Ça alors!'), 'ca alors!');
});

void test('slash menu matcher: filtering items', () => {
	const items = SLASH_ITEM_DEFINITIONS;

	// Empty query returns all items
	assert.strictEqual(filterSlashItems(items, '').length, items.length);
	assert.strictEqual(filterSlashItems(items, '   ').length, items.length);

	// By exact label
	const h1Results = filterSlashItems(items, 'titre 1');
	assert.ok(h1Results.some((i) => i.id === 'h1'));

	// Accent insensitive
	const bulletResults = filterSlashItems(items, 'liste a puces');
	assert.ok(bulletResults.some((i) => i.id === 'bullet-list'));

	// New items filtering
	const mathResults = filterSlashItems(items, 'equation');
	assert.ok(mathResults.some((i) => i.id === 'math-block'));

	const mermaidResults = filterSlashItems(items, 'mermaid');
	assert.ok(mermaidResults.some((i) => i.id === 'mermaid-block'));

	const tocResults = filterSlashItems(items, 'sommaire');
	assert.ok(tocResults.some((i) => i.id === 'toc'));

	const pageResults = filterSlashItems(items, 'page');
	assert.ok(pageResults.some((i) => i.id === 'page'));

	const toggleResults = filterSlashItems(items, 'depliant');
	assert.ok(toggleResults.some((i) => i.id === 'collapsible-callout'));

	const colsResults = filterSlashItems(items, '3 colonnes');
	assert.ok(colsResults.some((i) => i.id === 'cols-3'));

	// Unknown query
	const unknownResults = filterSlashItems(items, 'inexistant-xyz');
	assert.strictEqual(unknownResults.length, 0);
});

void test('slash menu matcher: trigger detection on clean lines', () => {
	// 1. Clean line with slash
	const doc1 = '/';
	const trigger1 = getSlashTriggerInfo(doc1, 0, '/', 1);
	assert.deepStrictEqual(trigger1, {
		from: 0,
		to: 1,
		query: '',
		indent: '',
	});

	// 2. Indented line with slash and query
	const doc2 = '  /titre';
	const trigger2 = getSlashTriggerInfo(doc2, 0, '  /titre', 8);
	assert.deepStrictEqual(trigger2, {
		from: 2,
		to: 8,
		query: 'titre',
		indent: '  ',
	});

	// 3. Tab-indented line
	const doc3 = '\t/liste';
	const trigger3 = getSlashTriggerInfo(doc3, 0, '\t/liste', 7);
	assert.deepStrictEqual(trigger3, {
		from: 1,
		to: 7,
		query: 'liste',
		indent: '\t',
	});
});

void test('slash menu matcher: refusing non-line-start and ordinary slash uses', () => {
	// Text before slash
	const doc1 = 'Bonjour /';
	assert.strictEqual(getSlashTriggerInfo(doc1, 0, doc1, doc1.length), null);

	// URL
	const doc2 = 'Voir https://obsidian.md/plugins';
	assert.strictEqual(getSlashTriggerInfo(doc2, 0, doc2, doc2.length), null);

	// File path
	const doc3 = 'Chemin: /usr/local/bin';
	assert.strictEqual(getSlashTriggerInfo(doc3, 0, doc3, doc3.length), null);

	// Math fraction
	const doc4 = 'Calcul 10/2';
	assert.strictEqual(getSlashTriggerInfo(doc4, 0, doc4, doc4.length), null);

	// Space after slash
	const doc5 = '/ ';
	assert.strictEqual(getSlashTriggerInfo(doc5, 0, doc5, doc5.length), null);

	const doc6 = '/titre test ';
	assert.strictEqual(getSlashTriggerInfo(doc6, 0, doc6, doc6.length), null);
});

void test('slash menu matcher: protected contexts', () => {
	// Inside fenced code block
	const codeDoc = '```ts\n/\n```';
	const slashPos = codeDoc.indexOf('/');
	assert.strictEqual(isInsideCodeBlock(codeDoc, slashPos), true);
	assert.strictEqual(getSlashTriggerInfo(codeDoc, 6, '/', slashPos + 1), null);

	// Inside inline code
	assert.strictEqual(isInsideInlineCode('`code /'), true);
	assert.strictEqual(isInsideInlineCode('`code` /'), false);
	assert.strictEqual(isProtectedContext('', '`test /', 7), true);

	// Inside wiki link or markdown link
	assert.strictEqual(isInsideLink('[[ma-note/'), true);
	assert.strictEqual(isInsideLink('[[ma-note]] /'), false);
	assert.strictEqual(isInsideLink('[lien/'), true);
	assert.strictEqual(isProtectedContext('', '[[page/', 7), true);

	// Inside HTML tag
	assert.strictEqual(isInsideHtmlTag('<span /'), true);
	assert.strictEqual(isInsideHtmlTag('<span>texte</span> /'), false);
	assert.strictEqual(isProtectedContext('', '<div /', 6), true);
});

void test('slash menu items: registry count and sections', () => {
	const items = SLASH_ITEM_DEFINITIONS;
	assert.strictEqual(items.length, 34);

	const basicItems = items.filter((i) => i.section === 'basic');
	const advancedItems = items.filter((i) => i.section === 'advanced');
	const mediaItems = items.filter((i) => i.section === 'media');

	assert.strictEqual(basicItems.length, 20);
	assert.strictEqual(advancedItems.length, 9);
	assert.strictEqual(mediaItems.length, 5);

	// Verify required basic items exist
	const basicIds = basicItems.map((i) => i.id);
	assert.ok(basicIds.includes('text'));
	assert.ok(basicIds.includes('h1'));
	assert.ok(basicIds.includes('h2'));
	assert.ok(basicIds.includes('h3'));
	assert.ok(basicIds.includes('h4'));
	assert.ok(basicIds.includes('h5'));
	assert.ok(basicIds.includes('h6'));
	assert.ok(basicIds.includes('toggle-h1'));
	assert.ok(basicIds.includes('toggle-h2'));
	assert.ok(basicIds.includes('toggle-h3'));
	assert.ok(basicIds.includes('bullet-list'));
	assert.ok(basicIds.includes('numbered-list'));
	assert.ok(basicIds.includes('task-list'));
	assert.ok(basicIds.includes('collapsible-callout'));
	assert.ok(basicIds.includes('page'));
	assert.ok(basicIds.includes('callout'));
	assert.ok(basicIds.includes('quote'));
	assert.ok(basicIds.includes('table'));
	assert.ok(basicIds.includes('divider'));
	assert.ok(basicIds.includes('link-note'));

	// Verify required advanced items exist
	const advancedIds = advancedItems.map((i) => i.id);
	assert.ok(advancedIds.includes('cols-2'));
	assert.ok(advancedIds.includes('cols-3'));
	assert.ok(advancedIds.includes('cols-4'));
	assert.ok(advancedIds.includes('cols-5'));
	assert.ok(advancedIds.includes('math-block'));
	assert.ok(advancedIds.includes('mermaid-block'));
	assert.ok(advancedIds.includes('toc'));
	assert.ok(advancedIds.includes('toc-static'));

	// Verify required media items exist
	const mediaIds = mediaItems.map((i) => i.id);
	assert.ok(mediaIds.includes('media-image'));
	assert.ok(mediaIds.includes('media-video'));
	assert.ok(mediaIds.includes('media-audio'));
	assert.ok(mediaIds.includes('code-block'));
	assert.ok(mediaIds.includes('media-file'));
});

void test('slash menu items: static templates and cursor positions', () => {
	// Headings
	assert.deepStrictEqual(getStaticInsertTemplate('h1'), { text: '# ', cursorOffset: 2 });
	assert.deepStrictEqual(getStaticInsertTemplate('h2'), { text: '## ', cursorOffset: 3 });
	assert.deepStrictEqual(getStaticInsertTemplate('h3'), { text: '### ', cursorOffset: 4 });
	assert.deepStrictEqual(getStaticInsertTemplate('h4'), { text: '#### ', cursorOffset: 5 });
	assert.deepStrictEqual(getStaticInsertTemplate('h5'), { text: '##### ', cursorOffset: 6 });
	assert.deepStrictEqual(getStaticInsertTemplate('h6'), { text: '###### ', cursorOffset: 7 });

	// Lists
	assert.deepStrictEqual(getStaticInsertTemplate('bullet-list'), { text: '- ', cursorOffset: 2 });
	assert.deepStrictEqual(getStaticInsertTemplate('numbered-list'), { text: '1. ', cursorOffset: 3 });
	assert.deepStrictEqual(getStaticInsertTemplate('task-list'), { text: '- [ ] ', cursorOffset: 6 });

	// Collapsible callout, Callout, Quote, Divider, Code Block
	const toggleTpl = getStaticInsertTemplate('collapsible-callout');
	assert.ok(toggleTpl !== null);
	assert.ok(toggleTpl.text.includes('> [!NOTE]+'));

	assert.deepStrictEqual(getStaticInsertTemplate('callout'), { text: '> [!NOTE]\n> ', cursorOffset: 12 });
	assert.deepStrictEqual(getStaticInsertTemplate('quote'), { text: '> ', cursorOffset: 2 });
	assert.deepStrictEqual(getStaticInsertTemplate('divider'), { text: '---\n', cursorOffset: 4 });
	assert.deepStrictEqual(getStaticInsertTemplate('code-block'), { text: '```\n\n```', cursorOffset: 4 });

	// Advanced blocks: math and mermaid
	const mathTpl = getStaticInsertTemplate('math-block');
	assert.deepStrictEqual(mathTpl, { text: '$$\n\n$$\n', cursorOffset: 3 });

	const mermaidTpl = getStaticInsertTemplate('mermaid-block');
	assert.ok(mermaidTpl !== null);
	assert.ok(mermaidTpl.text.includes('```mermaid\ngraph TD'));

	// Table
	const tableTpl = getStaticInsertTemplate('table');
	assert.ok(tableTpl !== null);
	assert.ok(tableTpl.text.includes('| Colonne 1 | Colonne 2 |'));
	assert.ok(tableTpl.cursorOffset > 0);

	// Plain text
	assert.deepStrictEqual(getStaticInsertTemplate('text'), { text: '', cursorOffset: 0 });
});

void test('slash menu toc helper: table of contents generation', () => {
	// In-memory document heading extraction
	const docWithHeadings = '# Intro\nTexte\n```\n# Not a heading\n```\n## Section 1\n### Sous-section\n# Fin';
	const extracted = extractHeadingsFromDoc(docWithHeadings);
	assert.strictEqual(extracted.length, 4);
	assert.strictEqual(extracted[0]?.heading, 'Intro');
	assert.strictEqual(extracted[1]?.heading, 'Section 1');
	assert.strictEqual(extracted[2]?.heading, 'Sous-section');
	assert.strictEqual(extracted[3]?.heading, 'Fin');

	// Empty headings
	const emptyToc = buildTableOfContentsMarkdown([]);
	assert.ok(emptyToc.includes('aucun titre détecté'));

	// Flat headings
	const flatHeadings = [
		{ heading: 'Introduction', level: 1 },
		{ heading: 'Conclusion', level: 1 },
	];
	const flatToc = buildTableOfContentsMarkdown(flatHeadings);
	assert.ok(flatToc.includes('- [[#Introduction]]'));
	assert.ok(flatToc.includes('- [[#Conclusion]]'));

	// Nested headings
	const nestedHeadings = [
		{ heading: 'Chapitre 1', level: 1 },
		{ heading: 'Section 1.1', level: 2 },
		{ heading: 'Sous-section 1.1.1', level: 3 },
		{ heading: 'Chapitre 2', level: 1 },
	];
	const nestedToc = buildTableOfContentsMarkdown(nestedHeadings);
	assert.ok(nestedToc.includes('- [[#Chapitre 1]]'));
	assert.ok(nestedToc.includes('  - [[#Section 1.1]]'));
	assert.ok(nestedToc.includes('    - [[#Sous-section 1.1.1]]'));
	assert.ok(nestedToc.includes('- [[#Chapitre 2]]'));
});
