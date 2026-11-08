'use client';

import { formatError } from '@/Function/shared/formatError';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { FONT } from '@/shared/designTokens';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Integration, IntegrationDraft } from '@/types/database';
import { CRITICAL_CLASS_LABELS } from './catalog';
import {
  DRAFT_FAILURE_LABELS, DRAFT_STATUS_LABELS, readManifestCommands, readTestRounds,
} from './draftModel';
import { activateDraft, rejectDraft, runDraftTest, sendDraftMessage, settleDraftToReview, useDraftDetail } from './draftData';
import { useIntegrationActions } from './data';
import { appDialog } from '@/Function/shared/appDialogStore';

// One AI-drafted connection (G4), from whichever entry opened it. The
// draft record is the whole story: what was asked, the candidate the AI
// proposed from the official spec, where the spec came from, every test
// round's evidence, and — once an owner decides — the decision. It never
// holds a credential; the credential is entered here only at test time,
// into Vault, against the staged row (PR3), and activation is the
// owner's separate act (PR4). The drafting run's steps are shown as the
// audit trail they are.

const OPEN = ['drafting', 'awaiting_input', 'testing', 'awaiting_review'];

function hostOf(raw: string | null): string | null {
  if (!raw) return null;
  try { return new URL(raw).hostname; } catch { return null; }
}

