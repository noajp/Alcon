'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchLabelUsageByDomain,
  mergeDomainLabelColors,
  updateElement,
  useDomains,
} from '@/hooks/useSupabase';
import { notifyDomainsChanged } from '@/alcon/domain/domainsStore';
import { hydrateLabelColors, setLabelColorLocal } from '@/alcon/shared/labelColor';
import {
  diffColorPatch,
  planLabelRemove,
  planLabelRename,
  removeLabelColor,
  renameLabelColor,
  renameTouchedColorKeys,
  restoreColorKeys,
  type LabelColors,
  type LabelUsageRow,
  type LabelWrite,
} from './labelCatalog';

// Settings › Labels reads and writes the two halves of a Domain's label
// catalogue: `domains.label_colors` (name → palette key) and every Element's
// `labels` array. Neither half is a row of its own, so a rename is N Element
// updates plus one jsonb patch, and the page has to be honest about the
// window in between.
//
// Two rules keep the writes safe:
//
//   Every colour write names only the keys it touched (`diffColorPatch` +
//   `mergeDomainLabelColors`, ELE_QLT-032) and applies them as an atomic
//   database-side merge, never a whole-map replace. This page is not the
//   only writer of `label_colors` — an Element's detail panel can pick a
//   colour for an unrelated label at any time — so asserting an opinion
//   about the whole map here would silently undo whatever that other
//   writer just did. One write chain per Domain still queues behind the
//   previous write so this page's own picks land in order, but ordering
//   within this page is no longer what keeps another page's writes alive.
//
//   Rename and delete lock their Domain. They rewrite Elements, and a second
//   rewrite queued behind the first would have to reason about the first's
//   partial failure. Colour picks stay unlocked — they touch only the map.

export interface DomainLabelState {
  id: string;
  name: string;
  colors: LabelColors;
  rows: LabelUsageRow[];
  /** Usage rows arrived. Until then counts are unknown and rename / delete wait. */
  loaded: boolean;
}

const ELEMENT_WRITES_IN_FLIGHT = 4;

function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') return e.message;
  return 'Something went wrong while saving.';
}

interface RunLimitedResult {
  /** Indices into `tasks` whose call threw. */
  failedIndices: number[];
  /** The first error seen, for the caller to surface. */
  firstError: unknown;
}

/**
 * Run every task in `tasks` with at most `limit` in flight, to completion.
 * A task's failure does not stop or cancel the others: with several already
 * in flight when one fails, "stop dispatching new ones" still lets the rest
 * commit their writes — the caller needs to know exactly which ones did and
 * didn't persist, not just "something failed somewhere."
 */
