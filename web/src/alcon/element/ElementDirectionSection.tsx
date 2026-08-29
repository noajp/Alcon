'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import { normalizeDirection, type ElementDirection } from '@/types/database';

// Direction — "how this Element should be driven" as a first-class block:
// approach (prose), acceptance criteria (declarative statements — NOT a
// checklist, that's the Subelements' job) and the next step. Persisted as
// the elements.direction jsonb; every save merges a single-field diff into
// the latest known direction so two fields edited in quick succession don't
// clobber each other.
//
// The parent mounts this with key={element.id} so switching Elements resets
// all local editing state; in-session prop updates after our own saves are
// already reflected in baseRef.

const EMPTY_DIRECTION: ElementDirection = { approach: null, acceptance: [], next: null };

// Stable React keys for acceptance rows — index keys would recycle focus /
// values when a row is removed mid-list.
let rowSeq = 0;
const newRowKey = () => `acc-${rowSeq++}`;

interface AcceptanceRow {
  key: string;
  text: string;
}

function hasContent(dir: ElementDirection): boolean {
  return !!dir.approach || dir.acceptance.length > 0 || !!dir.next;
}

interface ElementDirectionSectionProps {
  element: ElementWithDetails;
  /** Called after a change actually persisted — parent logs activity + refreshes. */
  onSaved: () => void;
}

