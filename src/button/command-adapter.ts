import { App, MarkdownView } from 'obsidian';

/**
 * Structural type for an Obsidian command in the internal registry.
 */
interface InternalCommandRecord {
	id: string;
	name: string;
	icon?: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => unknown;
	editorCallback?: (editor: unknown, view: unknown) => unknown;
	editorCheckCallback?: (checking: boolean, editor: unknown, view: unknown) => unknown;
}

interface InternalCommandsRegistry {
	commands?: Record<string, InternalCommandRecord>;
	listCommands?: () => InternalCommandRecord[];
	executeCommandById?: (id: string) => unknown;
}

interface InternalAppWithCommands extends App {
	commands?: InternalCommandsRegistry;
	plugins?: {
		manifests?: Record<string, { id?: string; name?: string }>;
	};
	internalPlugins?: {
		plugins?: Record<string, { instance?: { name?: string } }>;
	};
}

export interface ObsidianCommandItem {
	id: string;
	name: string;
	icon?: string;
	origin: string;
	requiresEditor: boolean;
}

export interface CommandExecutionContext {
	sourcePath: string;
	isSubEditor?: boolean;
}

export interface CommandExecutionValidation {
	canExecute: boolean;
	reason?: string;
	command?: ObsidianCommandItem;
}

/**
 * Checks if Obsidian's internal commands registry is present and functional.
 */
export function isCommandRegistryAvailable(app: App): boolean {
	const internalApp = app as InternalAppWithCommands;
	return (
		typeof internalApp.commands === 'object' &&
		internalApp.commands !== null &&
		typeof internalApp.commands.executeCommandById === 'function' &&
		typeof internalApp.commands.commands === 'object'
	);
}

/**
 * Safely extracts human-readable origin information for a command without guessing.
 */
function resolveCommandOrigin(app: App, commandId: string): string {
	const internalApp = app as InternalAppWithCommands;

	// Core Obsidian commands
	if (
		commandId.startsWith('app:') ||
		commandId.startsWith('workspace:') ||
		commandId.startsWith('editor:') ||
		commandId.startsWith('file-explorer:') ||
		commandId.startsWith('markdown:') ||
		commandId.startsWith('window:') ||
		commandId.startsWith('graph:')
	) {
		return 'Interne';
	}

	// Try resolving plugin from ID prefix (e.g., "mon-plugin:command-id")
	const colonIndex = commandId.indexOf(':');
	if (colonIndex > 0) {
		const pluginId = commandId.slice(0, colonIndex);
		const manifest = internalApp.plugins?.manifests?.[pluginId];
		if (manifest && typeof manifest.name === 'string' && manifest.name.trim()) {
			return `Plugin : ${manifest.name.trim()}`;
		}
	}

	return 'Origine non déterminée';
}

/**
 * Lists all available commands from Obsidian's registry with clean metadata.
 */
export function listAvailableCommands(app: App): ObsidianCommandItem[] {
	if (!isCommandRegistryAvailable(app)) {
		return [];
	}

	const internalApp = app as InternalAppWithCommands;
	const commandsDict = internalApp.commands?.commands;
	if (!commandsDict) return [];

	const result: ObsidianCommandItem[] = [];

	for (const id of Object.keys(commandsDict)) {
		const cmd = commandsDict[id];
		if (!cmd || typeof cmd.name !== 'string') continue;

		const hasEditorOnly =
			(typeof cmd.editorCallback === 'function' ||
				typeof cmd.editorCheckCallback === 'function') &&
			typeof cmd.callback !== 'function' &&
			typeof cmd.checkCallback !== 'function';

		result.push({
			id: cmd.id || id,
			name: cmd.name,
			icon: typeof cmd.icon === 'string' ? cmd.icon : undefined,
			origin: resolveCommandOrigin(app, id),
			requiresEditor: hasEditorOnly,
		});
	}

	result.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
	return result;
}

/**
 * Retrieves information for a specific command ID.
 */
