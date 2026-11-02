import { arrayMove } from '@dnd-kit/sortable';

/** The new order_index of every row in the first section that holds both the
 *  dragged row and the row it was dropped on, numbered from 1 in the
 *  DISPLAYED order — so the saved order matches where the user dropped, not
 *  the raw fetch order. Null when no single section holds both (a drop across
 *  sections is not a reorder). */
export function reorderWithinSections<T extends { id: string }>(
  sections: readonly (readonly T[])[],
  activeId: string,
  overId: string,
): { id: string; order_index: number }[] | null {
  for (const rows of sections) {
    const from = rows.findIndex((x) => x.id === activeId);
    const to = rows.findIndex((x) => x.id === overId);
    if (from === -1 || to === -1) continue;
    return arrayMove([...rows], from, to).map((x, i) => ({ id: x.id, order_index: i + 1 }));
  }
  return null;
}
