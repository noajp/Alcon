'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, Mail, PenLine, X } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { Textarea } from '@/ui/textarea';
import { DateField } from '@/Function/shared/date';
import { PageHead } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { CrmIcon } from '@/Function/shared/conceptIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useStrategies } from '@/hooks/strategyData';
import type { Crm, CrmDealPatch } from '@/hooks/useCrm';
import { ACTIVITY_TYPES, DEAL_ROLES, fieldsFor, LOST_STAGE, stageChange, WON_STAGE, type CrmActivityType, type CrmDeal, type CrmDealRole, type CrmStage } from './crmModel';
import { aiBrief, aiEmail, useCrmAi, type DealBrief, type DealEmail } from './crmAi';
import { HealthBadge, historyLine, money, relativeDay, ROLE_LABEL } from './crmFormat';
import { StartRenewal } from './CrmToday';
import { CrmPicker } from './CrmPicker';
import { CustomFields, EditableText, Property } from './CrmFields';
import { CrmRecordPage, RecordSection } from './CrmRecordPage';
import { CrmRelatedWork } from './CrmRelatedWork';
import { shiftDateOnly } from '@/Function/shared/dateUtils';

const ACTIVITY_LABEL: Record<CrmActivityType, string> = { call: 'Call', email: 'Mail', meeting: 'Meeting', note: 'Memo' };

