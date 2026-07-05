'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import {
  createStrategy,
  setStrategyObjects,
  updateStrategy,
  useDomains,
  useObjects,
  useStrategies,
  type AlconObject,
  type StrategyWithObjects,
} from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';

// =============================================================
// StrategyShell — the Materialization layer's "Strategy" app. A single
// header row (title + create button) over the portfolio Strategy list;
// selecting a row pushes into that Strategy's detail page (title,
// description, Object scope — no Properties rail, mirrors ElementDetailView
// minus the side rail).
// =============================================================

export function StrategyShell() {
  const { data: strategies, refetch: refetchStrategies } = useStrategies();

  const [newOpen, setNewOpen] = useState(false);
  const [openStrategyId, setOpenStrategyId] = useState<string | null>(null);
  const openStrategy = useMemo(
    () => strategies.find((s) => s.id === openStrategyId) ?? null,
    [strategies, openStrategyId],
  );

  if (openStrategy) {
    return (
      <StrategyDetailView
        strategy={openStrategy}
        onBack={() => setOpenStrategyId(null)}
        onSaved={() => refetchStrategies()}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavStrategyIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Strategy</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          title="Add Strategy"
          aria-label="Add Strategy"
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {strategies.length === 0 ? (
          <EmptyPrompt onCreate={() => setNewOpen(true)} />
        ) : (
          <StrategyListView
            strategies={strategies}
            onSelectStrategy={(s) => setOpenStrategyId(s.id)}
          />
        )}
      </div>

      {newOpen && (
        <StrategyCreateDialog
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            refetchStrategies();
            setOpenStrategyId(id);
          }}
        />
      )}
    </div>
  );
}

// =============================================================
// Empty / create prompt
// =============================================================
function EmptyPrompt({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
      <NavStrategyIcon size={28} className="text-muted-foreground/50" />
      <p className="text-[13px] text-muted-foreground max-w-md">
        Create a Strategy to group Objects across Domains. Each Strategy gets its own timeline and resource view.
      </p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:opacity-90"
        >
          <Plus size={12} />
          New Strategy
        </button>
      )}
    </div>
  );
}

