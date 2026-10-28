import type InkwellPlugin from '../main';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import { adoptLegacySpansCommand } from './adopt-legacy';
import { clearInkwellFormatting } from './clear-styles';
import { fixLegacySpansInNote } from './fix-legacy';
import {
	chooseAndApplyColor,
	setSelectionColor,
} from './text-color';
import {
	chooseAndApplyHighlight,
	setSelectionHighlight,
} from './text-highlight';
import {
	chooseAndApplySize,
	setSelectionSize,
} from './text-size';
import {
	chooseAndApplyFontFamily,
	setSelectionFontFamily,
} from './font-family';
import { toggleSelectionFormat } from './inline-format';

/** Registers all Inkwell commands. IDs are stable: never rename them. */
export function registerCommands(
	plugin: InkwellPlugin,
	tracker: EmbedSelectionTracker,
): void {
	// Text color commands
	plugin.addCommand({
		id: 'apply-text-color',
		name: 'Apply default text color',
		editorCallback: (editor) =>
			setSelectionColor(
				editor,
				tracker,
				plugin.settings.defaultColor,
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'choose-text-color',
		name: 'Choose text color...',
		editorCallback: (editor) => chooseAndApplyColor(plugin, editor, tracker),
	});

	plugin.addCommand({
		id: 'remove-text-color',
		name: 'Remove text color',
		editorCallback: (editor) =>
			setSelectionColor(
				editor,
				tracker,
				null,
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	// Highlight commands
	plugin.addCommand({
		id: 'apply-text-highlight',
		name: 'Apply default highlight',
		editorCallback: (editor) =>
			setSelectionHighlight(
				editor,
				tracker,
				plugin.settings.defaultHighlightColor,
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'choose-text-highlight',
		name: 'Choose highlight color...',
		editorCallback: (editor) => chooseAndApplyHighlight(plugin, editor, tracker),
	});

	plugin.addCommand({
		id: 'remove-text-highlight',
		name: 'Remove highlight',
		editorCallback: (editor) =>
			setSelectionHighlight(
				editor,
				tracker,
				null,
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	// Text size commands (V0.5.0)
	plugin.addCommand({
		id: 'choose-text-size',
		name: 'Choose text size...',
		editorCallback: (editor) => chooseAndApplySize(plugin, editor, tracker),
	});

	plugin.addCommand({
		id: 'set-size-small',
		name: 'Set text size to small',
		editorCallback: (editor) =>
			setSelectionSize(
				editor,
				tracker,
				'0.85em',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'set-size-normal',
		name: 'Set text size to normal',
		editorCallback: (editor) =>
			setSelectionSize(
				editor,
				tracker,
				null,
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'set-size-large',
		name: 'Set text size to large',
		editorCallback: (editor) =>
			setSelectionSize(
				editor,
				tracker,
				'1.25em',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	// Font family commands (V0.6.0)
	plugin.addCommand({
		id: 'choose-font-family',
		name: 'Choose font family...',
		editorCallback: (editor) => chooseAndApplyFontFamily(plugin, editor, tracker),
	});

	plugin.addCommand({
		id: 'set-font-sans-serif',
		name: 'Set font family to sans-serif',
		editorCallback: (editor) =>
			setSelectionFontFamily(
				editor,
				tracker,
				'sans-serif',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'set-font-serif',
		name: 'Set font family to serif',
		editorCallback: (editor) =>
			setSelectionFontFamily(
				editor,
				tracker,
				'serif',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'set-font-monospace',
		name: 'Set font family to monospace',
		editorCallback: (editor) =>
			setSelectionFontFamily(
				editor,
				tracker,
				'monospace',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'remove-font-family',
		name: 'Remove font family',
		editorCallback: (editor) =>
			setSelectionFontFamily(
				editor,
				tracker,
				null,
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	// Global clearing command
	plugin.addCommand({
		id: 'clear-all-styles',
		name: 'Clear all styles',
		editorCallback: (editor) =>
			clearInkwellFormatting(
				editor,
				tracker,
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	// Compatibility & maintenance commands
	plugin.addCommand({
		id: 'fix-legacy-formatting',
		name: 'Fix inverted Markdown formatting in active note',
		editorCallback: (editor) => fixLegacySpansInNote(editor),
	});

	plugin.addCommand({
		id: 'adopt-legacy-formatting',
		name: 'Adopt legacy formatting in selection or note...',
		editorCallback: (editor) => adoptLegacySpansCommand(plugin, editor, tracker),
	});

	// Floating toolbar keyboard focus command
	plugin.addCommand({
		id: 'focus-floating-toolbar',
		name: 'Focus floating toolbar',
		callback: () => {
			plugin.toolbarManager?.focus();
		},
	});

	// Edit styled text popover command (Prototype)
	plugin.addCommand({
		id: 'edit-styled-text',
		name: 'Modifier le passage entier...',
		editorCallback: (editor) => {
			plugin.editPopover.open(editor);
		},
	});

	// Unified HTML inline formatting commands (V1.5.0)
	plugin.addCommand({
		id: 'toggle-bold',
		name: 'Gras (HTML)',
		editorCallback: (editor) =>
			toggleSelectionFormat(
				editor,
				tracker,
				'bold',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'toggle-italic',
		name: 'Italique (HTML)',
		editorCallback: (editor) =>
			toggleSelectionFormat(
				editor,
				tracker,
				'italic',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'toggle-underline',
		name: 'Souligné (HTML)',
		editorCallback: (editor) =>
			toggleSelectionFormat(
				editor,
				tracker,
				'underline',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});

	plugin.addCommand({
		id: 'toggle-strikethrough',
		name: 'Barré (HTML)',
		editorCallback: (editor) =>
			toggleSelectionFormat(
				editor,
				tracker,
				'strikethrough',
				plugin.app.workspace.getActiveFile()?.path ?? null,
			),
	});
}
