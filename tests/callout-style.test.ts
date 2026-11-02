import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	CalloutCustomStyle,
	parseCalloutMetadata,
	serializeCalloutMetadata,
	parseSingleCalloutMarkdown,
	serializeSingleCalloutMarkdown,
} from '../src/blocks/callout-parser';

describe('callout visual style metadata parser & serializer', () => {
	it('parses empty or missing metadata as undefined', () => {
		assert.equal(parseCalloutMetadata(''), undefined);
		assert.equal(parseCalloutMetadata(undefined), undefined);
		assert.equal(parseCalloutMetadata('   '), undefined);
	});

	it('parses background color correctly', () => {
		const res = parseCalloutMetadata('bg:#1e293b');
		assert.deepEqual(res, { bg: '#1e293b' });
	});

	it('parses border:off in various notations (off, none, 0, no, non)', () => {
		assert.deepEqual(parseCalloutMetadata('border:off'), { border: false });
		assert.deepEqual(parseCalloutMetadata('border:none'), { border: false });
		assert.deepEqual(parseCalloutMetadata('border:0'), { border: false });
		assert.deepEqual(parseCalloutMetadata('border:no'), { border: false });
		assert.deepEqual(parseCalloutMetadata('border:non'), { border: false });
	});

	it('parses border:on correctly', () => {
		assert.deepEqual(parseCalloutMetadata('border:on'), { border: true });
		assert.deepEqual(parseCalloutMetadata('border:solid'), { border: true });
	});

	it('parses border-color correctly', () => {
		const res = parseCalloutMetadata('border-color:#3b82f6');
		assert.deepEqual(res, { borderColor: '#3b82f6' });
	});

	it('parses composite style with multiple attributes', () => {
		const res = parseCalloutMetadata('bg:#2b2d42,border:off,border-color:#e63946');
		assert.deepEqual(res, {
			bg: '#2b2d42',
			border: false,
			borderColor: '#e63946',
		});
	});

	it('supports semicolon delimiters as well', () => {
		const res = parseCalloutMetadata('bg:#2b2d42;border:0;border-color:#e63946');
		assert.deepEqual(res, {
			bg: '#2b2d42',
			border: false,
			borderColor: '#e63946',
		});
	});

	it('serializes style cleanly', () => {
		const style: CalloutCustomStyle = {
			bg: '#1e293b',
			border: false,
			borderColor: '#60a5fa',
		};
		assert.equal(
			serializeCalloutMetadata(style),
			'bg:#1e293b,border:off,border-color:#60a5fa',
		);
	});

	it('serializes empty style as empty string', () => {
		assert.equal(serializeCalloutMetadata(undefined), '');
		assert.equal(serializeCalloutMetadata({}), '');
	});

	it('parses single callout markdown with style metadata', () => {
		const raw = '> [!NOTE|bg:#1e293b,border:off] Titre personnalisé\n> Ligne 1\n> Ligne 2';
		const data = parseSingleCalloutMarkdown(raw);
		assert.equal(data.calloutType, 'NOTE');
		assert.equal(data.title, 'Titre personnalisé');
		assert.deepEqual(data.style, {
			bg: '#1e293b',
			border: false,
		});
		assert.equal(data.bodyText, 'Ligne 1\nLigne 2');
	});

	it('parses collapsible callout with style metadata and fold symbol', () => {
		const raw = '> [!NOTE|bg:#064e3b]+ Menu dépliant vert\n> Contenu déplié';
		const data = parseSingleCalloutMarkdown(raw);
		assert.equal(data.calloutType, 'NOTE');
		assert.equal(data.foldMode, 'expanded');
		assert.equal(data.title, 'Menu dépliant vert');
		assert.deepEqual(data.style, {
			bg: '#064e3b',
		});
		assert.equal(data.bodyText, 'Contenu déplié');
	});

	it('round-trips serialize and parse without loss', () => {
		const initial = '> [!NOTE|bg:#451a03,border:off,border-color:#f59e0b] Titre ambre\n> Paragraphe 1\n> Paragraphe 2';
		const data = parseSingleCalloutMarkdown(initial);
		const serialized = serializeSingleCalloutMarkdown(data);
		assert.equal(serialized, initial);
	});

	it('serializes default callout without style metadata pipe', () => {
		const initial = '> [!NOTE] Titre normal\n> Paragraphe';
		const data = parseSingleCalloutMarkdown(initial);
		assert.equal(data.style, undefined);
		const serialized = serializeSingleCalloutMarkdown(data);
		assert.equal(serialized, initial);
	});
});

