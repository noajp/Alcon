'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeNoteContent } from './aiSummary';
import type { BriefStructured } from './types';

export interface BriefDraft {
  title: string;
  overview: string;
  summary: string;
  decisions: BriefStructured['decisions'];
  action_items: BriefStructured['action_items'];
  questions: BriefStructured['questions'];
  participants: BriefStructured['participants'];
  analyzedChars: number | null;
}

interface BriefDialogProps {
  defaultTitle: string;
  sourceFileName: string;
  sourceContent: string;
  initialDraft?: BriefDraft;
  onDraftChange?: (draft: BriefDraft) => void;
  onClose: () => void;
  onCreate: (input: {
    title: string;
    summary: string;
    structured?: BriefStructured;
  }) => Promise<void>;
}

type Phase = 'generating' | 'ready' | 'error';

export function BriefDialog({
  defaultTitle,
  sourceFileName,
  sourceContent,
  initialDraft,
  onDraftChange,
  onClose,
  onCreate,
}: BriefDialogProps) {
  const hasDraft = !!initialDraft;
  const [phase, setPhase] = useState<Phase>(hasDraft ? 'ready' : 'generating');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [submitError, setSubmitError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(initialDraft?.title ?? defaultTitle);
  const [overview, setOverview] = useState(initialDraft?.overview ?? '');
  const [summary, setSummary] = useState(initialDraft?.summary ?? '');
  const [decisions, setDecisions] = useState<BriefStructured['decisions']>(
    initialDraft?.decisions ?? []
  );
  const [actions, setActions] = useState<BriefStructured['action_items']>(
    initialDraft?.action_items ?? []
  );
  const [questions, setQuestions] = useState<BriefStructured['questions']>(
    initialDraft?.questions ?? []
  );
  const [participants, setParticipants] = useState<BriefStructured['participants']>(
    initialDraft?.participants ?? []
  );
  const [analyzedChars, setAnalyzedChars] = useState<number | null>(
    initialDraft?.analyzedChars ?? null
  );

  const runGeneration = useCallback(async () => {
    setPhase('generating');
    setErrorMsg('');
    try {
      const { structured: s, plainTextLength } = await summarizeNoteContent({
        title,
        content: sourceContent,
      });
      setAnalyzedChars(plainTextLength);
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

  // Only auto-generate when there's no pre-existing draft to restore.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (!hasDraft) runGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Persist every edit up to the parent so closing/reopening keeps it.
  useEffect(() => {
    if (phase !== 'ready') return;
    onDraftChange?.({
      title,
      overview,
      summary,
      decisions,
      action_items: actions,
      questions,
      participants,
      analyzedChars,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, title, overview, summary, decisions, actions, questions, participants, analyzedChars]);

  const submit = useCallback(async () => {
    const t = title.trim();
    if (!t) return;
    const structured: BriefStructured = {
      overview: overview.trim(),
      summary: summary.trim() || overview.trim(),
      decisions,
      action_items: actions,
      questions,
      participants,
    };
    setSubmitting(true);
    setSubmitError('');
    try {
      await onCreate({
        title: t,
        summary: summary.trim() || overview.trim(),
        structured,
      });
    } catch (err) {
      setSubmitError((err as Error).message || 'Briefの作成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [title, overview, summary, decisions, actions, questions, participants, onCreate]);

  const hasAnyStructure =
    decisions.length + actions.length + questions.length + participants.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Brief
            </div>
            <div className="text-[12px] text-muted-foreground">
              From <span className="text-foreground/80 font-medium">{sourceFileName}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={runGeneration}
            disabled={phase === 'generating'}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 border border-border rounded-md hover:border-foreground/40 hover:bg-accent text-foreground/80 hover:text-foreground disabled:opacity-50 disabled:cursor-wait"
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
            <div className="px-8 pt-6 pb-8">
              {/* Title — looks like a page heading */}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled"
                className="w-full bg-transparent border-0 no-focus-ring p-0 text-[22px] font-semibold text-foreground tracking-[-0.4px] leading-[1.2] placeholder:text-foreground/25"
              />

              {/* Overview — flowing paragraph */}
              <textarea
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                placeholder="1〜2行の概要"
                rows={2}
                className="mt-3 w-full bg-transparent border-0 no-focus-ring p-0 text-[13px] leading-[1.7] text-foreground/80 placeholder:text-muted-foreground/50 resize-none"
              />

              {analyzedChars !== null && (
                <div className="mt-4 text-[11px] text-muted-foreground/70">
                  Analyzed <span className="tabular-nums font-medium text-foreground/70">{analyzedChars}</span> characters from the Note body.
                  {analyzedChars < 40 && (
                    <span className="ml-1.5 text-amber-500">
                      本文が短すぎる可能性があります。Note側で内容を追記してから再抽出してください。
                    </span>
                  )}
                </div>
              )}

              {!hasAnyStructure && (
                <div className="mt-6 text-[12px] text-muted-foreground/60 leading-[1.6]">
                  Note からは Decisions / Actions / Questions / Participants が抽出できませんでした。
                  このまま Brief すれば Title と Overview だけの軽量 Brief になります。
                </div>
              )}

              {decisions.length > 0 && (
                <Section label="Key Decisions">
                  <ul className="space-y-2">
                    {decisions.map((d, i) => (
                      <BulletItem
                        key={i}
                        title={d.title}
                        detail={d.detail}
                        onRemove={() =>
                          setDecisions((prev) => prev.filter((_, j) => j !== i))
                        }
                      />
                    ))}
                  </ul>
                </Section>
              )}

              {actions.length > 0 && (
                <Section label="Action Items">
                  <ul className="space-y-1.5">
                    {actions.map((a, i) => (
                      <ActionItem
                        key={i}
                        title={a.title}
                        owner={a.owner}
                        due={a.due}
                        onRemove={() =>
                          setActions((prev) => prev.filter((_, j) => j !== i))
                        }
                      />
                    ))}
                  </ul>
                </Section>
              )}

              {questions.length > 0 && (
                <Section label="Open Questions">
                  <ul className="space-y-1.5">
                    {questions.map((q, i) => (
                      <QuestionItem
                        key={i}
                        title={q.title}
                        detail={q.detail}
                        onRemove={() =>
                          setQuestions((prev) => prev.filter((_, j) => j !== i))
                        }
                      />
                    ))}
                  </ul>
                </Section>
              )}

              {participants.length > 0 && (
                <Section label="Participants">
                  <ul className="flex flex-wrap gap-1.5">
                    {participants.map((p, i) => (
                      <ParticipantChip
                        key={i}
                        name={p.name}
                        role={p.role}
                        onRemove={() =>
                          setParticipants((prev) => prev.filter((_, j) => j !== i))
                        }
                      />
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <div className="text-[11px] text-destructive min-w-0 flex-1 break-words">
            {submitError}
          </div>
          <div className="flex items-center gap-2">
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
              disabled={phase !== 'ready' || !title.trim() || submitting}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 bg-foreground text-background rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {submitting && <Spinner />}
              {submitting ? 'Briefing...' : 'Brief'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Sections
// ============================================
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 pt-5 border-t border-border/60">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 mb-2.5">
        {label}
      </div>
      {children}
    </section>
  );
}

function BulletItem({
  title,
  detail,
  onRemove,
}: {
  title: string;
  detail?: string;
  onRemove: () => void;
}) {
  return (
    <li className="group flex items-start gap-2.5">
      <span className="mt-[7px] w-[5px] h-[5px] shrink-0 rounded-full bg-foreground/50" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
      <RemoveButton onClick={onRemove} />
    </li>
  );
}

function ActionItem({
  title,
  owner,
  due,
  onRemove,
}: {
  title: string;
  owner?: string;
  due?: string;
  onRemove: () => void;
}) {
  return (
    <li className="group flex items-start gap-2.5">
      <span className="mt-[3px] w-[14px] h-[14px] shrink-0 border border-foreground/40" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {(owner || due) && (
          <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-2">
            {owner && <span className="inline-flex items-center gap-1">@{owner}</span>}
            {due && <span className="inline-flex items-center gap-1">⏰ {due}</span>}
          </div>
        )}
      </div>
      <RemoveButton onClick={onRemove} />
    </li>
  );
}

function QuestionItem({
  title,
  detail,
  onRemove,
}: {
  title: string;
  detail?: string;
  onRemove: () => void;
}) {
  return (
    <li className="group flex items-start gap-2.5">
      <span className="text-[13px] leading-[1.55] text-foreground/50 shrink-0 mt-0">?</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] italic text-foreground/85 leading-[1.55] break-words">{title}</div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
      <RemoveButton onClick={onRemove} />
    </li>
  );
}

function ParticipantChip({
  name,
  role,
  onRemove,
}: {
  name: string;
  role?: string;
  onRemove: () => void;
}) {
  return (
    <li className="group inline-flex items-center gap-1.5 text-[12px] bg-accent/60 px-2 py-1">
      <span className="text-foreground/90">{name}</span>
      {role && <span className="text-muted-foreground/80">· {role}</span>}
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        aria-label="Remove"
      >
        <XIcon size={10} />
      </button>
    </li>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive px-1 mt-0.5"
      aria-label="Remove"
    >
      <XIcon />
    </button>
  );
}

// ============================================
// States
// ============================================
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
        className="text-[12px] px-3 py-1.5 border border-border rounded-md hover:bg-accent text-foreground/80 hover:text-foreground mt-1"
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

function XIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
