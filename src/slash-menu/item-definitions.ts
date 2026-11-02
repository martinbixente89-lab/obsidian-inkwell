import type { SlashMenuSection } from './types';

export interface SlashItemDefinition {
	id: string;
	label: string;
	section: SlashMenuSection;
	icon: string;
	syntax?: string;
	keywords: string[];
}

export interface InsertTemplate {
	text: string;
	cursorOffset: number;
}

export const SLASH_ITEM_DEFINITIONS: SlashItemDefinition[] = [
	// --- Blocs de base ---
	{
		id: 'text',
		label: 'Texte',
		section: 'basic',
		icon: 'type',
		keywords: ['texte', 'paragraphe', 'normal', 'p', 'plain'],
	},
	{
		id: 'h1',
		label: 'Titre 1',
		section: 'basic',
		icon: 'heading-1',
		syntax: '#',
		keywords: ['titre 1', 'h1', 'heading 1', 'grand titre', '#'],
	},
	{
		id: 'h2',
		label: 'Titre 2',
		section: 'basic',
		icon: 'heading-2',
		syntax: '##',
		keywords: ['titre 2', 'h2', 'heading 2', '##'],
	},
	{
		id: 'h3',
		label: 'Titre 3',
		section: 'basic',
		icon: 'heading-3',
		syntax: '###',
		keywords: ['titre 3', 'h3', 'heading 3', '###'],
	},
	{
		id: 'h4',
		label: 'Titre 4',
		section: 'basic',
		icon: 'heading-4',
		syntax: '####',
		keywords: ['titre 4', 'h4', 'heading 4', '####'],
	},
	{
		id: 'h5',
		label: 'Titre 5',
		section: 'basic',
		icon: 'heading-5',
		syntax: '#####',
		keywords: ['titre 5', 'h5', 'heading 5', '#####'],
	},
	{
		id: 'h6',
		label: 'Titre 6',
		section: 'basic',
		icon: 'heading-6',
		syntax: '######',
		keywords: ['titre 6', 'h6', 'heading 6', '######'],
	},
	{
		id: 'toggle-h1',
		label: 'Titre dépliant 1',
		section: 'basic',
		icon: 'heading-1',
		syntax: '▸#',
		keywords: [
			'titre depliant 1',
			'titre repliable 1',
			'toggle h1',
			'h1 depliant',
			'accordeon titre 1',
		],
	},
	{
		id: 'toggle-h2',
		label: 'Titre dépliant 2',
		section: 'basic',
		icon: 'heading-2',
		syntax: '▸##',
		keywords: [
			'titre depliant 2',
			'titre repliable 2',
			'toggle h2',
			'h2 depliant',
			'accordeon titre 2',
		],
	},
	{
		id: 'toggle-h3',
		label: 'Titre dépliant 3',
		section: 'basic',
		icon: 'heading-3',
		syntax: '▸###',
		keywords: [
			'titre depliant 3',
			'titre repliable 3',
			'toggle h3',
			'h3 depliant',
			'accordeon titre 3',
		],
	},
	{
		id: 'bullet-list',
		label: 'Liste à puces',
		section: 'basic',
		icon: 'list',
		syntax: '-',
		keywords: ['liste a puces', 'puces', 'bullet', 'ul', '-'],
	},
	{
		id: 'numbered-list',
		label: 'Liste numérotée',
		section: 'basic',
		icon: 'list-ordered',
		syntax: '1.',
		keywords: ['liste numerotee', 'chiffre', 'ordre', 'ol', '1.'],
	},
	{
		id: 'task-list',
		label: 'Liste de tâches',
		section: 'basic',
		icon: 'check-square',
		syntax: '[]',
		keywords: ['liste de taches', 'tache', 'todo', 'check', 'case', '[]'],
	},
	{
		id: 'collapsible-callout',
		label: 'Menu dépliant',
		section: 'basic',
		icon: 'chevron-right',
		syntax: '>',
		keywords: ['menu depliant', 'depliant', 'toggle', 'repliable', 'volet', 'accordeon', '>'],
	},
	{
		id: 'page',
		label: 'Page',
		section: 'basic',
		icon: 'file',
		keywords: ['page', 'nouvelle page', 'note', 'creer une page', 'document'],
	},
	{
		id: 'callout',
		label: 'Encadré',
		section: 'basic',
		icon: 'message-square',
		keywords: ['encadre', 'callout', 'note', 'boite', 'alerte', 'bloc'],
	},
	{
		id: 'quote',
		label: 'Citation',
		section: 'basic',
		icon: 'quote',
		syntax: '"',
		keywords: ['citation', 'quote', 'blockquote', 'guillemet', '>'],
	},
	{
		id: 'table',
		label: 'Tableau',
		section: 'basic',
		icon: 'table',
		keywords: ['tableau', 'table', 'grille', 'colonnes', 'lignes'],
	},
	{
		id: 'divider',
		label: 'Séparateur',
		section: 'basic',
		icon: 'minus',
		syntax: '---',
		keywords: ['separateur', 'ligne', 'hr', 'divider', 'regle', '---'],
	},
	{
		id: 'link-note',
		label: 'Lien vers une page',
		section: 'basic',
		icon: 'file-text',
		keywords: ['lien vers une page', 'lien vers une note', 'lien', 'note', 'page', 'interne', 'wiki'],
	},

	// --- Blocs avancés ---
	{
		id: 'cols-2',
		label: '2 colonnes',
		section: 'advanced',
		icon: 'columns',
		syntax: '2 col',
		keywords: ['2 colonnes', 'deux colonnes', 'colonnes', 'disposition', 'layout', 'columns'],
	},
	{
		id: 'cols-3',
		label: '3 colonnes',
		section: 'advanced',
		icon: 'columns',
		syntax: '3 col',
		keywords: ['3 colonnes', 'trois colonnes', 'colonnes', 'disposition', 'layout', 'columns'],
	},
	{
		id: 'cols-4',
		label: '4 colonnes',
		section: 'advanced',
		icon: 'columns',
		syntax: '4 col',
		keywords: ['4 colonnes', 'quatre colonnes', 'colonnes', 'disposition', 'layout', 'columns'],
	},
	{
		id: 'cols-5',
		label: '5 colonnes',
		section: 'advanced',
		icon: 'columns',
		syntax: '5 col',
		keywords: ['5 colonnes', 'cinq colonnes', 'colonnes', 'disposition', 'layout', 'columns'],
	},
	{
		id: 'tabs',
		label: 'Onglets',
		section: 'advanced',
		icon: 'panels-top-left',
		syntax: 'tabs',
		keywords: [
			'onglets',
			'onglet',
			'tabs',
			'tab',
			'volet',
			'volets',
			'panneau',
			'classeur',
		],
	},
	{
		id: 'math-block',
		label: 'Équation — bloc entier',
		section: 'advanced',
		icon: 'sigma',
		syntax: '$$',
		keywords: ['equation', 'math', 'formule', 'latex', 'bloc entier', '$$'],
	},
	{
		id: 'mermaid-block',
		label: 'Code — Mermaid',
		section: 'advanced',
		icon: 'git-fork',
		keywords: ['mermaid', 'diagramme', 'schema', 'graphique', 'flowchart', 'code'],
	},
	{
		id: 'toc',
		label: 'Table des matières',
		section: 'advanced',
		icon: 'list-tree',
		syntax: 'auto',
		keywords: [
			'table des matieres',
			'sommaire',
			'toc',
			'titres',
			'plan',
			'dynamique',
		],
	},
	{
		id: 'toc-static',
		label: 'Table des matières (statique)',
		section: 'advanced',
		icon: 'list',
		keywords: [
			'table des matieres statique',
			'sommaire statique',
			'toc statique',
			'liens titres',
		],
	},

	// --- Média ---
	{
		id: 'media-image',
		label: 'Image',
		section: 'media',
		icon: 'image',
		keywords: ['image', 'photo', 'picture', 'png', 'jpg', 'illustration'],
	},
	{
		id: 'media-video',
		label: 'Vidéo',
		section: 'media',
		icon: 'video',
		keywords: ['video', 'film', 'mp4', 'mov', 'media'],
	},
	{
		id: 'media-audio',
		label: 'Audio',
		section: 'media',
		icon: 'headphones',
		keywords: ['audio', 'son', 'musique', 'mp3', 'voix', 'enregistrement'],
	},
	{
		id: 'code-block',
		label: 'Code',
		section: 'media',
		icon: 'code',
		syntax: '...',
		keywords: ['code', 'bloc de code', 'programmation', 'script', '```', '...'],
	},
	{
		id: 'media-file',
		label: 'Fichier',
		section: 'media',
		icon: 'paperclip',
		keywords: ['fichier', 'piece jointe', 'document', 'pdf', 'attachment'],
	},
];