// =============================================================
// Portfolio Strategy list — the entire Strategy root view. Selecting a
// row pushes into that Strategy's detail page.
// =============================================================
function StrategyListView({
  strategies,
  onSelectStrategy,
}: {
  strategies: StrategyWithObjects[];
  onSelectStrategy: (strategy: StrategyWithObjects) => void;
}) {
  return (
    <div className="h-full overflow-auto px-2 pb-2 pt-2">
      <div className="grid grid-cols-[1fr_120px] gap-3 px-4 py-2 text-[11px] tracking-wide text-muted-foreground/70 font-medium sticky top-0 bg-card z-10">
        <span>Name</span>
        <span className="text-right">Objects</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {strategies.map((s) => (
          <button
            type="button"
            key={s.id}
            onClick={() => onSelectStrategy(s)}
            className="w-full grid grid-cols-[1fr_120px] gap-3 px-4 py-3.5 min-h-[3.25rem] bg-transparent hover:bg-muted/30 border border-border rounded transition-colors items-center text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <NavStrategyIcon size={13} className="text-muted-foreground" />
              <span className="text-[13px] font-semibold text-foreground/95 truncate">{s.name}</span>
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums text-right">
              {s.objectIds.length}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Auto-grow a textarea to fit its content, mirroring the seamless
// title/description textareas on the Object Overview / Element detail tabs.
function useAutoGrowTextarea(ref: { current: HTMLTextAreaElement | null }, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

// Flatten the Object explorer tree + group by Domain — shared between the
// create dialog and the detail view's Object-scope picker.
function useObjectPicker(query: string) {
  const { data: domains } = useDomains();
  const { data: explorer } = useObjects(null);

  const allObjects = useMemo(() => {
    const flat: AlconObject[] = [];
    const walk = (nodes: typeof explorer.objects) => {
      for (const n of nodes) {
        flat.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(explorer.objects);
    return flat;
  }, [explorer.objects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allObjects;
    return allObjects.filter((o) => o.name.toLowerCase().includes(q));
  }, [allObjects, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, { domainName: string; objects: AlconObject[] }>();
    for (const o of filtered) {
      const did = o.domain_id ?? '__none__';
      const dname = domains.find((d) => d.id === did)?.name ?? 'No domain';
      if (!m.has(did)) m.set(did, { domainName: dname, objects: [] });
      m.get(did)!.objects.push(o);
    }
    return Array.from(m.entries());
  }, [filtered, domains]);

  return grouped;
}

function ObjectPickerList({
  grouped,
  selectedIds,
  onToggle,
}: {
  grouped: Array<[string, { domainName: string; objects: AlconObject[] }]>;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {grouped.length === 0 && (
        <div className="px-3 py-3 text-[12px] text-muted-foreground italic">
          No Objects match
        </div>
      )}
      {grouped.map(([did, { domainName, objects }]) => (
        <div key={did}>
          <div className="px-3 py-1 text-[10px] tracking-wide text-muted-foreground bg-muted/20 sticky top-0">
            {domainName}
          </div>
          {objects.map((o) => {
            const checked = selectedIds.has(o.id);
            return (
              <button
                type="button"
                key={o.id}
                onClick={() => onToggle(o.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-accent text-left"
              >
                <span
                  className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                    checked ? 'bg-primary border-primary' : 'border-border'
                  }`}
                >
                  {checked && <span className="text-[9px] text-primary-foreground leading-none">✓</span>}
                </span>
                <ObjectIcon size={11} />
                <span className="flex-1 truncate text-foreground">{o.name}</span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

// =============================================================
// Strategy detail page — full-width title/description/Object-scope
// editor. Mirrors ElementDetailView's header + seamless title/description
// pattern, but with no Properties rail.
// =============================================================
function StrategyDetailView({
  strategy,
  onBack,
  onSaved,
}: {
  strategy: StrategyWithObjects;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(strategy.name);
  const [description, setDescription] = useState(strategy.description ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(strategy.objectIds));
  const [query, setQuery] = useState('');

  // Re-sync local edit state when switching to a different Strategy.
  useEffect(() => {
    setName(strategy.name);
    setDescription(strategy.description ?? '');
    setSelectedIds(new Set(strategy.objectIds));
  }, [strategy.id, strategy.name, strategy.description, strategy.objectIds]);

  const nameRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(nameRef, name);
  useAutoGrowTextarea(descriptionRef, description);

  const grouped = useObjectPicker(query);

  const saveName = async () => {
    const trimmed = name.trim() || strategy.name;
    if (trimmed === strategy.name) return;
    await updateStrategy(strategy.id, { name: trimmed });
    onSaved();
  };

  const saveDescription = async () => {
    const trimmed = description.trim() || null;
    if (trimmed === (strategy.description ?? null)) return;
    await updateStrategy(strategy.id, { description: trimmed });
    onSaved();
  };

  const toggleObject = async (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    await setStrategyObjects(strategy.id, Array.from(next));
    onSaved();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card h-full">
      <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          Strategy
        </button>
        <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
        <span className="px-1.5 py-0.5 text-[12px] font-semibold text-foreground truncate max-w-[240px]">
          {strategy.name}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-8 py-8 space-y-5">
          <div>
            <span className="w-9 h-9 -ml-2 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70 mb-3">
              <NavStrategyIcon size={18} />
            </span>
            <textarea
              ref={nameRef}
              value={name}
              rows={1}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              placeholder="Strategy name"
              className="w-full text-2xl font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 resize-none leading-tight overflow-hidden tracking-normal"
            />
          </div>
          <textarea
            ref={descriptionRef}
            value={description}
            rows={1}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            placeholder="Add description..."
            className="w-full text-[14px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none overflow-hidden"
          />

          <section>
            <h2 className="text-[13px] font-medium text-foreground/90 mb-2">
              Objects <span className="text-muted-foreground/60">({selectedIds.size} selected)</span>
            </h2>
            <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-2">
              <Search size={12} className="text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Objects across Domains…"
                className="flex-1 bg-transparent text-[13px] outline-none"
              />
            </div>
            <div className="rounded-lg border border-border/60 bg-card max-h-[420px] overflow-auto">
              <ObjectPickerList grouped={grouped} selectedIds={selectedIds} onToggle={toggleObject} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Create dialog — the only remaining modal (there's no Strategy yet to
// push into a detail page for).
// =============================================================
function StrategyCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const nameRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(nameRef, name);
  useAutoGrowTextarea(descriptionRef, description);

  const grouped = useObjectPicker(query);

  const toggleObject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const created = await createStrategy(
        { name: name.trim(), description: description.trim() || null },
        Array.from(selectedIds),
      );
      onCreated(created.id);
    } catch (e) {
      console.error('create Strategy failed:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-10 flex items-center px-4 border-b border-border/60 flex-shrink-0">
          <span className="text-[13px] font-semibold text-foreground">New Strategy</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-auto flex-1">
          <div>
            <span className="w-9 h-9 -ml-2 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70 mb-3">
              <NavStrategyIcon size={18} />
            </span>
            <textarea
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              rows={1}
              placeholder="Strategy name"
              className="w-full text-2xl font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 resize-none leading-tight overflow-hidden tracking-normal"
              autoFocus
            />
          </div>
          <section>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={1}
              placeholder="Add description..."
              className="w-full text-[14px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none overflow-hidden"
            />
          </section>

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              Objects <span className="text-muted-foreground/60">({selectedIds.size} selected)</span>
            </label>
            <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-1">
              <Search size={12} className="text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Objects across Domains…"
                className="flex-1 bg-transparent text-[13px] outline-none"
              />
            </div>
            <div className="border border-border/40 rounded-md max-h-72 overflow-auto">
              <ObjectPickerList grouped={grouped} selectedIds={selectedIds} onToggle={toggleObject} />
            </div>
          </div>
        </div>

        <div className="h-12 flex items-center justify-end gap-2 px-4 border-t border-border/60 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
