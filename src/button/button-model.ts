/**
 * Data model and serialization helpers for Action Buttons.
 *
 * Stored as an Obsidian callout:
 * > [!button|filled|#7864ff] Libellé du bouton
 * > [[Chemin/Vers/Note.md]]
 *
 * or for URL:
 * > [!button|outline] Visiter le site
 * > https://exemple.fr
 *
 * or for Command:
 * > [!button|filled] Basculer la barre latérale
 * > commande: app:toggle-left-sidebar
 */

export type ButtonActionType = 'note' | 'url' | 'command';
export type ButtonVariant = 'filled' | 'outline';

export interface ButtonData {
	label: string;
	actionType: ButtonActionType;
	target: string;
	variant: ButtonVariant;
	color?: string;
}

export interface ButtonParseResult {
	data: ButtonData | null;
	rawMarkdown: string;
	isValid: boolean;
	validationError?: string;
}

/**
 * Strictly validates that a URL uses HTTP or HTTPS.
 * Rejects javascript:, data:, file:, etc.
 */
export function isValidWebUrl(url: string): boolean {
	const trimmed = url.trim();
	if (!trimmed) return false;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return /^https?:\/\//i.test(trimmed);
	}
}

/**
 * Validates hexadecimal CSS color format (#rgb or #rrggbb).
 */
export function isValidHexColor(color: string): boolean {
	return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color.trim());
}

/**
 * Sanitizes variant with fallback to 'filled'.
 */
export function sanitizeVariant(variant?: string): ButtonVariant {
	if (variant && variant.trim().toLowerCase() === 'outline') {
		return 'outline';
	}
	return 'filled';
}

/**
 * Sanitizes hex color or returns undefined if invalid.
 */
export function sanitizeColor(color?: string): string | undefined {
	if (!color) return undefined;
	const trimmed = color.trim();
	if (isValidHexColor(trimmed)) {
		return trimmed.toLowerCase();
	}
	return undefined;
}

/**
 * Escapes unescaped brackets in button label.
 */
export function escapeButtonLabel(label: string): string {
	return label
		.replace(/\\\[/g, '[')
		.replace(/\\\]/g, ']')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
}

/**
 * Unescapes brackets in button label.
 */
export function unescapeButtonLabel(label: string): string {
	return label.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
}

/**
 * Serializes a ButtonData into Markdown callout format.
 */
export function serializeButton(data: ButtonData): string {
	const variant = sanitizeVariant(data.variant);
	const color = sanitizeColor(data.color);

	const metaTokens: string[] = ['!button'];
	metaTokens.push(variant);
	if (color) {
		metaTokens.push(color);
	}

	const safeLabel = escapeButtonLabel(data.label.trim() || 'Action');
	const headerLine = `> [${metaTokens.join('|')}] ${safeLabel}`;

	let bodyLine = '> ';
	switch (data.actionType) {
		case 'note': {
			const cleanNote = data.target.trim().replace(/^\[\[|\]\]$/g, '');
			bodyLine += `[[${cleanNote}]]`;
			break;
		}
		case 'url': {
			bodyLine += data.target.trim();
			break;
		}
		case 'command': {
			bodyLine += `commande: ${data.target.trim()}`;
			break;
		}
	}

	return `${headerLine}\n${bodyLine}`;
}

/**
 * Parses a callout block into structured ButtonData with strict validation.
 */
export function parseButton(markdown: string): ButtonParseResult {
	const raw = markdown.trim();
	if (!raw) {
		return { data: null, rawMarkdown: raw, isValid: false, validationError: 'Contenu vide' };
	}

	const lines = raw.split(/\r?\n/);
	const firstLine = lines[0] ?? '';

	// Match callout header: > [!button|meta1|meta2] Label
	const headerMatch = firstLine.match(/^\s*>\s*\[!button(?:\|([^\]]+))?\]\s*(.*)$/i);
	if (!headerMatch) {
		return {
			data: null,
			rawMarkdown: raw,
			isValid: false,
			validationError: 'Format d’en-tête de bouton non reconnu',
		};
	}

	const rawMeta = headerMatch[1] ?? '';
	const rawLabel = (headerMatch[2] ?? '').trim();
	const label = unescapeButtonLabel(rawLabel) || 'Action';

	// Parse metadata tokens (variant, color)
	let variant: ButtonVariant = 'filled';
	let color: string | undefined;

	if (rawMeta) {
		const tokens = rawMeta.split('|').map((t) => t.trim().toLowerCase());
		for (const tok of tokens) {
			if (tok === 'filled' || tok === 'outline') {
				variant = tok;
			} else if (isValidHexColor(tok)) {
				color = tok;
			}
		}
	}

	// Parse body lines (subsequent lines starting with >)
	const bodyLines: string[] = [];
	for (let i = 1; i < lines.length; i++) {
		const l = lines[i] ?? '';
		const m = l.match(/^\s*>\s?(.*)$/);
		if (m && m[1] !== undefined) {
			bodyLines.push(m[1].trim());
		}
	}

	const bodyText = bodyLines.join(' ').trim();
	if (!bodyText) {
		return {
			data: {
				label,
				actionType: 'note',
				target: '',
				variant,
				color,
			},
			rawMarkdown: raw,
			isValid: false,
			validationError: 'Cible d’action manquante',
		};
	}

	// Determine action type from body
	// 1. Note link: [[Target]]
	const noteMatch = bodyText.match(/^\[\[([^\]]+)\]\]$/);
	if (noteMatch && noteMatch[1]) {
		const rawTarget = noteMatch[1].trim();
		// Extract path part before any pipe alias
		const notePath = rawTarget.split('|')[0]?.trim() || rawTarget;
		return {
			data: {
				label,
				actionType: 'note',
				target: notePath,
				variant,
				color,
			},
			rawMarkdown: raw,
			isValid: Boolean(notePath),
			validationError: notePath ? undefined : 'Chemin de note cible vide',
		};
	}

	// 2. Command: commande: <id> or command: <id>
	const cmdMatch = bodyText.match(/^(?:commande|command)\s*:\s*(.+)$/i);
	if (cmdMatch && cmdMatch[1]) {
		const commandId = cmdMatch[1].trim();
		return {
			data: {
				label,
				actionType: 'command',
				target: commandId,
				variant,
				color,
			},
			rawMarkdown: raw,
			isValid: Boolean(commandId),
			validationError: commandId ? undefined : 'Identifiant de commande vide',
		};
	}

	// 3. Web URL: http:// or https://
	if (isValidWebUrl(bodyText)) {
		return {
			data: {
				label,
				actionType: 'url',
				target: bodyText,
				variant,
				color,
			},
			rawMarkdown: raw,
			isValid: true,
		};
	}

	// Fallback/Invalid target: do not guess
	return {
		data: {
			label,
			actionType: 'note',
			target: bodyText,
			variant,
			color,
		},
		rawMarkdown: raw,
		isValid: false,
		validationError: `Type d’action ou cible non valide : « ${bodyText} »`,
	};
}
