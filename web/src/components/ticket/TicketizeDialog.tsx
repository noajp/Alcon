'use client';

import { useCallback, useEffect, useState } from 'react';
import { summarizeNoteContent } from './aiSummary';
import type { TicketStructured } from './types';

interface TicketizeDialogProps {
  defaultTitle: string;
  sourceFileName: string;
  sourceContent: string;
  onClose: () => void;
  onCreate: (input: { title: string; summary: string; structured?: TicketStructured }) => void;
}

type Phase = 'generating' | 'ready' | 'error';

export function TicketizeDialog({
  defaultTitle,
  sourceFileName,
  sourceContent,
  onClose,
  onCreate,
}: TicketizeDialogProps) {
  const [phase, setPhase] = useState<Phase>('generating');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [title, setTitle] = useState(defaultTitle);
  const [overview, setOverview] = useState('');
  const [summary, setSummary] = useState('');
  const [decisions, setDecisions] = useState<TicketStructured['decisions']>([]);
  const [actions, setActions] = useState<TicketStructured['action_items']>([]);
  const [questions, setQuestions] = useState<TicketStructured['questions']>([]);
  const [participants, setParticipants] = useState<TicketStructured['participants']>([]);

  const runGeneration = useCallback(async () => {
    setPhase('generating');
    setErrorMsg('');
    try {
      const s = await summarizeNoteContent({ title, content: sourceContent });
      setOverview(s.overview);
      setSummary(s.summary ?? s.overview);
      setDecisions(s.decisions);
      setActions(s.action_items);
      setQuestions(s.questions);
      setParticipants(s.participants);
      setPhase('ready');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to summarize');
      setPhase('error');
    }
  }, [title, sourceContent]);

  useEffect(() => {
    // Kick off AI structure extraction as soon as the dialog mounts.
    runGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const submit = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    const structured: TicketStructured = {
      overview: overview.trim(),
      summary: summary.trim() || overview.trim(),
      decisions,
      action_items: actions,
      questions,
      participants,
    };
    onCreate({
      title: t,
      summary: summary.trim() || overview.trim(),
      structured,
    });
  }, [title, overview, summary, decisions, actions, questions, participants, onCreate]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] bg-card border border-border shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Commit
            </div>
            <div className="text-[12px] text-muted-foreground">
              From <span className="text-foreground/80 font-medium">{sourceFileName}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={runGeneration}
            disabled={phase === 'generating'}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border border-border hover:border-foreground/40 hover:bg-accent text-foreground/80 hover:text-foreground disabled:opacity-50 disabled:cursor-wait"
            title="AIで再抽出"
          >
            {phase === 'generating' ? <Spinner /> : <SparkleIcon />}
            <span>{phase === 'generating' ? '抽出中...' : '再抽出'}</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {phase === 'generating' && <GeneratingState />}
          {phase === 'error' && <ErrorState message={errorMsg} onRetry={runGeneration} />}
          {phase === 'ready' && (
            <div className="p-5 space-y-4">
              <Field label="Title">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Untitled"
                  className="w-full bg-transparent outline-none text-[15px] font-semibold text-foreground border border-border px-2.5 py-2 focus:border-foreground/40"
                />
              </Field>

              <Field label="Overview">
                <textarea
                  value={overview}
                  onChange={(e) => setOverview(e.target.value)}
                  placeholder="1〜2行の概要"
                  rows={2}
                  className="w-full bg-transparent outline-none text-[13px] leading-[1.6] text-foreground/90 border border-border px-2.5 py-2 focus:border-foreground/40 resize-none"
                />
              </Field>

              <Section
                label="Decisions"
                count={decisions.length}
                emptyText="決定事項なし"
                items={decisions.map((d, i) => (
                  <ItemRow
                    key={i}
                    title={d.title}
                    detail={d.detail}
                    onRemove={() => setDecisions((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              />

              <Section
                label="Action Items"
                count={actions.length}
                emptyText="Actionなし"
                items={actions.map((a, i) => (
                  <ItemRow
                    key={i}
                    title={a.title}
                    meta={[a.owner, a.due].filter(Boolean).join(' · ')}
                    onRemove={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              />

              <Section
                label="Open Questions"
                count={questions.length}
                emptyText="未解決の問いなし"
                items={questions.map((q, i) => (
                  <ItemRow
                    key={i}
                    title={q.title}
                    detail={q.detail}
                    onRemove={() => setQuestions((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              />

              <Section
                label="Participants"
                count={participants.length}
                emptyText="登場人物の抽出なし"
                items={participants.map((p, i) => (
                  <ItemRow
                    key={i}
                    title={p.name}
                    meta={p.role}
                    onRemove={() => setParticipants((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={phase !== 'ready' || !title.trim()}
            className="text-[12px] font-medium px-3 py-1.5 bg-foreground text-background disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Commit
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Local bits
// ============================================
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Section({
  label,
  count,
  items,
  emptyText,
}: {
  label: string;
  count: number;
  items: React.ReactNode;
  emptyText: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground/60 tabular-nums">{count}</span>
      </div>
      {count === 0 ? (
        <div className="text-[12px] text-muted-foreground/60 pl-0.5">{emptyText}</div>
      ) : (
        <ul className="space-y-1">{items}</ul>
      )}
    </div>
  );
}

function ItemRow({
  title,
  detail,
  meta,
  onRemove,
}: {
  title: string;
  detail?: string;
  meta?: string;
  onRemove: () => void;
}) {
  return (
    <li className="group flex items-start gap-2 py-1.5 border-t border-border/60 first:border-t-0">
      <span className="mt-1.5 w-[6px] h-[6px] shrink-0 rounded-full bg-foreground/40" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.45] break-words">{title}</div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.45] break-words">
            {detail}
          </div>
        )}
        {meta && (
          <div className="text-[11px] text-muted-foreground/70 mt-0.5 tabular-nums">{meta}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive px-1"
        aria-label="Remove"
        title="Remove"
      >
        <XIcon />
      </button>
    </li>
  );
}

function GeneratingState() {
  return (
    <div className="h-[260px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner size={18} />
      <div className="text-[12px]">Note を構造化しています...</div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-[260px] flex flex-col items-center justify-center gap-3 text-destructive px-6 text-center">
      <div className="text-[12px]">AI要約に失敗しました</div>
      <div className="text-[11px] text-muted-foreground max-w-sm break-words">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="text-[12px] px-3 py-1.5 border border-border hover:bg-accent text-foreground/80 hover:text-foreground mt-1"
      >
        Retry
      </button>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" />
    </svg>
  );
}

function Spinner({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="14 40" strokeLinecap="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