export function getCommandInfo(app: App, commandId: string): ObsidianCommandItem | null {
	if (!isCommandRegistryAvailable(app)) return null;

	const internalApp = app as InternalAppWithCommands;
	const cmd = internalApp.commands?.commands?.[commandId];
	if (!cmd) return null;

	const hasEditorOnly =
		(typeof cmd.editorCallback === 'function' ||
			typeof cmd.editorCheckCallback === 'function') &&
		typeof cmd.callback !== 'function' &&
		typeof cmd.checkCallback !== 'function';

	return {
		id: cmd.id || commandId,
		name: cmd.name || commandId,
		icon: typeof cmd.icon === 'string' ? cmd.icon : undefined,
		origin: resolveCommandOrigin(app, commandId),
		requiresEditor: hasEditorOnly,
	};
}

/**
 * Validates whether a command can be executed in the specified context.
 */
export function validateCommandExecution(
	app: App,
	commandId: string,
	context: CommandExecutionContext,
): CommandExecutionValidation {
	if (!isCommandRegistryAvailable(app)) {
		return {
			canExecute: false,
			reason: 'Le registre de commandes d’Obsidian n’est pas disponible dans cet environnement.',
		};
	}

	const internalApp = app as InternalAppWithCommands;
	const cmd = internalApp.commands?.commands?.[commandId];
	if (!cmd) {
		return {
			canExecute: false,
			reason: `La commande « ${commandId} » est introuvable. Le plugin associé est peut-être désactivé ou désinstallé.`,
		};
	}

	const cmdInfo = getCommandInfo(app, commandId) ?? {
		id: commandId,
		name: cmd.name || commandId,
		origin: 'Origine non déterminée',
		requiresEditor: false,
	};

	// Sub-editor check: columns and tabs cannot pass synthetic editor contexts to parent commands
	if (context.isSubEditor && cmdInfo.requiresEditor) {
		return {
			canExecute: false,
			reason:
				'Cette commande d’édition ne peut pas être exécutée depuis une colonne ou un onglet.',
			command: cmdInfo,
		};
	}

	// Active view check: verify active leaf corresponds to the button's note
	const activeFile = app.workspace.getActiveFile();
	if (context.sourcePath && (!activeFile || activeFile.path !== context.sourcePath)) {
		return {
			canExecute: false,
			reason:
				'La note active a changé ou ne correspond plus à l’emplacement du bouton.',
			command: cmdInfo,
		};
	}

	// Respect checkCallback when available
	if (typeof cmd.checkCallback === 'function') {
		try {
			const isAllowed = cmd.checkCallback(true);
			if (isAllowed === false) {
				return {
					canExecute: false,
					reason: 'La commande indique qu’elle n’est pas disponible dans le contexte actuel.',
					command: cmdInfo,
				};
			}
		} catch {
			// If checkCallback throws, do not force execution
			return {
				canExecute: false,
				reason: 'La vérification de disponibilité de la commande a échoué.',
				command: cmdInfo,
			};
		}
	}

	// Respect editorCheckCallback when available
	if (typeof cmd.editorCheckCallback === 'function') {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.editor) {
			return {
				canExecute: false,
				reason: 'Cette commande nécessite un éditeur de note actif.',
				command: cmdInfo,
			};
		}

		try {
			const isAllowed = cmd.editorCheckCallback(true, activeView.editor, activeView);
			if (isAllowed === false) {
				return {
					canExecute: false,
					reason: 'La commande signale que l’éditeur actif ne remplit pas ses conditions d’exécution.',
					command: cmdInfo,
				};
			}
		} catch {
			return {
				canExecute: false,
				reason: 'La vérification d’éditeur de la commande a échoué.',
				command: cmdInfo,
			};
		}
	}

	return {
		canExecute: true,
		command: cmdInfo,
	};
}

/**
 * Safely executes an Obsidian command after validation.
 */
export function executeCommandSafely(
	app: App,
	commandId: string,
	context: CommandExecutionContext,
): { success: boolean; error?: string } {
	const validation = validateCommandExecution(app, commandId, context);
	if (!validation.canExecute) {
		return {
			success: false,
			error: validation.reason || 'Exécution impossible.',
		};
	}

	const internalApp = app as InternalAppWithCommands;
	try {
		internalApp.commands?.executeCommandById?.(commandId);
		return { success: true };
	} catch (e) {
		return {
			success: false,
			error: `Erreur lors de l’exécution de la commande : ${(e as Error).message}`,
		};
	}
}
