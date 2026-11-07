import { Notice } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	decideSlashOpening,
	disableNativeSlash,
	getNativeSlashState,
	NATIVE_SLASH_MANUAL_PROCEDURE,
	openPluginSettings,
	SlashOpenDecision,
} from './native-slash';

export type SlashOpenSource = 'typing' | 'plus-button';

/** Notices already shown during this session (typing path only). */
const shownSessionNotices = new Set<string>();

function showNoticeWithSettingsLink(plugin: InkwellPlugin, message: string): void {
	if (typeof createFragment !== 'function') {
		new Notice(`${message} (Paramètres → Inkwell)`, 12000);
		return;
	}
	const fragment = createFragment((frag) => {
		frag.createDiv({ text: message });
		const link = frag.createEl('a', {
			text: 'Ouvrir les réglages d’Inkwell',
			href: '#',
		});
		link.addEventListener('click', (e) => {
			e.preventDefault();
			if (!openPluginSettings(plugin.app, plugin.manifest.id)) {
				new Notice('Ouvrez Paramètres → Inkwell pour choisir le menu slash.');
			}
		});
	});
	new Notice(fragment, 12000);
}

const MESSAGES = {
	'inkwell-off':
		'Le menu d’insertion d’Inkwell est désactivé dans ses réglages : aucun « / » n’a été inséré.',
	'native-reenabled':
		'Les « Commandes slash » d’Obsidian ont été réactivées : le menu slash d’Inkwell a été désactivé pour éviter deux menus simultanés. Vous pouvez le réactiver dans les réglages d’Inkwell.',
	conflict:
		'Les « Commandes slash » d’Obsidian sont actives : le menu slash d’Inkwell ne s’ouvre pas pour éviter deux menus simultanés. Choisissez le menu souhaité dans les réglages d’Inkwell.',
	unknown: `L’état des « Commandes slash » d’Obsidian ne peut pas être détecté : le menu slash d’Inkwell ne s’ouvre pas. ${NATIVE_SLASH_MANUAL_PROCEDURE}`,
} as const;

/**
 * Applies the "native menu re-enabled → Inkwell's menu off" rule.
 * Used both on an opening attempt and when Inkwell's settings are displayed.
 * Returns true when Inkwell's menu has just been turned off.
 */
export async function applyNativeReenabledRule(plugin: InkwellPlugin): Promise<boolean> {
	const decision = decideSlashOpening(plugin.settings, getNativeSlashState(plugin.app));
	if (decision !== 'native-reenabled') return false;
	plugin.settings.slashMenuEnabled = false;
	plugin.settings.inkwellSlashChosen = false;
	plugin.settings.nativeSlashManuallyConfirmed = false;
	await plugin.saveSettings();
	return true;
}

/**
 * Single checkpoint for every attempt to open Inkwell's slash menu
 * (typing, paste, any text change, gutter "+" button).
 * Reads the native state on demand: no watcher, no polling.
 * Returns true only when Inkwell's menu may open.
 */
export function checkSlashMenuOpening(
	plugin: InkwellPlugin,
	source: SlashOpenSource,
): boolean {
	const decision: SlashOpenDecision = decideSlashOpening(
		plugin.settings,
		getNativeSlashState(plugin.app),
	);
	if (decision === 'open') return true;

	if (decision === 'native-reenabled') {
		void applyNativeReenabledRule(plugin);
		showNoticeWithSettingsLink(plugin, MESSAGES['native-reenabled']);
		return false;
	}

	if (decision === 'inkwell-off') {
		// Typing a "/" with Inkwell's menu off is normal text: stay silent.
		if (source === 'plus-button') new Notice(MESSAGES['inkwell-off'], 8000);
		return false;
	}

	// 'conflict' or 'unknown': refuse to open, settings unchanged.
	if (source === 'plus-button') {
		showNoticeWithSettingsLink(plugin, `${MESSAGES[decision]} Aucun « / » n’a été inséré.`);
		return false;
	}

	if (decision === 'conflict') {
		if (!plugin.settings.slashConflictNoticeShown) {
			plugin.settings.slashConflictNoticeShown = true;
			void plugin.saveSettings();
			showNoticeWithSettingsLink(plugin, MESSAGES.conflict);
		}
	} else if (!shownSessionNotices.has(decision)) {
		shownSessionNotices.add(decision);
		showNoticeWithSettingsLink(plugin, MESSAGES.unknown);
	}
	return false;
}

export type SlashChoiceConfirm = (mode: 'disable-native' | 'manual-confirm') => Promise<boolean>;

export interface SlashChoiceResult {
	enabled: boolean;
	message?: string;
}

/**
 * Explicit user choice in Inkwell's settings: turn Inkwell's slash menu on.
 * - Native menu off: enable directly.
 * - Native menu on: ask for confirmation, disable it, then verify it is really off
 *   before enabling Inkwell's menu. On refusal or failure, Inkwell's menu stays off.
 * - Native state unreadable: never claim it is off; ask the user to confirm the
 *   manual procedure, without modifying anything in Obsidian.
 */
export async function requestInkwellSlashMenu(
	plugin: InkwellPlugin,
	confirm: SlashChoiceConfirm,
): Promise<SlashChoiceResult> {
	const native = getNativeSlashState(plugin.app);
	let manuallyConfirmed = false;
	let message: string | undefined;

	if (native === 'enabled') {
		if (!(await confirm('disable-native'))) {
			return { enabled: false, message: 'Aucun changement : le menu slash d’Inkwell reste désactivé.' };
		}
		const result = disableNativeSlash(plugin.app);
		if (!result.ok) {
			return {
				enabled: false,
				message: `${result.message} Le menu slash d’Inkwell reste désactivé. ${NATIVE_SLASH_MANUAL_PROCEDURE}`,
			};
		}
		message = 'Les « Commandes slash » d’Obsidian ont été désactivées ; le menu slash d’Inkwell est actif.';
	} else if (native === 'unknown') {
		if (!(await confirm('manual-confirm'))) {
			return { enabled: false, message: 'Aucun changement : le menu slash d’Inkwell reste désactivé.' };
		}
		manuallyConfirmed = true;
	}

	plugin.settings.slashMenuEnabled = true;
	plugin.settings.inkwellSlashChosen = true;
	plugin.settings.nativeSlashManuallyConfirmed = manuallyConfirmed;
	plugin.settings.slashConflictNoticeShown = false;
	await plugin.saveSettings();
	return { enabled: true, message };
}

/** Explicit user choice: turn Inkwell's slash menu off. Never re-enables the native menu. */
export async function turnOffInkwellSlashMenu(plugin: InkwellPlugin): Promise<void> {
	plugin.settings.slashMenuEnabled = false;
	plugin.settings.inkwellSlashChosen = false;
	plugin.settings.nativeSlashManuallyConfirmed = false;
	plugin.settings.slashConflictNoticeShown = false;
	await plugin.saveSettings();
}

/** Test helper: forget session-scoped notices. */
export function resetSlashGateSessionState(): void {
	shownSessionNotices.clear();
}