/** Everyone on the buying side beyond the main contact, with their part in the decision. */
function DealPeople({ crm, deal, onOpenContact }: { crm: Crm; deal: CrmDeal; onOpenContact: (id: string) => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const run = (work: Promise<unknown>) => { setError(null); work.catch(cause => setError(cause instanceof Error ? cause.message : t('Could not save. Try again.'))); };
  // The main contact shows once, as the main contact.
  const rows = crm.dealContacts.filter(row => row.deal_id === deal.id && row.contact_id !== deal.contactId)
    .map(row => ({ row, contact: crm.contacts.find(contact => contact.id === row.contact_id) }))
    .filter((item): item is { row: typeof item.row; contact: NonNullable<typeof item.contact> } => !!item.contact)
    .sort((a, b) => DEAL_ROLES.indexOf(a.row.role) - DEAL_ROLES.indexOf(b.row.role) || a.contact.name.localeCompare(b.contact.name));
  const taken = new Set([deal.contactId, ...rows.map(item => item.contact.id)]);
  // The deal's company first: that is where the buying group usually is.
  const candidates = crm.contacts.filter(contact => !taken.has(contact.id))
    .sort((a, b) => Number(b.company_id === deal.companyId) - Number(a.company_id === deal.companyId) || a.name.localeCompare(b.name));
  const roles = DEAL_ROLES.map(role => ({ id: role, label: t(ROLE_LABEL[role]) }));
  return <RecordSection title={t('People involved')}>
    <div className="max-w-xl space-y-1">
      {rows.map(({ row, contact }) => <div key={row.id} className="group flex items-center gap-2 rounded-md transition-colors hover:bg-muted/40">
        <button type="button" className="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-[13px] outline-none" onClick={() => onOpenContact(contact.id)}>
          {contact.name}{contact.title && <span className="text-muted-foreground"> · {contact.title}</span>}
        </button>
        <CrmPicker label={t('Role of {name}', { name: contact.name })} value={row.role} clearable={false} options={roles}
          onChange={role => role && run(crm.updateDealContact(row.id, { role: role as CrmDealRole }))} />
        <ButtonAppearanceProvider appearance="inline"><Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('Remove {name} from this deal', { name: contact.name })} onClick={() => run(crm.removeDealContact(row.id))}><X size={12} /></Button></ButtonAppearanceProvider>
      </div>)}
      <CrmPicker label={t('Add a person')} value={null} placeholder={t('Add a person')}
        options={candidates.map(contact => ({ id: contact.id, label: contact.name, hint: contact.title ?? crm.companies.find(company => company.id === contact.company_id)?.name ?? null }))}
        onChange={id => id && run(crm.addDealContact(deal.id, { id }, 'influencer'))}
        onCreate={name => run(crm.addDealContact(deal.id, { name }, 'influencer'))} />
      {!rows.length && <p className="px-1.5 text-xs text-muted-foreground">{t('Who decides, who champions it, who could block it — beyond the main contact.')}</p>}
      {error && <p role="alert" className="px-1.5 text-xs text-[var(--status-danger)]">{t(error)}</p>}
    </div>
  </RecordSection>;
}

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
  return <RecordSection title={t('Next step')} action={element && <span className="text-[11px] text-muted-foreground">{t('Element')} {element.display_id ?? ''}</span>}>
    <input aria-label={t('Next step')} placeholder={t('What happens next?')} value={title} disabled={busy}
      onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && dirty) void save(); }}
      className="h-8 w-full max-w-xl rounded-sm bg-muted/30 px-2 text-[13px] outline-none hover:bg-muted/40 focus:bg-muted/60" />
    <div className="flex flex-wrap items-center gap-1">
      <DateField aria-label={t('Next action date')} value={due} onChange={value => setDue(value)} placeholder={t('Set date')} />
      {due && <span className={`text-xs ${due < today ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>{relativeDay(due, today, locale, t)}</span>}
      <ButtonAppearanceProvider appearance="inline">
        {[[1, 'Tomorrow'], [3, '+3 days'], [7, 'Next week']].map(([days, label]) => <Button key={label} variant="ghost" size="xs" disabled={busy}
          onClick={() => { const next = shiftDateOnly(today, days as number); setDue(next); if (title.trim()) void save(next); }}>{t(label as string)}</Button>)}
      </ButtonAppearanceProvider>
      {dirty && <Button size="xs" variant="primary" disabled={busy || !title.trim()} onClick={() => void save()}>{element ? t('Update next step') : t('Set next step')}</Button>}
      {(deal.nextStep || deal.nextActionDate) && !dirty && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void done()}><Check size={12} />{t('Mark done')}</Button>}
    </div>
    <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">{crm.pipelines.find(item => item.id === deal.pipelineId)?.object_id ? t('Saved as an Element in the pipeline’s Object, assigned to the owner — it shows in Calendar and Workload.')
      : !deal.ownerId || deal.ownerId === crm.me ? t('Saved as an Element in your My Elements. Choose an Object in Pipeline settings to give next steps to their owners.')
      : t('Saved on the deal. Choose an Object in Pipeline settings to make next steps Elements for their owners.')}</p>
    {notice && <p role="status" className="text-xs text-[var(--status-warning)]">{t(notice)}</p>}
    {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{t(error)}</p>}
  </RecordSection>;
}

export function CrmDealPage({ crm, deal, onBack, onOpenPipeline, onCapture, onOpenElement, onOpenInitiative, onOpenCompany, onOpenContact, onOpenDeal }: {
  crm: Crm; deal: CrmDeal; onBack: () => void; onOpenPipeline: () => void; onCapture: (dealId: string) => void; onOpenDeal: (id: string) => void;
  onOpenElement?: (id: string) => void; onOpenInitiative?: (id: string) => void; onOpenCompany: (id: string) => void; onOpenContact: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const strategies = useStrategies();
  // The deal's own pipeline: its stages, its name — not whichever the board shows.
  const workspace = crm.workspaces.find(item => item.pipeline.id === deal.pipelineId) ?? crm.workspace!;
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
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); throw cause; } finally { setBusy(false); }
  }
  // A notice (the next step could not follow a new owner) shows where errors do.
  const save = (patch: CrmDealPatch) => run(() => crm.saveDeal(deal.id, patch, { onNotice: setError }));
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
  const dealFields = fieldsFor(crm.fields, 'deal', workspace.pipeline.domain_id);
  const label = workspace.pipeline.record_label;

  // The deal's facts, on the right: where it stands, who, how much, when.
  const rail = <>
    <RailCard title={t('Properties')} padded>
      <div className="space-y-1">
        <Property label={t('Stage')}>
          <div className="flex flex-wrap gap-1 py-0.5">
            {deal.outcome === 'won' ? <span className="px-1.5 text-[13px] text-foreground">{t('Won')}</span>
              : deal.outcome === 'lost' ? <span className="px-1.5 text-[13px] text-muted-foreground">{t('Lost')}</span>
              : <CrmPicker label={t('Stage')} value={deal.stage?.id ?? null} clearable={false} options={stages.map(stage => ({ id: stage.id, label: t(stage.label), hint: `${stage.probability}%` }))}
                onChange={id => { const stage = stages.find(item => item.id === id); if (stage) void moveTo(stage); }} />}
          </div>
        </Property>
        <Property label={t('Owner')}><CrmPicker label={t('Owner')} value={deal.ownerId} placeholder={t('Unassigned')}
          options={crm.people.map(person => ({ id: person.id, label: person.name, hint: person.type === 'ai_agent' ? t('AI agent') : null }))}
          onChange={id => void save({ ownerId: id }).catch(() => {})} /></Property>
        <Property label={t('Company')}>
          <div className="flex items-center gap-1">
            <CrmPicker label={t('Company')} value={deal.companyId} placeholder={t('No company')}
              options={crm.companies.map(company => ({ id: company.id, label: company.name, hint: company.industry }))}
              onChange={id => void save({ companyId: id }).catch(() => {})} onCreate={name => void save({ companyName: name }).catch(() => {})} />
            {deal.companyId && <Button variant="ghost" size="icon-xs" aria-label={t('Open')} onClick={() => onOpenCompany(deal.companyId!)}><ArrowUpRight size={12} /></Button>}
          </div>
        </Property>
        <Property label={t('Contact')}>
          <div className="flex items-center gap-1">
            <CrmPicker label={t('Contact')} value={deal.contactId} placeholder={t('No contact')}
              options={companyContacts.map(contact => ({ id: contact.id, label: contact.name, hint: contact.title ?? contact.email }))}
              onChange={id => void save({ contactId: id }).catch(() => {})} onCreate={name => void save({ contactName: name }).catch(() => {})} />
            {deal.contactId && <Button variant="ghost" size="icon-xs" aria-label={t('Open')} onClick={() => onOpenContact(deal.contactId!)}><ArrowUpRight size={12} /></Button>}
          </div>
        </Property>
        <Property label={t('Initiative')}>
          <div className="flex items-center gap-1">
            <CrmPicker label={t('Initiative')} value={deal.initiativeId} placeholder={t('Not linked')}
              options={strategies.data.map(item => ({ id: item.id, label: item.name }))} onChange={id => void save({ initiativeId: id }).catch(() => {})} />
            {initiative && onOpenInitiative && <Button variant="ghost" size="icon-xs" aria-label={t('Open Initiative')} onClick={() => onOpenInitiative(initiative.id)}><ArrowUpRight size={12} /></Button>}
          </div>
        </Property>
        <div className="h-3" aria-hidden />
        <Property label={t('Amount')}><EditableText numeric label={t('Amount')} value={deal.amount} onSave={value => save({ amount: value as number | null })} /></Property>
        <Property label={t('Currency')}><EditableText label={t('Currency')} value={deal.currency} placeholder="JPY" onSave={value => {
          const code = typeof value === 'string' ? value.toUpperCase() : '';
          if (!/^[A-Z]{3}$/.test(code)) return Promise.reject(new Error('Currency must be a three-letter code, such as USD or JPY.'));
          return save({ currency: code });
        }} /></Property>
        <Property label={t('Probability')}><EditableText numeric label={t('Probability (%)')} value={deal.probability} onSave={value => save({ probability: value as number | null })} /></Property>
        <Property label={t('Close date')}><DateField aria-label={t('Close date')} value={deal.closeDate} onChange={value => void save({ closeDate: value }).catch(() => {})} placeholder={t('Set date')} /></Property>
        <Property label={t('Renews on')}><DateField aria-label={t('Renews on')} value={deal.renewsOn} onChange={value => void save({ renewsOn: value }).catch(() => {})} placeholder={t('Set date')} /></Property>
        {[[t('Renewal of'), deal.renewalOf], [t('Renewed by'), deal.renewedBy]].map(([title, id]) => {
          const linked = id ? crm.allDeals.find(item => item.id === id) : null;
          return linked ? <Property key={title} label={title!}><button type="button" className="truncate rounded-sm px-1.5 text-left text-[13px] hover:bg-muted/40" onClick={() => onOpenDeal(linked.id)}>#{linked.number} {linked.name}</button></Property> : null;
        })}
        {deal.action?.code === 'renewal_due' && <div className="px-1.5 py-1"><StartRenewal deal={deal} crm={crm} onOpen={onOpenDeal} /></div>}
        <Property label={t('Last contact')}><span className="px-1.5 text-[13px] text-muted-foreground">{relativeDay(deal.lastContact, today, locale, t)}</span></Property>
        <Property label={t('Source')}><EditableText label={t('Source')} value={deal.source} placeholder={t('e.g. Referral, Website')} onSave={value => save({ source: value as string | null })} /></Property>
        {deal.outcome === 'lost' && <Property label={t('Lost reason')}><EditableText label={t('Lost reason')} value={deal.lostReason} placeholder={t('Why was it lost?')} onSave={value => save({ lostReason: value as string | null })} /></Property>}
        <CustomFields fields={dealFields} values={deal.custom} onSave={custom => save({ custom })} />
      </div>
    </RailCard>
    <RailCard title={t('Health')} padded>
      <div className="flex items-center gap-2 py-1"><HealthBadge level={deal.health.level} score={deal.health.score} t={t} /></div>
      {deal.health.reasons.length > 0 && <ul className="space-y-1 pt-1 text-[12px]">{deal.health.reasons.map(reason => <li key={reason.message} className="flex justify-between gap-3">
        <span>{t(reason.message, reason.values)}</span><span className="tabular-nums text-muted-foreground">−{reason.impact}</span>
      </li>)}</ul>}
    </RailCard>
  </>;

  return <CrmRecordPage
    crumbs={[{ label: workspace.pipeline.name, onClick: onOpenPipeline }, { label: deal.name }]}
    onBack={onBack} onDelete={() => crm.deleteDeal(deal.id)} deleteLabel={label ? t('Delete this {name}?', { name: label }) : t('Delete this deal?')}
    actions={<>
      {open && <>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void moveTo(WON_STAGE)}><Check size={14} />{t('Won')}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void moveTo(LOST_STAGE)}>{t('Lost')}</Button>
      </>}
      {!open && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void moveTo(workspace.stages[workspace.stages.length - 1])}>{t('Reopen')}</Button>}
      <Button size="sm" variant="secondary" onClick={() => onCapture(deal.id)}><PenLine size={14} />{t('Update from notes')}</Button>
    </>}
    rail={rail}>
    <div>
      <PageHead icon={<CrmIcon size={18} />} title={deal.name} description="" canEdit
        titleLabel={t('Deal name')} titlePlaceholder={t('Deal name')} descriptionLabel="" descriptionPlaceholder=""
        onSaveTitle={name => save({ name }).then(() => {})} />
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <span className="tabular-nums">D-{deal.number}</span>
        {deal.account && <button type="button" className="rounded-sm hover:text-foreground" onClick={() => onOpenCompany(deal.companyId!)}>{deal.account}</button>}
        <span className="tabular-nums text-foreground">{money(deal.amount, deal.currency, locale)}</span>
        {open && deal.stage && <span>{t(deal.stage.label)}</span>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--status-danger)]">{t(error)}</p>}
      {!deal.valid && <div role="status" className="mt-3 max-w-xl space-y-1 text-xs">
        <p className="font-medium">{t('Complete these details to include this deal in the forecast')}</p>
        <ul className="list-inside list-disc text-muted-foreground">{deal.issues.map(issue => <li key={issue.message}>{t(issue.message, issue.values)}</li>)}</ul>
      </div>}
    </div>

    {open && <NextStep key={deal.id} crm={crm} deal={deal} />}
    <DealPeople crm={crm} deal={deal} onOpenContact={onOpenContact} />
    <CrmRelatedWork crm={crm} target={{ dealId: deal.id }} onOpenElement={onOpenElement} />
    {deal.nextElement && onOpenElement && <ButtonAppearanceProvider appearance="inline">
      <Button size="sm" variant="ghost" onClick={() => onOpenElement(deal.nextElement!.id)}><ArrowUpRight size={12} />{t('Open Element')} {deal.nextElement.display_id ?? ''}</Button>
    </ButtonAppearanceProvider>}

    <RecordSection title={t('AI assist')}>
      <ButtonAppearanceProvider appearance="inline">
        <div className="-ml-2.5 flex flex-wrap gap-0.5">
          <Button size="sm" variant="ghost" disabled={ai !== null || aiState !== 'ready'} onClick={() => void askAi('brief')}>{ai === 'brief' ? t('Reading the deal…') : t('Brief me')}</Button>
          <Button size="sm" variant="ghost" disabled={ai !== null || aiState !== 'ready'} onClick={() => void askAi('email')}>{ai === 'email' ? t('Drafting…') : t('Draft follow-up email')}</Button>
        </div>
      </ButtonAppearanceProvider>
      {aiState === 'unavailable' && <p className="text-xs text-muted-foreground">{t('AI drafting turns on once the updated alcon-copilot function is deployed.')}</p>}
      {aiError && <p role="alert" className="text-xs text-[var(--status-danger)]">{t(aiError)}</p>}
      {brief && <div className="max-w-2xl space-y-2 text-[13px] leading-relaxed">
        <p>{brief.summary}</p>
        {brief.nextStep && <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t('Recommended')}:</span><span>{brief.nextStep}</span>
          {open && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void run(() => crm.setNextStep(deal, { title: brief.nextStep.slice(0, 280), due: deal.nextActionDate ?? shiftDateOnly(today, 1) })).catch(() => {})}>{t('Use as next step')}</Button>}</div>}
        {brief.risks.length > 0 && <div><p className="text-xs text-muted-foreground">{t('Risks')}</p><ul className="list-inside list-disc">{brief.risks.map(risk => <li key={risk}>{risk}</li>)}</ul></div>}
        {brief.questions.length > 0 && <div><p className="text-xs text-muted-foreground">{t('Ask the buyer')}</p><ul className="list-inside list-disc">{brief.questions.map(question => <li key={question}>{question}</li>)}</ul></div>}
      </div>}
      {(email || ai === 'email') && <div className="max-w-2xl space-y-2">
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
    </RecordSection>

    <RecordSection title={t('Activity')}>
      <div className="max-w-2xl space-y-3">
        <TextComposer rows={2} aria-label={t('Log activity')} placeholder={t('What happened? Calls, emails and meetings also update the last contact.')}
          value={note} onChange={event => setNote(event.target.value)} disabled={busy}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void logNote(); } }}
          hint={<span className="flex flex-wrap gap-1">{ACTIVITY_TYPES.map(type => <Button key={type} shape="tab" size="xs" variant={noteType === type ? 'secondary' : 'ghost'} aria-pressed={noteType === type} onClick={() => setNoteType(type)}>{t(ACTIVITY_LABEL[type])}</Button>)}</span>}
          action={<Button size="xs" variant="primary" disabled={busy || !note.trim()} onClick={() => void logNote()}>{t('Log')}</Button>} />
        {deal.activity.length > 0 ? <ol className="space-y-3">{deal.activity.map((entry, index) => <li key={entry.id ?? index} className="space-y-0.5">
          {(() => {
            const line = historyLine(entry.type, entry.text, workspace.stages, locale, t);
            return <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{line.label}</span>
                {entry.date && <span>{relativeDay(entry.date, today, locale, t)}</span>}
                {entry.author && <span>· {entry.author}</span>}
              </div>
              <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${line.quiet ? 'text-muted-foreground' : ''}`}>{line.text}</p>
            </>;
          })()}
        </li>)}</ol> : <p className="text-xs text-muted-foreground">{t('No activity yet.')}</p>}
      </div>
    </RecordSection>
  </CrmRecordPage>;
}
