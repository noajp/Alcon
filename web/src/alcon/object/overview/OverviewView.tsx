'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronRight, CalendarDays, Hash, Users as UsersIcon, Layers, Plus } from 'lucide-react';
import type { ExplorerData, ElementWithDetails, AlconObjectWithChildren, CustomColumnWithValues } from '@/hooks/useSupabase';
import { updateObject, useDomains, createCustomColumn, fetchDomainCustomColumnsWithValues, setCustomColumnObjectValue } from '@/hooks/useSupabase';
import { supabase } from '@/lib/supabase';
import type { Domain, CustomColumnType, Json } from '@/types/database';
import { ObjectIcon } from '@/shell/icons';
import { CustomColumnCell, AddColumnModal } from '@/alcon/tag';
import { WidgetGrid } from '@/alcon/widget/WidgetGrid';
import { renderWidget, BARE_WIDGET_TYPES } from '@/alcon/widget/renderWidget';
import type { WidgetConfig } from '@/alcon/widget/types';

interface OverviewViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
  explorerData: ExplorerData;
  onRefresh?: () => void;
  onNavigate?: (nav: { objectId?: string }) => void;
}

const SIDE_DEFAULTS: WidgetConfig[] = [
  { id: 'ov-side-team', type: 'team-roster', span: 'full' },
  { id: 'ov-side-activity', type: 'recent-activity', span: 'full' },
];

const MAIN_DEFAULTS: WidgetConfig[] = [
  { id: 'ov-main-kpi', type: 'kpi-cards', span: 'full' },
  { id: 'ov-main-milestones', type: 'milestones', span: 'full' },
];

/**
 * Object Overview tab — Asana-style project overview.
 * 2-column layout: editable description + child Objects in main, properties + widgets on the side.
 */
