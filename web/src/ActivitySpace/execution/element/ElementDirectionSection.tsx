'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus } from 'lucide-react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import { normalizeDirection, type AcceptanceLine, type ElementDirection } from '@/types/database';
import { mergeAcceptance, sameAcceptance } from './directionMerge';

// Direction — "how this Element should be driven" as a first-class block:
// approach (prose), acceptance criteria (declarative statements — NOT a
// checklist, that's the Subelements' job) and the next step. Persisted as
// the elements.direction jsonb; every save merges a single-field diff into
// the latest known direction so two fields edited in quick succession don't
// clobber each other.
//
// Writes are queued (one in flight at a time) and debounced while a streak
// of Enters is still landing, then flushed immediately on blur. A failed
// write leaves the known server value alone, so a dropped save is not
// mistaken for a persisted one by whatever is typed next.
//
// The parent mounts this with key={element.id} so switching Elements resets
// all local editing state.
//
// A direction written somewhere else (another tab, another person) while the
// same Element stays open is not lost: every save merges its one changed
// field onto the newest direction the server has sent, not onto the copy this
// tab loaded, so the other writer's fields survive. A field this tab merely
// focused and left says nothing, since the only value it could contribute is
// the one it loaded.
//
// The criteria are one field holding a list, and each line carries an id, so
// a save sends the rows this tab changed rather than the list it is holding:
// see directionMerge.ts. Two people editing different criteria both keep
// their work; two people editing the same one is settled in favour of
// whoever saves last.
//
// One limit remains, from the inputs not re-seeding while open: what this tab
// shows for a field it is not editing lags until the Element is reopened.

const EMPTY_DIRECTION: ElementDirection = { approach: null, acceptance: [], next: null };
const WRITE_DEBOUNCE_MS = 400;

// A row's key is the id it is stored under, so React, the focus map and the
// merge all identify a criterion the same way. A row typed here and not yet
// saved gets its id now rather than at write time — the merge has to be able
// to name it either way.
const newLineId = () => (globalThis.crypto?.randomUUID?.() ?? `acc-${Date.now()}-${Math.random().toString(36).slice(2)}`);

interface AcceptanceRow {
  key: string;
  text: string;
}

function hasContent(dir: ElementDirection): boolean {
  return !!dir.approach || dir.acceptance.length > 0 || !!dir.next;
}

/** Stable identity for a direction, so "have we sent this before" is a set
 *  lookup rather than a scan. */
function directionKey(d: ElementDirection): string {
  return JSON.stringify([d.approach, d.acceptance, d.next]);
}

/** The criteria a row list actually carries: trimmed, blanks dropped, each
 *  still under the id it is stored by. */
function acceptanceOf(rows: AcceptanceRow[]): AcceptanceLine[] {
  return rows.filter((r) => r.text.trim()).map((r) => ({ id: r.key, text: r.text.trim() }));
}

function directionEqual(a: ElementDirection, b: ElementDirection): boolean {
  return a.approach === b.approach && a.next === b.next && sameAcceptance(a.acceptance, b.acceptance);
}

interface ElementDirectionSectionProps {
  element: ElementWithDetails;
  /** Called after a change actually persisted — parent logs `detail` as the activity entry and refreshes. */
  onSaved: (detail: string) => void;
}

