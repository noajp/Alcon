'use client';
import { useObjectives } from '@/hooks/useObjectives';

export function OkrSummaryWidget() {
  const { objectives, loading } = useObjectives();
  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>;
  if (objectives.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No objectives yet</div>;

  const allKRs = objectives.flatMap(o => o.keyResults);
  const avgProgress = allKRs.length > 0
    ? Math.round(allKRs.reduce((sum, kr) => {
        const pct = kr.target_value && kr.target_value > 0
          ? Math.min(100, ((kr.current_value || 0) / kr.target_value) * 100)
          : 0;
        return sum + pct;
      }, 0) / allKRs.length)
    : 0;

  const onTrack = objectives.filter(o => o.status === 'on_track' || o.status === 'achieved').length;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="text-center">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Avg. Progress</div>
        <div className="text-2xl font-semibold tabular-nums mt-1 text-emerald-600">{avgProgress}%</div>
      </div>
      <div className="text-center">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">On Track</div>
        <div className="text-2xl font-semibold tabular-nums mt-1 text-foreground">{onTrack} / {objectives.length}</div>
      </div>
      <div className="text-center">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Key Results</div>
        <div className="text-2xl font-semibold tabular-nums mt-1 text-foreground">{allKRs.length}</div>
      </div>
    </div>
  );
}
