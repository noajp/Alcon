'use client';

import { useMemo, useState } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Copy, FileText, Flag, Hand, ListChecks, Loader2, MessageSquare, Pause, ShieldCheck, Wrench, CircleDot } from '@/ui/icons';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { cn } from '@/lib/utils';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import type { AgentArtifact, AgentRunStatus, AgentRunStep, AgentRunStepType } from '@/types/database';
import type { useAgentRun } from '@/hooks/useSupabase';
import { approvalRows, sharedColumns } from './approvalView';

// The agent on an Element (ADR 0027): one status line for the run, its
// Workpad as compact tool rows, the approval card when it waits on a
// person, and the deliverables it saved. Shapes follow the Task Rows / Tool
// Chips / Approval Card patterns, drawn with Alcon's own tokens.

type Agent = ReturnType<typeof useAgentRun>;

const STATUS: Record<AgentRunStatus, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'text-muted-foreground' },
  running: { label: 'Working', tone: 'text-[var(--accent-default)]' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'text-[var(--accent-default)]' },
  paused: { label: 'Paused', tone: 'text-muted-foreground' },
  awaiting_review: { label: 'Awaiting review', tone: 'text-foreground' },
  completed: { label: 'Completed', tone: 'text-foreground' },
  failed: { label: 'Failed', tone: 'text-[var(--status-danger)]' },
  cancelled: { label: 'Stopped', tone: 'text-muted-foreground' },
};

type Glyph = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
const STEP_ICON: Record<AgentRunStepType, Glyph> = {
  plan: ListChecks, thought: CircleDot, action: Wrench, subelement: CheckCircle2, comment: MessageSquare,
  status: ArrowRight, result: Flag, error: AlertCircle, approval: ShieldCheck, artifact: FileText,
};

function StatusGlyph({ status }: { status: AgentRunStatus }) {
  if (status === 'queued' || status === 'running') return <Loader2 size={15} className="animate-spin text-[var(--accent-default)]" />;
  if (status === 'awaiting_approval') return <Hand size={15} className="text-[var(--accent-default)]" />;
  if (status === 'paused' || status === 'cancelled') return <Pause size={15} className="text-muted-foreground" />;
  if (status === 'failed') return <AlertCircle size={15} className="text-[var(--status-danger)]" />;
  return <CheckCircle2 size={15} className="text-foreground" />;
}

/** "Echo Test: POST /notify" → label "Echo Test", chip "POST /notify". */
function splitStepTitle(title: string): { label: string; chip: string | null } {
  const i = title.indexOf(': ');
  if (i <= 0 || i > 40) return { label: title, chip: null };
  return { label: title.slice(0, i), chip: title.slice(i + 2) };
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="max-w-full truncate rounded-md border border-border bg-muted/40 px-1.5 py-px font-mono text-[11px] text-foreground/80">{children}</span>;
}

function StepRow({ step }: { step: AgentRunStep }) {
  const [open, setOpen] = useState(false);
  const Icon = STEP_ICON[step.type] ?? CircleDot;
  const { label, chip } = splitStepTitle(step.title);
  const hasDetail = !!step.detail;
  return (
    <li>
      <button
        type="button"
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-[12px]', hasDetail && 'hover:bg-muted/40')}
      >
        <Icon size={13} strokeWidth={2} className={step.type === 'error' ? 'shrink-0 text-[var(--status-danger)]' : 'shrink-0 text-muted-foreground'} />
        <span className="shrink-0 text-foreground/90">{label}</span>
        {chip && <Chip>{chip}</Chip>}
        {hasDetail && <DisclosureTriangle open={open} className="ml-auto text-muted-foreground" />}
      </button>
      {open && step.detail && (
        <div className="mb-1 ml-6 mt-0.5 rounded-md bg-muted/30 px-2 py-1.5">
          <MarkdownLite text={step.detail} className="text-[12px]" />
        </div>
      )}
    </li>
  );
}

const VISIBLE_STEPS = 5;

