export interface Rect {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
}

export interface PositionResult {
	top: number;
	left: number;
	placement: 'top' | 'bottom';
}

/**
 * Computes optimal position for the floating toolbar.
 * - Preferred placement: above the selection rect.
 * - Flips below if not enough vertical room above.
 * - Centers horizontally with selection.
 * - Clamps strictly within boundary rect (with margins) to prevent viewport/editor overflow.
 */
export function calculateToolbarPosition(
	selectionRect: Rect,
	toolbarWidth: number,
	toolbarHeight: number,
	boundaryRect: Rect,
	offset = 8,
	margin = 10,
): PositionResult {
	const minLeft = boundaryRect.left + margin;
	const maxLeft = Math.max(minLeft, boundaryRect.right - toolbarWidth - margin);

	// Center horizontally over selection
	const targetCenterX = selectionRect.left + selectionRect.width / 2;
	let left = targetCenterX - toolbarWidth / 2;
	left = Math.max(minLeft, Math.min(left, maxLeft));

	// Try placing above selection
	const spaceAbove = selectionRect.top - boundaryRect.top;
	const neededHeight = toolbarHeight + offset + margin;

	let top: number;
	let placement: 'top' | 'bottom';

	if (spaceAbove >= neededHeight) {
		top = selectionRect.top - toolbarHeight - offset;
		placement = 'top';
	} else {
		// Not enough space above: place below selection
		top = selectionRect.bottom + offset;
		placement = 'bottom';
	}

	// Clamp vertically within boundaries
	const minTop = boundaryRect.top + margin;
	const maxTop = Math.max(minTop, boundaryRect.bottom - toolbarHeight - margin);
	top = Math.max(minTop, Math.min(top, maxTop));

	return { top, left, placement };
}

/**
 * Computes position for an attached color/highlight popover.
 * Aligns with toolbar and clamps within boundaries.
 */
export function calculatePopoverPosition(
	anchorRect: Rect,
	popoverWidth: number,
	popoverHeight: number,
	boundaryRect: Rect,
	preferredPlacement: 'top' | 'bottom' = 'bottom',
	offset = 4,
	margin = 10,
): PositionResult {
	const minLeft = boundaryRect.left + margin;
	const maxLeft = Math.max(minLeft, boundaryRect.right - popoverWidth - margin);

	// Center horizontally with anchor
	const targetCenterX = anchorRect.left + anchorRect.width / 2;
	let left = targetCenterX - popoverWidth / 2;
	left = Math.max(minLeft, Math.min(left, maxLeft));

	let top: number;
	let placement: 'top' | 'bottom' = preferredPlacement;

	if (preferredPlacement === 'bottom') {
		const spaceBelow = boundaryRect.bottom - anchorRect.bottom;
		if (spaceBelow >= popoverHeight + offset + margin) {
			top = anchorRect.bottom + offset;
			placement = 'bottom';
		} else {
			top = anchorRect.top - popoverHeight - offset;
			placement = 'top';
		}
	} else {
		const spaceAbove = anchorRect.top - boundaryRect.top;
		if (spaceAbove >= popoverHeight + offset + margin) {
			top = anchorRect.top - popoverHeight - offset;
			placement = 'top';
		} else {
			top = anchorRect.bottom + offset;
			placement = 'bottom';
		}
	}

	const minTop = boundaryRect.top + margin;
	const maxTop = Math.max(minTop, boundaryRect.bottom - popoverHeight - margin);
	top = Math.max(minTop, Math.min(top, maxTop));

	return { top, left, placement };
}
