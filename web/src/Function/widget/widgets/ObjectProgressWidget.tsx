'use client';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ExplorerData } from '@/hooks/useSupabase';
import { completionOf, isOpenStatus } from '@/Function/shared/completion';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { isOverdue } from '@/Function/shared/dateUtils';

export function ObjectProgressWidget({ explorerData }: { explorerData: ExplorerData }) {
  const { t } = useI18n();
  if (explorerData.objects.length === 0) return <p className="py-1 text-sm text-muted-foreground">{t('No Objects yet.')}</p>;
  return (
    <div className="space-y-3">
      {explorerData.objects.map(obj => {
        const els = obj.elements ?? [];
        const { done, total, pct } = completionOf(els);
        const inProg = els.filter(e => e.status === 'in_progress').length;
        const overdue = els.filter(e => isOpenStatus(e.status) && isOverdue(e.due_date)).length;
        return (
          <div key={obj.id} className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-medium text-foreground truncate">{obj.name}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {overdue > 0 && <span className="text-[11px] text-[var(--status-danger)]">{t('{n} overdue', { n: overdue })}</span>}
                  <span className="text-[11px] text-muted-foreground tabular-nums">{done} / {total}</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden flex">
                <div className="h-full transition-all duration-500" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%`, backgroundColor: SEMANTIC_COLORS.status.done }} />
                <div className="h-full transition-all duration-500" style={{ width: `${total > 0 ? (inProg / total) * 100 : 0}%`, backgroundColor: SEMANTIC_COLORS.status.in_progress }} />
              </div>
            </div>
            <span className="text-[13px] text-foreground tabular-nums w-10 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
