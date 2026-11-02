import test from 'node:test';
import assert from 'node:assert/strict';
import {
	escapeButtonLabel,
	isValidHexColor,
	isValidWebUrl,
	parseButton,
	serializeButton,
	unescapeButtonLabel,
} from '../src/button/button-model';

void test('button model: label escaping and unescaping', () => {
	const raw = 'Ouvrir [Documentation] (v2) & [Aide]';
	const escaped = escapeButtonLabel(raw);
	assert.strictEqual(escaped, 'Ouvrir \\[Documentation\\] (v2) & \\[Aide\\]');
	const unescaped = unescapeButtonLabel(escaped);
	assert.strictEqual(unescaped, raw);
});

void test('button model: URL validation strictly allows HTTP/HTTPS only', () => {
	assert.strictEqual(isValidWebUrl('https://obsidian.md'), true);
	assert.strictEqual(isValidWebUrl('http://localhost:3000/app'), true);
	assert.strictEqual(isValidWebUrl('javascript:alert(1)'), false);
	assert.strictEqual(isValidWebUrl('data:text/html,test'), false);
	assert.strictEqual(isValidWebUrl('file:///etc/passwd'), false);
	assert.strictEqual(isValidWebUrl('obsidian://open'), false);
	assert.strictEqual(isValidWebUrl(''), false);
});

void test('button model: hex color validation', () => {
	assert.strictEqual(isValidHexColor('#fff'), true);
	assert.strictEqual(isValidHexColor('#7864ff'), true);
	assert.strictEqual(isValidHexColor('#123456'), true);
	assert.strictEqual(isValidHexColor('#gggggg'), false);
	assert.strictEqual(isValidHexColor('blue'), false);
	assert.strictEqual(isValidHexColor(''), false);
});

void test('button model: serialize and parse note button', () => {
	const data = {
		label: 'Voir la synthèse du projet',
		actionType: 'note' as const,
		target: 'Dossier Projets/Note de cadrage.md',
		variant: 'filled' as const,
		color: '#4a90e2',
	};

	const md = serializeButton(data);
	assert.strictEqual(
		md,
		'> [!button|filled|#4a90e2] Voir la synthèse du projet\n> [[Dossier Projets/Note de cadrage.md]]',
	);

	const parsed = parseButton(md);
	assert.strictEqual(parsed.isValid, true);
	assert.deepStrictEqual(parsed.data, data);
});

void test('button model: serialize and parse URL button', () => {
	const data = {
		label: 'Documentation officielle',
		actionType: 'url' as const,
		target: 'https://obsidian.md/plugins',
		variant: 'outline' as const,
	};

	const md = serializeButton(data);
	assert.strictEqual(
		md,
		'> [!button|outline] Documentation officielle\n> https://obsidian.md/plugins',
	);

	const parsed = parseButton(md);
	assert.strictEqual(parsed.isValid, true);
	assert.deepStrictEqual(parsed.data, {
		...data,
		color: undefined,
	});
});

void test('button model: serialize and parse Command button', () => {
	const data = {
		label: 'Basculer la barre latérale',
		actionType: 'command' as const,
		target: 'app:toggle-left-sidebar',
		variant: 'filled' as const,
		color: '#2e7d32',
	};

	const md = serializeButton(data);
	assert.strictEqual(
		md,
		'> [!button|filled|#2e7d32] Basculer la barre latérale\n> commande: app:toggle-left-sidebar',
	);

	const parsed = parseButton(md);
	assert.strictEqual(parsed.isValid, true);
	assert.deepStrictEqual(parsed.data, data);
});

void test('button model: invalid or ambiguous targets marked invalid without guessing', () => {
	// Missing target
	const parsed1 = parseButton('> [!button] Mon action');
	assert.strictEqual(parsed1.isValid, false);
	assert.ok(parsed1.validationError?.includes('manquante'));

	// Invalid protocol
	const parsed2 = parseButton('> [!button] Dangereux\n> javascript:alert(1)');
	assert.strictEqual(parsed2.isValid, false);
	assert.ok(parsed2.validationError?.includes('non valide'));

	// Malformed header
	const parsed3 = parseButton('> [!unknown] Bouton\n> [[Note.md]]');
	assert.strictEqual(parsed3.isValid, false);
});
