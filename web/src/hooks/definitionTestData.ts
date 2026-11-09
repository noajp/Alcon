'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DefinitionTest } from '@/types/database';

// Definition test reads and actions (B14). Members of the Space read
// the rows (RLS); deletion is the row's own policy (captured_by or
// the Space's owner). Everything else — capture, launch, settle —
// goes through the engine's definitionTest actions, because capture
// derives server-side (the client never carries a fixture to save)
// and launching places a run. The table grants members no update:
// last_* results are the settle's alone.

const TEST_COLUMNS = 'id, definition_id, activity_space_id, name, fixture, expected, source_run_id, source_run_label, source_run_status, tainted, captured_by, captured_at, last_result, last_run_id, last_run_at, last_body_hash';

export function useDefinitionTests(definitionId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['definition-tests', definitionId ?? 'none'] as const;
  const query = useQuery({
    queryKey,
    enabled: !!definitionId,
    queryFn: async (): Promise<DefinitionTest[]> => {
      const { data, error } = await supabase.from('definition_tests').select(TEST_COLUMNS)
        .eq('definition_id', definitionId!).order('captured_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as DefinitionTest[];
    },
  });
  return {
    tests: query.data ?? [],
    loading: !!definitionId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey }),
  };
}

/** Every test in the Space, for surfaces that summarize across
 *  definitions (the constraint review's one line). */
export function useSpaceDefinitionTests(spaceId: string | null) {
  const queryKey = ['definition-tests-space', spaceId ?? 'none'] as const;
  const query = useQuery({
    queryKey,
    enabled: !!spaceId,
    queryFn: async (): Promise<DefinitionTest[]> => {
      const { data, error } = await supabase.from('definition_tests').select(TEST_COLUMNS)
        .eq('activity_space_id', spaceId!).order('captured_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as DefinitionTest[];
    },
  });
  return { tests: query.data ?? [], loading: !!spaceId && query.isPending };
}

export interface CaptureExchangePreview {
  seq: number; kind: string; action: string; integrationName: string;
  summary: string; argKeys: string[]; isError: boolean; responsePreview: string;
}

export type CapturePreview =
  | {
      ok: true; definitionId: string; definitionName: string; tainted: boolean;
      sourceRunLabel: string; exchanges: CaptureExchangePreview[];
    }
  | { ok: false; reason: string; detail?: string; seq?: number };

export type CaptureSave =
  | { ok: true; testId: string }
  | { ok: false; reason: string; detail?: string; seq?: number };

/** The failure half of either capture call, for the surfaces that
 *  render its named reason. */
export interface CaptureFailureLike { ok: false; reason: string; detail?: string; seq?: number }

export type TestLaunch = { ok: true; runId: string; elementId: string } | { ok: false; reason: string; detail?: string };

/** One engine round-trip for a definitionTest action; the engine's
 *  own message surfaces on failure (agentData's invoke discipline). */
async function invokeDefinitionTest<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('run-agent', { body: { definitionTest: payload } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = error.message;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) message = String(j.error); } catch { /* keep */ }
    }
    throw new Error(message);
  }
  return data as T;
}

/** The capture preview: the server derives the fixture from the
 *  run's record and returns the confirmation's material — never the
 *  fixture itself. */
export async function previewTestCapture(runId: string): Promise<CapturePreview> {
  return invokeDefinitionTest<CapturePreview>({ action: 'capturePreview', runId });
}

/** Saves a confirmed capture: the server re-derives everything with
 *  the person's name and volatile marks. */
export async function saveTestCapture(args: {
  runId: string; name: string; marks: { seq: number; keys: string[] }[];
}): Promise<CaptureSave> {
  return invokeDefinitionTest<CaptureSave>({ action: 'captureSave', ...args });
}

/** Launches one test run. `body` is the editor's unsaved body when
 *  the person runs the test against their edit (D6); absent, the
 *  saved body is tried. */
export async function launchDefinitionTestRun(testId: string, body?: string): Promise<TestLaunch> {
  return invokeDefinitionTest<TestLaunch>({ action: 'launch', testId, ...(body !== undefined ? { body } : {}) });
}

/** Deletion is the row's own RLS line (captured_by or owner) — a
 *  direct delete, refused by the policy for anyone else. */
export async function deleteDefinitionTest(testId: string): Promise<void> {
  const { error } = await supabase.from('definition_tests').delete().eq('id', testId);
  if (error) throw error;
}
