'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAudit, useAuditChain, useAuditRunSteps, type Audit } from '@/hooks/useAudit';
import { sealChain, type ChainStep, type GrantVersionRecord, type LedgerRun, type StepEvent, type WorkflowStepRecord } from '@/Function/audit/auditModel';
import { buildAuditSample } from '@/Function/audit/auditSample';

// What the Audit app reads: the Space's ledger, or — while the Space has no
// AI workflow yet — the on-screen sample in the same shape, so every page
// shows what it is for before the first gateway reports. The sample is never
// written anywhere and gives way to the first real deployment.

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface AuditSource extends Audit {
  /** The ledger shown is the on-screen sample, not the Space's records. */
  sample: boolean;
  /** The sample's steps in full, sealed into their chains. */
  sampleSteps: ChainStep[] | null;
  /** The sample's grants, one version per deployment. */
  sampleGrants: GrantVersionRecord[] | null;
}

const EMPTY: never[] = [];

export function useAuditSource(): AuditSource {
  const audit = useAudit();
  const { t, locale } = useI18n();
  const empty = Boolean(audit.spaceId) && !audit.loading && !audit.error && audit.deployments.length === 0;
  const sample = useQuery({
    queryKey: ['audit-sample', locale],
    queryFn: async () => {
      const built = buildAuditSample(new Date(), t);
      const sealed = (await Promise.all(built.deployments.map(d =>
        sealChain(built.steps.filter(s => s.deployment_id === d.id), sha256Hex)))).flat();
      return { ...built, steps: sealed };
    },
    enabled: empty,
    staleTime: Infinity,
  });
  const data = empty ? sample.data : undefined;

  const stepsByRun = useMemo(() => new Map<string, StepEvent[]>((data?.runs ?? EMPTY).map(run => [run.id, run.steps])), [data]);
  const runsByDeployment = useMemo(() => {
    const map = new Map<string, LedgerRun[]>();
    for (const run of data?.runs ?? EMPTY) map.set(run.deployment_id, [...(map.get(run.deployment_id) ?? []), run]);
    return map;
  }, [data]);

  if (!data) return { ...audit, loading: audit.loading || (empty && sample.isPending), sample: false, sampleSteps: null, sampleGrants: null };
  return {
    ...audit,
    templates: data.templates,
    deployments: data.deployments,
    runs: data.runs,
    truncated: false,
    stepsByRun,
    runsByDeployment,
    // The sample's Domains and agents carry only what the pages read: an id and a name.
    domains: data.domains as unknown as Audit['domains'],
    workers: data.workers as unknown as Audit['workers'],
    sample: true,
    sampleSteps: data.steps,
    sampleGrants: data.grants,
  };
}

/** One run's steps in full, from the ledger or the sample. */
export function useRunSteps(source: AuditSource, runId: string | null): { steps: WorkflowStepRecord[]; loading: boolean; error: Error | null } {
  const real = useAuditRunSteps(source.sample ? null : runId);
  const sampled = useMemo(() => source.sampleSteps?.filter(s => s.run_id === runId) ?? EMPTY, [source.sampleSteps, runId]);
  return source.sample ? { steps: sampled, loading: false, error: null } : real;
}

/** A deployment's latest links and its total, from the ledger or the sample. */
export function useChainLinks(source: AuditSource, deploymentId: string | null): { steps: ChainStep[]; total: number; loading: boolean; error: Error | null } {
  const real = useAuditChain(source.sample ? null : deploymentId);
  const sampled = useMemo(() => (source.sampleSteps?.filter(s => s.deployment_id === deploymentId) ?? EMPTY).slice().reverse(), [source.sampleSteps, deploymentId]);
  return source.sample ? { steps: sampled, total: sampled.length, loading: false, error: null } : real;
}
