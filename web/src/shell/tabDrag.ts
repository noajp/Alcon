import type { Modifier } from '@dnd-kit/core';

/** Keep the dragged tab inside the tab strip, without growing its scroll area. */
export const constrainTabDrag: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0, y: 0 };
  const minX = containerNodeRect.left - draggingNodeRect.left;
  const maxX = Math.max(minX, containerNodeRect.right - draggingNodeRect.right);
  return { ...transform, x: Math.min(maxX, Math.max(minX, transform.x)), y: 0 };
};
