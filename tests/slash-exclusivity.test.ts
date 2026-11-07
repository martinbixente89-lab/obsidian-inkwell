import test, { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
// Same module as `obsidian` under `npm test` (esbuild alias): exposes the notice recorder.
import { Notice } from './helpers/obsidian-stub';
import {
	decideSlashOpening,
	disableNativeSlash,
	getNativeSlashState,
	type SlashExclusivitySettings,
} from '../src/slash-menu/native-slash';
import {
	checkSlashMenuOpening,
	requestInkwellSlashMenu,
	resetSlashGateSessionState,
	turnOffInkwellSlashMenu,
} from '../src/slash-menu/slash-gate';
import { DEFAULT_SETTINGS, InkwellSettings, sanitizeSettings } from '../src/settings/types';
import type InkwellPlugin from '../src/main';

/* ---------- Test doubles ---------------------------------------------------- */

/** Fake of the internal core-plugin wrapper, as observed on Obsidian 1.15.0. */
function nativeWrapper(enabled: boolean, opts: { forced?: boolean; throws?: boolean } = {}) {
	const w = {
		enabled,
		disableCalls: 0,
		enableCalls: 0,
		disable(_byUser: boolean) {
			w.disableCalls++;
			if (opts.throws) throw new Error('boom');
			if (!opts.forced) w.enabled = false; // "forced" policy: silent no-op
		},
		enable(_byUser: boolean) {
			w.enableCalls++;
			w.enabled = true;
			return Promise.resolve();
		},
	};
	return w;
}

function appWith(wrapper: unknown) {
	return {
		internalPlugins: {
			getPluginById: (id: string) => (id === 'slash-command' ? wrapper : null),
		},
	};
}

function fakePlugin(app: unknown, overrides: Partial<InkwellSettings> = {}) {
	const plugin = {
		app,
		manifest: { id: 'inkwell' },
		settings: { ...sanitizeSettings({}), ...overrides },
		saves: 0,
		saveSettings() {
			plugin.saves++;
			return Promise.resolve();
		},
	};
	return plugin;
}
const asPlugin = (p: unknown) => p as InkwellPlugin;

/** Under Node, `createFragment` is absent: notices fall back to plain text with the settings path. */
function noticeTexts(): string[] {
	return Notice.shown.map((n) => String(n));
}

beforeEach(() => {
	Notice.shown = [];
	resetSlashGateSessionState();
});

/* ---------- Native state detection ---------------------------------------- */

void describe('native slash: state detection (internal API, feature-detected)', () => {
	void test('reads enabled / disabled', () => {
		assert.equal(getNativeSlashState(asPlugin(fakePlugin(appWith(nativeWrapper(true)))).app), 'enabled');
		assert.equal(getNativeSlashState(asPlugin(fakePlugin(appWith(nativeWrapper(false)))).app), 'disabled');
	});

	void test('reports unknown, never "disabled", when the API is missing or unexpected', () => {
		const cases: unknown[] = [
			{},
			{ internalPlugins: {} },
			{ internalPlugins: { getPluginById: () => null } },
			{ internalPlugins: { getPluginById: () => ({ enabled: 'yes' }) } },
			{
				internalPlugins: {
					getPluginById: () => {
						throw new Error('changed');
					},
				},
			},
		];
		for (const app of cases) {
			assert.equal(getNativeSlashState(asPlugin(fakePlugin(app)).app), 'unknown');
		}
	});
});

void describe('native slash: disabling with verification', () => {
	void test('succeeds only when the module is really disabled afterwards', () => {
		const w = nativeWrapper(true);
		const res = disableNativeSlash(asPlugin(fakePlugin(appWith(w))).app);
		assert.deepEqual(res, { ok: true });
		assert.equal(w.enabled, false);
		assert.equal(w.disableCalls, 1);
	});

	void test('reports failure when a managed policy keeps it enabled (silent no-op)', () => {
		const w = nativeWrapper(true, { forced: true });
		const res = disableNativeSlash(asPlugin(fakePlugin(appWith(w))).app);
		assert.equal(res.ok, false);
		assert.equal(!res.ok && res.reason, 'still-enabled');
		assert.equal(w.enabled, true);
	});

	void test('reports failure when the call throws or the API is unavailable', () => {
		const throwing = disableNativeSlash(
			asPlugin(fakePlugin(appWith(nativeWrapper(true, { throws: true })))).app,
		);
		assert.equal(!throwing.ok && throwing.reason, 'error');
		const missing = disableNativeSlash(asPlugin(fakePlugin({})).app);
		assert.equal(!missing.ok && missing.reason, 'unavailable');
	});

	void test('does nothing when already disabled', () => {
		const w = nativeWrapper(false);
		assert.deepEqual(disableNativeSlash(asPlugin(fakePlugin(appWith(w))).app), { ok: true });
		assert.equal(w.disableCalls, 0);
	});
});

/* ---------- Pure decision --------------------------------------------------- */

void describe('slash exclusivity: decision', () => {
	const base: SlashExclusivitySettings = {
		slashMenuEnabled: true,
		inkwellSlashChosen: false,
		nativeSlashManuallyConfirmed: false,
	};
	void test('decision table', () => {
		assert.equal(decideSlashOpening({ ...base, slashMenuEnabled: false }, 'enabled'), 'inkwell-off');
		assert.equal(decideSlashOpening(base, 'disabled'), 'open');
		assert.equal(decideSlashOpening(base, 'enabled'), 'conflict');
		assert.equal(decideSlashOpening({ ...base, inkwellSlashChosen: true }, 'enabled'), 'native-reenabled');
		assert.equal(decideSlashOpening(base, 'unknown'), 'unknown');
		assert.equal(decideSlashOpening({ ...base, nativeSlashManuallyConfirmed: true }, 'unknown'), 'open');
	});
});

/* ---------- Opening checkpoint (typing / paste / "+") ----------------------- */

void describe('slash exclusivity: opening checkpoint', () => {
	void test('native menu off: Inkwell opens, nothing written, no notice', () => {
		const p = fakePlugin(appWith(nativeWrapper(false)));
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), true);
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'plus-button'), true);
		assert.equal(p.saves, 0);
		assert.equal(Notice.shown.length, 0);
	});

	void test('both menus active without choice: refuse, keep settings, one notice only for typing', () => {
		const w = nativeWrapper(true);
		const p = fakePlugin(appWith(w));
		for (let i = 0; i < 5; i++) {
			assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false);
		}
		assert.equal(p.settings.slashMenuEnabled, true, 'refusal alone does not change the setting');
		assert.equal(w.enabled, true, 'native module never disabled without confirmation');
		assert.equal(w.disableCalls, 0);
		assert.equal(Notice.shown.length, 1, 'single notice');
		assert.ok(noticeTexts()[0]?.includes('Choisissez le menu souhaité'));
		assert.ok(noticeTexts()[0]?.includes('Paramètres → Inkwell'));
		assert.equal(p.settings.slashConflictNoticeShown, true, 'notice remembered');
	});

	void test('"+" button in conflict: refused with an explanation every time (nothing inserted)', () => {
		const p = fakePlugin(appWith(nativeWrapper(true)), { slashConflictNoticeShown: true });
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'plus-button'), false);
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'plus-button'), false);
		assert.equal(Notice.shown.length, 2);
		assert.ok(noticeTexts().every((t) => t.includes('Aucun « / » n’a été inséré')));
		assert.equal(p.settings.slashMenuEnabled, true);
	});

	void test('"+" button with Inkwell menu off: explained, typing stays silent', () => {
		const p = fakePlugin(appWith(nativeWrapper(false)), { slashMenuEnabled: false });
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false);
		assert.equal(Notice.shown.length, 0);
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'plus-button'), false);
		assert.equal(Notice.shown.length, 1);
	});

	void test('native re-enabled after choosing Inkwell: only Inkwell menu is turned off, explained once', () => {
		const w = nativeWrapper(true);
		const p = fakePlugin(appWith(w), { inkwellSlashChosen: true });
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false);
		assert.equal(p.settings.slashMenuEnabled, false);
		assert.equal(p.settings.inkwellSlashChosen, false);
		assert.equal(p.saves, 1);
		assert.equal(w.enabled, true, 'native untouched');
		assert.equal(Notice.shown.length, 1);
		assert.ok(noticeTexts()[0]?.includes('ont été réactivées'));

		// Next attempts: Inkwell menu is simply off, no new notice, no further writes.
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false);
		assert.equal(Notice.shown.length, 1);
		assert.equal(p.saves, 1);
	});

	void test('unreadable native state: refuse with manual procedure once per session; manual confirmation opens', () => {
		const p = fakePlugin({});
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false);
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false);
		assert.equal(Notice.shown.length, 1);
		assert.ok(noticeTexts()[0]?.includes('ne peut pas être détecté'));
		assert.ok(noticeTexts()[0]?.includes('Commandes slash'));
		assert.equal(p.saves, 0);

		const confirmed = fakePlugin({}, { nativeSlashManuallyConfirmed: true });
		assert.equal(checkSlashMenuOpening(asPlugin(confirmed), 'typing'), true);
	});
});

