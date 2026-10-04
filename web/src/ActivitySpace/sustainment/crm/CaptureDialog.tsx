'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { Textarea } from '@/ui/textarea';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ACTIVITY_TYPES, resolveStage, type CrmActivityType } from './crmModel';
import { readCapture, reviewRows, reviewValues, type CaptureFields, type CaptureProposal, type ReviewRow } from './crmCapture';
import { aiCapture, useCrmAi } from './crmAi';
import { money } from './crmFormat';
import type { Crm, CrmDealPatch } from '@/hooks/useCrm';

const FIELD_LABEL: Record<keyof CaptureFields, string> = {
  name: 'Deal name', account: 'Account', contact: 'Contact', email: 'Email', stage: 'Stage', amount: 'Amount', currency: 'Currency',
  probability: 'Probability (%)', closeDate: 'Close date', nextActionDate: 'Next action date', nextStep: 'Next step',
};
const ACTIVITY_LABEL: Record<CrmActivityType, string> = { call: 'Call', email: 'Mail', meeting: 'Meeting', note: 'Memo' };

/** Paste or type what happened; review what will change; apply in one write. */
export function CrmCapture({ crm, initialDealId, onClose, onApplied }: {
  crm: Crm; initialDealId: string | null; onClose: () => void; onApplied: (dealId: string) => void;
}) {
  const { t, locale } = useI18n();
  const workspace = crm.workspace!;
  const [input, setInput] = useState('');
  const [ai, setAi] = useState<CaptureProposal | null>(null);
  const [aiFor, setAiFor] = useState('');
  const [reading, setReading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null | undefined>(initialDealId ?? undefined); // undefined = follow the reading
  // Rows whose default (ticked, or opt-in for closing a deal) the person flipped.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [activityType, setActivityType] = useState<CrmActivityType | null>(null);
  const [logActivity, setLogActivity] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiState = useCrmAi();
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const local = useMemo(() => input.trim() ? readCapture(input, workspace.today, workspace.deals, workspace.stages) : null, [input, workspace]);
  // An AI reading belongs to the exact text it read; editing the text falls back to the local reading.
  const proposal = ai && aiFor === input ? ai : local;
  // Ticks belong to the reading they were made on; a new reading starts from the defaults.
  const [toggledFor, setToggledFor] = useState(proposal);
  if (toggledFor !== proposal) { setToggledFor(proposal); setToggled(new Set()); }
  const dealId = target !== undefined ? target : proposal?.dealId ?? null;
  const deal = dealId ? workspace.deals.find(item => item.id === dealId) ?? null : null;
  const changes = proposal ? reviewRows(proposal, deal, workspace.stages, { primaryCurrency: workspace.primaryCurrency, fallbackName: t('New deal'), hasField: () => true }) : [];
  const checked = (row: ReviewRow) => !!row.required || !row.optIn !== toggled.has(row.key);
  const willLog = logActivity;
  const canApply = !!proposal && !saving && (changes.some(checked) || willLog);
  const type = activityType ?? proposal?.activity.type ?? 'note';

  async function readWithAi() {
    if (!input.trim()) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setReading(true); setAiError(null);
    const text = input;
    try {
      const result = await aiCapture(text, workspace.today, workspace.deals, workspace.stages, controller.signal);
      setAi(result); setAiFor(text);
    } catch (cause) {
      if (!controller.signal.aborted) setAiError(cause instanceof Error ? cause.message : t('AI is unavailable right now.'));
    } finally { if (abort.current === controller) setReading(false); }
  }

  async function apply() {
    if (!proposal || !canApply) return;
    setSaving(true); setError(null);
    try {
      const values = reviewValues(changes, checked) as Partial<Record<keyof CaptureFields, string | number>>;
      const text = (key: keyof CaptureFields) => typeof values[key] === 'string' ? values[key] as string : undefined;
      const patch: CrmDealPatch = {
        name: text('name'), stage: text('stage'), currency: text('currency'), closeDate: text('closeDate'),
        amount: typeof values.amount === 'number' ? values.amount : undefined,
        probability: typeof values.probability === 'number' ? values.probability : undefined,
        companyName: text('account'), contactName: text('contact'), contactEmail: text('email'),
      };
      for (const key of Object.keys(patch) as (keyof CrmDealPatch)[]) if (patch[key] === undefined) delete patch[key];
      // A contact email with no name of its own lands on the deal's contact.
      if (patch.contactEmail && !patch.contactName && deal?.contactId) await crm.saveContact(deal.contactId, { email: patch.contactEmail });
      const activity = willLog ? { type, text: proposal.summary ? `${proposal.summary} — ${input.trim()}` : input.trim() } : undefined;
      const id = await crm.saveDeal(deal?.id ?? null, patch, { activity });
      // The next step is an Element, written after the deal so it can name it.
      const step = text('nextStep'); const due = text('nextActionDate');
      if (step || due) {
        await crm.setNextStep({ id, name: patch.name ?? deal?.name ?? '', account: patch.companyName ?? deal?.account ?? null, ownerId: deal?.ownerId ?? crm.me, nextElement: deal?.nextElement ?? null, number: deal?.number },
          { title: step ?? deal?.nextStep ?? t('Follow up'), due: due ?? deal?.nextActionDate ?? null });
      }
      onApplied(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not save. Try again.'));
    } finally { setSaving(false); }
  }

  const display = (key: keyof CaptureFields, value: string | number | null, side: 'from' | 'to') => {
    if (value === null || value === '') return '—';
    // The old amount is in the deal's currency; the new one in the proposed currency when it changes too.
    if (key === 'amount' && typeof value === 'number') return money(value, (side === 'to' ? proposal?.fields.currency ?? deal?.currency : deal?.currency) || null, locale);
    if (key === 'stage') return t(resolveStage(String(value), workspace.stages)?.label ?? String(value));
    return String(value);
  };

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 sm:max-w-2xl">
      <div className="space-y-1">
        <DialogTitle>{t('Capture')}</DialogTitle>
        <DialogDescription>{t('Paste meeting notes or an email, or type one line. Alcon reads the deal, amount, dates and next step — you review before anything changes.')}</DialogDescription>
      </div>
      <Textarea autoFocus rows={5} aria-label={t('Capture notes')} value={input} disabled={saving}
        placeholder={t('e.g. Call with Acme — budget ¥1.2M, 70% likely, contract by end of month. Next: send revised quote Tuesday.')}
        onChange={event => setInput(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (canApply) void apply(); } }} />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {proposal && <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('Applies to')}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="secondary" size="sm" align="start" disabled={saving}>
                <span className="max-w-64 truncate">{deal ? deal.name : t('New deal')}</span><ChevronDown size={12} />
              </Button></DropdownMenuTrigger>
              <MenuShell as="dropdown" width="standard" align="start">
                <div className="max-h-72 overflow-y-auto">
                  <DropdownMenuItem className={MENU_ROW} onSelect={() => setTarget(null)}>{t('New deal')}</DropdownMenuItem>
                  {workspace.deals.filter(item => item.outcome !== 'lost').map(item => <DropdownMenuItem key={item.id} className={MENU_ROW} onSelect={() => setTarget(item.id)}>
                    <span className="min-w-0 flex-1 truncate">{item.name}</span><span className="text-xs text-muted-foreground">{item.account}</span>
                  </DropdownMenuItem>)}
                </div>
              </MenuShell>
            </DropdownMenu>
            <span className="ml-auto text-xs text-muted-foreground">{proposal.source === 'ai' ? t('Read by AI') : reading ? t('AI is reading…') : t('Quick reading')}</span>
          </div>
          {proposal.summary && <p className="text-sm">{proposal.summary}</p>}
          {changes.length > 0 ? <ul className="divide-y divide-[var(--border-subtle)] text-sm" aria-label={t('Changes')}>
            {changes.map(change => <li key={change.key} className="flex items-center gap-3 py-2">
              <input type="checkbox" aria-label={t('Apply {field}', { field: t(FIELD_LABEL[change.key]) })} checked={checked(change)} disabled={saving || change.required}
                onChange={() => setToggled(current => { const next = new Set(current); if (next.has(change.key)) next.delete(change.key); else next.add(change.key); return next; })} />
              <span className="w-36 shrink-0 text-xs text-muted-foreground">{t(FIELD_LABEL[change.key])}{change.impliedBy && <span className="block">{t('from the stage')}</span>}</span>
              <span className="min-w-0 flex-1 truncate">{deal && <><span className="text-muted-foreground line-through">{display(change.key, change.from, 'from')}</span><span className="px-1.5 text-muted-foreground">→</span></>}<span className="font-medium">{display(change.key, change.to, 'to')}</span></span>
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">{t('No field changes found. The note can still be logged as activity.')}</p>}
          {<div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={logActivity} disabled={saving} onChange={event => setLogActivity(event.target.checked)} />{t('Log as')}</label>
            {ACTIVITY_TYPES.map(item => <Button key={item} shape="tab" size="xs" variant={type === item ? 'secondary' : 'ghost'} aria-pressed={type === item} disabled={!logActivity || saving} onClick={() => setActivityType(item)}>{t(ACTIVITY_LABEL[item])}</Button>)}
          </div>}
        </>}
        {aiError && <p role="alert" className="text-xs text-[var(--status-danger)]">{t(aiError)}</p>}
        {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">{t('⌘↵ to apply')}</span>
        <Button variant="ghost" disabled={saving} onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="ghost" disabled={aiState !== 'ready' || !input.trim() || reading || saving || (ai !== null && aiFor === input)} title={aiState === 'unavailable' ? t('AI drafting turns on once the updated alcon-copilot function is deployed.') : undefined} onClick={() => void readWithAi()}>{reading ? t('Reading…') : t('Read with AI')}</Button>
        <Button variant="primary" disabled={!canApply} onClick={() => void apply()}>
          {saving ? t('Saving…') : deal ? t('Update deal') : t('Create deal')}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
