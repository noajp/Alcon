'use client';

import { ChevronRight } from 'lucide-react';
import { ObjectIcon } from '@/shell/icons';
import { SegmentedProgress } from '@/alcon/shared/SegmentedProgress';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import type { WidgetHost } from '../types';

/**
 * Child Objects — the Objects nested under this one, with their own
 * completion. Full-bleed table, so the widget frame supplies the border and
 * no padding (`padded: false` in the registry).
 */
export function ObjectChildrenWidget({ host }: { host: WidgetHost }) {
  const children = host.object?.children ?? [];

  useWidgetEmpty(children.length === 0);
  useWidgetMeta(children.length > 0 ? String(children.length) : null);
  if (children.length === 0) return null;

  return (
    <table className="w-full bg-card">
      <tbody>
        {children.map((child, idx) => {
          const total = child.elements?.length || 0;
          const done = child.elements?.filter((e) => e.status === 'done').length || 0;
          const progress = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <tr
              key={child.id}
              onClick={() => host.onNavigate?.({ objectId: child.id })}
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
                {total} elements
              </td>
              <td className="hidden md:table-cell px-3 py-2.5 w-[160px]">
                <div className="flex items-center gap-2">
                  <SegmentedProgress value={progress} className="flex-1" />
                  <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">
                    {progress}%
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
  );
}
