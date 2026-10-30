import type { EditorView } from '@codemirror/view';
import type InkwellPlugin from '../main';

export type SlashMenuSection = 'basic' | 'advanced' | 'media';

export interface SlashExecutionContext {
	plugin: InkwellPlugin;
	view: EditorView;
	from: number; // Start position of / in document
	to: number;   // Position of cursor (end of /query)
	indent: string;
}

export interface SlashMenuItem {
	id: string;
	label: string;
	section: SlashMenuSection;
	icon: string;
	syntax?: string;
	keywords: string[];
	execute: (ctx: SlashExecutionContext) => void | Promise<void>;
}

export interface SlashTriggerInfo {
	from: number; // Position of /
	to: number;   // Position of cursor (end of query)
	query: string;
	indent: string;
}

