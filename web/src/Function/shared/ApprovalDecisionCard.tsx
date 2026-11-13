'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Check, Hand, Loader2 } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import type { AgentAction } from '@/types/database';
import { CRITICAL_CLASS_LABELS } from '@/AIP/connectors/catalog';
import { approvalHeadline, approvalRows, compensationMarkerOf, rememberChoices, type ApprovalAskReason, type ApprovalRow } from './approvalCardModel';

// The one decision card for Athena's writes, on every surface that
// decides: the chat, the Element run panel, the Inbox, an Automation's
// waiting row. One anatomy — the action as a sentence, the labeled
// fields and content the decision turns on, why it is being asked, the
// note that is the edit path, Allow / Deny bound to exactly this input.
// It fetches nothing and routes nothing: the surfaces hand it the
// action, who may decide, and the decision callback (agentData's decide
// functions — the single, hash-bound decision channel).

export interface ApprovalDecision {
  note?: string;
  remember?: string[];
}

const WHY_ASKED: Record<Exclude<ApprovalAskReason, 'critical'>, string> = {
  command: 'This command is set to “Asks first”.',
  rule: 'A condition on this command asks for approval.',
  mode: 'This Space asks every time.',
  http: 'This call is a raw HTTP request, which always asks.',
  catalog: 'This operation in Clayware asks for approval first.',
};