/**
 * Returns static Markdown template and cursor offset for non-interactive items.
 */
export function getStaticInsertTemplate(id: string): InsertTemplate | null {
	switch (id) {
		case 'text':
			return { text: '', cursorOffset: 0 };
		case 'h1':
			return { text: '# ', cursorOffset: 2 };
		case 'h2':
			return { text: '## ', cursorOffset: 3 };
		case 'h3':
			return { text: '### ', cursorOffset: 4 };
		case 'h4':
			return { text: '#### ', cursorOffset: 5 };
		case 'h5':
			return { text: '##### ', cursorOffset: 6 };
		case 'h6':
			return { text: '###### ', cursorOffset: 7 };
		case 'bullet-list':
			return { text: '- ', cursorOffset: 2 };
		case 'numbered-list':
			return { text: '1. ', cursorOffset: 3 };
		case 'task-list':
			return { text: '- [ ] ', cursorOffset: 6 };
		case 'collapsible-callout':
			return {
				text: '> [!NOTE]+ Menu dépliant\n> ',
				cursorOffset: 27,
			};
		case 'callout':
			return { text: '> [!NOTE]\n> ', cursorOffset: 12 };
		case 'quote':
			return { text: '> ', cursorOffset: 2 };
		case 'table': {
			const header = '| Colonne 1 | Colonne 2 |\n';
			const sep = '| --- | --- |\n';
			const data = '|  |  |';
			return { text: header + sep + data, cursorOffset: header.length + sep.length + 2 };
		}
		case 'tabs': {
			const template =
				'> [!tabs]\n>\n> > [!tab|Onglet 1]\n> > \n>\n> > [!tab|Onglet 2]\n> > \n';
			const cursorOffset = '> [!tabs]\n>\n> > [!tab|Onglet 1]\n> > '.length;
			return { text: template, cursorOffset };
		}
		case 'divider':
			return { text: '---\n', cursorOffset: 4 };
		case 'code-block':
			return { text: '```\n\n```', cursorOffset: 4 };
		case 'math-block':
			return { text: '$$\n\n$$\n', cursorOffset: 3 };
		case 'mermaid-block':
			return {
				text: '```mermaid\ngraph TD\n    A[Début] --> B[Fin]\n```\n',
				cursorOffset: 25,
			};
		default:
			return null;
	}
}