async function runLimited(
  tasks: readonly (() => Promise<unknown>)[],
  limit: number,
): Promise<RunLimitedResult> {
  let next = 0;
  const failedIndices: number[] = [];
  let firstError: unknown;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      try {
        await tasks[index]();
      } catch (e) {
        failedIndices.push(index);
        if (firstError === undefined) firstError = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return { failedIndices, firstError };
}

export function useLabelCatalog() {
  const { data: domains, loading: domainsLoading } = useDomains();
  const [usage, setUsage] = useState<Map<string, LabelUsageRow[]>>(new Map());
  // Colour maps this page has edited. From the first edit on, the page's own
  // copy is the truth for that Domain: useDomains refetches after every save
  // (this page asks it to), and a refetch that landed between two queued picks
  // would otherwise paint the older value back over the newer one.
  const [colorOverrides, setColorOverrides] = useState<Map<string, LabelColors>>(new Map());
  // The same maps, readable from inside a queued write without a stale closure.
  const colorsRef = useRef(new Map<string, LabelColors>());
  const queueRef = useRef(new Map<string, Promise<void>>());
  const [busyDomains, setBusyDomains] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Usage rows for every Domain not fetched yet.
  useEffect(() => {
    const missing = domains.filter((d) => !usage.has(d.id)).map((d) => d.id);
    if (missing.length === 0) return;
    let cancelled = false;
    fetchLabelUsageByDomain(missing)
      .then((result) => {
        if (cancelled) return;
        setUsage((prev) => {
          const next = new Map(prev);
          for (const [id, rows] of result) next.set(id, rows);
          return next;
        });
      })
      .catch((e: unknown) => { if (!cancelled) setError(messageOf(e)); });
    return () => { cancelled = true; };
  }, [domains, usage]);

  // Seed the chip catalogue for every Domain on the page, so a swatch here and
  // a chip on a Domain's Elements show the same colour. Edited Domains already
  // hydrate themselves on each save.
  useEffect(() => {
    for (const d of domains) {
      if (!colorsRef.current.has(d.id)) hydrateLabelColors(d.id, d.label_colors ?? {});
    }
  }, [domains]);

  const merged = useMemo<DomainLabelState[]>(
    () =>
      domains.map((d) => ({
        id: d.id,
        name: d.name,
        colors: colorOverrides.get(d.id) ?? d.label_colors ?? {},
        rows: usage.get(d.id) ?? [],
        loaded: usage.has(d.id),
      })),
    [domains, colorOverrides, usage],
  );

  const fail = (e: unknown) => { if (mountedRef.current) setError(messageOf(e)); };

  const currentColors = (domainId: string): LabelColors =>
    colorsRef.current.get(domainId) ?? domains.find((d) => d.id === domainId)?.label_colors ?? {};

  const putColors = (domainId: string, next: LabelColors) => {
    colorsRef.current.set(domainId, next);
    hydrateLabelColors(domainId, next);
    if (mountedRef.current) setColorOverrides((prev) => new Map(prev).set(domainId, next));
  };

  const putRows = (domainId: string, writes: readonly LabelWrite[]) => {
    const byId = new Map(writes.map((w) => [w.id, w.labels]));
    if (mountedRef.current) {
      setUsage((prev) => {
        const rows = prev.get(domainId);
        if (!rows) return prev;
        return new Map(prev).set(
          domainId,
          rows.map((r) => (byId.has(r.id) ? { ...r, labels: byId.get(r.id)! } : r)),
        );
      });
    }
  };

  const setBusy = (domainId: string, busy: boolean) => {
    if (!mountedRef.current) return;
    setBusyDomains((prev) => {
      const next = new Set(prev);
      if (busy) next.add(domainId); else next.delete(domainId);
      return next;
    });
  };

  const enqueue = (domainId: string, task: () => Promise<void>): Promise<void> => {
    const prev = queueRef.current.get(domainId) ?? Promise.resolve();
    // Every task settles itself (rollback + error), so the chain never rejects;
    // the second handler is belt-and-braces against one that throws anyway.
    const next = prev.then(task, task);
    queueRef.current.set(domainId, next);
    return next;
  };

  /** Write only the keys this operation touched — never the whole map. A
   *  whole-map write here is exactly what let a pick from an Element's
   *  detail panel (a different writer of this same column, ELE_QLT-032) get
   *  silently undone by a save that started from an older snapshot and
   *  knows nothing about that other pick. `diffColorPatch` reads the keys'
   *  current (post-edit) state to say which are sets and which are
   *  removals; `mergeDomainLabelColors` applies that patch atomically in
   *  the database, so there's no read to go stale in the first place. */
  const saveColors = async (domainId: string, touchedKeys: readonly string[]) => {
    const colors = currentColors(domainId);
    await mergeDomainLabelColors(domainId, diffColorPatch(colors, touchedKeys));
    notifyDomainsChanged();
  };

  /** Pick a colour for a label; also how a label is created ahead of any Element using it. */
  const setColor = (domainId: string, name: string, colorKey: string): Promise<void> => {
    const before = currentColors(domainId);
    putColors(domainId, { ...before, [name]: colorKey });
    setLabelColorLocal(domainId, name, colorKey);
    setError(null);
    return enqueue(domainId, async () => {
      try {
        await saveColors(domainId, [name]);
      } catch (e) {
        // Roll back only if no later pick has moved this label on since.
        const now = currentColors(domainId);
        if (now[name] === colorKey) putColors(domainId, restoreColorKeys(now, before, [name]));
        fail(e);
      }
    });
  };

  /**
   * Elements first, colours second. `writes` and `rowsBefore` are the same
   * length in the same order — both are `rows` filtered to the touched ids —
   * so a failed index in one names the same Element in the other.
   *
   * A partial failure (some Element writes commit, others don't — the writes
   * run to completion at up to `ELEMENT_WRITES_IN_FLIGHT` concurrently, so an
   * early failure does not stop the ones already in flight from persisting)
   * must not revert every touched row's local state: the rows that DID
   * persist have to keep showing what the DB now has, or the page and the
   * database silently disagree until a reload. Only the rows whose write
   * actually failed revert. The colour write is skipped whenever any Element
   * write failed — with some Elements still carrying the old name, `from`'s
   * colour is still in use and dropping it would leave those un-renamed rows
   * colourless.
   */
  const rewrite = (
    domainId: string,
    writes: readonly LabelWrite[],
    rowsBefore: readonly LabelWrite[],
    colorsAfter: LabelColors,
    touchedKeys: readonly string[],
  ): Promise<void> => {
    const colorsBefore = currentColors(domainId);
    putRows(domainId, writes);
    putColors(domainId, colorsAfter);
    setError(null);
    setBusy(domainId, true);
    return enqueue(domainId, async () => {
      try {
        const { failedIndices, firstError } = await runLimited(
          writes.map((w) => () => updateElement(w.id, { labels: w.labels })),
          ELEMENT_WRITES_IN_FLIGHT,
        );
        if (failedIndices.length > 0) {
          putRows(domainId, failedIndices.map((i) => rowsBefore[i]));
          throw firstError;
        }
        await saveColors(domainId, touchedKeys);
      } catch (e) {
        const now = currentColors(domainId);
        const untouchedSince = touchedKeys.filter((k) => now[k] === colorsAfter[k]);
        putColors(domainId, restoreColorKeys(now, colorsBefore, untouchedSince));
        fail(e);
      } finally {
        setBusy(domainId, false);
      }
    });
  };

  const rename = (domainId: string, from: string, to: string): Promise<void> => {
    const rows = usage.get(domainId);
    if (!rows || from === to) return Promise.resolve();
    const writes = planLabelRename(rows, from, to);
    const touched = new Set(writes.map((w) => w.id));
    const rowsBefore = rows.filter((r) => touched.has(r.id)).map((r) => ({ id: r.id, labels: r.labels }));
    const before = currentColors(domainId);
    const touchedKeys = renameTouchedColorKeys(before, from, to);
    return rewrite(domainId, writes, rowsBefore, renameLabelColor(before, from, to), touchedKeys);
  };

  const remove = (domainId: string, name: string): Promise<void> => {
    const rows = usage.get(domainId);
    if (!rows) return Promise.resolve();
    const writes = planLabelRemove(rows, name);
    const touched = new Set(writes.map((w) => w.id));
    const rowsBefore = rows.filter((r) => touched.has(r.id)).map((r) => ({ id: r.id, labels: r.labels }));
    return rewrite(domainId, writes, rowsBefore, removeLabelColor(currentColors(domainId), name), [name]);
  };

  const loading = domainsLoading || domains.some((d) => !usage.has(d.id));

  return { domains: merged, loading, error, busyDomains, setColor, rename, remove };
}
