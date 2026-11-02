/**
 * In-memory transient UI store for active tab indices.
 * Keyed by `${filePath}::${tabBlockIndex}`.
 * Preserves user's navigation position across editor views and Reading Mode toggles
 * without writing UI state into the Markdown document.
 */
class TabStateStore {
	private states = new Map<string, number>();

	private makeKey(filePath: string, tabBlockIndex: number): string {
		return `${filePath}::${tabBlockIndex}`;
	}

	public getActiveTabIndex(filePath: string, tabBlockIndex: number): number {
		const key = this.makeKey(filePath, tabBlockIndex);
		return this.states.get(key) ?? 0;
	}

	public setActiveTabIndex(
		filePath: string,
		tabBlockIndex: number,
		subTabIndex: number,
	): void {
		const key = this.makeKey(filePath, tabBlockIndex);
		this.states.set(key, Math.max(0, subTabIndex));
	}

	public clearForFile(filePath: string): void {
		const prefix = `${filePath}::`;
		for (const key of this.states.keys()) {
			if (key.startsWith(prefix)) {
				this.states.delete(key);
			}
		}
	}
}

export const tabStateStore = new TabStateStore();
