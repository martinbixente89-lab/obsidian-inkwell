/**
 * Utilitaires d'encodage et de décodage des entités HTML pour Inkwell.
 * Supporte :
 * - Entités nommées XML/HTML de base : &amp;, &lt;, &gt;, &quot;, &apos;
 * - Entités numériques décimales : &#...;
 * - Entités numériques hexadécimales : &#x...;
 *
 * Refuse explicitement tout cas non géré (ex: &copy;, entités mal formées)
 * pour éviter toute altération silencieuse du texte source.
 */

export interface DecodeResult {
	success: boolean;
	text: string;
	error?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
};

/**
 * Décode les entités HTML d'un texte intérieur de span.
 * Retourne success: false si une entité inconnue ou mal formée est détectée.
 */
export function decodeHtmlEntities(raw: string): DecodeResult {
	let error: string | undefined;

	// Vérifier la présence d'entités avec un regex général
	const entityRegex = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z0-9]+);/g;

	// Vérifier s'il y a des ampersands orphelins ou invalides qui ressemblent à des entités cassées
	const unclosedEntityRegex = /&[a-zA-Z0-9#]+(?=[^a-zA-Z0-9#;]|$)/;
	if (unclosedEntityRegex.test(raw)) {
		return {
			success: false,
			text: raw,
			error: 'Entité HTML non fermée ou mal formée détectée dans le passage.',
		};
	}

	const decoded = raw.replace(entityRegex, (match, body: string) => {
		if (error) return match;

		// 1. Entités nommées
		if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, match)) {
			return NAMED_ENTITIES[match] as string;
		}

		// 2. Entités hexadécimales : &#x...;
		if (body.startsWith('#x') || body.startsWith('#X')) {
			const hexStr = body.slice(2);
			const codePoint = parseInt(hexStr, 16);
			if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
				error = `Entité hexadécimale invalide : ${match}`;
				return match;
			}
			try {
				return String.fromCodePoint(codePoint);
			} catch {
				error = `Code point hexadécimal invalide : ${match}`;
				return match;
			}
		}

		// 3. Entités décimales : &#...;
		if (body.startsWith('#')) {
			const decStr = body.slice(1);
			const codePoint = parseInt(decStr, 10);
			if (isNaN(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
				error = `Entité décimale invalide : ${match}`;
				return match;
			}
			try {
				return String.fromCodePoint(codePoint);
			} catch {
				error = `Code point décimal invalide : ${match}`;
				return match;
			}
		}

		// 4. Entité nommée non gérée dans ce prototype
		error = `Entité nommée non prise en charge : ${match}`;
		return match;
	});

	if (error) {
		return { success: false, text: raw, error };
	}

	return { success: true, text: decoded };
}

/**
 * Encode uniquement les caractères sensibles HTML (&, <, >) pour empêcher
 * l'injection de balises tout en garantissant un texte littéral pur.
 * & est encodé en premier pour éviter tout double encodage.
 */
export function encodeHtmlEntities(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
