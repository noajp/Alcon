'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { appDialog } from '@/Function/shared/appDialogStore';
import type { PromotionDraft, PromotionDraftStatus } from '@/types/database';
import type { Definition } from '@/hooks/definitionData';
import {
  acceptUnverifiablePromotion, activatePromotionDraft, rejectPromotionDraft, rollbackPromotedDefinition,
  sendPromotionMessage, usePromotionDraftDetail, usePromotionDrafts, usePromotionObjectNames,
} from './promotionData';
import {
  draftPackageWeb, promotionDriftWeb, promotionStructureHashWeb, readRehearsalReportWeb,
} from './promotionModel';
import { checkHarness, parseDefinition } from './harnessDefinition';

// Settings › AI › Harnesses › Promotions: one-off work on its way to
// becoming a standing harness. The section lists the Space's drafts at
// every stage; the dialog is the draft's whole life in one place — the
// conversation with the drafter, the package it proposes, the
// rehearsal's evidence, and the owner's decisions (activation is bound
// to the tested hashes; the RPC refuses an update whose target moved).
// Nothing here can create a definition or an Automation except the
// owner's activation, which is the RPC's act, not this screen's.

const STATUS_LABELS: Record<PromotionDraftStatus, string> = {
  drafting: 'Drafting',
  awaiting_input: 'Waiting for an answer',
  rehearsing: 'Rehearsing',
  awaiting_review: 'Waiting for review',
  active: 'Active',
  rejected: 'Rejected',
  expired: 'Expired',
  failed: 'Failed',
};

function StatusChip({ status }: { status: PromotionDraftStatus }) {
  const { t } = useI18n();
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium',
      status === 'awaiting_review' ? 'bg-[var(--status-warning-subtle)] text-[var(--status-warning)]'
      : status === 'active' ? 'bg-[var(--status-success-subtle)] text-[var(--status-success)]'
      : status === 'failed' || status === 'rejected' ? 'bg-[var(--status-danger-subtle)] text-[var(--status-danger)]'
      : 'bg-[var(--surface-strong)] text-muted-foreground')}>
      {t(STATUS_LABELS[status])}
    </span>
  );
}

