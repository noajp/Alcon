'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { Textarea } from '@/ui/textarea';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Json } from '@/types/database';
import { ACTIVITY_TYPES, formatActivity, resolveStage, stageChange, type CrmActivityType } from './crmModel';
import { captureChanges, readCapture, type CaptureFields, type CaptureProposal } from './crmCapture';
import { aiCapture } from './crmAi';
import { money } from './crmFormat';
import type { Crm } from './useCrm';

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
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [activityType, setActivityType] = useState<CrmActivityType | null>(null);
  const [logActivity, setLogActivity] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const local = useMemo(() => input.trim() ? readCapture(input, workspace.today, workspace.deals, workspace.stages) : null, [input, workspace]);
  // An AI reading belongs to the exact text it read; editing the text falls back to the local reading.
  const proposal = ai && aiFor === input ? ai : local;
  const dealId = target !== undefined ? target : proposal?.dealId ?? null;
  const deal = dealId ? workspace.deals.find(item => item.id === dealId) ?? null : null;
  const changes = proposal ? captureChanges({ ...proposal, fields: { ...proposal.fields, ...(deal ? {} : { name: proposal.fields.name }) } }, deal)
    .filter(change => crm.hasField(change.key) || change.key === 'stage') : [];
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
      setAi(result); setAiFor(text); setSkipped(new Set());
    } catch (cause) {
      if (!controller.signal.aborted) setAiError(cause instanceof Error ? cause.message : t('AI is unavailable right now.'));
    } finally { if (abort.current === controller) setReading(false); }
  }

  async function apply() {
    if (!proposal || saving) return;
    setSaving(true); setError(null);
    try {
      const values: Record<string, Json | null> = {};
      for (const change of changes) if (!skipped.has(change.key)) values[change.key] = change.to;
      if (typeof values.stage === 'string') {
        const stage = resolveStage(values.stage, workspace.stages)!;
        const moved = stageChange(deal ?? { probability: null, stage: null }, stage);
        values.stage = moved.stage;
        if (values.probability === undefined) values.probability = moved.probability;
      }
      if (!deal) {
        // A new deal starts in the first stage at that stage's likelihood unless the note said otherwise.
        const first = workspace.stages[0];
        values.name ??= proposal.fields.name ?? t('New deal');
        if (values.stage === undefined && first) { values.stage = first.id; values.probability ??= first.probability; }
        if (values.currency === undefined && workspace.primaryCurrency) values.currency = workspace.primaryCurrency;
      }
      if (logActivity && crm.hasField('activity')) {
        const entry = { date: workspace.today, type, text: proposal.summary ? `${proposal.summary} — ${input.trim()}` : input.trim() };
        if (deal) { await crm.logActivity(deal, entry, values); onApplied(deal.id); return; }
        values.activity = formatActivity(entry);
        if (type !== 'note') values.lastContact = workspace.today;
      }
      onApplied(await crm.saveDeal(deal?.id ?? null, values));
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
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void (proposal ? apply() : readWithAi()); } }} />

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
              <input type="checkbox" aria-label={t('Apply {field}', { field: t(FIELD_LABEL[change.key]) })} checked={!skipped.has(change.key)} disabled={saving}
                onChange={event => setSkipped(current => { const next = new Set(current); if (event.target.checked) next.delete(change.key); else next.add(change.key); return next; })} />
              <span className="w-36 shrink-0 text-xs text-muted-foreground">{t(FIELD_LABEL[change.key])}</span>
              <span className="min-w-0 flex-1 truncate">{deal && <><span className="text-muted-foreground line-through">{display(change.key, change.from, 'from')}</span><span className="px-1.5 text-muted-foreground">→</span></>}<span className="font-medium">{display(change.key, change.to, 'to')}</span></span>
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">{t('No field changes found. The note can still be logged as activity.')}</p>}
          {crm.hasField('activity') && <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={logActivity} disabled={saving} onChange={event => setLogActivity(event.target.checked)} />{t('Log as')}</label>
            {ACTIVITY_TYPES.map(item => <Button key={item} shape="tab" size="xs" variant={type === item ? 'secondary' : 'ghost'} aria-pressed={type === item} disabled={!logActivity || saving} onClick={() => setActivityType(item)}>{t(ACTIVITY_LABEL[item])}</Button>)}
          </div>}
        </>}
        {aiError && <p role="alert" className="text-xs text-[var(--status-danger)]">{aiError}</p>}
        {error && <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">{t('⌘↵ to apply')}</span>
        <Button variant="ghost" disabled={saving} onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="ghost" disabled={!input.trim() || reading || saving || (ai !== null && aiFor === input)} onClick={() => void readWithAi()}>{reading ? t('Reading…') : t('Read with AI')}</Button>
        <Button variant="primary" disabled={!proposal || saving || (!changes.some(change => !skipped.has(change.key)) && !(logActivity && crm.hasField('activity')))} onClick={() => void apply()}>
          {saving ? t('Saving…') : deal ? t('Update deal') : t('Create deal')}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
