'use client';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ExplorerData } from '@/hooks/useSupabase';
import { completionOf } from '@/alcon/shared/completion';

export function ObjectProgressWidget({ explorerData }: { explorerData: ExplorerData }) {
  if (explorerData.objects.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No objects</div>;
  return (
    <div className="space-y-3">
      {explorerData.objects.map(obj => {
        const els = obj.elements ?? [];
        const { done, total, pct } = completionOf(els);
        const inProg = els.filter(e => e.status === 'in_progress').length;
        const overdue = els.filter(e => e.due_date && new Date(e.due_date) < new Date() && e.status !== 'done').length;
        return (
          <div key={obj.id} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-foreground truncate">{obj.name}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {overdue > 0 && <span className="text-[10px] text-red-500 font-medium">{overdue} overdue</span>}
                  <span className="text-xs text-muted-foreground tabular-nums">{done}/{total}</span>
                </div>
              </div>
              <div className="h-2 w-full bg-muted/40 rounded-full overflow-hidden flex">
                <div className="h-full transition-all duration-500" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%`, backgroundColor: SEMANTIC_COLORS.status.done }} />
                <div className="h-full transition-all duration-500" style={{ width: `${total > 0 ? (inProg / total) * 100 : 0}%`, backgroundColor: SEMANTIC_COLORS.status.in_progress }} />
              </div>
            </div>
            <span className="text-sm font-medium text-foreground tabular-nums w-10 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
