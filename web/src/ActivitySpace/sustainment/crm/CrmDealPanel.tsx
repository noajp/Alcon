'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Mail, Trash2, X } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { Textarea } from '@/ui/textarea';
import { DateField } from '@/Function/shared/date';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useStrategies } from '@/ActivitySpace/strategy/initiative/strategyData';
import type { Crm, CrmDealPatch } from '@/hooks/useCrm';
import { ACTIVITY_TYPES, LOST_STAGE, shiftDate, stageChange, WON_STAGE, type CrmActivity, type CrmActivityType, type CrmDeal, type CrmStage } from './crmModel';
import { aiBrief, aiEmail, useCrmAi, type DealBrief, type DealEmail } from './crmAi';
import { HealthBadge, money, relativeDay } from './crmFormat';
import { CrmPicker } from './CrmPicker';
import { CustomFields, EditableText, Property } from './CrmFields';

const ACTIVITY_LABEL: Record<CrmActivity['type'], string> = { call: 'Call', email: 'Mail', meeting: 'Meeting', note: 'Memo', stage: 'Stage' };

function NextStep({ crm, deal }: { crm: Crm; deal: CrmDeal }) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState(deal.nextStep ?? '');
  const [due, setDue] = useState<string | null>(deal.nextActionDate);
  const [synced, setSynced] = useState(`${deal.nextStep}|${deal.nextActionDate}`);
  if (synced !== `${deal.nextStep}|${deal.nextActionDate}`) { setSynced(`${deal.nextStep}|${deal.nextActionDate}`); setTitle(deal.nextStep ?? ''); setDue(deal.nextActionDate); }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = crm.today;
  const dirty = title.trim() !== (deal.nextStep ?? '') || due !== deal.nextActionDate;
  async function save(nextDue = due) {
    if (!title.trim()) { setError(t('Describe the next step.')); return; }
    setBusy(true); setError(null);
    try { setNotice(await crm.setNextStep(deal, { title, due: nextDue })); } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); } finally { setBusy(false); }
  }
  async function done() {
    setBusy(true); setError(null);
    try { await crm.completeNextStep(deal); } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); } finally { setBusy(false); }
  }
  const element = deal.nextElement && !['done', 'cancelled'].includes(deal.nextElement.status) ? deal.nextElement : null;
  return <section aria-label={t('Next step')} className="space-y-2">
    <div className="flex items-center gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{t('Next step')}</h3>
      {element && <span className="text-[11px] text-muted-foreground">{t('Element')} {element.display_id ?? ''}</span>}
    </div>
    <input aria-label={t('Next step')} placeholder={t('What happens next?')} value={title} disabled={busy}
      onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && dirty) void save(); }}
      className="h-8 w-full rounded-sm bg-muted/30 px-2 text-[13px] outline-none hover:bg-muted/40 focus:bg-muted/60" />
    <div className="flex flex-wrap items-center gap-1">
      <DateField aria-label={t('Next action date')} value={due} onChange={value => setDue(value)} placeholder={t('Set date')} />
      {due && <span className={`text-xs ${due < today ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>{relativeDay(due, today, locale, t)}</span>}
      <ButtonAppearanceProvider appearance="inline">
        {[[1, 'Tomorrow'], [3, '+3 days'], [7, 'Next week']].map(([days, label]) => <Button key={label} variant="ghost" size="xs" disabled={busy}
          onClick={() => { const next = shiftDate(today, days as number); setDue(next); if (title.trim()) void save(next); }}>{t(label as string)}</Button>)}
      </ButtonAppearanceProvider>
    </div>
    <div className="flex flex-wrap items-center gap-1">
      {dirty && <Button size="xs" variant="primary" disabled={busy || !title.trim()} onClick={() => void save()}>{element ? t('Update next step') : t('Set next step')}</Button>}
      {(deal.nextStep || deal.nextActionDate) && !dirty && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void done()}><Check size={12} />{t('Mark done')}</Button>}
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">{crm.pipeline?.object_id ? t('Saved as an Element in the pipeline’s Object, assigned to the owner — it shows in Calendar and Workload.')
      : !deal.ownerId || deal.ownerId === crm.me ? t('Saved as an Element in your My Elements. Choose an Object in Pipeline settings to give next steps to their owners.')
      : t('Saved on the deal. Choose an Object in Pipeline settings to make next steps Elements for their owners.')}</p>
    {notice && <p role="status" className="text-xs text-[var(--status-warning)]">{t(notice)}</p>}
    {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{t(error)}</p>}
  </section>;
}

export function CrmDealPanel({ crm, deal, onClose, onCapture, onOpenElement, onOpenInitiative, onOpenCompany }: {
  crm: Crm; deal: CrmDeal; onClose: () => void; onCapture: (dealId: string) => void;
  onOpenElement?: (id: string) => void; onOpenInitiative?: (id: string) => void; onOpenCompany: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const strategies = useStrategies();
  const workspace = crm.workspace!;
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
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); throw cause; } finally { setBusy(false); }
  }
  const save = (patch: CrmDealPatch) => run(() => crm.saveDeal(deal.id, patch));
  const moveTo = (stage: CrmStage) => save(stageChange(deal, stage)).catch(() => {});
  async function logNote() {
    if (!note.trim()) return;
    await run(() => crm.logActivity(deal.id, { type: noteType, text: note.trim() })).then(() => setNote('')).catch(() => {});
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
      if (!controller.signal.aborted) setAiError(cause instanceof Error ? cause.message : 'AI is unavailable right now.');
    } finally { if (abort.current === controller) setAi(null); }
  }

  const open = deal.outcome === 'open';
  const stages = [...workspace.stages, ...(deal.stage && open && !workspace.stages.some(stage => stage.id === deal.stage!.id) ? [deal.stage] : [])];
  const mailto = email && deal.email ? `mailto:${encodeURIComponent(deal.email)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}` : null;
  const companyContacts = crm.contacts.filter(contact => !deal.companyId || contact.company_id === deal.companyId || contact.id === deal.contactId);
  const initiative = strategies.data.find(item => item.id === deal.initiativeId);
  const dealFields = crm.fields.filter(field => field.entity === 'deal');

  return <aside aria-label={t('Deal')} className="flex h-full w-full min-w-0 flex-col bg-card">
    <div className="flex items-start gap-2 px-5 pb-3 pt-5">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><span className="tabular-nums">D-{deal.number}</span>{crm.pipelines.length > 1 && <span>· {workspace.pipeline.name}</span>}</div>
        <input aria-label={t('Deal name')} key={deal.name} defaultValue={deal.name}
          className="w-full min-w-0 rounded-sm bg-transparent px-1 text-lg font-semibold outline-none hover:bg-muted/40 focus:bg-muted/60"
          onBlur={event => { const value = event.target.value.trim(); if (value && value !== deal.name) void save({ name: value }).catch(() => {}); }}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          {deal.companyId ? <button type="button" className="rounded-sm hover:text-foreground" onClick={() => onOpenCompany(deal.companyId!)}>{deal.account}</button> : <span>{t('No company')}</span>}
          <span className="tabular-nums text-foreground">{money(deal.amount, deal.currency, locale)}</span>
          <HealthBadge level={deal.health.level} score={deal.health.score} t={t} />
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={t('Close panel')} onClick={onClose}><X size={14} /></Button>
    </div>

    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6">
      {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{t(error)}</p>}
      {!deal.valid && <div role="status" className="space-y-1 rounded-md bg-[var(--status-warning-subtle)] p-3 text-xs">
        <p className="font-medium">{t('Complete these details to include this deal in the forecast')}</p>
        <ul className="list-inside list-disc text-muted-foreground">{deal.issues.map(issue => <li key={issue.message}>{t(issue.message, issue.values)}</li>)}</ul>
      </div>}

      <section aria-label={t('Stage')} className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {stages.map(stage => <Button key={stage.id} shape="tab" size="xs" variant={open && deal.stage?.id === stage.id ? 'secondary' : 'ghost'}
            aria-pressed={open && deal.stage?.id === stage.id} disabled={busy} onClick={() => void moveTo(stage)}>{t(stage.label)}</Button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="xs" variant={deal.outcome === 'won' ? 'primary' : 'ghost'} aria-pressed={deal.outcome === 'won'} disabled={busy || deal.outcome === 'won'} onClick={() => void moveTo(WON_STAGE)}><Check size={12} />{t('Won')}</Button>
          <Button size="xs" variant={deal.outcome === 'lost' ? 'danger' : 'ghost'} aria-pressed={deal.outcome === 'lost'} disabled={busy || deal.outcome === 'lost'} onClick={() => void moveTo(LOST_STAGE)}>{t('Lost')}</Button>
          {!open && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void moveTo(workspace.stages[workspace.stages.length - 1])}>{t('Reopen')}</Button>}
        </div>
        {deal.outcome === 'lost' && <Property label={t('Lost reason')}><EditableText label={t('Lost reason')} value={deal.lostReason} placeholder={t('Why was it lost?')} onSave={value => save({ lostReason: value as string | null })} /></Property>}
      </section>

      {open && <NextStep key={deal.id} crm={crm} deal={deal} />}
      {deal.nextElement && onOpenElement && <Button size="xs" variant="ghost" onClick={() => onOpenElement(deal.nextElement!.id)}><ArrowUpRight size={12} />{t('Open Element')} {deal.nextElement.display_id ?? ''}</Button>}

      <section aria-label={t('Ownership and links')} className="space-y-1">
        <Property label={t('Owner')}><CrmPicker label={t('Owner')} value={deal.ownerId} placeholder={t('Unassigned')}
          options={crm.people.map(person => ({ id: person.id, label: person.name, hint: person.type === 'ai_agent' ? t('AI agent') : null }))}
          onChange={id => void save({ ownerId: id }).catch(() => {})} /></Property>
        <Property label={t('Company')}><CrmPicker label={t('Company')} value={deal.companyId} placeholder={t('No company')}
          options={crm.companies.map(company => ({ id: company.id, label: company.name, hint: company.industry }))}
          onChange={id => void save({ companyId: id }).catch(() => {})} onCreate={name => void save({ companyName: name }).catch(() => {})} /></Property>
        <Property label={t('Contact')}><CrmPicker label={t('Contact')} value={deal.contactId} placeholder={t('No contact')}
          options={companyContacts.map(contact => ({ id: contact.id, label: contact.name, hint: contact.title ?? contact.email }))}
          onChange={id => void save({ contactId: id }).catch(() => {})} onCreate={name => void save({ contactName: name }).catch(() => {})} /></Property>
        <Property label={t('Initiative')}>
          <div className="flex items-center gap-1">
            <CrmPicker label={t('Initiative')} value={deal.initiativeId} placeholder={t('Not linked')}
              options={strategies.data.map(item => ({ id: item.id, label: item.name }))} onChange={id => void save({ initiativeId: id }).catch(() => {})} />
            {initiative && onOpenInitiative && <Button variant="ghost" size="icon-xs" aria-label={t('Open Initiative')} onClick={() => onOpenInitiative(initiative.id)}><ArrowUpRight size={12} /></Button>}
          </div>
        </Property>
      </section>

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
            {open && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run(() => crm.setNextStep(deal, { title: brief.nextStep.slice(0, 280), due: deal.nextActionDate ?? shiftDate(today, 1) })).catch(() => {})}>{t('Use as next step')}</Button>}</div>}
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
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run(() => crm.logActivity(deal.id, { type: 'email', text: `${email.subject} — ${email.body.slice(0, 600)}` })).catch(() => {})}>{t('Log as sent')}</Button>
              <Button size="xs" variant="ghost" disabled={ai !== null} onClick={() => void askAi('email')}>{t('Redraft')}</Button>
            </div>
          </>}
        </div>}
      </section>

      <section aria-label={t('Details')} className="space-y-1">
        <h3 className="pb-1 text-xs font-medium text-muted-foreground">{t('Details')}</h3>
        <Property label={t('Amount')}><EditableText numeric label={t('Amount')} value={deal.amount} onSave={value => save({ amount: value as number | null })} /></Property>
        <Property label={t('Currency')}><EditableText label={t('Currency')} value={deal.currency} placeholder="JPY" onSave={value => {
          const code = typeof value === 'string' ? value.toUpperCase() : '';
          if (!/^[A-Z]{3}$/.test(code)) return Promise.reject(new Error('Currency must be a three-letter code, such as USD or JPY.'));
          return save({ currency: code });
        }} /></Property>
        <Property label={t('Probability')}><EditableText numeric label={t('Probability (%)')} value={deal.probability} onSave={value => save({ probability: value as number | null })} /></Property>
        <Property label={t('Close date')}><DateField aria-label={t('Close date')} value={deal.closeDate} onChange={value => void save({ closeDate: value }).catch(() => {})} placeholder={t('Set date')} /></Property>
        <Property label={t('Last contact')}><span className="px-1.5 text-[13px] text-muted-foreground">{relativeDay(deal.lastContact, today, locale, t)}</span></Property>
        <Property label={t('Source')}><EditableText label={t('Source')} value={deal.source} placeholder={t('e.g. Referral, Website')} onSave={value => save({ source: value as string | null })} /></Property>
        <CustomFields fields={dealFields} values={deal.custom} onSave={custom => save({ custom })} />
      </section>

      <section aria-label={t('Activity')} className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t('Activity')}</h3>
        <TextComposer rows={2} aria-label={t('Log activity')} placeholder={t('What happened? Calls, emails and meetings also update the last contact.')}
          value={note} onChange={event => setNote(event.target.value)} disabled={busy}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void logNote(); } }}
          hint={<span className="flex flex-wrap gap-1">{ACTIVITY_TYPES.map(type => <Button key={type} shape="tab" size="xs" variant={noteType === type ? 'secondary' : 'ghost'} aria-pressed={noteType === type} onClick={() => setNoteType(type)}>{t(ACTIVITY_LABEL[type])}</Button>)}</span>}
          action={<Button size="xs" variant="primary" disabled={busy || !note.trim()} onClick={() => void logNote()}>{t('Log')}</Button>} />
        {deal.activity.length > 0 ? <ol className="space-y-3">{deal.activity.map((entry, index) => <li key={entry.id ?? index} className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t(ACTIVITY_LABEL[entry.type])}</span>
            {entry.date && <span>{relativeDay(entry.date, today, locale, t)}</span>}
            {entry.author && <span>· {entry.author}</span>}
          </div>
          <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${entry.type === 'stage' ? 'text-muted-foreground' : ''}`}>
            {entry.type === 'stage' ? entry.text.split(' → ').map(part => t(workspace.stages.find(stage => stage.id === part)?.label ?? (part === 'won' ? 'Won' : part === 'lost' ? 'Lost' : part))).join(' → ') : entry.text}
          </p>
        </li>)}</ol> : <p className="text-xs text-muted-foreground">{t('No activity yet.')}</p>}
      </section>

      <section className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
        {confirmDelete
          ? <span className="ml-auto flex items-center gap-2"><span className="text-xs">{workspace.pipeline.record_label ? t('Delete this {name}?', { name: workspace.pipeline.record_label }) : t('Delete this deal?')}</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => crm.deleteDeal(deal.id)).then(onClose).catch(() => {})}>{t('Delete')}</Button></span>
          : <Button size="sm" variant="ghost" className="ml-auto" aria-label={t('Delete deal')} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></Button>}
      </section>
    </div>
  </aside>;
}
