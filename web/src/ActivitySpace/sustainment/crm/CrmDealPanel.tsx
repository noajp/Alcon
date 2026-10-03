'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Mail, Trash2, X } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { Textarea } from '@/ui/textarea';
import { DateField } from '@/Function/shared/date';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { OperationsAction } from '@/ActivitySpace/sustainment/operations/OperationsAction';
import type { Json } from '@/types/database';
import { ACTIVITY_TYPES, LOST_STAGE, shiftDate, stageChange, WON_STAGE, type CrmActivityType, type CrmDeal, type CrmStage } from './crmModel';
import { aiBrief, aiEmail, useCrmAi, type DealBrief, type DealEmail } from './crmAi';
import { HealthBadge, money, relativeDay } from './crmFormat';
import type { Crm } from './useCrm';

const ACTIVITY_LABEL: Record<CrmActivityType, string> = { call: 'Call', email: 'Mail', meeting: 'Meeting', note: 'Memo' };
const FIELD_INPUT = 'h-7 w-full min-w-0 rounded-sm bg-transparent px-1.5 text-[13px] hover:bg-muted/40 focus:bg-muted/60 outline-none';

/** A property row that saves when it loses focus or on Enter; Esc restores. */
function EditableText({ label, value, onSave, numeric = false, placeholder }: {
  label: string; value: string | number | null; onSave: (value: Json | null) => Promise<void>; numeric?: boolean; placeholder?: string;
}) {
  const initial = value === null ? '' : String(value);
  const [draft, setDraft] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) { setSynced(initial); setDraft(initial); }
  const [error, setError] = useState(false);
  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === initial) return;
    const parsed = numeric ? (trimmed === '' ? null : Number(trimmed.replace(/,/g, ''))) : trimmed || null;
    if (numeric && parsed !== null && !Number.isFinite(parsed)) { setError(true); return; }
    setError(false);
    try { await onSave(parsed); } catch { setError(true); }
  }
  return <input aria-label={label} aria-invalid={error || undefined} className={`${FIELD_INPUT} ${value === null ? 'text-muted-foreground' : ''} ${error ? 'bg-[var(--status-danger-subtle)]' : ''}`}
    inputMode={numeric ? 'decimal' : undefined} placeholder={placeholder ?? '—'} value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={() => void commit()}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(initial); event.stopPropagation(); } }} />;
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2">
    <span className="text-xs text-muted-foreground">{label}</span><div className="min-w-0">{children}</div>
  </div>;
}

