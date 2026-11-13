'use client';

import { useMemo, useState } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { Check, Copy, FileText } from '@/ui/icons';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { traceFromRunSteps } from '@/Function/shared/workTrace';
import { TraceCompletion, TraceHeadline, TraceStepList } from '@/Function/shared/workTraceView';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';
import { CredentialRequestCard } from '@/AIP/connectors/CredentialRequestCard';
import { CreatedEntityCard } from '@/AIP/ai/CreatedEntityCard';
import type { CreatedEntity } from '@/AIP/ai/useClaywareCopilot';
import type { AgentOutput } from '@/types/database';
import type { ProposedReading } from '@/Function/audit/auditModel';
import { useMeasureLabels } from '@/AIP/ai/agentData';
import type { useAgentRun } from '@/hooks/useSupabase';
import { useIsSpaceOwner } from '@/AIP/connectors/data';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useNow } from '@/Function/shared/useNow';

// The agent on an Element (ADR 0027): the run's shared work trace
// (Function/shared/workTraceView) — its headline, its steps as compact rows,
// its completion — the approval card when it waits on a person, and the
// deliverables it saved. Shapes follow the Task Rows / Tool Chips /
// Approval Card patterns, drawn with Clayware's own tokens.

type Agent = ReturnType<typeof useAgentRun>;


/**
 * The readings this run proposed for its Strategies' measures, and what
 * became of each: recorded, waiting for this review's acceptance, or
 * refused with the reason. Renders nothing when the run proposed none —
 * under manual review this block is part of what the reviewer accepts.
 */
function ReadingsBlock({ readings }: { readings: readonly ProposedReading[] }) {
  const { t } = useI18n();
  const labels = useMeasureLabels(readings.map((r) => r.measureId));
  if (!readings.length) return null;
  const stateOf = (r: ProposedReading): string =>
    r.applied ? t('Recorded')
      : r.heldReason === 'awaiting-acceptance' ? t('Waiting for acceptance')
      : r.heldReason === 'verdict-not-pass' ? t('Not recorded — the check did not pass')
      : r.heldReason === 'not-bound' ? t('Not recorded — not a measure this run serves')
      : t('Recording failed');
  return (
    <div className="mt-1 space-y-0.5 px-1 text-[12px]">
      {readings.map((r) => {
        const label = labels.get(r.measureId);
        return (
          <p key={r.measureId} className="flex flex-wrap items-baseline gap-x-2 leading-snug">
            <span className="text-foreground/90">{label?.title ?? r.measureId}</span>
            <span className="text-foreground/90">{r.value}{label?.unit ? ` ${label.unit}` : ''}</span>
            <span className="text-muted-foreground">{stateOf(r)}</span>
          </p>
        );
      })}
    </div>
  );
}


function OutputItem({ output }: { output: AgentOutput }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(output.content); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard denied */ }
  };
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/40">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <DisclosureTriangle open={open} className="text-muted-foreground" />
          <FileText size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] text-foreground">{output.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{output.format}</span>
        </button>
        <Button variant="ghost" size="xs" onClick={() => void copy()} aria-label={t('Copy')}>
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? t('Copied') : t('Copy')}
        </Button>
      </div>
      {open && (
        <div className="py-2 pl-6 pr-1">
          {output.format === 'markdown' || output.format === 'text'
            ? <MarkdownLite text={output.content} />
            : <pre className="max-h-96 overflow-auto font-mono text-[12px] leading-relaxed">{output.content}</pre>}
        </div>
      )}
    </li>
  );
}

/** A running run whose Workpad has been silent this long is stuck (its
 *  invocation died mid-turn): run-agent accepts a resume for it (its
 *  STALE_MS), so the panel offers one next to Stop. */
const STALE_RUNNING_MS = 10 * 60 * 1000;

