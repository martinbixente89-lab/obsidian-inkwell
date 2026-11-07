import { Notice, Setting } from 'obsidian';
import type InkwellPlugin from '../main';
import {
	decideSlashOpening,
	getNativeSlashState,
	NATIVE_SLASH_MANUAL_PROCEDURE,
} from './native-slash';
import { NativeSlashChoiceModal } from './native-slash-modal';
import {
	applyNativeReenabledRule,
	requestInkwellSlashMenu,
	SlashChoiceConfirm,
	turnOffInkwellSlashMenu,
} from './slash-gate';

/**
 * Renders the "slash menu" setting, mutually exclusive with Obsidian's native
 * "Slash commands" core plugin. Reads the native state when the tab is displayed
 * (no watcher) and applies the "native re-enabled → Inkwell's menu off" rule.
 */
export function renderSlashMenuSetting(
	containerEl: HTMLElement,
	plugin: InkwellPlugin,
	redisplay: () => void,
): void {
	// Settings mutation is synchronous inside the rule; saving completes in the background.
	const wasTurnedOff =
		decideSlashOpening(plugin.settings, getNativeSlashState(plugin.app)) === 'native-reenabled';
	if (wasTurnedOff) void applyNativeReenabledRule(plugin);

	const native = getNativeSlashState(plugin.app);
	const decision = decideSlashOpening(plugin.settings, native);

	const confirm: SlashChoiceConfirm = (mode) =>
		new Promise<boolean>((resolve) => {
			new NativeSlashChoiceModal(plugin.app, mode, resolve).open();
		});

	const chooseInkwell = async () => {
		const result = await requestInkwellSlashMenu(plugin, confirm);
		if (result.message) new Notice(result.message, result.enabled ? 6000 : 12000);
		redisplay();
	};

	const setting = new Setting(containerEl)
		.setName('Menu d’insertion slash (/)')
		.setDesc(
			'Ouvre un menu flottant d’insertion rapide lorsque vous tapez / au début d’une ligne vide. Ce menu et les « Commandes slash » d’Obsidian sont exclusifs : un seul des deux est utilisé.',
		)
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.slashMenuEnabled).onChange(async (value) => {
				if (value) {
					await chooseInkwell();
				} else {
					await turnOffInkwellSlashMenu(plugin);
					redisplay();
				}
			});
		});

	const statusEl = setting.descEl.createDiv({ cls: 'setting-item-description' });
	if (wasTurnedOff) {
		statusEl.setText(
			'Les « Commandes slash » d’Obsidian ont été réactivées : le menu slash d’Inkwell a été désactivé. Réactivez-le ici pour désactiver de nouveau celui d’Obsidian.',
		);
	} else if (native === 'enabled') {
		statusEl.setText('État des « Commandes slash » d’Obsidian : actives.');
	} else if (native === 'disabled') {
		statusEl.setText('État des « Commandes slash » d’Obsidian : désactivées.');
	} else {
		statusEl.setText(
			`État des « Commandes slash » d’Obsidian : détection indisponible. ${NATIVE_SLASH_MANUAL_PROCEDURE}`,
		);
	}

	// Both menus enabled without an explicit choice: offer the choice explicitly.
	if (decision === 'conflict' || decision === 'unknown') {
		new Setting(containerEl)
			.setName('Choisir le menu slash')
			.setDesc(
				decision === 'conflict'
					? 'Les deux menus sont actifs : celui d’Inkwell ne s’ouvre pas tant qu’un choix n’est pas fait.'
					: 'Le menu d’Inkwell ne s’ouvre pas tant que vous n’avez pas confirmé la désactivation manuelle du menu d’Obsidian.',
			)
			.addButton((btn) => {
				btn
					.setButtonText('Utiliser le menu d’Inkwell')
					.setCta()
					.onClick(() => {
						void chooseInkwell();
					});
			})
			.addButton((btn) => {
				btn
					.setButtonText(
						decision === 'conflict' ? 'Garder le menu d’Obsidian' : 'Désactiver le menu d’Inkwell',
					)
					.onClick(() => {
						void (async () => {
							await turnOffInkwellSlashMenu(plugin);
							redisplay();
						})();
					});
			});
	}
}