export function ApprovalDecisionCard({ action, canDecide, deciding, onDecide, surface, results, canRemember }: {
  action: AgentAction;
  canDecide: boolean;
  deciding?: boolean;
  onDecide: (approve: boolean, opts: ApprovalDecision) => Promise<void>;
  surface: 'chat' | 'panel' | 'inbox' | 'automation';
  /** Per-call outcomes a surface already holds (the chat's, after its
   *  approved calls ran in place). A bare action carries only counts. */
  results?: { name: string; ok: boolean; content: string }[];
  /** Standing approvals change the Space's connection rules: owners
   *  only. Surfaces that know the Space pass whether the viewer owns
   *  it; the chips also need the calls to be rememberable (the display
   *  data encodes that — under the ask-every-time mode it does not). */
  canRemember?: boolean;
}) {
  const { t, locale } = useI18n();
  const rows = useMemo(() => approvalRows(action), [action]);
  const headline = approvalHeadline(rows, action.summary);
  const choices = useMemo(
    () => (canDecide && canRemember ? rememberChoices(action) : []),
    [action, canDecide, canRemember],
  );
  const anyCritical = rows.some((r) => r.critical);
  const integrations = [...new Set(rows.map((r) => r.integration))];
  // A plan approval (B8): the action is the whole plan from a plan run —
  // one decision over the listed sequence, critical calls included. Its
  // wording differs from a single ask's on purpose: approving DOES cover
  // the listed critical calls (hash-bound to exactly these), and denying
  // ends the plan rather than sending the agent back to propose again.
  const isPlan = action.tool === 'plan';

  // A compensation batch (B9): this approval is a failed run's
  // rollback, not new work — the note under the header says so, and
  // the deny wording is the rollback's own (denying does not send
  // the agent back to propose again; it leaves the writes standing).
  const compensation = compensationMarkerOf(action);

  // The note and the remember selection belong to one request: a new
  // request starts empty; a decision that fails and comes back keeps
  // what was typed.
  const [note, setNote] = useState('');
  const [remember, setRemember] = useState<string[]>([]);
  const [stateFor, setStateFor] = useState(action.id);
  if (action.id !== stateFor) { setStateFor(action.id); setNote(''); setRemember([]); }
  const [openRaw, setOpenRaw] = useState<string | null>(null);

  const status = action.status;
  const pending = status === 'pending';
  const busy = !!deciding;

  const decide = (approve: boolean) => {
    void onDecide(approve, {
      note: note.trim() || undefined,
      ...(approve && remember.length ? { remember } : {}),
    });
  };

  return (
    <div className={surface === 'chat' ? 'rounded-lg border border-border bg-card p-2.5 animate-fade-in' : undefined}>
      {/* Header: the action as a sentence, where it goes, the deadline. */}
      <div className="flex items-start gap-2 px-1 pt-1">
        <Hand size={15} className="mt-0.5 shrink-0 text-[var(--accent-default)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground">{headline}</div>
          <div className="text-[12px] text-muted-foreground">
            {rows.length > 1 ? `${t('Approving runs all {n} operations', { n: rows.length })} · ` : ''}
            {integrations.length === 1 ? integrations[0] : t('{n} destinations', { n: integrations.length })}
          </div>
          {isPlan && (
            <div className="text-[12px] text-muted-foreground">
              {t('This is a plan: the agent worked through the task without writing anything. Approving applies exactly the calls listed here.')}
            </div>
          )}
          {compensation && (
            <div className="text-[12px] text-muted-foreground">
              {t('Compensation for a failed run: approving runs these undo operations to roll back what the failed run wrote.')}
            </div>
          )}
          {pending && action.expires_at && (
            <div className="text-[12px] text-muted-foreground">
              {t('Waiting for a decision until {time}', { time: new Date(action.expires_at).toLocaleString(locale) })}
            </div>
          )}
        </div>
        {pending && surface === 'chat' && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{t('Awaiting approval')}</span>
        )}
      </div>

      {anyCritical && (
        <div className="mx-1 mt-2 rounded-md border border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 px-2 py-1.5 text-[12px] text-[var(--status-danger)]">
          {isPlan
            ? t('This plan includes a critical operation. Approving the plan covers exactly the calls listed here — nothing beyond them.')
            : t('This includes a critical operation. It asks every time: full delegation and saved conditions do not apply, and it cannot be remembered.')}
        </div>
      )}

      {/* One section per call: its title when the headline does not
          already say it, its labeled fields, its content, why it asks. */}
      <div className="mt-2 space-y-2 px-1">
        {rows.map((r) => (
          <CallSection key={r.id} row={r} t={t} isPlan={isPlan}
            showTitle={rows.length > 1 || headline !== `${r.integration} · ${r.title}`}
            rawOpen={openRaw === r.id}
            onToggleRaw={() => setOpenRaw((o) => (o === r.id ? null : r.id))} />
        ))}
      </div>

      <div className="mt-2 px-1 text-[12px] text-muted-foreground">
        {t('Allowing runs exactly these calls with exactly this input. If the input changes, this approval no longer matches.')}
      </div>

      {pending && canDecide && (
        <div className="px-1 pt-2">
          {choices.length > 0 && (
            <div className="pb-2">
              <div className="text-[12px] text-muted-foreground">{t('Don’t ask again for {target} when these fields match exactly:', { target: `${rows[0].integration} · ${rows[0].operation}` })}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {choices.map((c) => {
                  const on = remember.includes(c.field);
                  return (
                    <button key={c.field} type="button" aria-pressed={on}
                      onClick={() => setRemember((prev) => (on ? prev.filter((f) => f !== c.field) : [...prev, c.field]))}
                      className={cn('max-w-full truncate rounded-[var(--control-tab-radius)] border px-2 py-0.5 text-[12px]',
                        on ? 'border-[var(--accent-default)] bg-[var(--accent-default)]/10 text-foreground' : 'border-[var(--border-default)] text-muted-foreground hover:bg-muted/40')}>
                      {c.field} = {c.value}
                    </button>
                  );
                })}
              </div>
              {remember.length > 0 && (
                <div className="mt-1 text-[12px] text-muted-foreground">{t('Approving saves this condition on the connector; any other value, operation, or connector asks again.')}</div>
              )}
            </div>
          )}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000}
            placeholder={t('Note to the agent (optional)')} aria-label={t('Note to the agent (optional)')} className="text-[13px]" />
          <div className="mt-1 text-[12px] text-muted-foreground">{compensation ? t('Denying leaves the failed run\'s writes as they are; nothing is rolled back.') : isPlan ? t('Denying ends this plan. The plan stays in the record; nothing in it runs.') : t('Denying with a note tells the agent what to change; it will propose again.')}</div>
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => decide(false)}>{t('Deny')}</Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => decide(true)}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {t('Approve and run')}
            </Button>
          </div>
        </div>
      )}

      {pending && !canDecide && surface !== 'chat' && (
        <p className="px-1 pt-2 text-[12px] text-muted-foreground">
          {surface === 'inbox'
            ? t('Only the person who started this conversation can decide this approval.')
            : t('Waiting for the person who started this run to approve.')}
        </p>
      )}

      {/* Settled states: the outcome in place of the buttons. The Inbox
          keeps its own status line above the card, so it does not
          repeat it here. */}
      {surface !== 'inbox' && status === 'approved' && (
        <div className="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-muted-foreground">
          <Loader2 size={12} className="shrink-0 animate-spin" />{t('Working…')}
        </div>
      )}
      {surface !== 'inbox' && status === 'rejected' && (
        <div className="mt-2 px-1 text-[12px] text-muted-foreground">{compensation ? t('You denied this compensation. The failed run\'s writes were not rolled back.') : isPlan ? t('You denied this plan. Nothing in it was run.') : t('You denied this operation. It was not run.')}</div>
      )}
      {surface !== 'inbox' && status === 'expired' && (
        <div className="mt-2 px-1 text-[12px] text-muted-foreground">{t('This approval expired undecided. It was not run.')}</div>
      )}
      {surface !== 'inbox' && status === 'failed' && !results?.length && (
        <div className="mt-2 px-1 text-[12px] text-[var(--status-danger)]">{t('Approved, but the run failed')}</div>
      )}
      {(status === 'executed' || status === 'failed') && results && results.length > 0 && (
        <ul className="mt-2 space-y-0.5 px-1">
          {results.map((r, i) => {
            const row = rows[i];
            const Icon = r.ok ? Check : AlertCircle;
            return (
              <li key={i} className={`flex min-w-0 items-start gap-1.5 text-[12px] ${r.ok ? 'text-muted-foreground' : 'text-[var(--status-danger)]'}`}>
                <Icon size={11} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  {row && <span className="font-medium">{row.integration} · {row.operation} — </span>}
                  <span className="break-words">{r.content.slice(0, 160)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CallSection({ row, t, showTitle, rawOpen, onToggleRaw, isPlan }: {
  row: ApprovalRow;
  t: (key: string, vars?: Record<string, string | number>) => string;
  showTitle: boolean;
  rawOpen: boolean;
  onToggleRaw: () => void;
  /** In a plan, a listed critical call is covered by the plan's approval —
   *  the chip names the class without the "always asks" claim. */
  isPlan?: boolean;
}) {
  const criticalChip = row.critical
    ? isPlan
      ? t('Critical · {class}', { class: t(CRITICAL_CLASS_LABELS[row.critical]) })
      : t('Critical · {class} — always asks', { class: t(CRITICAL_CLASS_LABELS[row.critical]) })
    : '';
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      {showTitle && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="text-[12.5px] font-medium text-foreground">{row.title}</span>
          <span className="text-[10.5px] text-muted-foreground">{row.effect === 'read' ? t('read') : t('write')}</span>
          {row.critical && (
            <span className="rounded border border-[var(--status-danger)]/40 px-1 py-px text-[10.5px] text-[var(--status-danger)]">
              {criticalChip}
            </span>
          )}
        </div>
      )}
      {!showTitle && row.critical && (
        <div className="flex">
          <span className="rounded border border-[var(--status-danger)]/40 px-1 py-px text-[10.5px] text-[var(--status-danger)]">
            {criticalChip}
          </span>
        </div>
      )}
      {row.fields.length > 0 && (
        <div className="mt-1 space-y-px">
          {row.fields.map(([k, v]) => (
            <div key={k} className="flex min-w-0 gap-1.5 text-[12px]">
              <span className="shrink-0 text-muted-foreground">{k}</span>
              <span className="min-w-0 break-words text-foreground/90">{v}</span>
            </div>
          ))}
        </div>
      )}
      {row.preview && (
        <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 text-[12px] leading-relaxed text-foreground/90">{row.preview}</pre>
      )}
      {row.more > 0 && (
        <div className="mt-1 text-[11.5px] text-muted-foreground">{t('+{n} more fields in the raw input', { n: row.more })}</div>
      )}
      {row.askReason && row.askReason !== 'critical' && (
        <div className="mt-1 text-[11.5px] text-muted-foreground">{t(WHY_ASKED[row.askReason])}</div>
      )}
      <button type="button" onClick={onToggleRaw} aria-expanded={rawOpen}
        className="mt-1 flex items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground">
        <DisclosureTriangle open={rawOpen} />
        {t('Exact input')}
      </button>
      {rawOpen && (
        <div className="mt-1">
          {row.detail && <div className="mb-1 break-all font-mono text-[10.5px] text-muted-foreground">{row.detail}</div>}
          {row.destination !== row.integration && (
            <div className="mb-1 break-all font-mono text-[10.5px] text-muted-foreground">{row.destination}</div>
          )}
          <pre className="max-h-60 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(row.raw, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
