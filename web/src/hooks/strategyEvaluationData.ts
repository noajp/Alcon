'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  parseFailureDetail, parseFinishDetail, parseRunVerdict,
  type FailureDetail, type FinishDetail, type RunVerdict,
} from '@/Function/audit/auditModel';
import type { DefinitionRevisionCandidate, DefinitionTest, VerifierCalibration } from '@/types/database';

// The evaluation's data shapes live here, not in the view layer's
// model, so this hook never imports ActivitySpace/ (the layer rule) —
// the same arrangement as initiativeMissionData's MissionReading.
// evaluationModel imports these type-only and re-exports them.

export type EvaluationPeriod = '7d' | '28d' | '90d' | 'all';

/** One run_outcomes row, as the tab reads it (browser-safe columns
 *  only — never strategy_id: attribution is by element set). */
export interface EvaluationOutcomeRow {
  id: string;
  run_id: string;
  element_id: string | null;
  definition_id: string | null;
  outcome: string | null;
  verdict_result: string | null;
  human_signal: string;
  revisions: number;
  cost_usd: number;
  readings_applied: number;
  readings_held: number;
  finished_at: string;
}

/** One agent_runs row for an outcome's run, its jsonb parsed below. */
export interface EvaluationRunRow {
  id: string;
  element_id: string;
  status: string;
  finished_at: string | null;
  verdict: RunVerdict | null;
  finishDetail: FinishDetail | null;
  failureDetail: FailureDetail | null;
}

/** One deliverable a run produced. Its content travels with the row:
 *  agent_artifacts carries NO size column, so the pure model computes
 *  the size signal from the content itself (evaluationModel's
 *  artifactSizeOf), and the tab's Deliverables block expands to the
 *  content, reusing the Overview panel's rendering. */
export interface EvaluationArtifactRow {
  id: string;
  run_id: string | null;
  element_id: string;
  title: string;
  format: string;
  content: string;
  updated_at: string;
}

// =============================================================
// A Strategy's evaluation, read: the finished-run outcomes of its
// Elements, the runs behind them, their deliverables, and — for the
// definitions those runs actually used — calibration, open revision
// candidates and definition tests.
//
// Attribution is BY ELEMENT SET (see evaluationModel's header): the
// outcomes read is by element_id, never by run_outcomes.strategy_id,
// which is deliberately null for runs serving several Strategies.
//
// Evaluation is a report, not a live surface: no polling — the query
// refetches on mount / focus, like useInitiativeHealth.
//
// The period's outcomes are capped at the latest OUTCOME_CAP rows.
// A Strategy finishing more runs than that in one period is beyond
// this tab's v1; the cap is stated here and surfaced by the panel
// (`truncated`), never silent.
// =============================================================

export const OUTCOME_CAP = 2_000;

const CHUNK = 100;

export interface StrategyEvaluationData {
  outcomes: EvaluationOutcomeRow[];
  runs: EvaluationRunRow[];
  artifacts: EvaluationArtifactRow[];
  calibrations: VerifierCalibration[];
  candidates: DefinitionRevisionCandidate[];
  tests: DefinitionTest[];
  definitionNames: Record<string, string>;
  truncated: boolean;
}

const EMPTY: StrategyEvaluationData = {
  outcomes: [], runs: [], artifacts: [], calibrations: [], candidates: [], tests: [], definitionNames: {}, truncated: false,
};

async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

type RunRaw = Omit<EvaluationRunRow, 'verdict' | 'finishDetail' | 'failureDetail'> & {
  verdict: unknown; finish_detail: unknown; failure_detail: unknown;
};