export function OverviewView({ elements, object, explorerData, onRefresh, onNavigate }: OverviewViewProps) {
  // Object name + description as always-editable seamless textareas, mirroring
  // ElementDetailView's inline header (transparent, no border/ring, auto-grow,
  // save on blur — no Edit button or view/edit toggle).
  const [title, setTitle] = useState(object.name);
  const [description, setDescription] = useState(object.description || '');
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-grow both textareas so long names / descriptions wrap into view
  // instead of scrolling inside a fixed box. Re-measured on value change.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  // Re-sync from props when the Object switches or is saved elsewhere.
  useEffect(() => {
    setTitle(object.name);
    setDescription(object.description || '');
  }, [object.id, object.name, object.description]);

  const stats = useMemo(() => {
    const total = elements.length;
    const done = elements.filter((e) => e.status === 'done').length;
    const inProgress = elements.filter((e) => e.status === 'in_progress').length;
    const overdue = elements.filter((e) => {
      if (!e.due_date || e.status === 'done') return false;
      return new Date(e.due_date) < new Date();
    }).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, inProgress, overdue, progress };
  }, [elements]);

  // Domain(s) this Object is homed under — primary domain_id + object_domains
  // multi-homing junction, resolved to names via the membership-scoped Domain
  // list. Surfaced as its own island so the Domain context is visible here.
  const { data: domains } = useDomains();
  const [domainIds, setDomainIds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = new Set<string>();
      if (object.domain_id) ids.add(object.domain_id);
      const { data: links } = await supabase
        .from('object_domains')
        .select('domain_id')
        .eq('object_id', object.id);
      for (const l of links ?? []) if (l.domain_id) ids.add(l.domain_id as string);
      if (!cancelled) setDomainIds(Array.from(ids));
    })();
    return () => { cancelled = true; };
  }, [object.id, object.domain_id]);
  const memberDomains = useMemo<Domain[]>(() => {
    const byId = new Map(domains.map((d) => [d.id, d]));
    return domainIds.map((id) => byId.get(id)).filter((d): d is Domain => Boolean(d));
  }, [domains, domainIds]);

  // Custom properties (domain-scoped Tags) for this Object — the same columns
  // the Object list shows, surfaced here as editable property rows plus an
  // inline "Add property" that opens the column-type menu.
  const [customCols, setCustomCols] = useState<CustomColumnWithValues[]>([]);
  const [showAddProp, setShowAddProp] = useState(false);
  const reloadCustomCols = useCallback(async () => {
    if (!object.domain_id) { setCustomCols([]); return; }
    try {
      setCustomCols(await fetchDomainCustomColumnsWithValues(object.domain_id));
    } catch (e) {
      console.error('Failed to load Object properties', e);
    }
  }, [object.domain_id]);
  useEffect(() => { void reloadCustomCols(); }, [reloadCustomCols]);
  const handleCustomChange = useCallback(async (columnId: string, value: Json) => {
    try {
      await setCustomColumnObjectValue(columnId, object.id, value);
      await reloadCustomCols();
    } catch (e) {
      console.error('Failed to save property', e);
    }
  }, [object.id, reloadCustomCols]);
  const handleAddProperty = useCallback(async (name: string, type: CustomColumnType) => {
    if (!object.domain_id) return;
    try {
      await createCustomColumn({ domain_id: object.domain_id, name, column_type: type, options: {}, is_visible: true });
      await reloadCustomCols();
    } catch (e) {
      console.error('Failed to add property', e);
    }
    setShowAddProp(false);
  }, [object.domain_id, reloadCustomCols]);


  const handleTitleSave = async () => {
    const next = title.trim();
    if (next && next !== object.name) {
      try {
        await updateObject(object.id, { name: next });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save name:', err);
      }
    }
  };

  const handleDescriptionSave = async () => {
    if (description !== (object.description || '')) {
      try {
        await updateObject(object.id, { description: description || null });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save description:', err);
      }
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-8">
          {/* ───────────── Main column ───────────── */}
          <div className="space-y-6 min-w-0">
            {/* Header — Object icon stacked above the name; the name sits flush
                with the column's left edge so it lines up with the Description
                below (the icon no longer indents the title). */}
            <div>
              <span className="w-9 h-9 -ml-2 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70 mb-3">
                <ObjectIcon size={18} />
              </span>
              <textarea
                ref={titleRef}
                value={title}
                rows={1}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget as HTMLTextAreaElement).blur();
                  }
                }}
                className="w-full text-2xl text-foreground bg-transparent border-none focus:outline-none focus:ring-0 resize-none leading-tight overflow-hidden tracking-normal"
                style={{ fontWeight: 600 }}
                placeholder="Object name"
              />
            </div>

            {/* Description — always-editable seamless textarea, same
                implementation as ElementDetailView (no heading, no Edit button;
                transparent field, auto-grow, saves on blur). */}
            <section>
              <textarea
                ref={descRef}
                value={description}
                rows={1}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionSave}
                placeholder="Add description..."
                className="w-full text-[14px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none overflow-hidden"
              />
            </section>

            {/* Child Objects */}
            {object.children && object.children.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-[13px] font-medium text-foreground/90">
                    Child Objects
                  </h2>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {object.children.length}
                  </span>
                </div>
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <table className="w-full bg-card">
                    <tbody>
                      {object.children.map((child, idx) => {
                        const childTotal = child.elements?.length || 0;
                        const childDone = child.elements?.filter((e) => e.status === 'done').length || 0;
                        const childProgress = childTotal > 0 ? Math.round((childDone / childTotal) * 100) : 0;
                        return (
                          <tr
                            key={child.id}
                            onClick={() => onNavigate?.({ objectId: child.id })}
                            className={`group cursor-pointer transition-colors hover:bg-muted/30 ${
                              idx > 0 ? 'border-t border-border/60' : ''
                            }`}
                          >
                            <td className="pl-3 pr-2 py-2.5 w-6 text-[11px] text-muted-foreground/60 tabular-nums text-center">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 pr-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-muted-foreground"><ObjectIcon size={14} /></span>
                                <span className="text-[13px] font-medium text-foreground truncate">
                                  {child.name}
                                </span>
                                {child.children && child.children.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground shrink-0">
                                    {child.children.length} sub
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="hidden md:table-cell px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {childTotal} elements
                            </td>
                            <td className="hidden md:table-cell px-3 py-2.5 w-[160px]">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-foreground/70 rounded-full transition-all"
                                    style={{ width: `${childProgress}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">
                                  {childProgress}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 w-6">
                              <ChevronRight
                                size={13}
                                className="text-muted-foreground/40 group-hover:text-foreground transition-colors"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Main widgets (KPI + Milestones) */}
            <section>
              <WidgetGrid
                scope="overview"
                layoutKey={`overview-main:${object.id}`}
                defaults={MAIN_DEFAULTS}
                renderWidget={(w) =>
                  renderWidget(w, { elements, explorerData, object, onRefresh })
                }
                bareTypes={BARE_WIDGET_TYPES}
              />
            </section>
          </div>

          {/* ───────────── Side column ───────────── */}
          <aside className="space-y-6 min-w-0">
            {/* Domain — which Domain(s) this Object belongs to (primary FK +
                object_domains multi-homing). Mirrors the Element → Objects
                island so D/O/E membership is visible in both directions. */}
            <section>
              <h2 className="text-[13px] font-medium text-muted-foreground mb-3">
                Domain
              </h2>
              {memberDomains.length === 0 ? (
                <span className="text-[12px] text-muted-foreground italic">No Domain</span>
              ) : (
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  {memberDomains.map((d, idx) => (
                    <div
                      key={d.id}
                      className={`flex items-center gap-2.5 px-3 py-2.5 ${idx > 0 ? 'border-t border-border/60' : ''}`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: d.color ?? 'var(--muted-foreground)' }}
                      />
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {d.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Properties */}
            <section>
              <h2 className="text-[13px] font-medium text-muted-foreground mb-3">
                Properties
              </h2>
              <div className="space-y-2.5">
                <PropertyRow
                  label="Progress"
                  value={
                    <div className="flex items-center gap-2 w-full">
                      <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-foreground/70 rounded-full transition-all"
                          style={{ width: `${stats.progress}%` }}
                        />
                      </div>
                      <span className="text-[12px] tabular-nums text-foreground/80">
                        {stats.progress}%
                      </span>
                    </div>
                  }
                />
                <PropertyRow
                  label="Elements"
                  icon={<Layers size={12} />}
                  value={
                    <span className="text-[12px] text-foreground/80 tabular-nums">
                      {stats.done}/{stats.total} done
                    </span>
                  }
                />
                {stats.inProgress > 0 && (
                  <PropertyRow
                    label="Active"
                    icon={<UsersIcon size={12} />}
                    value={
                      <span className="text-[12px] text-amber-600 tabular-nums">
                        {stats.inProgress} in progress
                      </span>
                    }
                  />
                )}
                {stats.overdue > 0 && (
                  <PropertyRow
                    label="Overdue"
                    value={
                      <span className="text-[12px] text-rose-600 tabular-nums">
                        {stats.overdue}
                      </span>
                    }
                  />
                )}
                {/* Parent Object row is gone — Object nesting was dropped. */}
                <PropertyRow
                  label="ID"
                  icon={<Hash size={12} />}
                  value={
                    <span
                      className="font-mono text-[11px] text-muted-foreground/80 cursor-pointer hover:text-foreground transition-colors truncate"
                      title="Click to copy"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          object.display_id ?? `obj-${object.id.slice(0, 8)}`,
                        )
                      }
                    >
                      {object.display_id ?? `obj-${object.id.slice(0, 8)}`}
                    </span>
                  }
                />
                <PropertyRow
                  label="Created"
                  icon={<CalendarDays size={12} />}
                  value={
                    <span className="text-[12px] text-foreground/80">
                      {formatDate(object.created_at)}
                    </span>
                  }
                />
                <PropertyRow
                  label="Updated"
                  icon={<CalendarDays size={12} />}
                  value={
                    <span className="text-[12px] text-foreground/80">
                      {formatDate(object.updated_at)}
                    </span>
                  }
                />

                {/* Custom properties (domain Tags) — editable value + inline add. */}
                {customCols.map((col) => (
                  <PropertyRow
                    key={col.id}
                    label={col.name}
                    value={
                      <CustomColumnCell
                        column={col}
                        elementId={object.id}
                        value={col.values?.[object.id]?.value ?? null}
                        onChange={(v) => handleCustomChange(col.id, v)}
                      />
                    }
                  />
                ))}
                {object.domain_id && (
                  <button
                    type="button"
                    onClick={() => setShowAddProp(true)}
                    className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground py-1 transition-colors"
                  >
                    <Plus size={12} /> Add property
                  </button>
                )}
              </div>
            </section>

            {/* Side widgets (Members + Activity) */}
            <section>
              <WidgetGrid
                scope="overview"
                layoutKey={`overview-side:${object.id}`}
                defaults={SIDE_DEFAULTS}
                renderWidget={(w) =>
                  renderWidget(w, { elements, explorerData, object, onRefresh })
                }
                bareTypes={BARE_WIDGET_TYPES}
              />
            </section>
          </aside>
        </div>
      </div>

      {showAddProp && (
        <AddColumnModal onClose={() => setShowAddProp(false)} onAdd={handleAddProperty} />
      )}
    </div>
  );
}

function PropertyRow({
  label,
  icon,
  value,
}: {
  label: string;
  icon?: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0 py-0.5">
      <div className="flex items-center gap-1.5 w-[82px] shrink-0 text-[12px] font-normal text-muted-foreground">
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0">{value}</div>
    </div>
  );
}
