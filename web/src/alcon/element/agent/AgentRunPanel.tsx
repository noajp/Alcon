'use client';

import {
  ListChecks,
  Sparkles,
  Zap,
  CheckCircle2,
  MessageSquare,
  ArrowRight,
  Flag,
  AlertCircle,
  Loader2,
  Bot,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentRun, AgentRunStep } from '@/hooks/useSupabase';
import type { AgentRunStatus, AgentRunStepType } from '@/types/database';
import { StartAgentButton } from './StartAgentButton';

interface AgentRunPanelProps {
  run: AgentRun | null;
  steps: AgentRunStep[];
  starting: boolean;
  isActive: boolean;
  loading?: boolean;
  onStart: () => void;
  onCancel: () => void;
}

const STATUS_META: Record<AgentRunStatus, { label: string; tone: string; dot: string }> = {
  queued:          { label: 'キュー待ち',   tone: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  running:         { label: '実行中',       tone: 'text-blue-500',         dot: 'bg-blue-500' },
  awaiting_review: { label: 'レビュー待ち', tone: 'text-amber-500',        dot: 'bg-amber-500' },
  completed:       { label: '完了',         tone: 'text-emerald-500',      dot: 'bg-emerald-500' },
  failed:          { label: '失敗',         tone: 'text-rose-500',         dot: 'bg-rose-500' },
  cancelled:       { label: '停止',         tone: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};

const STEP_ICON: Record<AgentRunStepType, LucideIcon> = {
  plan: ListChecks,
  thought: Sparkles,
  action: Zap,
  subelement: CheckCircle2,
  comment: MessageSquare,
  status: ArrowRight,
  result: Flag,
  error: AlertCircle,
};

const STEP_TONE: Record<AgentRunStepType, string> = {
  plan: 'text-foreground',
  thought: 'text-muted-foreground',
  action: 'text-blue-500',
  subelement: 'text-emerald-500',
  comment: 'text-purple-400',
  status: 'text-amber-500',
  result: 'text-emerald-500',
  error: 'text-rose-500',
};

// The live "Workpad" — streams the agent's plan, progress, sub-element
// check-offs and final deliverable. Presentational: the parent owns the run
// state via useAgentRun and polls while a run is active.
export function AgentRunPanel({
  run,
  steps,
  starting,
  isActive,
  loading = false,
  onStart,
  onCancel,
}: AgentRunPanelProps) {
  // Never run — invite the user to start.
  if (!run && !loading) {
    return (
      <div className="space-y-2.5 py-1">
        <p className="text-[11.5px] text-muted-foreground leading-snug">
          このタスクをエージェントに自動実行させます。計画 → 実行 → 成果物投稿まで進め、最後はレビュー待ちで停止します。
        </p>
        <StartAgentButton run={null} isActive={false} starting={starting} onStart={onStart} />
      </div>
    );
  }

  if (loading && !run) {
    return <div className="py-3 text-center text-[11.5px] text-muted-foreground">読み込み中…</div>;
  }

  const meta = run ? STATUS_META[run.status] : null;

  return (
    <div className="space-y-2.5">
      {/* Status row */}
      {run && meta && (
        <div className="flex items-center justify-between gap-2">
          <span className={cn('inline-flex items-center gap-1.5 text-[11.5px] font-medium', meta.tone)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot, isActive && 'animate-pulse')} />
            {meta.label}
            {run.step_count > 0 && (
              <span className="text-muted-foreground font-normal">· {run.step_count} ステップ</span>
            )}
          </span>
          {isActive ? (
            <button
              type="button"
              onClick={onCancel}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              停止
            </button>
          ) : (
            <StartAgentButton run={run} isActive={false} starting={starting} onStart={onStart} compact />
          )}
        </div>
      )}

      {/* Steps timeline */}
      {steps.length > 0 && (
        <div className="relative pl-4">
          <div className="absolute left-[10px] top-1 bottom-1 w-px bg-border" />
          <div className="space-y-2">
            {steps.map((step) => {
              const Icon = STEP_ICON[step.type] ?? Sparkles;
              const tone = STEP_TONE[step.type] ?? 'text-muted-foreground';
              return (
                <div key={step.id} className="relative flex items-start gap-2">
                  <span className="absolute -left-4 top-0 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center">
                    <Icon size={10} className={tone} />
                  </span>
                  <div className="flex-1 min-w-0 pl-4">
                    <p className="text-[11.5px] text-foreground/90 leading-snug">{step.title}</p>
                    {step.detail && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground whitespace-pre-wrap leading-snug break-words">
                        {step.detail}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {isActive && (
              <div className="relative flex items-start gap-2">
                <span className="absolute -left-4 top-0 w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center">
                  <Loader2 size={10} className="text-blue-500 animate-spin" />
                </span>
                <div className="flex-1 min-w-0 pl-4">
                  <p className="text-[11.5px] text-muted-foreground leading-snug">作業中…</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active but no steps written yet */}
      {isActive && steps.length === 0 && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground py-1">
          <Loader2 size={12} className="animate-spin" />
          エージェントを起動しています…
        </div>
      )}

      {/* Failure */}
      {run?.status === 'failed' && run.error && (
        <div className="rounded-md bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 text-[11px] text-rose-400 leading-snug break-words">
          {run.error}
        </div>
      )}

      {/* Deliverable summary */}
      {run?.summary && (run.status === 'awaiting_review' || run.status === 'completed') && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-500 mb-1">
            <Bot size={11} />
            成果物
          </div>
          <p className="text-[11.5px] text-foreground/90 leading-snug break-words">{run.summary}</p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">全文はコメント欄に投稿されています。</p>
        </div>
      )}
    </div>
  );
}