export function CrmDealPanel({ crm, deal, onClose, onOpenTable, onCapture }: {
  crm: Crm; deal: CrmDeal; onClose: () => void; onOpenTable?: () => void; onCapture: (dealId: string) => void;
}) {
  const { t, locale } = useI18n();
  const today = crm.today;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [noteType, setNoteType] = useState<CrmActivityType>('call');
  const [brief, setBrief] = useState<DealBrief | null>(null);
  const [email, setEmail] = useState<DealEmail | null>(null);
  const [emailIntent, setEmailIntent] = useState('');
  const [ai, setAi] = useState<'brief' | 'email' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiState = useCrmAi();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [createdElement, setCreatedElement] = useState<string>();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); throw cause; } finally { setBusy(false); }
  }
  const save = (values: Record<string, Json | null>) => run(() => crm.saveDeal(deal.id, values));
  const moveTo = (stage: CrmStage) => save(stageChange(deal, stage)).catch(() => {});

  async function logNote() {
    if (!note.trim()) return;
    await run(() => crm.logActivity(deal, { date: today, type: noteType, text: note.trim() })).then(() => setNote('')).catch(() => {});
  }
  async function completeNextStep() {
    const text = deal.nextStep ? t('Done: {step}', { step: deal.nextStep }) : t('Next action completed');
    await run(() => crm.logActivity(deal, { date: today, type: 'note', text }, { nextActionDate: null, nextStep: null })).catch(() => {});
  }
  async function askAi(kind: 'brief' | 'email') {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAi(kind); setAiError(null);
    try {
      if (kind === 'brief') setBrief(await aiBrief(deal, today, locale, controller.signal));
      else setEmail(await aiEmail(deal, today, locale, emailIntent, controller.signal));
    } catch (cause) {
      if (!controller.signal.aborted) setAiError(cause instanceof Error ? cause.message : t('AI is unavailable right now.'));
    } finally { if (abort.current === controller) setAi(null); }
  }

  const open = deal.outcome === 'open';
  const stages = [...crm.stages, ...(deal.stage && !crm.stages.some(stage => stage.id === deal.stage!.id) && open ? [deal.stage] : [])];
  const mailto = email && deal.email ? `mailto:${encodeURIComponent(deal.email)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}` : null;

  return <aside aria-label={t('Deal')} className="flex h-full w-full min-w-0 flex-col bg-card">
    <div className="flex items-start gap-2 px-5 pb-3 pt-5">
      <div className="min-w-0 flex-1 space-y-1">
        <input aria-label={t('Deal name')} key={deal.name} defaultValue={deal.name}
          className="w-full min-w-0 rounded-sm bg-transparent px-1 text-lg font-semibold outline-none hover:bg-muted/40 focus:bg-muted/60"
          onBlur={event => { const value = event.target.value.trim(); if (value && value !== deal.name) void save({ name: value }).catch(() => {}); }}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>{deal.account ?? t('No account')}</span>
          <span className="tabular-nums text-foreground">{money(deal.amount, deal.currency, locale)}</span>
          <HealthBadge level={deal.health.level} score={deal.health.score} t={t} />
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={t('Close panel')} onClick={onClose}><X size={14} /></Button>
    </div>

    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6">
      {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p>}
      {!deal.valid && <div role="status" className="space-y-1 rounded-md bg-[var(--status-warning-subtle)] p-3 text-xs">
        <p className="font-medium">{t('Complete these details to include this deal in the forecast')}</p>
        <ul className="list-inside list-disc text-muted-foreground">{deal.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      </div>}

      <section aria-label={t('Stage')} className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {stages.map(stage => <Button key={stage.id} shape="tab" size="xs" variant={open && deal.stage?.id === stage.id ? 'secondary' : 'ghost'}
            aria-pressed={open && deal.stage?.id === stage.id} disabled={busy} onClick={() => void moveTo(stage)}>{t(stage.label)}</Button>)}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant={deal.outcome === 'won' ? 'primary' : 'ghost'} aria-pressed={deal.outcome === 'won'} disabled={busy || deal.outcome === 'won'} onClick={() => void moveTo(WON_STAGE)}><Check size={12} />{t('Won')}</Button>
          <Button size="xs" variant={deal.outcome === 'lost' ? 'danger' : 'ghost'} aria-pressed={deal.outcome === 'lost'} disabled={busy || deal.outcome === 'lost'} onClick={() => void moveTo(LOST_STAGE)}>{t('Lost')}</Button>
          {!open && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void moveTo(crm.stages[crm.stages.length - 1] ?? crm.stages[0])}>{t('Reopen')}</Button>}
        </div>
      </section>

      {open && <section aria-label={t('Next step')} className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">{t('Next step')}</h3>
        {crm.hasField('nextStep') && <EditableText label={t('Next step')} value={deal.nextStep} placeholder={t('What happens next?')} onSave={value => save({ nextStep: value })} />}
        <div className="flex flex-wrap items-center gap-1">
          <DateField aria-label={t('Next action date')} value={deal.nextActionDate} onChange={value => void save({ nextActionDate: value }).catch(() => {})} placeholder={t('Set date')} />
          {deal.nextActionDate && <span className={`text-xs ${deal.nextActionDate < today ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>{relativeDay(deal.nextActionDate, today, locale, t)}</span>}
          <ButtonAppearanceProvider appearance="inline">
            {[[1, 'Tomorrow'], [3, '+3 days'], [7, 'Next week']].map(([days, label]) => <Button key={label} variant="ghost" size="xs" disabled={busy}
              onClick={() => void save({ nextActionDate: shiftDate(today, days as number) }).catch(() => {})}>{t(label as string)}</Button>)}
          </ButtonAppearanceProvider>
        </div>
        {(deal.nextStep || deal.nextActionDate) && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void completeNextStep()}><Check size={12} />{t('Mark done')}</Button>}
      </section>}

      {deal.health.reasons.length > 0 && <section aria-label={t('Why this score')} className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">{t('Why this score')}</h3>
        <ul className="space-y-1 text-[13px]">{deal.health.reasons.map(reason => <li key={reason.message} className="flex justify-between gap-3">
          <span>{t(reason.message, reason.values)}</span><span className="tabular-nums text-muted-foreground">−{reason.impact}</span>
        </li>)}</ul>
      </section>}

      <section aria-label={t('AI assist')} className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t('AI assist')}</h3>
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="ghost" disabled={ai !== null || aiState !== 'ready'} onClick={() => void askAi('brief')}>{ai === 'brief' ? t('Reading the deal…') : t('Brief me')}</Button>
          <Button size="xs" variant="ghost" disabled={ai !== null || aiState !== 'ready'} onClick={() => void askAi('email')}>{ai === 'email' ? t('Drafting…') : t('Draft follow-up email')}</Button>
          <Button size="xs" variant="ghost" onClick={() => onCapture(deal.id)}>{t('Update from notes')}</Button>
        </div>
        {aiState === 'unavailable' && <p className="text-xs text-muted-foreground">{t('AI drafting turns on once the updated alcon-copilot function is deployed.')}</p>}
        {aiError && <p role="alert" className="text-xs text-[var(--status-danger)]">{t(aiError)}</p>}
        {brief && <div className="space-y-2 text-[13px] leading-relaxed">
          <p>{brief.summary}</p>
          {brief.nextStep && <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t('Recommended')}:</span><span>{brief.nextStep}</span>
            {crm.hasField('nextStep') && open && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void save({ nextStep: brief.nextStep.slice(0, 140) }).catch(() => {})}>{t('Use as next step')}</Button>}</div>}
          {brief.risks.length > 0 && <div><p className="text-xs text-muted-foreground">{t('Risks')}</p><ul className="list-inside list-disc">{brief.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></div>}
          {brief.questions.length > 0 && <div><p className="text-xs text-muted-foreground">{t('Ask the buyer')}</p><ul className="list-inside list-disc">{brief.questions.map(question => <li key={question}>{question}</li>)}</ul></div>}
        </div>}
        {(email || ai === 'email') && <div className="space-y-2">
          <input aria-label={t('Email intent')} placeholder={t('Optional: what should this email achieve?')} value={emailIntent} onChange={event => setEmailIntent(event.target.value)}
            className="h-7 w-full rounded-sm bg-muted/30 px-2 text-xs outline-none focus:bg-muted/60" />
          {email && <>
            <input aria-label={t('Subject')} value={email.subject} onChange={event => setEmail({ ...email, subject: event.target.value })} className="h-8 w-full rounded-sm bg-muted/30 px-2 text-[13px] font-medium outline-none focus:bg-muted/60" />
            <Textarea aria-label={t('Email body')} rows={8} value={email.body} onChange={event => setEmail({ ...email, body: event.target.value })} className="text-[13px]" />
            <div className="flex flex-wrap gap-1">
              <Button size="xs" variant="ghost" onClick={() => void navigator.clipboard?.writeText(`${email.subject}\n\n${email.body}`)}><Copy size={12} />{t('Copy')}</Button>
              {mailto && <Button size="xs" variant="ghost" asChild><a href={mailto}><Mail size={12} />{t('Open in mail')}</a></Button>}
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run(() => crm.logActivity(deal, { date: today, type: 'email', text: `${email.subject} — ${email.body.slice(0, 280)}` })).catch(() => {})}>{t('Log as sent')}</Button>
              <Button size="xs" variant="ghost" disabled={ai !== null} onClick={() => void askAi('email')}>{t('Redraft')}</Button>
            </div>
          </>}
        </div>}
      </section>

      <section aria-label={t('Details')} className="space-y-1">
        <h3 className="pb-1 text-xs font-medium text-muted-foreground">{t('Details')}</h3>
        <Property label={t('Account')}><EditableText label={t('Account')} value={deal.account} onSave={value => save({ account: value })} /></Property>
        {crm.hasField('contact') && <Property label={t('Contact')}><EditableText label={t('Contact')} value={deal.contact} onSave={value => save({ contact: value })} /></Property>}
        {crm.hasField('email') && <Property label={t('Email')}><EditableText label={t('Email')} value={deal.email} onSave={value => save({ email: value })} /></Property>}
        <Property label={t('Amount')}><EditableText numeric label={t('Amount')} value={deal.amount} onSave={value => save({ amount: value })} /></Property>
        <Property label={t('Currency')}><EditableText label={t('Currency')} value={deal.currency} placeholder="JPY" onSave={value => save({ currency: typeof value === 'string' ? value.toUpperCase() : value })} /></Property>
        <Property label={t('Probability')}><EditableText numeric label={t('Probability (%)')} value={deal.probability} onSave={value => save({ probability: value })} /></Property>
        <Property label={t('Close date')}><DateField aria-label={t('Close date')} value={deal.closeDate} onChange={value => void save({ closeDate: value }).catch(() => {})} placeholder={t('Set date')} /></Property>
        <Property label={t('Last contact')}><DateField aria-label={t('Last contact')} value={deal.lastContact} onChange={value => void save({ lastContact: value }).catch(() => {})} placeholder={t('Set date')} /></Property>
      </section>

      <section aria-label={t('Activity')} className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t('Activity')}</h3>
        {crm.hasField('activity') ? <TextComposer rows={2} aria-label={t('Log activity')} placeholder={t('What happened? Calls, emails and meetings also update the last contact.')}
          value={note} onChange={event => setNote(event.target.value)} disabled={busy}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void logNote(); } }}
          hint={<span className="flex flex-wrap gap-1">{ACTIVITY_TYPES.map(type => <Button key={type} shape="tab" size="xs" variant={noteType === type ? 'secondary' : 'ghost'} aria-pressed={noteType === type} onClick={() => setNoteType(type)}>{t(ACTIVITY_LABEL[type])}</Button>)}</span>}
          action={<Button size="xs" variant="primary" disabled={busy || !note.trim()} onClick={() => void logNote()}>{t('Log')}</Button>} />
          : <p className="text-xs text-muted-foreground">{t('Add the Activity log column in Pipeline settings to keep a timeline here.')}</p>}
        {deal.activity.length > 0 ? <ol className="space-y-3">{deal.activity.map((entry, index) => <li key={index} className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{t(ACTIVITY_LABEL[entry.type])}</span>{entry.date && <span>{relativeDay(entry.date, today, locale, t)}</span>}</div>
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{entry.text}</p>
        </li>)}</ol> : crm.hasField('activity') && <p className="text-xs text-muted-foreground">{t('No activity yet.')}</p>}
      </section>

      <section className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
        {crm.params.tableId && <OperationsAction tableId={crm.params.tableId} rowId={deal.id} createdId={createdElement} onCreated={setCreatedElement}
          label={t('Create follow-up Element')} title={`${t('Follow up')}: ${deal.name}`}
          detail={[deal.nextStep, deal.action ? t(deal.action.message, deal.action.values) : null, ...deal.health.reasons.map(reason => t(reason.message, reason.values))].filter(Boolean).join('\n')} />}
        {onOpenTable && <Button size="sm" variant="ghost" onClick={onOpenTable}><ArrowUpRight size={14} />{t('Open in Table')}</Button>}
        {confirmDelete
          ? <span className="ml-auto flex items-center gap-2"><span className="text-xs">{t('Delete this deal?')}</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => crm.deleteDeal(deal.id)).then(onClose).catch(() => {})}>{t('Delete')}</Button></span>
          : <Button size="sm" variant="ghost" className="ml-auto" aria-label={t('Delete deal')} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></Button>}
      </section>
    </div>
  </aside>;
}
