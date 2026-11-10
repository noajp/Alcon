import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDefinition } from '@/AIP/harness/harnessDefinition';
import { describeCron } from '@/AIP/automation/cron';
import { flowStepTitles, workflowOf } from '@/Function/shared/flowEdit';
import {
  automationStatusOf, inputBlocksOf, outputBlocksOf, workflowGraphOf, type AutomationZoneRow,
} from '@/Function/shared/automationZones';

// The Automation builder's zones (design §4.4) are pure projections of
// the automation row plus the steps Athena follows — in the #837 shape
// the automation's own workflow, and the harness body when it still
// follows one. The claim flow is the archetype: poll mail → classify →
// ticket into an Object → mark processed.

const sql = readFileSync(
  new URL('../../supabase/migrations/20261215090000_claim_flow_catalog.sql', import.meta.url),
  'utf8',
);

function claimBody(): string {
  const at = sql.indexOf("'def.claim-intake-gmail'");
  const open = sql.indexOf('$def$', at);
  const close = sql.indexOf('$def$', open + 5);
  return sql.slice(open + 5, close);
}

const CLAIM = claimBody();
const CLAIM_STEPS = flowStepTitles(workflowOf(CLAIM));

function row(patch: Partial<AutomationZoneRow> = {}): AutomationZoneRow {
  return {
    enabled: true, kind: 'schedule', cron: '*/15 * * * *', timezone: 'Asia/Tokyo',
    object_id: 'obj-claims', next_run_at: '2026-11-10T09:15:00.000Z',
    last_fired_at: '2026-11-10T09:00:00.000Z', last_status: 'started',
    ...patch,
  };
}

describe('workflowGraphOf', () => {
  it('prefers the stored drawing, and draws the written workflow when there is none', () => {
    const stored = { nodes: [{ id: 'a', kind: 'step', label: '描いた手順', x: 300, y: 0 }], edges: [{ id: 'e', source: 'start', target: 'a' }] };
    expect(workflowGraphOf({ workflow: '# 進め方\n1. 書いた手順\n', workflow_graph: stored }).nodes.map((n) => n.label)).toEqual(['描いた手順']);
    expect(workflowGraphOf({ workflow: '# 進め方\n1. 書いた手順\n', workflow_graph: null }).nodes.map((n) => n.label)).toEqual(['書いた手順']);
    expect(workflowGraphOf({ workflow: '', workflow_graph: null })).toEqual({ nodes: [], edges: [] });
  });
});

describe('automationStatusOf', () => {
  it('reads off before anything else', () => {
    expect(automationStatusOf(row({ enabled: false, last_status: 'failed' })))
      .toEqual({ kind: 'off', at: null, waiting: false });
  });

  it('reads a failed last start before the next run', () => {
    expect(automationStatusOf(row({ last_status: 'failed' })))
      .toEqual({ kind: 'failed', at: '2026-11-10T09:00:00.000Z', waiting: false });
  });

  it('reads the next run for a schedule, and the last firing otherwise', () => {
    expect(automationStatusOf(row())).toEqual({ kind: 'next', at: '2026-11-10T09:15:00.000Z', waiting: false });
    expect(automationStatusOf(row({ kind: 'webhook', cron: null, next_run_at: null })))
      .toEqual({ kind: 'last', at: '2026-11-10T09:00:00.000Z', waiting: false });
    expect(automationStatusOf(row({ kind: 'webhook', cron: null, next_run_at: null, last_fired_at: null })))
      .toEqual({ kind: 'none', at: null, waiting: false });
  });

  it('marks a row whose latest run waits on an approval', () => {
    expect(automationStatusOf(row(), 'awaiting_approval').waiting).toBe(true);
    expect(automationStatusOf(row(), 'running').waiting).toBe(false);
    expect(automationStatusOf(row(), null).waiting).toBe(false);
  });
});

describe('inputBlocksOf', () => {
  it('projects the claim flow: its schedule, then one Mail block from its search step', () => {
    const blocks = inputBlocksOf(row(), CLAIM_STEPS);
    expect(blocks[0]).toEqual({ kind: 'trigger', triggerKind: 'schedule', detail: describeCron('*/15 * * * *') });
    // The read step names Gmail too — one block per connector, from
    // the first step that names it.
    expect(blocks.filter((b) => b.kind === 'mail')).toHaveLength(1);
    expect(blocks[1]).toMatchObject({ kind: 'mail', stepIndex: 0 });
    if (blocks[1].kind === 'mail') expect(blocks[1].detail).toContain('gmail_search');
  });

  it('projects a webhook trigger with no schedule text', () => {
    expect(inputBlocksOf(row({ kind: 'webhook', cron: null }), []))
      .toEqual([{ kind: 'trigger', triggerKind: 'webhook', detail: '' }]);
  });

  it('projects a Files poll and another connector under its own name', () => {
    const blocks = inputBlocksOf(row(), [
      'searchFiles で報告書を探す',
      'notion_search で議事録を探す',
      'notion_read で本文を読む',
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['trigger', 'files', 'source']);
    expect(blocks[2]).toMatchObject({ kind: 'source', connector: 'notion', stepIndex: 1 });
  });

  it('offers no block for kinds with no machinery (no arrival, no run-finished)', () => {
    expect(inputBlocksOf(row(), ['まとめて報告する']).map((b) => b.kind)).toEqual(['trigger']);
  });
});

describe('outputBlocksOf', () => {
  it('projects the claim flow: target, artifact shape, tickets, the processed mark — and no send', () => {
    const blocks = outputBlocksOf(row(), parseDefinition(CLAIM), CLAIM_STEPS, '問い合わせ対応');
    expect(blocks[0]).toEqual({ kind: 'target', objectId: 'obj-claims', objectName: '問い合わせ対応' });
    expect(blocks[1]).toMatchObject({ kind: 'artifact', format: 'markdown' });
    const effects = blocks.filter((b) => b.kind !== 'target' && b.kind !== 'artifact');
    expect(effects.map((b) => [b.kind, b.stepIndex])).toEqual([['tickets', 3], ['marks-processed', 4]]);
    expect(blocks.some((b) => b.kind === 'sends')).toBe(false);
  });

  it('projects a schedule-only automation with no harness as just its target', () => {
    expect(outputBlocksOf(row(), null, ['集計して表にまとめる'], '集計先'))
      .toEqual([{ kind: 'target', objectId: 'obj-claims', objectName: '集計先' }]);
  });

  it('groups sends and file writes by step, and marks a Strategy change as gated', () => {
    const blocks = outputBlocksOf(row(), null, [
      'gmail_send で担当者に送る',
      'writeFile で報告書を保存する',
      'updateInitiative で Strategy を更新する',
    ], null);
    const effects = blocks.filter((b) => b.kind !== 'target' && b.kind !== 'artifact');
    expect(effects.map((b) => [b.kind, b.gated])).toEqual([['sends', false], ['files', false], ['strategy', true]]);
  });
});
