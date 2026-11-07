/**
 * Minimal runtime stand-in for the `obsidian` module, used only by unit tests.
 * The real package ships type definitions only, so modules importing runtime
 * values (e.g. `TFile` for `instanceof` checks) need this alias under `npm test`.
 */
export class TAbstractFile {
	path = '';
	name = '';
}

export class TFile extends TAbstractFile {
	basename = '';
	extension = 'md';
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {}

export class App {}
