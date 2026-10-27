'use client';

import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { FONT } from '@/shared/designTokens';
import { PageSection } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useDeploymentGrants } from '@/hooks/useDeploymentGrants';
import {
  GRANT_OPERATIONS, grantChanges, grantConnectors,
  type DeploymentGrant, type GrantOperation, type GrantVersionRecord, type LedgerRun, type WorkflowDeploymentRecord,
} from '@/Function/audit/auditModel';
import type { AuditSource } from './auditSource';
import { Empty } from './auditParts';

// What a workflow may do — each connection, and each kind of operation on it
// — decided here and enforced by the gateway (ADR 0046). The owner of the
// Space ticks a box; the database numbers the change as the next version;
// the gateway is handed it with its next table. What the runs did outside
// the grants is counted beside them.

const OPERATION_LABEL: Record<GrantOperation, string> = { read: 'Read', draft: 'Draft', send: 'Send', money: 'Money' };

export function AuditGrants({ source, deployment, runs }: { source: AuditSource; deployment: WorkflowDeploymentRecord; runs: LedgerRun[] }) {
  const { t, locale } = useI18n();
  const real = useDeploymentGrants(source.sample ? null : deployment.id, source.sample ? null : deployment.activity_space_id);
  const sampleVersions = useMemo(() => source.sampleGrants?.filter(v => v.deployment_id === deployment.id) ?? [], [source.sampleGrants, deployment.id]);
  const versions: readonly GrantVersionRecord[] = source.sample ? sampleVersions : real.versions;
  const grants: readonly DeploymentGrant[] = useMemo(() => source.sample ? sampleVersions[0]?.grants ?? [] : real.grants, [source.sample, sampleVersions, real.grants]);
  const canEdit = !source.sample && real.canEdit;
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState(false);

  const steps = useMemo(() => runs.flatMap(run => run.steps), [runs]);
  const called = useMemo(() => steps.flatMap(s => s.connector && s.operation !== 'none' ? [s.connector] : []), [steps]);
  const connectors = useMemo(() => {
    const listed = grantConnectors(grants, called);
    return [...listed, ...added.filter(c => !listed.includes(c))];
  }, [grants, called, added]);
  const outside = steps.filter(s => s.outside_grant);
  const done = outside.filter(s => s.result !== 'blocked').length;
  const has = (connector: string, operation: GrantOperation) => grants.some(g => g.connector === connector && g.operation === operation);
  const latest = versions[0];

  const toggle = async (connector: string, operation: GrantOperation) => {
    setFailed(false);
    try {
      await real.setGrant({ grant: { connector, operation }, allowed: !has(connector, operation) });
    } catch {
      setFailed(true);
    }
  };
  const addConnector = () => {
    const name = draft.trim();
    if (name && name.length <= 200 && !connectors.includes(name)) setAdded([...added, name]);
    setDraft('');
  };

  if (!source.sample && real.error) return <Empty>{t('Could not read the grants.')}</Empty>;
  if (!source.sample && real.loading) return <p className={`${FONT.sm} text-muted-foreground`}>{t('Loading the grants…')}</p>;

  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        <div className="min-w-0 space-y-0.5">
          <dt className={`${FONT.sm} text-muted-foreground`}>{t('In force')}</dt>
          <dd className={`${FONT['2xl']} tabular-nums text-foreground`}>{latest ? t('version {n}', { n: latest.version }) : '—'}</dd>
          <dd className={`${FONT.sm} text-muted-foreground`}>{latest ? new Date(latest.created_at).toLocaleString(locale) : t('Nothing granted yet')}</dd>
        </div>
        <div className="min-w-0 space-y-0.5">
          <dt className={`${FONT.sm} text-muted-foreground`}>{t('Outside the grants')}</dt>
          <dd className={`${FONT['2xl']} tabular-nums ${outside.length ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>{outside.length}</dd>
          <dd className={`${FONT.sm} text-muted-foreground`}>{outside.length ? t('{n} blocked, {m} carried out', { n: outside.length - done, m: done }) : t('In the runs shown')}</dd>
        </div>
      </dl>

      <PageSection title={t('Grants')}>
        <p className={`${FONT.sm} mb-3 text-muted-foreground`}>
          {t('The gateway allows only what is ticked here, and receives each change with its next table, within {m} minutes. If it cannot get a fresh table, it stops sending and payments and keeps only reading and drafting.', { m: 15 })}
        </p>
        {!connectors.length && !canEdit ? <Empty>{t('Nothing is granted, and no run has called a connection.')}</Empty> : (
          <div role="table" aria-label={t('Grants')} className="space-y-0.5">
            <div role="row" className={`${FONT.sm} grid grid-cols-[minmax(0,1fr)_repeat(4,64px)] items-center gap-2 px-3 py-1 text-muted-foreground`}>
              <span role="columnheader">{t('Connection')}</span>
              {GRANT_OPERATIONS.map(op => <span key={op} role="columnheader" className="text-center">{t(OPERATION_LABEL[op])}</span>)}
            </div>
            {connectors.map(connector => (
              <div key={connector} role="row" className="grid grid-cols-[minmax(0,1fr)_repeat(4,64px)] items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted/30">
                <span role="rowheader" className={`${FONT.base} truncate text-foreground`}>{connector}</span>
                {GRANT_OPERATIONS.map(op => {
                  const on = has(connector, op);
                  const label = t('{connector}: {operation}', { connector, operation: t(OPERATION_LABEL[op]) });
                  return (
                    <span key={op} role="cell" className="flex justify-center">
                      <button type="button" role="checkbox" aria-checked={on} aria-label={label} title={label}
                        disabled={!canEdit || real.saving} onClick={() => void toggle(connector, op)}
                        className={`flex size-5 items-center justify-center rounded border transition-colors disabled:cursor-default ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-transparent'} ${canEdit ? 'hover:bg-muted/60' : ''}`}>
                        {on && <Check size={12} />}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <form className="mt-3 flex max-w-sm gap-2" onSubmit={e => { e.preventDefault(); addConnector(); }}>
            <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('Connection name, as the gateway reports it')} aria-label={t('Add a connection')} className="h-8" />
            <Button type="submit" size="sm" variant="secondary" disabled={!draft.trim()}><Plus size={14} />{t('Add')}</Button>
          </form>
        )}
        {failed && <p role="alert" className={`${FONT.sm} mt-2 text-[var(--status-danger)]`}>{t('Could not change the grant.')}</p>}
        {!canEdit && !source.sample && <p className={`${FONT.sm} mt-3 text-muted-foreground`}>{t("Only the Space's owner can change the grants.")}</p>}
      </PageSection>

      <PageSection title={t('History')}>
        {!versions.length ? <Empty>{t('The grants have not been changed yet.')}</Empty> : (
          <ol className="space-y-0.5">
            {versions.map((v, i) => {
              const { added: plus, removed: minus } = grantChanges(versions[i + 1]?.grants ?? [], v.grants);
              const name = (g: DeploymentGrant) => `${g.connector} · ${t(OPERATION_LABEL[g.operation])}`;
              return (
                <li key={v.version} className="grid grid-cols-[96px_160px_minmax(0,1fr)] items-baseline gap-3 rounded-md px-3 py-2 hover:bg-muted/30">
                  <span className={`${FONT.base} tabular-nums text-foreground`}>{t('version {n}', { n: v.version })}</span>
                  <span className={`${FONT.sm} tabular-nums text-muted-foreground`}>{new Date(v.created_at).toLocaleString(locale)}</span>
                  <span className={`${FONT.sm} min-w-0 space-x-3`}>
                    {plus.map(g => <span key={`+${name(g)}`} className="text-[var(--status-success)]">+ {name(g)}</span>)}
                    {minus.map(g => <span key={`-${name(g)}`} className="text-[var(--status-danger)]">− {name(g)}</span>)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </PageSection>
    </div>
  );
}
