import type { App } from 'obsidian';

/**
 * Access to Obsidian's built-in "Slash commands" core plugin (id `slash-command`).
 *
 * This relies on Obsidian internals that are NOT part of the public API
 * (`app.internalPlugins`, verified on Obsidian 1.15.0). Every access is
 * feature-detected: when the shape is not the expected one, the state is
 * reported as `unknown` and nothing is modified.
 */

export const NATIVE_SLASH_PLUGIN_ID = 'slash-command';

export type NativeSlashState = 'enabled' | 'disabled' | 'unknown';

interface InternalPluginWrapperLike {
	enabled: boolean;
	disable: (byUser: boolean) => unknown;
}

function getNativeSlashWrapper(app: App): InternalPluginWrapperLike | null {
	try {
		const internal = (app as unknown as { internalPlugins?: unknown }).internalPlugins as
			| { getPluginById?: unknown }
			| undefined;
		if (!internal || typeof internal.getPluginById !== 'function') return null;
		const wrapper = (internal.getPluginById as (id: string) => unknown).call(
			internal,
			NATIVE_SLASH_PLUGIN_ID,
		) as Partial<InternalPluginWrapperLike> | null | undefined;
		if (!wrapper || typeof wrapper.enabled !== 'boolean') return null;
		return wrapper as InternalPluginWrapperLike;
	} catch {
		return null;
	}
}

/** Reads whether the native slash commands core plugin is enabled. */
export function getNativeSlashState(app: App): NativeSlashState {
	const wrapper = getNativeSlashWrapper(app);
	if (!wrapper) return 'unknown';
	return wrapper.enabled ? 'enabled' : 'disabled';
}

export type DisableNativeSlashResult =
	| { ok: true }
	| { ok: false; reason: 'unavailable' | 'still-enabled' | 'error'; message: string };

/**
 * Disables the native slash commands core plugin (persisted like a user action),
 * then reads the state back. Only reports success when it is actually disabled.
 * Never enables anything.
 */
export function disableNativeSlash(app: App): DisableNativeSlashResult {
	const wrapper = getNativeSlashWrapper(app);
	if (!wrapper || typeof wrapper.disable !== 'function') {
		return {
			ok: false,
			reason: 'unavailable',
			message: 'La détection du module « Commandes slash » d’Obsidian est indisponible.',
		};
	}
	if (!wrapper.enabled) return { ok: true };

	try {
		wrapper.disable(true);
	} catch (e) {
		return {
			ok: false,
			reason: 'error',
			message: `La désactivation des « Commandes slash » d’Obsidian a échoué : ${(e as Error).message}`,
		};
	}

	if (getNativeSlashState(app) !== 'disabled') {
		return {
			ok: false,
			reason: 'still-enabled',
			message:
				'Le module « Commandes slash » d’Obsidian est toujours actif (il est peut-être imposé par une configuration gérée).',
		};
	}
	return { ok: true };
}

/** Opens Inkwell's settings tab when the (internal) settings API is available. */
export function openPluginSettings(app: App, pluginId: string): boolean {
	try {
		const setting = (app as unknown as { setting?: unknown }).setting as
			| { open?: unknown; openTabById?: unknown }
			| undefined;
		if (!setting || typeof setting.open !== 'function' || typeof setting.openTabById !== 'function') {
			return false;
		}
		(setting.open as () => void).call(setting);
		(setting.openTabById as (id: string) => void).call(setting, pluginId);
		return true;
	} catch {
		return false;
	}
}

export const NATIVE_SLASH_MANUAL_PROCEDURE =
	'Ouvrez Réglages → Modules principaux → Commandes slash et désactivez ce module, puis confirmez votre choix dans les réglages d’Inkwell.';

/* ------------------------------------------------------------------------- */
/* Pure decision logic (no Obsidian dependency)                              */
/* ------------------------------------------------------------------------- */

export interface SlashExclusivitySettings {
	slashMenuEnabled: boolean;
	/** The user explicitly chose Inkwell's menu while the native one was off or after disabling it. */
	inkwellSlashChosen: boolean;
	/** Native state unreadable: the user confirmed having disabled the native menu manually. */
	nativeSlashManuallyConfirmed: boolean;
}

export type SlashOpenDecision =
	/** Inkwell's menu may open. */
	| 'open'
	/** Inkwell's menu is turned off in its settings. */
	| 'inkwell-off'
	/** Native menu re-enabled after the user chose Inkwell: turn Inkwell's menu off (last explicit choice). */
	| 'native-reenabled'
	/** Both menus active without an explicit choice: do not open, settings unchanged. */
	| 'conflict'
	/** Native state unreadable and not manually confirmed: do not open, explain the manual procedure. */
	| 'unknown';

export function decideSlashOpening(
	settings: SlashExclusivitySettings,
	native: NativeSlashState,
): SlashOpenDecision {
	if (!settings.slashMenuEnabled) return 'inkwell-off';
	if (native === 'disabled') return 'open';
	if (native === 'enabled') {
		return settings.inkwellSlashChosen ? 'native-reenabled' : 'conflict';
	}
	return settings.nativeSlashManuallyConfirmed ? 'open' : 'unknown';
}
