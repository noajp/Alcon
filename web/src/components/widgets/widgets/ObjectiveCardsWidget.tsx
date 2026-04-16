'use client';
import { format } from 'date-fns';
import { Calendar, Target } from 'lucide-react';
import { useObjectives } from '@/hooks/useObjectives';
import type { ExplorerData } from '@/hooks/useSupabase';
import { CARD, CARD_HOVER } from '@/shared/designTokens';

const STATUS_STYLE: Record<string, { label: string; pill: string; bar: string }> = {
  on_track: { label: 'On Track', pill: 'bg-emerald-50 text-emerald-600', bar: '#10B981' },
  at_risk:  { label: 'At Risk',  pill: 'bg-amber-50 text-amber-600',     bar: '#F59E0B' },
  behind:   { label: 'Behind',   pill: 'bg-red-50 text-red-600',         bar: '#EF4444' },
  achieved: { label: 'Achieved', pill: 'bg-blue-50 text-blue-600',       bar: '#3B82F6' },
};

export function ObjectiveCardsWidget({ explorerData }: { explorerData: ExplorerData }) {
  const { objectives, loading } = useObjectives();

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>;
  if (objectives.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-border/60 mb-3">
          <Target size={20} className="text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No objectives yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {objectives.map(obj => {
        const style = STATUS_STYLE[obj.status] || STATUS_STYLE.on_track;
        const krs = obj.keyResults || [];
        const avgProgress = krs.length > 0
          ? Math.round(krs.reduce((sum, kr) => {
              const pct = kr.target_value && kr.target_value > 0
                ? Math.min(100, ((kr.current_value || 0) / kr.target_value) * 100)
                : 0;
              return sum + pct;
            }, 0) / krs.length)
          : 0;

        return (
          <div key={obj.id} className={`${CARD} ${CARD_HOVER} p-5`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium ${style.pill}`}>
                  {style.label}
                </span>
              </div>
              {obj.due_date && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                  <Calendar size={11} />
                  {format(new Date(obj.due_date), 'MMM d, yyyy')}
                </span>
              )}
            </div>
            <h4 className="text-[15px] font-medium text-foreground">{obj.title}</h4>
            {obj.description && (
              <p className="text-[13px] text-muted-foreground mt-1">{obj.description}</p>
            )}
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${avgProgress}%`, backgroundColor: style.bar }} />
              </div>
              <span className="text-[12px] font-medium tabular-nums text-foreground w-10 text-right">{avgProgress}%</span>
            </div>

            {krs.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Key Results</div>
                {krs.map(kr => {
                  const pct = kr.target_value && kr.target_value > 0
                    ? Math.min(100, Math.round(((kr.current_value || 0) / kr.target_value) * 100))
                    : 0;
                  const krStyle = STATUS_STYLE[kr.status] || style;
                  return (
                    <div key={kr.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] text-foreground truncate">{kr.title}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                            {kr.current_value || 0} / {kr.target_value || 0}
                          </span>
                        </div>
                        <div className="h-1 mt-1.5 bg-muted/40 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: krStyle.bar }} />
                        </div>
                      </div>
                      <span className="text-[11px] font-medium tabular-nums text-foreground w-9 text-right">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