export function ElementDirectionSection({ element, onSaved }: ElementDirectionSectionProps) {
  // Seed all local state once from the prop; afterwards this component owns
  // its editing session (see the key note above).
  const [initial] = useState<ElementDirection>(() => normalizeDirection(element.direction) ?? EMPTY_DIRECTION);
  const [expanded, setExpanded] = useState(() => hasContent(initial));
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const [approach, setApproach] = useState(initial.approach ?? '');
  const [rows, setRows] = useState<AcceptanceRow[]>(() =>
    initial.acceptance.map((line) => ({ key: line.id, text: line.text }))
  );
  const [next, setNext] = useState(initial.next ?? '');

  // The newest direction the server is known to hold, whoever wrote it: the
  // value a save merges onto. Keeping this rather than the copy the tab
  // loaded is what stops one writer from overwriting another's fields.
  const serverRef = useRef<ElementDirection>(initial);
  // The criteria as this tab last had them — its own view, not the merged
  // list that went to the server. The rows on screen are never re-seeded from
  // elsewhere, so this is the only thing the current rows can honestly be
  // diffed against: measure against the merged list and a row somebody else
  // added, which this tab never showed, reads as a row this tab deleted.
  const loadedAcceptanceRef = useRef<AcceptanceLine[]>(initial.acceptance);
  // Every value this tab has sent. A refetch can arrive out of order, and one
  // carrying an earlier write of ours is behind rather than news — taking it
  // would hand the next save a base that undoes the later write. A value we
  // never wrote is always news, including one that restores what we replaced.
  const writtenRef = useRef(new Set<string>());
  // The value currently being written. It is no longer pending and not yet
  // the server's, and an edit made in that window has to merge onto it or it
  // writes the field back to what it was before the request left.
  const inflightRef = useRef<ElementDirection | null>(null);
  // One write in flight at a time — a Promise chain instead of a bare
  // fire-and-forget, so a slow request can't land after a faster later one
  // and resurrect stale field values.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef<{ value: ElementDirection; detail: string; acceptanceView?: AcceptanceLine[] } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What a save merges onto: the newest the server is known to hold, then the
  // write on its way there, then anything queued behind it.
  const currentBase = useCallback((): ElementDirection => ({
    ...serverRef.current,
    ...inflightRef.current,
    ...pendingRef.current?.value,
  }), []);

  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    writeChainRef.current = writeChainRef.current.then(async () => {
      inflightRef.current = pending.value;
      try {
        writtenRef.current.add(directionKey(pending.value));
        await updateElement(element.id, { direction: hasContent(pending.value) ? pending.value : null });
        // The server now holds this. Said here rather than waiting for the
        // refetch, so an edit made in the meantime merges onto the write that
        // just landed instead of onto the value it replaced.
        serverRef.current = pending.value;
        if (pending.acceptanceView) loadedAcceptanceRef.current = pending.acceptanceView;
        onSaved(pending.detail);
      } catch (e) {
        console.error('Failed to save direction', e);
        // The write never landed, so the server still holds what it held.
        // The value is put back in the queue rather than dropped: nothing
        // retries on its own, but the next edit carries it along instead of
        // silently leaving this tab's text unsaved.
        writtenRef.current.delete(directionKey(pending.value));
        if (!pendingRef.current) pendingRef.current = pending;
      } finally {
        inflightRef.current = null;
      }
    });
  }, [element.id, onSaved]);

  // patch merges into the latest known (optimistic) direction. `immediate`
  // flushes right away (field blur — editing this field just ended);
  // otherwise the write is debounced so a streak of Enters produces one
  // write instead of one per keystroke.
  const persist = useCallback((patch: Partial<ElementDirection>, detail: string, opts?: { immediate?: boolean; acceptanceView?: AcceptanceLine[] }) => {
    // The base is the newest thing the server has said, with whatever this
    // tab has already queued on top of it. Merging onto the loaded copy
    // instead is what used to erase a field another writer had just changed.
    const prev = currentBase();
    const merged: ElementDirection = { ...prev, ...patch };
    if (directionEqual(merged, prev)) return;
    pendingRef.current = { value: merged, detail, acceptanceView: opts?.acceptanceView ?? pendingRef.current?.acceptanceView };
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (opts?.immediate) {
      flush();
    } else {
      debounceTimerRef.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
    }
  }, [flush, currentBase]);

  // The detail query is invalidated when the row changes (Function/sync), so a
  // direction written elsewhere arrives here as a prop. Recording it costs
  // nothing and is what the next merge reads.
  useEffect(() => {
    const incoming = normalizeDirection(element.direction) ?? EMPTY_DIRECTION;
    if (directionEqual(incoming, serverRef.current)) return;
    // An earlier write of ours, arriving late. Behind, not news.
    if (writtenRef.current.has(directionKey(incoming))) return;
    serverRef.current = incoming;
    // `loadedAcceptanceRef` deliberately does not move here. It is what this
    // tab last agreed to, and the diff a save sends is measured against it —
    // adopt someone else's list into it and their new rows read as rows this
    // tab deleted, and their edits read as rows this tab reverted.
  }, [element.direction]);

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

  // Escape-to-cancel snapshots — taken on focus, restored on Escape, for
  // every field. Without this Escape fell through to blur, which saves
  // whatever is currently typed — the opposite of "cancel".
  //
  // Restoring via setState (e.g. setApproach(snapshot)) is not enough on its
  // own: blur() fires its handler synchronously, before React has applied
  // that setState, so the handler's closure still sees the just-typed value
  // and persists it — the DB ends up with the text Escape was supposed to
  // discard. The *CancelRef values carry the authoritative value straight
  // into the blur handler instead of relying on state having caught up.
  const approachSnapshotRef = useRef(approach);
  const approachCancelRef = useRef<string | null>(null);
  const nextSnapshotRef = useRef(next);
  const nextCancelRef = useRef<string | null>(null);
  const rowSnapshotsRef = useRef(new Map<string, string>());
  const rowCancelRef = useRef<{ key: string; text: string } | null>(null);

  const saveAcceptance = useCallback((nextRows: AcceptanceRow[], opts?: { immediate?: boolean }) => {
    // What this tab changed, applied to the list the server holds now — so a
    // criterion somebody else added while this one was being edited survives,
    // and one deleted here still goes.
    const mine = acceptanceOf(nextRows);
    const merged = mergeAcceptance(loadedAcceptanceRef.current, mine, currentBase().acceptance);
    // Nothing to write means the server already holds this. The base still has
    // to move, or the next diff is measured against rows this tab has dropped.
    if (sameAcceptance(merged, currentBase().acceptance)) loadedAcceptanceRef.current = mine;
    persist(
      { acceptance: merged },
      'Updated acceptance criteria',
      { ...opts, acceptanceView: mine },
    );
  }, [persist, currentBase]);

  const handleApproachBlur = () => {
    const cancelled = approachCancelRef.current;
    approachCancelRef.current = null;
    const value = cancelled !== null ? cancelled : approach;
    // Focused and left without typing: there is nothing of this tab's to
    // save, and writing the value it loaded would overwrite whatever someone
    // else put there in the meantime.
    if (value === approachSnapshotRef.current) return;
    persist({ approach: value.trim() || null }, 'Updated approach', { immediate: true });
  };

  const handleNextBlur = () => {
    const cancelled = nextCancelRef.current;
    nextCancelRef.current = null;
    const value = cancelled !== null ? cancelled : next;
    if (value === nextSnapshotRef.current) return;
    persist({ next: value.trim() || null }, 'Updated next step', { immediate: true });
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
    const fresh: AcceptanceRow = { key: newLineId(), text: '' };
    const nextRows = [...rows.slice(0, index + 1), fresh, ...rows.slice(index + 1)];
    setRows(nextRows);
    focusKeyRef.current = fresh.key;
    saveAcceptance(nextRows); // debounced — a fast streak of Enters coalesces into one write
  };

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    const row = rows[index];
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRowEnter(index);
    } else if (e.key === 'Backspace' && row.text === '') {
      // Backspace on an emptied row removes it and puts the caret at the
      // end of the previous one — mirrors every checklist editor worth using.
      e.preventDefault();
      const prevRow = rows[index - 1];
      const nextRows = rows.filter((_, i) => i !== index);
      setRows(nextRows);
      if (prevRow) focusKeyRef.current = prevRow.key;
      saveAcceptance(nextRows);
    } else if (e.key === 'Escape') {
      // Consumed here: the cancel is this row's one level, not the page's.
      e.preventDefault();
      const snapshot = rowSnapshotsRef.current.get(row.key);
      if (snapshot !== undefined) {
        rowCancelRef.current = { key: row.key, text: snapshot };
        setRowText(index, snapshot);
      }
      e.currentTarget.blur();
    }
  };

  const handleRowFocus = (row: AcceptanceRow) => {
    rowSnapshotsRef.current.set(row.key, row.text);
  };

  const handleRowBlur = (index: number) => {
    const row = rows[index];
    const snapshot = rowSnapshotsRef.current.get(row.key);
    rowSnapshotsRef.current.delete(row.key);
    const cancel = rowCancelRef.current;
    rowCancelRef.current = null;
    // Escape fired setRowText(snapshot) right before this handler, but blur()
    // runs synchronously — React hasn't applied that update yet, so `row`
    // here can still be the just-typed text. Use the cancelled value
    // directly rather than trusting `row.text` caught up in time.
    const text = cancel && cancel.key === row.key ? cancel.text : row.text;
    // Left exactly as it was found. Writing the list back would send this
    // tab's copy over a criterion somebody else added since — the same reason
    // a bare blur on approach or next now says nothing. An untouched row that
    // was blank was never a criterion at all, so it just goes.
    if (snapshot !== undefined && text === snapshot) {
      if (text.trim()) return;
      setRows(rows.filter((_, i) => i !== index));
      return;
    }
    if (!text.trim()) {
      const nextRows = rows.filter((_, i) => i !== index);
      setRows(nextRows);
      saveAcceptance(nextRows, { immediate: true });
    } else {
      const settledRows = rows.map((r, i) => (i === index ? { ...r, text } : r));
      saveAcceptance(settledRows, { immediate: true });
    }
  };

  const addRow = () => {
    const fresh: AcceptanceRow = { key: newLineId(), text: '' };
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
          onFocus={() => { approachSnapshotRef.current = approach; }}
          onBlur={handleApproachBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              approachCancelRef.current = approachSnapshotRef.current;
              setApproach(approachSnapshotRef.current);
              e.currentTarget.blur();
            }
          }}
          placeholder="Add approach..."
          className="w-full text-[13px] text-foreground bg-transparent border-none focus:outline-none resize-none overflow-hidden py-0.5"
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
                onFocus={() => handleRowFocus(row)}
                onKeyDown={(e) => handleRowKeyDown(e, index)}
                onBlur={() => handleRowBlur(index)}
                placeholder="Done when..."
                className="flex-1 min-w-0 text-[13px] text-foreground bg-transparent border-none focus:outline-none py-0.5"
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
          onFocus={() => { nextSnapshotRef.current = next; }}
          onBlur={handleNextBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              nextCancelRef.current = nextSnapshotRef.current;
              setNext(nextSnapshotRef.current);
              e.currentTarget.blur();
            }
          }}
          placeholder="Add next step..."
          className="w-full text-[13px] text-foreground bg-transparent border-none focus:outline-none py-0.5"
        />
      </div>
    </div>
  );
}