/* ---------- Explicit choice in settings ------------------------------------- */

void describe('slash exclusivity: explicit choice in settings', () => {
	const never = () => Promise.reject(new Error('confirmation must not be asked'));

	void test('native off: Inkwell enabled directly, no confirmation, native untouched', async () => {
		const w = nativeWrapper(false);
		const p = fakePlugin(appWith(w), { slashMenuEnabled: false });
		const res = await requestInkwellSlashMenu(asPlugin(p), never);
		assert.equal(res.enabled, true);
		assert.equal(p.settings.slashMenuEnabled, true);
		assert.equal(p.settings.inkwellSlashChosen, true);
		assert.equal(w.disableCalls, 0);
	});

	void test('native on, user cancels: nothing changes', async () => {
		const w = nativeWrapper(true);
		const p = fakePlugin(appWith(w), { slashMenuEnabled: false });
		const asked: string[] = [];
		const res = await requestInkwellSlashMenu(asPlugin(p), (mode) => {
			asked.push(mode);
			return Promise.resolve(false);
		});
		assert.deepEqual(asked, ['disable-native']);
		assert.equal(res.enabled, false);
		assert.equal(p.settings.slashMenuEnabled, false);
		assert.equal(w.enabled, true);
		assert.equal(w.disableCalls, 0);
		assert.equal(p.saves, 0);
	});

	void test('native on, user confirms: native disabled and verified, then Inkwell enabled', async () => {
		const w = nativeWrapper(true);
		const p = fakePlugin(appWith(w), { slashMenuEnabled: false, slashConflictNoticeShown: true });
		const res = await requestInkwellSlashMenu(asPlugin(p), () => Promise.resolve(true));
		assert.equal(res.enabled, true);
		assert.equal(w.enabled, false);
		assert.equal(p.settings.slashMenuEnabled, true);
		assert.equal(p.settings.inkwellSlashChosen, true);
		assert.equal(p.settings.slashConflictNoticeShown, false);
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), true);
	});

	void test('native on, disable has no effect (managed): switch not completed', async () => {
		const w = nativeWrapper(true, { forced: true });
		const p = fakePlugin(appWith(w), { slashMenuEnabled: false });
		const res = await requestInkwellSlashMenu(asPlugin(p), () => Promise.resolve(true));
		assert.equal(res.enabled, false);
		assert.ok(res.message?.includes('toujours actif'));
		assert.equal(p.settings.slashMenuEnabled, false);
		assert.equal(p.settings.inkwellSlashChosen, false);
		assert.equal(p.saves, 0);
	});

	void test('unreadable state: manual confirmation, nothing modified in Obsidian', async () => {
		const p = fakePlugin({}, { slashMenuEnabled: false });
		const asked: string[] = [];
		const res = await requestInkwellSlashMenu(asPlugin(p), (mode) => {
			asked.push(mode);
			return Promise.resolve(true);
		});
		assert.deepEqual(asked, ['manual-confirm']);
		assert.equal(res.enabled, true);
		assert.equal(p.settings.nativeSlashManuallyConfirmed, true);
	});

	void test('turning Inkwell off never re-enables the native menu', async () => {
		const w = nativeWrapper(false);
		const p = fakePlugin(appWith(w), { inkwellSlashChosen: true });
		await turnOffInkwellSlashMenu(asPlugin(p));
		assert.equal(p.settings.slashMenuEnabled, false);
		assert.equal(p.settings.inkwellSlashChosen, false);
		assert.equal(w.enableCalls, 0);
		assert.equal(w.enabled, false);
	});

	void test('full cycle has no activation loop: last explicit choice wins', async () => {
		const w = nativeWrapper(true);
		const p = fakePlugin(appWith(w)); // legacy: both enabled, no choice

		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false); // conflict
		await requestInkwellSlashMenu(asPlugin(p), () => Promise.resolve(true)); // choose Inkwell
		assert.equal(w.enabled, false);
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), true);

		w.enabled = true; // user re-enables the native menu in Obsidian
		assert.equal(checkSlashMenuOpening(asPlugin(p), 'typing'), false);
		assert.equal(p.settings.slashMenuEnabled, false);
		assert.equal(w.enabled, true);

		// Nothing re-enables anything afterwards.
		for (let i = 0; i < 3; i++) checkSlashMenuOpening(asPlugin(p), 'typing');
		assert.equal(w.enableCalls, 0);
		assert.equal(w.disableCalls, 1);
		assert.equal(p.settings.slashMenuEnabled, false);
	});
});

