import test from 'node:test';
import assert from 'node:assert/strict';
import {
	convertBookmarkToSimpleLink,
	escapeMarkdownTitle,
	escapeMarkdownUrl,
	extractDomain,
	parseBookmark,
	serializeBookmark,
	unescapeMarkdownTitle,
	unescapeMarkdownUrl,
} from '../src/bookmark/bookmark-model';

void test('bookmark model: title escaping and unescaping', () => {
	const original = 'Guide [TypeScript] (v5.0) & [React]';
	const escaped = escapeMarkdownTitle(original);
	assert.strictEqual(escaped, 'Guide \\[TypeScript\\] (v5.0) & \\[React\\]');

	const unescaped = unescapeMarkdownTitle(escaped);
	assert.strictEqual(unescaped, original);
});

void test('bookmark model: url escaping and unescaping with parentheses', () => {
	const original = 'https://fr.wikipedia.org/wiki/Chat_(animal)';
	const escaped = escapeMarkdownUrl(original);
	assert.strictEqual(escaped, 'https://fr.wikipedia.org/wiki/Chat_%28animal%29');

	const unescaped = unescapeMarkdownUrl(escaped);
	assert.strictEqual(unescaped, original);
});

void test('bookmark model: domain extraction', () => {
	assert.strictEqual(extractDomain('https://www.github.com/obsidianmd/obsidian-api'), 'github.com');
	assert.strictEqual(extractDomain('https://en.wikipedia.org/wiki/Main_Page'), 'en.wikipedia.org');
	assert.strictEqual(extractDomain('http://localhost:3000/app'), 'localhost');
	assert.strictEqual(extractDomain('invalide-url'), 'invalide-url');
});

void test('bookmark model: serialize and parse roundtrip', () => {
	const initial = {
		url: 'https://obsidian.md/download',
		title: 'Télécharger Obsidian',
		description: 'L’application de prise de notes en local.',
	};

	const markdown = serializeBookmark(initial);
	assert.strictEqual(
		markdown,
		'> [!bookmark] [Télécharger Obsidian](https://obsidian.md/download)\n> L’application de prise de notes en local.',
	);

	const parsed = parseBookmark(markdown);
	assert.deepStrictEqual(parsed, initial);
});

void test('bookmark model: complex title with square brackets and parentheses in URL', () => {
	const initial = {
		url: 'https://fr.wikipedia.org/wiki/Paris_(homonymie)',
		title: '[Page] Paris [France]',
		description: 'Description sur plusieurs lignes :\nLigne 1\nLigne 2',
	};

	const markdown = serializeBookmark(initial);
	assert.strictEqual(
		markdown,
		'> [!bookmark] [\\[Page\\] Paris \\[France\\]](https://fr.wikipedia.org/wiki/Paris_%28homonymie%29)\n> Description sur plusieurs lignes :\n> Ligne 1\n> Ligne 2',
	);

	const parsed = parseBookmark(markdown);
	assert.deepStrictEqual(parsed, initial);
});

void test('bookmark model: empty description', () => {
	const initial = {
		url: 'https://exemple.fr',
		title: 'Exemple',
		description: '',
	};

	const markdown = serializeBookmark(initial);
	assert.strictEqual(markdown, '> [!bookmark] [Exemple](https://exemple.fr)');

	const parsed = parseBookmark(markdown);
	assert.deepStrictEqual(parsed, initial);
});

void test('bookmark model: convert to simple link', () => {
	const data = {
		url: 'https://fr.wikipedia.org/wiki/Chat_(animal)',
		title: 'Le Chat [Félidé]',
		description: 'Une description quelconque',
	};

	const simpleLink = convertBookmarkToSimpleLink(data);
	assert.strictEqual(
		simpleLink,
		'[Le Chat \\[Félidé\\]](https://fr.wikipedia.org/wiki/Chat_%28animal%29)',
	);
});
