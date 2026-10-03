'use client';

import { useState } from 'react';
import { Bot, Check, FilePen } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ScmProposal } from './scmEngine';
import { explainProposal, formatDay, formatMoney, formatQuantity, HEALTH_LABEL, PO_STATUS_LABEL } from './scmText';
import { HealthBadge, Pill, Section, SCM_INPUT } from './ScmParts';
import { useScmSurface } from './scmSurface';

const AUTHORITY_LABEL = { auto: 'Within autopilot authority', approval: 'Needs approval', over_budget: 'Over monthly budget' } as const;
const AUTHORITY_TONE = { auto: 'success', approval: 'warning', over_budget: 'danger' } as const;

/** Proposed orders, one per supplier and destination, each with its evidence. */
export function ScmReplenish({ onRunPlanner, running }: { onRunPlanner: () => void; running: boolean }) {
  const { t, locale } = useI18n();
  const { plan, data, actions, locationId, openNode, openOrder } = useScmSurface();
  const proposals = plan.proposals.filter(proposal => !locationId || proposal.locationId === locationId);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, { poId: string; number: number; supplier: string; location: string; status: string }>>({});

  function adjusted(proposal: ScmProposal): ScmProposal {
    const lines = proposal.lines.filter(line => !excluded[proposal.key]?.has(line.itemId)).map(line => {
      const raw = edits[proposal.key]?.[line.itemId];
      const quantity = raw === undefined ? line.quantity : Math.max(0, Number(raw) || 0);
      return { ...line, quantity, value: quantity * line.unitCost };
    }).filter(line => line.quantity > 0);
    return { ...proposal, lines, total: lines.reduce((sum, line) => sum + line.value, 0) };
  }

  async function place(proposal: ScmProposal, draft: boolean) {
    setBusy(proposal.key); setError(null);
    try {
      const final = adjusted(proposal);
      const summary = await actions.placeProposals([final], { mode: draft ? 'draft' : 'place', policy: data.policy, today: data.today, explain: entry => explainProposal(entry, plan, t, locale, draft ? 'draft' : 'place') });
      const created = summary?.created[0];
      if (created) setPlaced(current => ({ ...current, [proposal.key]: created }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(null); }
  }

  return <div className="space-y-8">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4">
      <div className="min-w-0 max-w-2xl space-y-1">
        <p className="text-sm font-medium">{data.policy.autopilotEnabled ? t('Autopilot is on') : t('Autopilot is off')}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{data.policy.autopilotEnabled
          ? t('Each day the planner places orders up to {limit} on its own and drafts larger ones as approval Elements for you. Monthly budget: {budget}.', { limit: formatMoney(data.policy.autoApproveLimit, data.policy.currency, locale), budget: data.policy.monthlyBudget === null ? t('none') : formatMoney(data.policy.monthlyBudget, data.policy.currency, locale) })
          : t('Review each proposal and place it, or turn on the autopilot in Planning settings to let it act within limits you set.')}</p>
      </div>
      <Button variant="primary" disabled={running || !proposals.length} onClick={onRunPlanner}><Bot size={14} />{running ? t('Planning…') : data.policy.autopilotEnabled ? t('Run planner now') : t('Draft all for approval')}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {Object.values(placed).length > 0 && <ul role="status" className="space-y-1">{Object.values(placed).map(entry => <li key={entry.poId}>
      <button type="button" className="flex w-full items-center gap-2 rounded-md bg-[var(--status-success-subtle)] px-3 py-2 text-left text-sm hover:underline" onClick={() => openOrder(entry.poId)}>
        <Check size={14} className="text-[var(--status-success)]" />
        {entry.status === 'draft' ? t('PO-{n} saved for approval ({supplier} → {location}). An approval Element is in your queue.', { n: entry.number, supplier: entry.supplier, location: entry.location }) : t('PO-{n} placed ({supplier} → {location}).', { n: entry.number, supplier: entry.supplier, location: entry.location })}
      </button>
    </li>)}</ul>}

    {proposals.length ? <div className="space-y-4">{proposals.map(proposal => {
      const current = adjusted(proposal);
      const poId = placed[proposal.key]?.poId;
      return <article key={proposal.key} className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-4">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{proposal.supplierName} → {proposal.locationName}</h3>
            <p className="text-xs text-muted-foreground">{t('Order today, arrives about {day}', { day: formatDay(proposal.expectedOn, locale) })}{proposal.needBy ? ` · ${t('needed before {day}', { day: formatDay(proposal.needBy, locale) })}` : ''}</p>
          </div>
          {proposal.urgent && <Pill tone="danger">{t('Urgent')}</Pill>}
          <Pill tone={AUTHORITY_TONE[proposal.authority]}>{t(AUTHORITY_LABEL[proposal.authority])}</Pill>
        </header>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr>
            <th className="w-6 py-1" /><th className="py-1 font-medium">{t('Item')}</th><th className="py-1 font-medium">{t('Why')}</th>
            <th className="w-24 py-1 text-right font-medium">{t('Quantity')}</th><th className="py-1 text-right font-medium">{t('Value')}</th>
          </tr></thead>
          <tbody>{proposal.lines.map(line => {
            const node = plan.nodes.find(entry => entry.key === line.nodeKey);
            const off = excluded[proposal.key]?.has(line.itemId);
            return <tr key={line.itemId} className={`border-t border-[var(--border-subtle)] ${off ? 'opacity-40' : ''}`}>
              <td className="py-1.5"><input type="checkbox" aria-label={t('Include {name}', { name: line.name })} checked={!off} disabled={!!poId} onChange={() => setExcluded(currentSet => {
                const next = new Set(currentSet[proposal.key] ?? []);
                if (next.has(line.itemId)) next.delete(line.itemId); else next.add(line.itemId);
                return { ...currentSet, [proposal.key]: next };
              })} /></td>
              <td className="max-w-64 py-1.5"><button type="button" className="block max-w-full truncate text-left hover:underline" onClick={() => openNode(line.nodeKey)}>{line.name}</button><span className="text-xs text-muted-foreground">{line.sku}</span></td>
              <td className="py-1.5 text-xs text-muted-foreground">{node && <span className="flex flex-wrap items-center gap-2"><HealthBadge health={node.health} />{t('{onHand} on hand · {daily}/day · lead {lead}d', { onHand: formatQuantity(node.onHand, locale), daily: formatQuantity(node.dailyDemand, locale), lead: formatQuantity(node.leadTime, locale) })}</span>}</td>
              <td className="py-1"><input aria-label={t('Quantity for {name}', { name: line.name })} inputMode="decimal" disabled={!!poId || off} className={`${SCM_INPUT} text-right`} value={edits[proposal.key]?.[line.itemId] ?? String(line.quantity)}
                onChange={event => setEdits(currentEdits => ({ ...currentEdits, [proposal.key]: { ...currentEdits[proposal.key], [line.itemId]: event.target.value } }))} /></td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney((Number(edits[proposal.key]?.[line.itemId] ?? line.quantity) || 0) * line.unitCost, proposal.currency, locale)}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr className="border-t border-[var(--border-subtle)] font-medium"><td /><td className="py-1.5">{t('Total')}</td><td /><td /><td className="py-1.5 text-right tabular-nums">{formatMoney(current.total, proposal.currency, locale)}</td></tr></tfoot>
        </table>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {poId ? <Button size="sm" variant="ghost" onClick={() => openOrder(poId)}><Check size={14} />{t('Order created — open')}</Button> : <>
            <Button size="sm" variant="ghost" disabled={busy !== null || !current.lines.length} onClick={() => void place(proposal, true)}><FilePen size={14} />{t('Save as draft for approval')}</Button>
            <Button size="sm" variant="primary" disabled={busy !== null || !current.lines.length} onClick={() => void place(proposal, false)}>{busy === proposal.key ? t('Placing…') : t('Place order')}</Button>
          </>}
        </div>
      </article>;
    })}</div> : <div className="space-y-2 py-10 text-center"><p className="text-sm font-medium">{t('Nothing to order')}</p><p className="text-sm text-muted-foreground">{t('Stock and open orders cover every item through its next review.')}</p></div>}

    <Section title={t('Autopilot log')} description={t('What the planner did on its own, and why it stopped where it did.')}>
      {data.runs.length ? <ul className="divide-y divide-[var(--border-subtle)]">{data.runs.map(run => <li key={run.id} className="space-y-1 py-2.5">
        <p className="text-xs text-muted-foreground">{new Date(run.ranAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</p>
        {run.summary.status === 'failed' && <p role="alert" className="text-sm text-destructive">{t('Stopped with an error: {error}', { error: run.summary.error ?? '' })}</p>}
        {run.summary.status === 'running' && <p className="text-sm text-muted-foreground">{t('Running…')}</p>}
        {run.summary.created?.length ? <ul className="space-y-0.5">{run.summary.created.map(entry => <li key={entry.poId} className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="font-medium hover:underline" onClick={() => openOrder(entry.poId)}>PO-{entry.number}</button>
          <span className="text-muted-foreground">{entry.supplier} → {entry.location}</span>
          <span className="tabular-nums">{formatMoney(entry.total, entry.currency, locale)}</span>
          <Pill tone={entry.status === 'approved' ? 'success' : 'warning'}>{entry.status === 'approved' ? t('Approved automatically') : t(PO_STATUS_LABEL[entry.status])}</Pill>
        </li>)}</ul> : !run.summary.status && <p className="text-sm text-muted-foreground">{t('No orders needed.')}</p>}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">{t('The autopilot has not run yet.')}</p>}
    </Section>
    <p className="text-xs text-muted-foreground">{t('Quantities cover lead time plus the {review}-day review period and safety stock, less stock and open orders, rounded to MOQ and pack size. {health} lines come first.', { review: data.policy.reviewDays, health: t(HEALTH_LABEL.critical) })}</p>
  </div>;
}