function Workpad({ steps }: { steps: AgentRunStep[] }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (!steps.length) return null;
  const shown = all ? steps : steps.slice(-VISIBLE_STEPS);
  return (
    <div className="mt-1">
      {steps.length > VISIBLE_STEPS && (
        <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="mb-0.5 flex items-center gap-1 px-1 text-[12px] text-muted-foreground hover:text-foreground">
          <DisclosureTriangle open={all} />
          {all ? t('Show fewer steps') : t('Show all {n} steps', { n: steps.length })}
        </button>
      )}
      <ul className="space-y-px">{shown.map((s) => <StepRow key={s.id} step={s} />)}</ul>
    </div>
  );
}

function ApprovalCard({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  // The note belongs to one request: a new request starts empty, but a
  // decision that fails and comes back keeps what was typed.
  const pendingId = agent.pending?.id ?? null;
  const [noteFor, setNoteFor] = useState(pendingId);
  if (pendingId && pendingId !== noteFor) { setNoteFor(pendingId); setNote(''); }
  const [openRow, setOpenRow] = useState<string | null>(null);
  const rows = useMemo(() => (agent.pending ? approvalRows(agent.pending) : []), [agent.pending]);
  if (!agent.pending) return null;
  const shared = sharedColumns(rows);
  const omitted = rows.reduce((n, r) => n + r.more, 0);
  return (
    <div className="mt-2">
      <div className="flex items-start gap-2 px-1 pt-1">
        <Hand size={15} className="mt-0.5 shrink-0 text-[var(--accent-default)]" />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">{agent.pending.summary}</div>
          <div className="text-[12px] text-muted-foreground">{t('Approving runs all {n} operations', { n: rows.length })}</div>
        </div>
      </div>

      <div className="mt-2 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="border-b border-border py-1 pr-3 font-medium">{t('Operation')}</th>
              {shared ? shared.map((c) => <th key={c} className="border-b border-border py-1 pr-3 font-medium">{c}</th>)
                : <th className="border-b border-border py-1 pr-3 font-medium">{t('Content')}</th>}
              <th className="w-6 border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <FragmentRow key={r.id} open={openRow === r.id} colSpan={(shared?.length ?? 1) + 2} raw={r.raw} rawLabel={t('Raw input')}>
                <td className="border-b border-border/60 py-1.5 pr-3 align-top">
                  <div className="text-foreground/90">{r.integration}</div>
                  <Chip>{r.operation}</Chip>
                </td>
                {shared
                  ? r.fields.map(([k, v]) => <td key={k} className="border-b border-border/60 py-1.5 pr-3 align-top text-foreground">{v}</td>)
                  : (
                    <td className="border-b border-border/60 py-1.5 pr-3 align-top">
                      {r.fields.length ? r.fields.map(([k, v]) => (
                        <div key={k} className="flex gap-2"><span className="shrink-0 text-muted-foreground">{k}</span><span className="min-w-0 break-words text-foreground">{v}</span></div>
                      )) : <span className="text-muted-foreground">—</span>}
                      {r.more > 0 && <div className="text-muted-foreground">{t('+{n} more fields in the raw input', { n: r.more })}</div>}
                    </td>
                  )}
                <td className="border-b border-border/60 py-1.5 align-top">
                  <button type="button" aria-label={t('Raw input')} aria-expanded={openRow === r.id} onClick={() => setOpenRow((o) => (o === r.id ? null : r.id))} className="rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                    <DisclosureTriangle open={openRow === r.id} />
                  </button>
                </td>
              </FragmentRow>
            ))}
          </tbody>
        </table>
        {shared && omitted > 0 && (
          <div className="mt-1 text-[12px] text-muted-foreground">{t('+{n} more fields in the raw input', { n: omitted })}</div>
        )}
      </div>

      <div className="px-1 pt-2">
        {agent.isMine ? (
          <TextComposer
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('Note to the agent (optional)')}
            rows={2}
            className="text-[13px]"
            secondaryAction={<Button variant="secondary" size="sm" disabled={agent.deciding} onClick={() => void agent.decide(false, note)}>{t('Reject')}</Button>}
            action={
              <Button variant="primary" size="sm" disabled={agent.deciding} onClick={() => void agent.decide(true, note)}>
                {agent.deciding ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {t('Approve and run')}
              </Button>
            }
          />
        ) : (
          <p className="text-[12px] text-muted-foreground">{t('Waiting for the person who started this run to approve.')}</p>
        )}
      </div>
    </div>
  );
}

