import { describe, expect, it } from 'vitest';
import {
  actionState, missionBarriers, type MissionElementRow, type MissionRunRow,
} from '@/ActivitySpace/strategy/initiative/mission/missionModel';

// The server port of the Chain's state reading (getInitiativeExecution's
// source). Pinned to the web original over shared fixtures: the two must
// agree, or the conversation would describe different work than the
// Chain shows.
const es = await import(new URL('../../supabase/functions/_shared/executionState.ts', import.meta.url).pathname);

interface Case {
  status: string | null;
  claudeCode?: boolean;
  leased?: boolean;
  runStatus?: string;
}

const CASES: Case[] = [
  { status: 'done', runStatus: 'running' },
  { status: 'cancelled', runStatus: 'running' },
  { status: 'blocked' },
  { status: 'todo', runStatus: 'queued' },
  { status: 'todo', runStatus: 'running' },
  { status: 'todo', runStatus: 'awaiting_approval' },
  { status: 'todo', runStatus: 'awaiting_input' },
  { status: 'todo', runStatus: 'paused' },
  { status: 'todo', runStatus: 'failed' },
  { status: 'todo', runStatus: 'completed' },
  { status: 'todo', runStatus: 'awaiting_review' },
  { status: 'review' },
  { status: 'in_progress' },
  { status: 'todo' },
  { status: null },
  { status: 'review', claudeCode: true },
  { status: 'todo', claudeCode: true, leased: true },
  { status: 'todo', claudeCode: true, leased: false },
  { status: 'in_progress', claudeCode: true, runStatus: 'failed' },
];

const webElement = (c: Case): MissionElementRow => ({
  id: 'e', title: 'Task e', status: c.status, display_id: null, object_id: 'o1',
  claudeCode: c.claudeCode, leased: c.leased,
});
const webRun = (c: Case): MissionRunRow | undefined => c.runStatus === undefined ? undefined : {
  id: 'r', element_id: 'e', status: c.runStatus as MissionRunRow['status'], input_tokens: 0, output_tokens: 0,
  cost_usd: 0, summary: null, error: null, created_at: '1', verdict: null, proposed_readings: null,
};
const serverElement = (c: Case) => ({
  id: 'e', title: 'Task e', status: c.status, claudeCode: c.claudeCode, leased: c.leased,
});
const serverRun = (c: Case) => c.runStatus === undefined ? undefined : {
  element_id: 'e', status: c.runStatus, summary: null, error: null, created_at: '1',
};

describe('executionState agreement: actionStateOf is actionState', () => {
  it('agrees on every fixture in the matrix', () => {
    for (const c of CASES) {
      expect(es.actionStateOf(serverElement(c), serverRun(c)), JSON.stringify(c))
        .toBe(actionState(webElement(c), webRun(c)));
    }
  });

  it('reads the shared cases as the Chain does', () => {
    expect(es.actionStateOf(serverElement({ status: 'todo', runStatus: 'awaiting_input' }), serverRun({ status: 'todo', runStatus: 'awaiting_input' }))).toBe('waiting');
    expect(es.actionStateOf(serverElement({ status: 'done', runStatus: 'running' }), serverRun({ status: 'done', runStatus: 'running' }))).toBe('done');
    expect(es.actionStateOf(serverElement({ status: 'todo', claudeCode: true, leased: true }), undefined)).toBe('running');
  });

  it('takes the latest run per Element', () => {
    const latest = es.latestRunsByElement([
      { element_id: 'a', status: 'failed', summary: null, error: null, created_at: '2026-11-01' },
      { element_id: 'a', status: 'completed', summary: null, error: null, created_at: '2026-11-02' },
    ]);
    expect(latest.get('a')?.status).toBe('completed');
  });
});

describe('executionState agreement: barriersOf is missionBarriers', () => {
  const elements = [
    { id: 'a', title: 'Task a', status: 'done' },
    { id: 'b', title: 'Task b', status: 'todo' },
    { id: 'c', title: 'Task c', status: 'blocked' },
    { id: 'd', title: 'Task d', status: 'todo' },
    { id: 'e', title: 'Task e', status: 'cancelled' },
    { id: 'f', title: 'Task f', status: 'review' },
  ];
  const runs = [
    { element_id: 'b', status: 'running', summary: null, error: null, created_at: '1' },
    { element_id: 'd', status: 'failed', summary: null, error: 'boom', created_at: '1' },
    { element_id: 'a', status: 'completed', summary: null, error: null, created_at: '1' },
  ];

  it('agrees on membership, order and detail', () => {
    const web = missionBarriers(
      elements.map((e) => ({ ...e, display_id: null, object_id: 'o1' })),
      runs.map((r) => ({ ...r, id: `run-${r.element_id}`, input_tokens: 0, output_tokens: 0, cost_usd: 0, verdict: null, proposed_readings: null }) as MissionRunRow),
    );
    const server = es.barriersOf(elements, runs);
    expect(server.map((b: { elementId: string; kind: string; detail: string | null }) => [b.elementId, b.kind, b.detail]))
      .toEqual(web.map((b) => [b.elementId, b.kind, b.detail]));
    expect(server.map((b: { elementId: string }) => b.elementId)).toEqual(['c', 'd', 'f']);
    expect(server[1].detail).toBe('boom');
    expect(server[0].title).toBe('Task c');
  });
});
