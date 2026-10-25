'use client';

import { useState } from 'react';
import { useEscapeLayer } from '@/Function/shared/keyboard';

// Shared multi-select state for element lists (the checkbox + Shift-range +
// BulkActionBar pattern). Extracted so every list host — Object detail's
// All Elements, the Domain Elements view, My Elements — gets identical
// selection behaviour instead of re-implementing it (and drifting).
//
// The range fill follows the DISPLAYED order: ListTable passes the
// flattened section order as `orderedIds`, so Shift-click selects the rows
// the user actually sees (grouped / sorted), not the raw fetch order.
export function useElementSelection() {
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  const handleRowSelect = (
    elementId: string,
    mode: 'single' | 'range' | 'replace',
    orderedIds?: string[],
  ) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (mode === 'single') {
        if (next.has(elementId)) next.delete(elementId);
        else next.add(elementId);
        setSelectionAnchor(elementId);
        return next;
      }
      if (mode === 'range') {
        const ids = orderedIds ?? [];
        const anchor = selectionAnchor ?? (next.size > 0 ? Array.from(next).pop() ?? null : null);
        const aIdx = anchor ? ids.indexOf(anchor) : -1;
        const bIdx = ids.indexOf(elementId);
        if (aIdx === -1 || bIdx === -1) {
          next.add(elementId);
          if (!anchor) setSelectionAnchor(elementId);
          return next;
        }
        const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
        return next;
      }
      // 'replace' — plain click while something is already selected.
      setSelectionAnchor(elementId);
      return new Set<string>([elementId]);
    });
  };

  const clearSelection = () => {
    setSelectedRowIds(new Set());
    setSelectionAnchor(null);
  };

  /** Keep only these selected — what a bulk action could not do, left in hand. */
  const selectOnly = (ids: readonly string[]) => {
    setSelectedRowIds(new Set(ids));
    setSelectionAnchor(null);
  };

  // Escape clears the whole selection — the standard "get me out" gesture,
  // alongside the bulk bar's ✕ and toggling individual checkboxes. A layer,
  // so the bulk bar's own pickers take the key first while they are open.
  useEscapeLayer(selectedRowIds.size > 0, () => {
    setSelectedRowIds(new Set());
    setSelectionAnchor(null);
  });

  return { selectedRowIds, handleRowSelect, clearSelection, selectOnly };
}
