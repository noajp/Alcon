'use client';

import { useState, useEffect, useMemo } from 'react';
import { Pencil, Check, ChevronRight, CalendarDays, Hash, Users as UsersIcon, Layers } from 'lucide-react';
import type { ExplorerData, ElementWithDetails, AlconObjectWithChildren } from '@/hooks/useSupabase';
import { updateObject } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
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
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftDesc, setDraftDesc] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);

  useEffect(() => {
    setDraftDesc(object.description || '');
    setEditingDesc(false);
  }, [object.id, object.description]);

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

  const parent = useMemo(() => {
    if (!object.parent_object_id) return null;
    const find = (objs: AlconObjectWithChildren[]): AlconObjectWithChildren | null => {
      for (const o of objs) {
        if (o.id === object.parent_object_id) return o;
        if (o.children) {
          const found = find(o.children);
          if (found) return found;
        }
      }
      return null;
    };
    return find(explorerData.objects);
  }, [object.parent_object_id, explorerData.objects]);

  const handleSaveDesc = async () => {
    setSavingDesc(true);
    try {
      await updateObject(object.id, { description: draftDesc });
      onRefresh?.();
      setEditingDesc(false);
    } catch (err) {
      console.error('Failed to save description:', err);
    } finally {
      setSavingDesc(false);
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
            {/* Header */}
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70">
                <ObjectIcon size={18} />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground truncate">
                {object.name}
              </h1>
            </div>

            {/* Description */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Description
                </h2>
                {!editingDesc ? (
                  <button
                    onClick={() => setEditingDesc(true)}
                    className="text-[12px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-muted/40 transition-colors"
                  >
                    <Pencil size={11} />
                    Edit
                  </button>
                ) : (
                  <button
                    onClick={handleSaveDesc}
                    disabled={savingDesc}
                    className="text-[12px] font-medium text-background bg-foreground hover:bg-foreground/90 inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors disabled:opacity-50"
                  >
                    <Check size={11} />
                    {savingDesc ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
              {editingDesc ? (
                <textarea
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                  rows={5}
                  autoFocus
                  className="w-full text-[13px] text-foreground bg-muted/30 border border-border/60 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-foreground/10"
                  placeholder="What is this Object about? Describe the goal, scope, and any important context..."
                />
              ) : (
                <div className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap min-h-[40px]">
                  {object.description || (
                    <span className="text-muted-foreground italic">
                      No description yet. Click Edit to add one.
                    </span>
                  )}
                </div>
              )}
            </section>

            {/* Child Objects */}
            {object.children && object.children.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
            {/* Properties */}
            <section>
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
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
                      <span className="text-[11px] tabular-nums text-foreground/80">
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
                {parent && (
                  <PropertyRow
                    label="Parent"
                    value={
                      <button
                        onClick={() => onNavigate?.({ objectId: parent.id })}
                        className="inline-flex items-center gap-1 text-[12px] text-foreground/80 hover:text-foreground hover:underline truncate"
                      >
                        <ObjectIcon size={11} />
                        <span className="truncate">{parent.name}</span>
                      </button>
                    }
                  />
                )}
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
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex items-center gap-1.5 w-[78px] shrink-0 text-[11px] text-muted-foreground">
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0">{value}</div>
    </div>
  );
}