function FragmentRow({ children, open, colSpan, raw, rawLabel }: { children: React.ReactNode; open: boolean; colSpan: number; raw: Record<string, unknown>; rawLabel: string }) {
  return (
    <>
      <tr>{children}</tr>
      {open && (
        <tr>
          <td colSpan={colSpan} className="border-b border-border/60 pb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">{rawLabel}</div>
            <pre className="max-h-60 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(raw, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function ArtifactItem({ artifact }: { artifact: AgentArtifact }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(artifact.content); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard denied */ }
  };
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/40">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <DisclosureTriangle open={open} className="text-muted-foreground" />
          <FileText size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] text-foreground">{artifact.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{artifact.format}</span>
        </button>
        <Button variant="ghost" size="xs" onClick={() => void copy()} aria-label={t('Copy')}>
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? t('Copied') : t('Copy')}
        </Button>
      </div>
      {open && (
        <div className="py-2 pl-6 pr-1">
          {artifact.format === 'markdown' || artifact.format === 'text'
            ? <MarkdownLite text={artifact.content} />
            : <pre className="max-h-96 overflow-auto font-mono text-[12px] leading-relaxed">{artifact.content}</pre>}
        </div>
      )}
    </li>
  );
}

export function AgentRunPanel({ agent, onRunAgain }: { agent: Agent; onRunAgain: () => void }) {
  const { t } = useI18n();
  const run = agent.run;
  if (!run && !agent.artifacts.length && !agent.error) return null;
  const status = run ? STATUS[run.status] ?? STATUS.completed : null;
  const finished = run && ['awaiting_review', 'completed', 'failed', 'cancelled'].includes(run.status);
  const cost = run ? Number(run.cost_usd || 0) : 0;
  const lastStep = agent.steps.at(-1);
  const line = (run?.status === 'awaiting_approval' && agent.pending?.summary)
    || run?.summary
    || (run && ['queued', 'running'].includes(run.status) ? lastStep?.title : null)
    || (status ? t(status.label) : '');

  return (
    <section className="space-y-2">
      {agent.error && <p className="px-1 text-[12px] text-[var(--status-danger)]">{agent.error}</p>}
      {run && status && (
        <div>
          <div role="status" aria-live="polite" className="flex min-h-9 items-center gap-2.5 px-1 py-1.5">
            <StatusGlyph status={run.status} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{line}</span>
            {cost > 0 && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">${cost.toFixed(2)}</span>}
            <span className={cn('shrink-0 text-[12px]', status.tone)}>{t(status.label)}</span>
            {agent.isActive || run.status === 'awaiting_approval' ? (
              <Button variant="ghost" size="xs" onClick={() => void agent.cancel()}>{t('Stop')}</Button>
            ) : run.status === 'paused' ? (
              agent.isMine ? <Button variant="secondary" size="xs" onClick={() => void agent.resume()}>{t('Resume')}</Button> : null
            ) : finished ? (
              <Button variant="ghost" size="xs" disabled={agent.starting} onClick={onRunAgain}>
                {run.mode === 'reply' ? t('Work on the Element') : t('Run again')}
              </Button>
            ) : null}
          </div>
          {(run.status === 'failed' || run.status === 'paused') && run.error && (
            <p className="mt-1 px-1 text-[12px] text-muted-foreground">{run.error}</p>
          )}
          <div className="px-1">
            <Workpad steps={agent.steps} />
          </div>
          <ApprovalCard agent={agent} />
        </div>
      )}

      {agent.artifacts.length > 0 && (
        <div>
          <h2 className={`${FONT.lg} mb-1 px-1 text-foreground`}>{t('Deliverables')}</h2>
          <ul className="space-y-px">{agent.artifacts.map((a) => <ArtifactItem key={a.id} artifact={a} />)}</ul>
        </div>
      )}
    </section>
  );
}
