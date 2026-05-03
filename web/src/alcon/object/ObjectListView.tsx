'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, GripVertical } from 'lucide-react';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';

export interface ListSection {
  id: string;
  name: string;
  objects: AlconObjectWithChildren[];
  // future: elements: ElementWithDetails[];
}

interface ObjectListViewProps {
  sections: ListSection[];
  onSelectObject: (id: string) => void;
  /** When set, renders an "Add Object" footer row inside each section. */
  onAddObject?: () => void;
  /** Hide the section header row entirely (still groups items underneath). */
  hideSectionHeaders?: boolean;
}

/**
 * Unified ListView used for both the Domain Object list and (eventually) the
 * per-Object section list. The markup mirrors ObjectDetailView's section
 * table so the same visual shows at every hierarchy level — column header,
 * section header (bold name + count + collapse chevron), Object rows with
 * gripped drag-handle gutter + placeholder checkbox + Object icon, and an
 * inline "Add" footer per section.
 */
export function ObjectListView({
  sections,
  onSelectObject,
  onAddObject,
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
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sectionIndex) => {
            const isCollapsed = collapsed.has(section.id);
            return (
              <Fragment key={section.id}>
                {!hideSectionHeaders && (
                  <tr className="group">
                    <td className={`w-8 px-1 pb-1.5 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`} />
                    <td className={`w-7 px-1 pb-1.5 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`} />
                    <td className={`pb-1.5 pl-1 pr-2 ${sectionIndex === 0 ? 'pt-1' : 'pt-4'}`}>
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
                            {section.objects.length}
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
                    </tr>
                  ))}
                {!isCollapsed && onAddObject && (
                  <tr
                    className="group hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={onAddObject}
                  >
                    <td className="w-8 px-1 py-2" />
                    <td className="w-7 px-1 py-2" />
                    <td className="pl-1 pr-2 py-2 min-w-0">
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
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