export function PromotionsSection({ spaceId, isOwner, definitions, onChanged }: {
  spaceId: string | null;
  isOwner: boolean;
  definitions: Definition[];
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const drafts = usePromotionDrafts(spaceId);
  const objectNames = usePromotionObjectNames(spaceId);
  const [open, setOpen] = useState<PromotionDraft | null>(null);
  const live = useMemo(
    () => (open ? drafts.data.find((d) => d.id === open.id) ?? open : null),
    [open, drafts.data],
  );
  if (!spaceId || (drafts.data.length === 0 && !drafts.loading)) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-medium text-foreground">{t('Promotion drafts')}</h3>
      <div>
        {drafts.data.map((d) => {
          const target = d.activated_definition_id
            ? definitions.find((x) => x.id === d.activated_definition_id) ?? null : null;
          const drift = d.status === 'active' && target && d.activated_body && d.name
            ? promotionDriftWeb({ name: d.name, body: d.activated_body }, { name: target.name, body: target.body })
            : null;
          return (
            <div key={d.id} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 transition-colors hover:bg-[var(--surface-strong)]">
              <button type="button" onClick={() => setOpen(d)}
                className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:underline">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {d.name ?? t(d.source_kind === 'memory' ? 'From a memory' : 'From a finished run')}
                    </span>
                    <StatusChip status={d.status} />
                    {drift?.drifted && (
                      <span className="shrink-0 rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--status-warning)]">
                        {t('Edited since activation — structural changes: {aspects}', { aspects: drift.aspects.join(', ') })}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {t(d.source_kind === 'memory' ? 'From a memory' : 'From a finished run')}
                    {d.status === 'awaiting_input' && d.awaiting_question ? ` · ${d.awaiting_question}` : ''}
                  </div>
                </div>
              </button>
              {(d.status === 'awaiting_review' || (d.status === 'rehearsing' && readRehearsalReportWeb(d.rehearsal_report).outcome === 'unverifiable')) && (
                <Button size="xs" variant="secondary" onClick={() => setOpen(d)}>{t('Review')}</Button>
              )}
            </div>
          );
        })}
      </div>
      {live && (
        <PromotionDraftDialog draft={live} isOwner={isOwner} definitions={definitions}
          objectNames={objectNames}
          onClose={() => setOpen(null)}
          onChanged={() => { void drafts.refetch(); onChanged?.(); }} />
      )}
    </div>
  );
}

export function PromotionDraftDialog({ draft, isOwner, definitions, objectNames, onClose, onChanged }: {
  draft: PromotionDraft;
  isOwner: boolean;
  definitions: Definition[];
  objectNames: Map<string, string>;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const detail = usePromotionDraftDetail(draft);
  const pkg = draftPackageWeb(draft);
  const report = readRehearsalReportWeb(draft.rehearsal_report);
  const unverifiable = draft.status === 'rehearsing' && report.outcome === 'unverifiable';
  const target = draft.target_definition_id
    ? definitions.find((x) => x.id === draft.target_definition_id) ?? null : null;
  const activated = draft.activated_definition_id
    ? definitions.find((x) => x.id === draft.activated_definition_id) ?? null : null;
  const activatedDrift = draft.status === 'active' && activated && draft.activated_body && draft.name
    ? promotionDriftWeb({ name: draft.name, body: draft.activated_body }, { name: activated.name, body: activated.body })
    : null;

  // An update's base check, the same comparison the RPC makes: the
  // target's current structure hash against the base the draft pinned.
  const baseCheck = useQuery({
    queryKey: ['promotion-base-check', target?.id, target?.updated_at, draft.base_definition_hash] as const,
    enabled: !!target && !!draft.base_definition_hash,
    queryFn: () => promotionStructureHashWeb(target!.name, target!.body),
  });
  const baseMoved = !!baseCheck.data && !!draft.base_definition_hash && baseCheck.data !== draft.base_definition_hash;

  const warnings = useMemo(() => {
    if (!pkg) return [];
    return checkHarness(parseDefinition(pkg.body)).filter((d) => d.severity !== 'error').map((d) => d.message);
  }, [pkg]);
  const nameConflict = pkg
    ? definitions.find((x) => x.id !== draft.target_definition_id
      && x.name.trim().toLowerCase() === pkg.name.trim().toLowerCase()) ?? null
    : null;

  const [words, setWords] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const send = async () => {
    if (!draft.draft_run_id || !words.trim()) return;
    setSending(true); setSendError(null);
    try {
      await sendPromotionMessage(draft.draft_run_id, words.trim());
      setWords('');
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const decide = async (action: 'activate' | 'reject' | 'accept' | 'rollback') => {
    const confirmText = action === 'activate'
      ? `${t('Activate this promotion?')} ${t('The tested definition goes live exactly as reviewed.')}${pkg?.binding.trigger ? ` ${t('Its automation starts enabled.')}` : ''}`
      : action === 'reject' ? t('Reject this promotion?')
      : null;
    if (confirmText && !(await appDialog.confirm(confirmText))) return;
    setDeciding(true); setDecideError(null);
    try {
      if (action === 'activate') await activatePromotionDraft(draft.id);
      else if (action === 'reject') await rejectPromotionDraft(draft.id);
      else if (action === 'accept') await acceptUnverifiablePromotion(draft.id);
      else await rollbackPromotedDefinition(draft.id);
      onChanged?.();
      if (action === 'activate') onClose();
    } catch (e) {
      setDecideError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeciding(false);
    }
  };

  const objectName = pkg?.binding.objectId ? objectNames.get(pkg.binding.objectId) ?? null : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="truncate">{draft.name ?? t('Promotion drafts')}</DialogTitle>
            <StatusChip status={draft.status} />
          </div>
          <DialogDescription className="pt-1 text-[12px]">
            {t(draft.source_kind === 'memory' ? 'From a memory' : 'From a finished run')}
            {draft.expires_at && draft.status === 'awaiting_review'
              ? ` · ${t('Expires {date}', { date: new Date(draft.expires_at).toLocaleDateString() })}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-[13px]">
          {draft.material_sources.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-[12px] font-medium text-muted-foreground">{t('Material provenance')}</h4>
              {draft.material_sources.some((s) => s.tainted) && (
                <p className="text-[12px] text-[var(--status-warning)]">{t('A fragment was excluded: it carried a secret-like value')}</p>
              )}
              {draft.material_sources.some((s) => s.instructionShaped) && (
                <p className="text-[12px] text-[var(--status-warning)]">{t('Instruction-shaped text in the source was excluded')}</p>
              )}
            </section>
          )}

          {pkg && (
            <section className="space-y-2">
              <div className="text-[12px] text-muted-foreground">
                {pkg.binding.objectId
                  ? t('Object: {name}', { name: objectName ?? pkg.binding.objectId })
                  : t('No object chosen yet')}
                {' · '}
                {pkg.binding.trigger
                  ? t('Schedule: {cron} ({timezone})', { cron: pkg.binding.trigger.cron, timezone: pkg.binding.trigger.timezone })
                  : t('No automation — a person runs this harness by hand')}
              </div>
              {nameConflict && (
                <p className="text-[12px] text-[var(--status-warning)]">
                  {t('A different harness already carries this name: {name}', { name: nameConflict.name })}
                </p>
              )}
              <div className="max-h-[40vh] overflow-y-auto rounded-md bg-[var(--surface-strong)] p-3">
                <MarkdownLite text={pkg.body} />
              </div>
              {warnings.length > 0 && (
                <ul className="list-inside list-disc text-[12px] text-muted-foreground">
                  {warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
            </section>
          )}

          {(report.reads.length > 0 || report.writes.length > 0 || report.outcome) && (
            <section className="space-y-1">
              <h4 className="text-[12px] font-medium text-muted-foreground">{t('Rehearsal evidence')}</h4>
              <p className="text-[12px] text-foreground">
                {t('Reads executed {total} ({ok} passed)', {
                  total: report.reads.length, ok: report.reads.filter((r) => r.ok).length,
                })}
                {' · '}
                {t('Writes planned {total} ({ok} could be assembled)', {
                  total: report.writes.length, ok: report.writes.filter((w) => w.valid).length,
                })}
              </p>
              {report.writes.filter((w) => !w.valid).map((w) => (
                <p key={w.tool} className="text-[12px] text-[var(--status-danger)]">{w.tool}{w.problem ? ` — ${w.problem}` : ''}</p>
              ))}
              {report.reads.filter((r) => !r.ok).map((r) => (
                <p key={r.tool} className="text-[12px] text-[var(--status-danger)]">{r.tool}</p>
              ))}
            </section>
          )}

          {unverifiable && (
            <p className="rounded-md bg-[var(--surface-strong)] px-3 py-2 text-[12px] text-foreground">
              {t('The rehearsal verified nothing — no reads ran. Only an owner can carry it to review, by acknowledging that here.')}
            </p>
          )}

          {draft.status === 'awaiting_review' && target && baseMoved && (
            <p className="rounded-md bg-[var(--surface-strong)] px-3 py-2 text-[12px] text-[var(--status-danger)]">
              {t('The definition this updates was edited after drafting began. Activation will be refused — reject this draft and draft again.')}
            </p>
          )}

          {draft.status === 'active' && activatedDrift && (
            <p className="text-[12px] text-muted-foreground">
              {activatedDrift.drifted
                ? t('Edited since activation — structural changes: {aspects}', { aspects: activatedDrift.aspects.join(', ') })
                : t('Unchanged since activation')}
            </p>
          )}

          {detail.steps.length > 0 && (
            <section className="space-y-1">
              {detail.steps.slice(-30).map((s) => (
                <div key={s.id} className="text-[12px]">
                  <span className="text-foreground">{s.title}</span>
                  {s.detail && <span className="block whitespace-pre-wrap text-muted-foreground">{s.detail.slice(0, 400)}</span>}
                </div>
              ))}
            </section>
          )}

          {(draft.status === 'drafting' || draft.status === 'awaiting_input') && draft.draft_run_id && (
            <section className="space-y-2">
              {draft.awaiting_question && (
                <p className="text-[12px] text-foreground"><span className="text-muted-foreground">{t('Question')}: </span>{draft.awaiting_question}</p>
              )}
              <Textarea value={words} onChange={(e) => setWords(e.target.value)} rows={2}
                placeholder={t('Type a message for the drafter…')} />
              {sendError && <p className="text-[12px] text-[var(--status-danger)]">{sendError}</p>}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void send()} disabled={sending || !words.trim()}>{t('Send')}</Button>
              </div>
            </section>
          )}

          {decideError && <p className="text-[12px] text-[var(--status-danger)]">{decideError}</p>}
          {!isOwner && (draft.status === 'awaiting_review' || unverifiable) && (
            <p className="text-[12px] text-muted-foreground">{t('Only a Space owner decides.')}</p>
          )}
          {isOwner && draft.status === 'awaiting_review' && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => void decide('reject')} disabled={deciding}>{t('Reject')}</Button>
              <Button size="sm" onClick={() => void decide('activate')} disabled={deciding || baseMoved}>{t('Activate')}</Button>
            </div>
          )}
          {isOwner && unverifiable && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => void decide('reject')} disabled={deciding}>{t('Reject')}</Button>
              <Button size="sm" onClick={() => void decide('accept')} disabled={deciding}>{t('Accept and send to review')}</Button>
            </div>
          )}
          {isOwner && draft.status === 'active' && activatedDrift?.drifted && (
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => void decide('rollback')} disabled={deciding}>
                {t('Roll back to the activated version')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