/* ---------- Settings persistence ------------------------------------------- */

void describe('slash exclusivity: settings sanitization', () => {
	void test('new fields default to false and keep valid stored values', () => {
		const d = sanitizeSettings({});
		assert.equal(d.inkwellSlashChosen, false);
		assert.equal(d.nativeSlashManuallyConfirmed, false);
		assert.equal(d.slashConflictNoticeShown, false);
		assert.equal(d.slashMenuEnabled, DEFAULT_SETTINGS.slashMenuEnabled);

		const kept = sanitizeSettings({
			inkwellSlashChosen: true,
			nativeSlashManuallyConfirmed: true,
			slashConflictNoticeShown: true,
		});
		assert.equal(kept.inkwellSlashChosen, true);
		assert.equal(kept.nativeSlashManuallyConfirmed, true);
		assert.equal(kept.slashConflictNoticeShown, true);

		const bad = sanitizeSettings({ inkwellSlashChosen: 'yes', slashConflictNoticeShown: 1 });
		assert.equal(bad.inkwellSlashChosen, false);
		assert.equal(bad.slashConflictNoticeShown, false);
	});

	void test('loading existing data (1.6.1, both menus on) changes nothing by itself', () => {
		const loaded = sanitizeSettings({ slashMenuEnabled: true });
		assert.equal(loaded.slashMenuEnabled, true);
		assert.equal(loaded.inkwellSlashChosen, false);
	});
});