async function fetchEvaluation(elementIds: string[], period: EvaluationPeriod): Promise<StrategyEvaluationData> {
  if (elementIds.length === 0) return EMPTY;
  // The period's start, mirroring evaluationModel.periodStartMs — the
  // formula is duplicated here because hooks may not import the
  // surface layer where the model lives.
  const PERIOD_DAYS: Record<Exclude<EvaluationPeriod, 'all'>, number> = { '7d': 7, '28d': 28, '90d': 90 };
  const sinceIso = period === 'all' ? null : new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString();

  const perChunk = await Promise.all(elementIds.reduce<string[][]>((acc, id, i) => {
    const chunkIdx = Math.floor(i / CHUNK);
    acc[chunkIdx] = [...(acc[chunkIdx] ?? []), id];
    return acc;
  }, []).map(async (chunk) => {
    let q = supabase.from('run_outcomes')
      .select('id, run_id, element_id, definition_id, outcome, verdict_result, human_signal, revisions, cost_usd, readings_applied, readings_held, finished_at')
      .in('element_id', chunk)
      .order('finished_at', { ascending: false })
      .limit(OUTCOME_CAP);
    if (sinceIso) q = q.gte('finished_at', sinceIso);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as EvaluationOutcomeRow[];
  }));
  const allOutcomes = perChunk.flat().sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1));
  const truncated = allOutcomes.length > OUTCOME_CAP;
  const outcomes = allOutcomes.slice(0, OUTCOME_CAP);

  const runIds = [...new Set(outcomes.map((o) => o.run_id))];
  const definitionIds = [...new Set(outcomes.map((o) => o.definition_id).filter((id): id is string => !!id))];

  const [rawRuns, artifacts, calibrations, candidates, tests, definitionRows] = await Promise.all([
    runIds.length === 0 ? [] : inChunks<RunRaw>(runIds, (c) => supabase.from('agent_runs')
      .select('id, element_id, status, finished_at, verdict, finish_detail, failure_detail')
      .in('id', c)),
    runIds.length === 0 ? [] : inChunks<EvaluationArtifactRow>(runIds, (c) => supabase.from('agent_artifacts')
      .select('id, run_id, element_id, title, format, content, updated_at').in('run_id', c).order('updated_at', { ascending: false })),
    definitionIds.length === 0 ? [] : inChunks<VerifierCalibration>(definitionIds, (c) => supabase.from('verifier_calibration')
      .select('id, activity_space_id, definition_id, window_start, window_days, agree_pass, agree_fail, false_pass, false_fail, pairs, updated_at')
      .in('definition_id', c).order('window_start', { ascending: false })),
    definitionIds.length === 0 ? [] : inChunks<DefinitionRevisionCandidate>(definitionIds, (c) => supabase.from('definition_revision_candidates')
      .select('id, definition_id, activity_space_id, reason, rate, pairs, sample_outcome_ids, status, created_at, updated_at')
      .in('definition_id', c).eq('status', 'open')),
    definitionIds.length === 0 ? [] : inChunks<DefinitionTest>(definitionIds, (c) => supabase.from('definition_tests')
      .select('id, definition_id, activity_space_id, name, fixture, expected, source_run_id, source_run_label, source_run_status, tainted, captured_by, captured_at, last_result, last_run_id, last_run_at, last_body_hash')
      .in('definition_id', c)),
    definitionIds.length === 0 ? [] : inChunks<{ id: string; name: string }>(definitionIds, (c) => supabase.from('definitions')
      .select('id, name').in('id', c)),
  ]);

  const runs: EvaluationRunRow[] = rawRuns.map((r) => ({
    id: r.id,
    element_id: r.element_id,
    status: r.status,
    finished_at: r.finished_at,
    verdict: parseRunVerdict(r.verdict),
    finishDetail: parseFinishDetail(r.finish_detail),
    failureDetail: parseFailureDetail(r.failure_detail),
  }));

  return {
    outcomes,
    runs,
    artifacts,
    calibrations,
    candidates,
    tests,
    definitionNames: Object.fromEntries(definitionRows.map((d) => [d.id, d.name])),
    truncated,
  };
}

/** The evaluation rows for a Strategy's Elements over one period. */
export function useStrategyEvaluation(elementIds: string[], period: EvaluationPeriod) {
  const sortedIds = [...elementIds].sort();
  const query = useQuery({
    queryKey: ['strategy-evaluation', sortedIds.join(','), period],
    queryFn: () => fetchEvaluation(sortedIds, period),
    staleTime: 30_000,
  });
  return {
    data: query.data ?? EMPTY,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
