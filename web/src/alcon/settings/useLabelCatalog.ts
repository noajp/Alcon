'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchLabelUsageByDomain,
  replaceDomainLabelColors,
  updateElement,
  useDomains,
} from '@/hooks/useSupabase';
import { notifyDomainsChanged } from '@/alcon/domain/domainsStore';
import { hydrateLabelColors, setLabelColorLocal } from '@/alcon/shared/labelColor';
import {
  planLabelRemove,
  planLabelRename,
  removeLabelColor,
  renameLabelColor,
  restoreColorKeys,
  type LabelColors,
  type LabelUsageRow,
  type LabelWrite,
} from './labelCatalog';

// Settings › Labels reads and writes the two halves of a Domain's label
// catalogue: `domains.label_colors` (name → palette key) and every Element's
// `labels` array. Neither half is a row of its own, so a rename is N Element
// updates plus one jsonb overwrite, and the page has to be honest about the
// window in between.
//
// Two rules keep the writes safe:
//
//   One write chain per Domain. `label_colors` is replaced whole, so two saves
//   in flight would race on arrival order — the later pick could be undone by
//   the earlier request landing second. Every write to a Domain queues behind
//   the previous one, and the colour map it writes is read at execution time,
//   not enqueue time, so a chain of quick picks ends on the last pick.
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

/** Run `tasks` with at most `limit` in flight; the first failure stops the rest and is rethrown. */
async function runLimited(tasks: readonly (() => Promise<unknown>)[], limit: number): Promise<void> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && next < tasks.length) {
      const index = next++;
      try {
        await tasks[index]();
      } catch (e) {
        if (!failed) {
          failed = true;
          failure = e;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  if (failed) throw failure;
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

  /** Write the Domain's colour map as it stands now — after every pick queued so far. */
  const saveColors = async (domainId: string) => {
    const colors = currentColors(domainId);
    await replaceDomainLabelColors(domainId, colors);
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
        await saveColors(domainId);
      } catch (e) {
        // Roll back only if no later pick has moved this label on since.
        const now = currentColors(domainId);
        if (now[name] === colorKey) putColors(domainId, restoreColorKeys(now, before, [name]));
        fail(e);
      }
    });
  };

  /**
   * Elements first, colours second. If the colour write fails after the
   * Elements are rewritten, the old key survives as an unused entry — a visible
   * leftover, not lost data. The other order could leave Elements carrying a
   * name with no colour while a name nothing carries has one.
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
        await runLimited(
          writes.map((w) => () => updateElement(w.id, { labels: w.labels })),
          ELEMENT_WRITES_IN_FLIGHT,
        );
        await saveColors(domainId);
      } catch (e) {
        putRows(domainId, rowsBefore);
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
    return rewrite(domainId, writes, rowsBefore, renameLabelColor(currentColors(domainId), from, to), [from, to]);
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
