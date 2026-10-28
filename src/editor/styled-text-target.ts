import { decodeHtmlEntities } from '../utils/html-entities';
import { parseTagAttributes } from '../format/color-spans';

export interface StyledSpanTarget {
	spanStart: number;
	spanEnd: number;
	innerStart: number;
	innerEnd: number;
	openTag: string;
	closeTag: string;
	color: string;
	rawInnerText: string;
	visibleText: string;
}

export interface TargetAnalysisResult {
	success: boolean;
	target?: StyledSpanTarget;
	reason?: string;
}

/**
 * Analyse une ligne pour déterminer si la sélection ou le curseur cible
 * un unique passage coloré Inkwell valide pour le prototype.
 */
export function analyzeStyledSpanTarget(
	lineText: string,
	rawFrom: number,
	rawTo: number,
): TargetAnalysisResult {
	const selFrom = Math.min(rawFrom, rawTo);
	const selTo = Math.max(rawFrom, rawTo);

	const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
	let match: RegExpExecArray | null;

	const matchingSpans: Array<{
		spanStart: number;
		spanEnd: number;
		openTag: string;
		closeTag: string;
		innerStart: number;
		innerEnd: number;
		rawInnerText: string;
		attrsStr: string;
	}> = [];

	while ((match = spanRegex.exec(lineText)) !== null) {
		const spanStart = match.index;
		const fullMatch = match[0];
		const spanEnd = spanStart + fullMatch.length;
		const attrsStr = match[1] ?? '';
		const openTag = `<span${attrsStr}>`;
		const closeTag = '</span>';
		const innerStart = spanStart + openTag.length;
		const innerEnd = spanEnd - closeTag.length;
		const rawInnerText = match[2] ?? '';

		matchingSpans.push({
			spanStart,
			spanEnd,
			openTag,
			closeTag,
			innerStart,
			innerEnd,
			rawInnerText,
			attrsStr,
		});
	}

	// 1. Déterminer quels spans intersectent la sélection ou le curseur
	const overlappingSpans = matchingSpans.filter((s) => {
		if (selFrom === selTo) {
			// Curseur simple : doit être à l'intérieur du span (balises ou contenu)
			return selFrom >= s.spanStart && selFrom <= s.spanEnd;
		}
		// Sélection étendue : doit avoir un chevauchement non vide
		return selTo > s.spanStart && selFrom < s.spanEnd;
	});

	if (overlappingSpans.length === 0) {
		return {
			success: false,
			reason: 'Aucun passage coloré Inkwell sous le curseur ou dans la sélection.',
		};
	}

	if (overlappingSpans.length > 1) {
		return {
			success: false,
			reason: 'La sélection chevauche plusieurs passages stylés. Veuillez en cibler un seul.',
		};
	}

	const candidate = overlappingSpans[0];
	if (!candidate) {
		return { success: false, reason: 'Passage introuvable.' };
	}

	// 2. Si sélection étendue, vérifier qu'elle ne déborde pas en dehors du span
	if (selFrom !== selTo) {
		if (selFrom < candidate.spanStart || selTo > candidate.spanEnd) {
			return {
				success: false,
				reason: 'La sélection déborde en dehors du passage coloré. Veuillez cibler uniquement le passage stylé.',
			};
		}
	}

	// 3. Vérifier les formats imbriqués (pas de tags HTML internes dans ce prototype)
	if (/<[a-zA-Z0-9/]\b[^>]*>/i.test(candidate.rawInnerText)) {
		return {
			success: false,
			reason: 'Le passage contient des balises imbriquées non prises en charge dans ce prototype.',
		};
	}

	// 4. Analyser les attributs du span
	const parsedAttrs = parseTagAttributes(candidate.attrsStr);

	if (!parsedAttrs.isInkwell) {
		return {
			success: false,
			reason: 'Le span détecté n’est pas géré par Inkwell (absence de data-inkwell).',
		};
	}

	// Refus des attributs tiers dès le ciblage (Condition 5)
	if (Object.keys(parsedAttrs.otherAttrs).length > 0) {
		return {
			success: false,
			reason: 'Ce prototype est limité aux passages colorés simples sans attributs tiers.',
		};
	}

	// Refus des autres styles que la couleur (highlight, font-size, font-family, otherStyles)
	if (
		parsedAttrs.highlight !== null ||
		parsedAttrs.fontSize !== null ||
		parsedAttrs.fontFamily !== null ||
		Object.keys(parsedAttrs.otherStyles).length > 0
	) {
		return {
			success: false,
			reason: 'Ce prototype est limité aux passages ayant uniquement une couleur de texte.',
		};
	}

	if (!parsedAttrs.color) {
		return {
			success: false,
			reason: 'Le passage Inkwell ne possède aucune couleur de texte définie.',
		};
	}

	// 5. Décoder les entités HTML du texte intérieur
	const decodeRes = decodeHtmlEntities(candidate.rawInnerText);
	if (!decodeRes.success) {
		return {
			success: false,
			reason: decodeRes.error ?? 'Entité HTML non prise en charge dans le passage.',
		};
	}

	return {
		success: true,
		target: {
			spanStart: candidate.spanStart,
			spanEnd: candidate.spanEnd,
			innerStart: candidate.innerStart,
			innerEnd: candidate.innerEnd,
			openTag: candidate.openTag,
			closeTag: candidate.closeTag,
			color: parsedAttrs.color,
			rawInnerText: candidate.rawInnerText,
			visibleText: decodeRes.text,
		},
	};
}