export function IntegrationDraftDialog({ draft, spaceId, integrations, canReview, onClose, onChanged }: {
  draft: IntegrationDraft;
  spaceId: string;
  integrations: readonly Integration[];
  /** The viewer owns the Space: only they enter credentials, test, decide. */
  canReview: boolean;
  onClose: () => void;
  /** The draft or a connection changed; the parent re-reads both lists. */
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const { run, steps } = useDraftDetail(draft);
  const [words, setWords] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const actions = useIntegrationActions(spaceId);
  const staged = draft.materialized_integration_id
    ? integrations.find((i) => i.id === draft.materialized_integration_id) ?? null
    : null;
  const targetName = draft.target_integration_id
    ? integrations.find((i) => i.id === draft.target_integration_id)?.name ?? null
    : null;

  const commands = readManifestCommands(draft.manifest);
  const reads = commands.filter((c) => c.effect === 'read');
  const writes = commands.filter((c) => c.effect === 'write');
  const rounds = readTestRounds(draft.test_results);
  const latestRound = rounds[rounds.length - 1] ?? null;
  const endpointHost = hostOf(draft.endpoint);
  const sourceHosts = [...new Set(draft.sources.map((s) => hostOf(s)).filter(Boolean))];
  const runAtRest = !!run && (run.status === 'awaiting_input' || run.status === 'paused');
  const canSend = OPEN.includes(draft.status) && runAtRest && !sending;

  const send = async () => {
    const message = words.trim();
    if (!message || !run || !canSend) return;
    setSending(true); setSendError(null);
    try {
      await sendDraftMessage(run.id, message);
      setWords('');
    } catch (e) {
      setSendError(formatError(e));
    } finally {
      setSending(false);
    }
  };

  const saveSecret = async () => {
    if (!staged || !secretInput.trim()) return;
    setTestError(null);
    try {
      await actions.secret.mutateAsync({ id: staged.id, value: secretInput.trim() });
      setSecretInput('');
      onChanged?.();
    } catch (e) {
      setTestError(formatError(e));
    }
  };

  const test = async (settle: boolean) => {
    setTestBusy(true); setTestError(null);
    try {
      if (settle) await settleDraftToReview(draft.id);
      else await runDraftTest(draft.id);
      onChanged?.();
    } catch (e) {
      setTestError(formatError(e));
    } finally {
      setTestBusy(false);
    }
  };

  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const decide = async (activate: boolean) => {
    const ok = await appDialog.confirm(activate
      ? t('Activate this connection? What was tested goes live exactly as shown.')
      : t('Reject this draft? The staged connection is deleted and nothing goes live.'));
    if (!ok) return;
    setDeciding(true); setDecideError(null);
    try {
      if (activate) await activateDraft(draft.id);
      else await rejectDraft(draft.id);
      onChanged?.();
      if (activate) onClose();
    } catch (e) {
      setDecideError(formatError(e));
    } finally {
      setDeciding(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="truncate">{draft.name}</DialogTitle>
            <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium',
              draft.status === 'awaiting_review' ? 'bg-[var(--status-warning-subtle)] text-[var(--status-warning)]'
              : draft.status === 'active' ? 'bg-[var(--status-success-subtle)] text-[var(--status-success)]'
              : 'bg-[var(--surface-strong)] text-muted-foreground')}>
              {t(DRAFT_STATUS_LABELS[draft.status])}
            </span>
          </div>
          <DialogDescription className="pt-1 text-[12px]">
            {t('Drafted by the AI from the official documentation. Nothing is connected until an owner approves the tested draft.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-[13px]">
          {(draft.request_context.purpose || draft.request_context.waitingFor || targetName) && (
            <section className="space-y-1">
              <h3 className={FONT.label}>{t('Why this was drafted')}</h3>
              {targetName && <p className="text-muted-foreground">{t('This draft updates the existing connection “{name}”. The live connection keeps working until an owner activates the update.', { name: targetName })}</p>}
              {draft.request_context.waitingFor && <p className="text-muted-foreground">{t('Waiting work: {what}', { what: draft.request_context.waitingFor })}</p>}
              {draft.request_context.purpose && <p className="text-foreground">{draft.request_context.purpose}</p>}
            </section>
          )}

          {draft.status === 'awaiting_input' && draft.awaiting_question && (
            <section className="rounded-md bg-[var(--status-warning-subtle)] px-3 py-2">
              <h3 className={FONT.label}>{t('The AI is asking')}</h3>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{draft.awaiting_question}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{t('Answer below — drafting resumes from your words.')}</p>
            </section>
          )}

          {draft.endpoint ? (
            <section className="space-y-3">
              <h3 className={FONT.label}>{t('The drafted definition')}</h3>
              <div className="space-y-1">
                <div className="break-all font-mono text-[12px] text-foreground">{draft.endpoint}</div>
                <p className="text-[12px] text-muted-foreground">
                  {draft.auth_type === 'none' || !draft.auth_type
                    ? t('No authentication.')
                    : draft.auth_type === 'header'
                      ? t('Authentication: the credential is sent in the {header} header.', { header: draft.auth_header ?? '' })
                      : t('Authentication: the credential is sent as a bearer token.')}
                </p>
                {endpointHost && draft.auth_type && draft.auth_type !== 'none' && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('The credential is sent only to {host} — every command stays under this address.', { host: endpointHost })}
                  </p>
                )}
                {sourceHosts.length > 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    {t('The specification was read from {hosts}. No credential is sent there.', { hosts: sourceHosts.join(', ') })}
                  </p>
                )}
              </div>

              {commands.length > 0 && (
                <div className="space-y-3">
                  <CommandGroup title={t('Reads')} rows={reads} t={t} />
                  <CommandGroup title={t('Writes')} rows={writes} t={t} />
                </div>
              )}

              {draft.dropped_commands.length > 0 && (
                <div className="rounded-md bg-[var(--status-warning-subtle)] px-3 py-2">
                  <h4 className="text-[12px] font-medium text-foreground">{t('Dropped from what was asked')}</h4>
                  <ul className="mt-1 space-y-1">
                    {draft.dropped_commands.map((d) => (
                      <li key={d.name} className="text-[12px] text-muted-foreground">
                        <span className="font-mono text-foreground">{d.name}</span> — {d.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {draft.guide && (
                <div>
                  <h4 className={FONT.label}>{t('Guide for the agent')}</h4>
                  <p className="mt-1 whitespace-pre-wrap rounded-md bg-[var(--surface-strong)] px-3 py-2 text-[12px] text-foreground">{draft.guide}</p>
                </div>
              )}

              {draft.sources.length > 0 && (
                <div>
                  <h4 className={FONT.label}>{t('Sources')}</h4>
                  <ul className="mt-1 space-y-0.5">
                    {draft.sources.map((s) => (
                      <li key={s} className="break-all text-[12px] text-muted-foreground">{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ) : draft.status === 'drafting' && (
            <p className="text-muted-foreground">{t('The AI is reading the official documentation and drafting the definition…')}</p>
          )}

          <section className="space-y-2">
            <h3 className={FONT.label}>{t('Test evidence')}</h3>
            {draft.failure_class && DRAFT_FAILURE_LABELS[draft.failure_class] && (
              <p className="text-[12px] text-[var(--status-danger)]">{t(DRAFT_FAILURE_LABELS[draft.failure_class])}</p>
            )}
            {latestRound ? (
              <div className="space-y-1">
                <p className="text-[12px] text-muted-foreground">
                  {t('Last tested {when}: {outcome}', { when: new Date(latestRound.at).toLocaleString(), outcome: latestRound.outcome })}
                </p>
                <ul className="space-y-1">
                  {latestRound.results.map((r) => (
                    <li key={r.command} className="flex items-baseline gap-2 text-[12px]">
                      <span className="font-mono text-foreground">{r.command}</span>
                      <span className="text-muted-foreground">
                        {!r.executed
                          ? t('Not run — assembled only')
                          : r.failure
                            ? t(DRAFT_FAILURE_LABELS[r.failure] ?? r.failure)
                            : t('OK ({status})', { status: r.status ?? '' })}
                      </span>
                    </li>
                  ))}
                </ul>
                {latestRound.control && <p className="text-[12px] text-muted-foreground">{latestRound.control}</p>}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">{t('Not tested yet.')}</p>
            )}
          </section>

          {draft.status === 'awaiting_review' && (
            <section className="space-y-2 rounded-md bg-[var(--surface-strong)] px-3 py-3">
              <h3 className={FONT.label}>{t('Review')}</h3>
              {draft.expires_at && (
                <p className="text-[12px] text-muted-foreground">
                  {t('Decide by {when} — after that the draft expires.', { when: new Date(draft.expires_at).toLocaleString() })}
                </p>
              )}
              {targetName && targetName !== draft.name && (
                <p className="text-[12px] text-[var(--status-warning)]">
                  {t('Activating renames the connection from “{from}” to “{to}”.', { from: targetName, to: draft.name })}
                </p>
              )}
              {canReview ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => void decide(true)} disabled={deciding}>
                    {t('Activate')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void decide(false)} disabled={deciding}>
                    {t('Reject')}
                  </Button>
                </div>
              ) : (
                <p className="text-[12px] text-muted-foreground">{t('Only a Space owner can decide.')}</p>
              )}
              {decideError && <p className="text-[12px] text-[var(--status-danger)]">{decideError}</p>}
            </section>
          )}

          {draft.status === 'active' && draft.decided_at && (
            <p className="text-[12px] text-muted-foreground">
              {t('Activated on {when}.', { when: new Date(draft.decided_at).toLocaleString() })}
            </p>
          )}

          {staged && (draft.status === 'testing' || draft.status === 'awaiting_review') && (
            <section className="space-y-2">
              <h3 className={FONT.label}>{t('Credential and test')}</h3>
              {draft.auth_type && draft.auth_type !== 'none' && (
                <div className="space-y-2">
                  <p className="text-[12px] text-muted-foreground">
                    {staged.secret_id ? t('A credential is stored. Enter a new one to replace it.') : t('No credential stored yet.')}
                  </p>
                  {canReview ? (
                    <div className="flex gap-2">
                      <Input type="password" value={secretInput} onChange={(e) => setSecretInput(e.target.value)}
                        placeholder={t('Credential')} aria-label={t('Credential')}
                        className="h-8 flex-1 text-[13px] md:text-[13px]" autoComplete="off" />
                      <Button size="sm" variant="secondary" onClick={() => void saveSecret()}
                        disabled={!secretInput.trim() || actions.secret.isPending}>
                        {t('Save credential')}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">{t('Only Space owners can enter the credential and run the test.')}</p>
                  )}
                </div>
              )}
              {draft.status === 'testing' && canReview && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void test(false)} disabled={testBusy}>
                      {testBusy ? t('Testing…') : t('Run the test')}
                    </Button>
                    {latestRound && (latestRound.outcome === 'auth_unverified' || latestRound.outcome === 'unverifiable') && (
                      <Button size="sm" variant="secondary" onClick={() => void test(true)} disabled={testBusy}>
                        {t('Send to review anyway')}
                      </Button>
                    )}
                  </div>
                  {latestRound && (latestRound.outcome === 'auth_unverified' || latestRound.outcome === 'unverifiable') && (
                    <p className="text-[12px] text-muted-foreground">
                      {t('The test could not verify authentication. You can still send it to review — the evidence above is what the reviewer sees.')}
                    </p>
                  )}
                </div>
              )}
              {testError && <p className="text-[12px] text-[var(--status-danger)]">{testError}</p>}
            </section>
          )}

          {steps.length > 0 && (
            <section className="space-y-2">
              <h3 className={FONT.label}>{t('Drafting record')}</h3>
              <ol className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {steps.map((s) => (
                  <li key={s.id} className="text-[12px]">
                    <span className="text-foreground">{s.title}</span>
                    {s.detail && <span className="block truncate text-muted-foreground" title={s.detail}>{s.detail}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {OPEN.includes(draft.status) && run && (
            <section className="space-y-2">
              <h3 className={FONT.label}>{t('Talk to the drafting AI')}</h3>
              <Textarea
                value={words}
                onChange={(e) => setWords(e.target.value)}
                disabled={!canSend}
                placeholder={draft.status === 'awaiting_input' ? t('Your answer…') : t('Ask for a change…')}
                className="min-h-20 text-[13px] md:text-[13px]"
              />
              {sendError && <p className="text-[12px] text-[var(--status-danger)]">{sendError}</p>}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-muted-foreground">
                  {run.status === 'queued' || run.status === 'running' ? t('The AI is working…') : !runAtRest ? t('The drafting run has ended.') : null}
                </p>
                <Button size="sm" onClick={() => void send()} disabled={!canSend || !words.trim()}>
                  {t('Send')}
                </Button>
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CommandGroup({ title, rows, t }: {
  title: string;
  rows: ReturnType<typeof readManifestCommands>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="text-[12px] font-medium text-foreground">{title}</h4>
      <ul className="mt-1 divide-y divide-[var(--border-subtle)]">
        {rows.map((c) => (
          <li key={c.name} className="flex items-baseline gap-2 py-1.5">
            <span className="font-mono text-[12px] text-foreground">{c.name}</span>
            {c.critical && (
              <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-[var(--status-danger-subtle)] px-1.5 text-[10px] font-medium text-[var(--status-danger)]">
                {t(CRITICAL_CLASS_LABELS[c.critical])}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {[c.method, c.path].filter(Boolean).join(' ')}
              {c.description ? ` — ${c.description}` : ''}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{c.permission}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
