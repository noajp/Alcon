'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, GripVertical } from 'lucide-react';
import type { AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';

const STATUS_COLOR: Record<string, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-amber-500',
  review: 'text-blue-500',
  done: 'text-emerald-500',
  blocked: 'text-rose-500',
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-50 text-red-700',
  high: 'bg-amber-50 text-amber-700',
  medium: 'bg-neutral-100 text-neutral-600',
  low: 'bg-neutral-100 text-neutral-400',
};

const AtomIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
    <circle cx="21.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="4.4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="19.6" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export interface ListSection {
  id: string;
  name: string;
  objects: AlconObjectWithChildren[];
  elements?: ElementWithDetails[];
}

interface ObjectListViewProps {
  sections: ListSection[];
  onSelectObject: (id: string) => void;
  onSelectElement?: (id: string) => void;
  /** When set, renders an "Add Object" footer row inside each section. */
  onAddObject?: () => void;
  /** When set, renders an "Add Element" footer row inside each section. */
  onAddElement?: () => void;
  /** Hide the section header row entirely (still groups items underneath). */
  hideSectionHeaders?: boolean;
}

/**
 * Unified ListView used wherever Objects / Elements are listed at any
 * hierarchy level. The markup is shared so the Domain Object list and the
 * per-Object item list look identical — column header, optional section
 * header (bold name + count + collapse chevron), Object rows (grip + name),
 * optional Element rows (priority/status/due in extra columns), and inline
 * "Add" footers.
 */