export function ElementDirectionSection({ element, onSaved }: ElementDirectionSectionProps) {
  // Seed all local state once from the prop; afterwards this component owns
  // its editing session (see the key note above).
  const [initial] = useState<ElementDirection>(() => normalizeDirection(element.direction) ?? EMPTY_DIRECTION);
  const [expanded, setExpanded] = useState(() => hasContent(initial));
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const [approach, setApproach] = useState(initial.approach ?? '');
  const [rows, setRows] = useState<AcceptanceRow[]>(() =>
    initial.acceptance.map((text) => ({ key: newRowKey(), text }))
  );
  const [next, setNext] = useState(initial.next ?? '');

  // Latest direction we know to be persisted (or in flight). Single-field
  // saves merge into this instead of re-reading the prop, so a save fired
  // before the previous refresh lands doesn't resurrect stale values.
  const baseRef = useRef<ElementDirection>(initial);

  const persist = useCallback(async (patch: Partial<ElementDirection>) => {
    const prev = baseRef.current;
    const merged: ElementDirection = { ...prev, ...patch };
    const unchanged =
      merged.approach === prev.approach &&
      merged.next === prev.next &&
      merged.acceptance.length === prev.acceptance.length &&
      merged.acceptance.every((line, i) => line === prev.acceptance[i]);
    if (unchanged) return;
    baseRef.current = merged;
    try {
      // Fully cleared → store null, so the empty state comes back next visit.
      await updateElement(element.id, { direction: hasContent(merged) ? merged : null });
      onSaved();
    } catch (e) {
      console.error('Failed to save direction', e);
    }
  }, [element.id, onSaved]);

  // Auto-grow the approach textarea (same pattern as the title field).
  const approachRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = approachRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [approach, expanded]);

  // Acceptance rows keep their inputs in a key→node map so Enter can focus
  // the row it just inserted (and Backspace the one before the row it
  // removed). The pending key is picked up right after the next render.
  const rowRefs = useRef(new Map<string, HTMLInputElement>());
  const focusKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = focusKeyRef.current;
    if (!key) return;
    focusKeyRef.current = null;
    const el = rowRefs.current.get(key);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  const saveAcceptance = useCallback((nextRows: AcceptanceRow[]) => {
    void persist({ acceptance: nextRows.map((r) => r.text.trim()).filter(Boolean) });
  }, [persist]);

  const handleApproachBlur = () => {
    void persist({ approach: approach.trim() ? approach : null });
  };

  const handleNextBlur = () => {
    void persist({ next: next.trim() ? next : null });
  };

  const setRowText = (index: number, text: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, text } : r)));
  };

  // Enter on a filled row commits it and opens a fresh row right below, so
  // criteria can be rattled off back-to-back. Enter on an empty row just
  // blurs it — which deletes it (see handleRowBlur) and ends the streak.
  const handleRowEnter = (index: number) => {
    const row = rows[index];
    if (!row.text.trim()) {
      rowRefs.current.get(row.key)?.blur();
      return;
    }
    const fresh: AcceptanceRow = { key: newRowKey(), text: '' };
    const nextRows = [...rows.slice(0, index + 1), fresh, ...rows.slice(index + 1)];
    setRows(nextRows);
    focusKeyRef.current = fresh.key;
    saveAcceptance(nextRows);
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRowEnter(index);
    } else if (e.key === 'Backspace' && rows[index].text === '') {
      // Backspace on an emptied row removes it and puts the caret at the
      // end of the previous one — mirrors every checklist editor worth using.
      e.preventDefault();
      const prevRow = rows[index - 1];
      const nextRows = rows.filter((_, i) => i !== index);
      setRows(nextRows);
      if (prevRow) focusKeyRef.current = prevRow.key;
      saveAcceptance(nextRows);
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  };

  const handleRowBlur = (index: number) => {
    const row = rows[index];
    if (!row.text.trim()) {
      const nextRows = rows.filter((_, i) => i !== index);
      setRows(nextRows);
      saveAcceptance(nextRows);
    } else {
      saveAcceptance(rows);
    }
  };

  const addRow = () => {
    const fresh: AcceptanceRow = { key: newRowKey(), text: '' };
    setRows((prev) => [...prev, fresh]);
    focusKeyRef.current = fresh.key;
  };

  // Empty state — same language as the Sub-elements block's "+ Add
  // sub-element" affordance. Once expanded it stays expanded for the
  // session, even if the user clears everything back out.
  if (!expanded) {
    return (
      <div className="px-1">
        <button
          onClick={() => { setExpanded(true); setManuallyExpanded(true); }}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground py-1 transition-colors"
        >
          <Plus size={13} /> Set direction
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
        <span>Direction</span>
      </div>

      {/* Approach — free prose; newlines allowed, saved on blur. */}
      <div>
        <div className="text-[11px] font-medium text-muted-foreground/70">Approach</div>
        <textarea
          ref={approachRef}
          value={approach}
          rows={1}
          autoFocus={manuallyExpanded}
          onChange={(e) => setApproach(e.target.value)}
          onBlur={handleApproachBlur}
          placeholder="Add approach..."
          className="w-full text-[13px] text-foreground bg-transparent border-none focus:outline-none focus:ring-0 resize-none overflow-hidden py-0.5"
        />
      </div>

      {/* Acceptance criteria — declarative statements, one per row. */}
      <div>
        <div className="text-[11px] font-medium text-muted-foreground/70">Acceptance criteria</div>
        <div>
          {rows.map((row, index) => (
            <div key={row.key} className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0" />
              <input
                ref={(el) => {
                  if (el) rowRefs.current.set(row.key, el);
                  else rowRefs.current.delete(row.key);
                }}
                value={row.text}
                onChange={(e) => setRowText(index, e.target.value)}
                onKeyDown={(e) => handleRowKeyDown(e, index)}
                onBlur={() => handleRowBlur(index)}
                placeholder="Done when..."
                className="flex-1 min-w-0 text-[13px] text-foreground bg-transparent border-none focus:outline-none focus:ring-0 py-0.5"
              />
            </div>
          ))}
        </div>
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70 hover:text-foreground py-0.5 transition-colors"
        >
          <Plus size={12} /> Add criterion
        </button>
      </div>

      {/* Next step — a single concrete move, saved on blur / Enter. */}
      <div>
        <div className="text-[11px] font-medium text-muted-foreground/70">Next step</div>
        <input
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onBlur={handleNextBlur}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
          placeholder="Add next step..."
          className="w-full text-[13px] text-foreground bg-transparent border-none focus:outline-none focus:ring-0 py-0.5"
        />
      </div>
    </div>
  );
}