export function AgentRunPanel({ agent, onRunAgain }: { agent: Agent; onRunAgain: () => void }) {
  const { t } = useI18n();
  const now = useNow();
  // A standing approval changes the Space's connection rules: owners only.
  const spaceId = useActiveSpaceId();
  const isOwner = useIsSpaceOwner(spaceId) === true;
  const run = agent.run;
  // Credential capture asks this run raised (secure-login PR2): their
  // steps carry only the request id — the card re-reads its row live.
  // One card per request, however many slices repeated the step.
  const credentialAsks = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of agent.steps) {
      if (s.type !== 'credential_request' || !s.detail) continue;
      try {
        const parsed = JSON.parse(s.detail) as { requestId?: unknown; label?: unknown };
        if (typeof parsed.requestId === 'string' && parsed.requestId) {
          seen.set(parsed.requestId, typeof parsed.label === 'string' ? parsed.label : '');
        }
      } catch { /* a step whose detail is not the ask's JSON is just a row */ }
    }
    return [...seen.entries()].map(([requestId, label]) => ({ requestId, label }));
  }, [agent.steps]);
  // The pull request this run's publish opened (coding capability
  // PR3): its step's detail is the created record the card family
  // reads — the card re-reads the code_changes row live, so the run
  // record keeps showing the PR's state after the run ends. A step
  // whose detail is the plain-URL fallback carries no card record
  // and stays a trace row.
  const publishedPrs = useMemo(() => {
    const seen = new Map<string, CreatedEntity>();
    for (const s of agent.steps) {
      if (s.type !== 'pull_request' || !s.detail) continue;
      try {
        const parsed = JSON.parse(s.detail) as { created?: unknown };
        if (!Array.isArray(parsed.created)) continue;
        for (const entry of parsed.created) {
          if (!entry || typeof entry !== 'object') continue;
          const e = entry as Record<string, unknown>;
          if (e.kind !== 'pull_request' || typeof e.id !== 'string' || !e.id
            || typeof e.title !== 'string' || !e.title || seen.has(e.id)) continue;
          seen.set(e.id, {
            kind: 'pull_request', id: e.id, title: e.title,
            ...(typeof e.url === 'string' && e.url ? { url: e.url } : {}),
            ...(typeof e.repo === 'string' && e.repo ? { repo: e.repo } : {}),
            ...(typeof e.number === 'number' && e.number > 0 ? { number: e.number } : {}),
            ...(typeof e.state === 'string' && e.state ? { state: e.state } : {}),
          });
        }
      } catch { /* a step whose detail is not the record's JSON is just a row */ }
    }
    return [...seen.values()];
  }, [agent.steps]);
  // The run told the shared way (workTrace): headline, steps, completion.
  const trace = useMemo(
    () => traceFromRunSteps(
      run ? { ...run, pendingSummary: agent.pending?.summary ?? null } : null,
      agent.steps,
    ),
    [run, agent.steps, agent.pending],
  );
  if (!run && !agent.outputs.length && !agent.error) return null;
  const finished = run && ['awaiting_review', 'completed', 'failed', 'cancelled'].includes(run.status);
  const lastStep = agent.steps.at(-1);
  const lastActivity = lastStep?.created_at ?? run?.started_at ?? run?.created_at;
  const stuckRunning = run?.status === 'running' && !!lastActivity
    && now - new Date(lastActivity).getTime() > STALE_RUNNING_MS;

  return (
    <section className="space-y-2">
      {agent.error && <p className="px-1 text-[12px] text-[var(--status-danger)]">{agent.error}</p>}
      {run && (
        <div>
          <TraceHeadline trace={trace} controls={
            agent.isActive || run.status === 'awaiting_approval' ? (
              <>
                {stuckRunning && agent.isMine && (
                  <Button variant="secondary" size="xs" onClick={() => void agent.resume()}>{t('Resume')}</Button>
                )}
                <Button variant="ghost" size="xs" onClick={() => void agent.cancel()}>{t('Stop')}</Button>
              </>
            ) : run.status === 'paused' ? (
              agent.isMine ? <Button variant="secondary" size="xs" onClick={() => void agent.resume()}>{t('Resume')}</Button> : null
            ) : finished ? (
              <Button variant="ghost" size="xs" disabled={agent.starting} onClick={onRunAgain}>
                {run.mode === 'reply' ? t('Work on the Element') : t('Run again')}
              </Button>
            ) : null
          } />
          {/* A stopped run's error sits under the header while it can still
              resume; a finished run's error belongs to its completion. */}
          {(run.status === 'failed' || run.status === 'paused') && run.error && !trace.completion && (
            <p className="mt-1 px-1 text-[12px] text-muted-foreground">{run.error}</p>
          )}
          <div className="px-1">
            <TraceStepList steps={trace.steps} foldAfter={5} fromEnd />
          </div>
          <ReadingsBlock readings={run.proposed_readings ?? []} />
          <TraceCompletion trace={trace} />
          {/* The one decision card (Function/shared), fed by the run's
              pending action; a standing approval is an owner's to give. */}
          {agent.pending && (
            <div className="mt-2">
              <ApprovalDecisionCard action={agent.pending} surface="panel"
                canDecide={agent.isMine} deciding={agent.deciding} canRemember={isOwner}
                onDecide={async (approve, opts) => { await agent.decide(approve, opts.note, opts.remember); }} />
            </div>
          )}
          {/* A capture this run is waiting on: the shared card, under
              the trace it interrupted. Answering it is an owner's act
              in the dialog; the run's own Resume stays the starter's. */}
          {credentialAsks.map((c) => (
            <div key={c.requestId} className="mt-2">
              <CredentialRequestCard spaceId={spaceId} requestId={c.requestId} label={c.label} />
            </div>
          ))}
          {/* The PR the run published, as its created card — the
              durable surface next to the trace that produced it. */}
          {publishedPrs.map((entity) => (
            <div key={entity.id} className="mt-2">
              <CreatedEntityCard entity={entity} />
            </div>
          ))}
        </div>
      )}

      {agent.outputs.length > 0 && (
        <div>
          <h2 className={`${FONT.lg} mb-1 px-1 text-foreground`}>{t('Outputs')}</h2>
          <ul className="space-y-px">{agent.outputs.map((a) => <OutputItem key={a.id} output={a} />)}</ul>
        </div>
      )}
    </section>
  );
}
