import { Editor, Notice } from 'obsidian';
import type InkwellPlugin from '../main';
import { EmbedSelectionTracker } from '../editor/embed-selection';
import {
	adoptCandidateSpan,
	findLegacySpansInLines,
} from '../format/color-spans';
import { AdoptModal } from '../ui/adopt-modal';
import { captureSelectionState } from './selection-state';

/**
 * Scans selection or active note for legacy spans and prompts user to adopt them
 * by adding data-inkwell="1". Undoable in 1 step.
 * Accurately tracks mouse selections made inside Live Preview widgets.
 */
export function adoptLegacySpansCommand(
	plugin: InkwellPlugin,
	editor: Editor,
	tracker: EmbedSelectionTracker,
): void {
	const activeFile = plugin.app.workspace.getActiveFile();
	const captured = captureSelectionState(editor, tracker, activeFile?.path ?? null);
	const hasSelection = captured.hasSelection;

	const lineCount = editor.lineCount();
	const lines: string[] = [];
	for (let i = 0; i < lineCount; i++) {
		lines.push(editor.getLine(i));
	}

	const scopeRange = hasSelection
		? {
				startLine: captured.lineNo,
				startCh: captured.fromCh,
				endLine: captured.targetToLine,
				endCh: captured.toCh,
			}
		: undefined;

	const scopeDescription = hasSelection ? 'Sélection active' : 'Note active entière';
	const candidates = findLegacySpansInLines(lines, scopeRange);

	if (candidates.length === 0) {
		new Notice(`Aucune balise historique à adopter trouvée (${scopeDescription.toLowerCase()}).`);
		return;
	}

	// Open confirmation modal
	new AdoptModal(plugin.app, {
		count: candidates.length,
		scopeDescription,
		onConfirm: () => {
			// Apply all changes in a single transaction
			// Sort candidates from bottom-to-top, right-to-left
			candidates.sort((a, b) => {
				if (a.lineNo !== b.lineNo) return b.lineNo - a.lineNo;
				return b.rawStart - a.rawStart;
			});

			const changes = candidates.map((cand) => {
				const adopted = adoptCandidateSpan(cand.raw);
				return {
					from: { line: cand.lineNo, ch: cand.rawStart },
					to: { line: cand.lineNo, ch: cand.rawEnd },
					text: adopted,
				};
			});

			editor.transaction({ changes });
			new Notice(
				`${candidates.length} balise(s) historique(s) adoptée(s). Annulable avec Cmd + Z.`,
			);
		},
		onCancel: () => {
			// Do nothing
		},
	}).open();
}