export function ObjectListView({
  sections,
  onSelectObject,
  onSelectElement,
  onAddObject,
  onAddElement,
  hideSectionHeaders = false,
}: ObjectListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Show Element-specific columns only when at least one section carries
  // elements (otherwise the wide layout looks empty when listing Objects only).
  const anyElements = sections.some((s) => (s.elements?.length ?? 0) > 0);

  return (
    <div className="overflow-x-auto h-full">
      <table className="w-full min-w-max bg-card border-collapse">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th className="w-8 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card" />
            <th className="w-7 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card" />
            <th className="md:min-w-[280px] px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground bg-card">
              Name
            </th>
            {anyElements && (
              <>
                <th className="hidden md:table-cell w-24 px-3 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card">Priority</th>
                <th className="hidden md:table-cell w-28 px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground bg-card">Status</th>
                <th className="hidden md:table-cell w-32 px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground bg-card">Due date</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sectionIndex) => {
            const isCollapsed = collapsed.has(section.id);
            const sectionElements = section.elements ?? [];
            const itemCount = section.objects.length + sectionElements.length;
            return (
              <Fragment key={section.id}>
                {!hideSectionHeaders && (
                  <tr className="group">
                    <td className={`w-8 px-1 pb-1.5 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`} />
                    <td className={`w-7 px-1 pb-1.5 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`} />
                    <td colSpan={anyElements ? 4 : 1} className={`pb-1.5 pl-1 pr-2 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-3 shrink-0" />
                        <button
                          type="button"
                          onClick={() => toggle(section.id)}
                          className="size-3.5 shrink-0 flex items-center justify-center rounded hover:bg-muted transition-colors"
                          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                        >
                          <ChevronDown
                            size={12}
                            className={`text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(section.id)}
                          className="text-base font-bold text-foreground hover:bg-muted/40 -mx-1 px-1 py-0.5 rounded transition-colors min-w-0 truncate text-left"
                        >
                          {section.name}
                          <span className="ml-1.5 text-muted-foreground/60 font-normal text-sm tabular-nums">
                            {itemCount}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {!isCollapsed &&
                  section.objects.map((obj) => (
                    <tr
                      key={`obj-${obj.id}`}
                      className="group hover:bg-muted/30 transition-colors cursor-pointer tracking-[-0.3px] leading-[1.4]"
                      onClick={() => onSelectObject(obj.id)}
                    >
                      <td className="w-8 px-1 py-2">
                        <div className="flex items-center justify-center text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">
                          <GripVertical size={12} />
                        </div>
                      </td>
                      <td className="w-7 px-1 py-2">
                        <div className="flex items-center justify-center">
                          <div className="w-4 h-4 rounded-[2px] border border-muted-foreground/15 group-hover:border-muted-foreground/30 transition-colors" />
                        </div>
                      </td>
                      <td className="pl-1 pr-2 py-2 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem]">
                          <div className="w-3 shrink-0" />
                          <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/70">
                            <ObjectIcon size={14} />
                          </span>
                          <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">
                            {obj.name}
                          </span>
                        </div>
                      </td>
                      {anyElements && (
                        <>
                          <td className="hidden md:table-cell px-3 py-2 text-muted-foreground/30" />
                          <td className="hidden md:table-cell px-3 py-2 text-muted-foreground/30" />
                          <td className="hidden md:table-cell px-3 py-2 text-muted-foreground/30" />
                        </>
                      )}
                    </tr>
                  ))}
                {!isCollapsed &&
                  sectionElements.map((el) => {
                    const statusColor = STATUS_COLOR[el.status ?? 'todo'] ?? 'text-muted-foreground';
                    const priorityClass = PRIORITY_BADGE[el.priority ?? 'medium'] ?? PRIORITY_BADGE.medium;
                    const isOverdue = el.due_date && new Date(el.due_date) < new Date() && el.status !== 'done';
                    return (
                      <tr
                        key={`el-${el.id}`}
                        className="group hover:bg-muted/30 transition-colors cursor-pointer tracking-[-0.3px] leading-[1.4]"
                        onClick={() => onSelectElement?.(el.id)}
                      >
                        <td className="w-8 px-1 py-2">
                          <div className="flex items-center justify-center text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">
                            <GripVertical size={12} />
                          </div>
                        </td>
                        <td className="w-7 px-1 py-2">
                          <div className="flex items-center justify-center">
                            <div className={`w-4 h-4 rounded-[2px] flex items-center justify-center ${
                              el.status === 'done'
                                ? 'bg-emerald-500'
                                : 'border border-muted-foreground/15 group-hover:border-muted-foreground/30'
                            }`} />
                          </div>
                        </td>
                        <td className="pl-1 pr-2 py-2 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem]">
                            <div className="w-3 shrink-0" />
                            <span className={`size-3.5 shrink-0 flex items-center justify-center ${statusColor}`}>
                              <AtomIcon size={14} />
                            </span>
                            <span className={`text-[13px] truncate flex-1 min-w-0 ${
                              el.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'
                            }`}>
                              {el.title}
                            </span>
                          </div>
                        </td>
                        <td className="hidden md:table-cell px-3 py-2 text-center">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${priorityClass}`}>
                            {(el.priority ?? 'medium')}
                          </span>
                        </td>
                        <td className="hidden md:table-cell px-3 py-2">
                          <span className={`inline-flex items-center gap-1.5 ${statusColor}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                            <span className="text-[11px] capitalize">{(el.status ?? 'todo').replace('_', ' ')}</span>
                          </span>
                        </td>
                        <td className="hidden md:table-cell px-3 py-2">
                          {el.due_date ? (
                            <span className={`text-[11px] ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                              {new Date(el.due_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/40">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                {!isCollapsed && onAddObject && (
                  <tr
                    className="group hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={onAddObject}
                  >
                    <td className="w-8 px-1 py-2" />
                    <td className="w-7 px-1 py-2" />
                    <td colSpan={anyElements ? 4 : 1} className="pl-1 pr-2 py-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem] text-muted-foreground">
                        <div className="w-3 shrink-0" />
                        <span className="size-3.5 shrink-0 flex items-center justify-center">
                          <ObjectIcon size={14} />
                        </span>
                        <span className="text-[13px] group-hover:text-foreground transition-colors">
                          Add Object
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {!isCollapsed && onAddElement && (
                  <tr
                    className="group hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={onAddElement}
                  >
                    <td className="w-8 px-1 py-2" />
                    <td className="w-7 px-1 py-2" />
                    <td colSpan={anyElements ? 4 : 1} className="pl-1 pr-2 py-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem] text-muted-foreground">
                        <div className="w-3 shrink-0" />
                        <span className="size-3.5 shrink-0 flex items-center justify-center">
                          <AtomIcon size={14} />
                        </span>
                        <span className="text-[13px] group-hover:text-foreground transition-colors">
                          Add Element
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
