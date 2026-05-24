'use client';

import { Play, Loader2, RotateCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentRun } from '@/hooks/useSupabase';

interface StartAgentButtonProps {
  run: AgentRun | null;
  isActive: boolean;
  starting: boolean;
  onStart: () => void;
  onCancel?: () => void;
  /** Icon-only, sized for kanban cards. */
  compact?: boolean;
  disabled?: boolean;
}

// The "▶︎ 開始" control. Presentational — the parent owns the run state via
// useAgentRun and binds onStart / onCancel. Used both on kanban cards
// (compact) and the Element detail header (full).
export function StartAgentButton({
  run,
  isActive,
  starting,
  onStart,
  onCancel,
  compact = false,
  disabled = false,
}: StartAgentButtonProps) {
  const busy = starting || isActive;
  const hasRun = !!run;
  const status = run?.status;
  const isDone = status === 'awaiting_review' || status === 'completed';

  // ── Compact (kanban card) ──────────────────────────────────────────────
  if (compact) {
    if (busy) {
      return (
        <span
          className="inline-flex items-center justify-center h-6 w-6 rounded-md text-primary"
          title="エージェント実行中"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      );
    }
    const Icon = status === 'failed' ? AlertCircle : isDone ? CheckCircle2 : Play;
    const tone =
      status === 'failed'
        ? 'text-rose-500 hover:bg-rose-500/10'
        : isDone
          ? 'text-emerald-500 hover:bg-emerald-500/10'
          : 'text-muted-foreground hover:text-primary hover:bg-accent';
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
        className={cn(
          'inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors disabled:opacity-40',
          tone,
        )}
        title={hasRun ? 'エージェントを再実行' : 'エージェントで開始'}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    );
  }

  // ── Full (rail / panel) ────────────────────────────────────────────────
  if (busy) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary/10 text-primary text-[12px] font-medium">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {starting ? '起動中…' : '実行中…'}
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-1.5 rounded-md text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            停止
          </button>
        )}
      </div>
    );
  }

  const Icon = hasRun ? RotateCw : Play;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onStart}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
      title={hasRun ? 'エージェントを再実行' : 'エージェントで実行を開始'}
    >
      <Icon className="h-3.5 w-3.5" />
      {hasRun ? '再実行' : '開始'}
    </button>
  );
}
