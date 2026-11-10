import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDefinition } from '@/AIP/harness/harnessDefinition';
import { describeCron, parseCron } from '@/AIP/automation/cron';
import { flowStepTitles, workflowOf } from '@/Function/shared/flowEdit';
import {
  AUTOMATION_CRON_PRESETS, automationStatusOf, bindingInputOf, bindingUpdateOf,
  inputBlocksOf, outputBlocksOf, workflowGraphOf, type AutomationZoneRow,
} from '@/Function/shared/automationZones';
import { nextRunOf } from '@/hooks/automationData';

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

describe('binding editing (PR2)', () => {
  const NOW = new Date('2026-11-06T01:00:00Z');

  it('offers only presets whose cron can be read', () => {
    expect(AUTOMATION_CRON_PRESETS.length).toBeGreaterThan(0);
    for (const p of AUTOMATION_CRON_PRESETS) expect(() => parseCron(p.cron)).not.toThrow();
  });

  it('reads a row into the binding input, templates and all', () => {
    expect(bindingInputOf({
      kind: 'schedule', cron: '0 9 * * *', timezone: 'Asia/Tokyo', object_id: 'obj-1',
      title_template: '朝のまとめ', description_template: null,
    })).toEqual({
      kind: 'schedule', cron: '0 9 * * *', timezone: 'Asia/Tokyo', objectId: 'obj-1',
      titleTemplate: '朝のまとめ', descriptionTemplate: null,
    });
    // A row read before the template columns were carried reads as none.
    expect(bindingInputOf({ kind: 'webhook', cron: null, timezone: 'UTC', object_id: 'obj-2' }))
      .toEqual({ kind: 'webhook', cron: null, timezone: 'UTC', objectId: 'obj-2', titleTemplate: null, descriptionTemplate: null });
  });

  it('shapes a schedule edit as creation does: trimmed cron, recomputed next run', () => {
    expect(bindingUpdateOf({
      kind: 'schedule', cron: ' 0 9 * * * ', timezone: 'Asia/Tokyo', objectId: 'obj-1',
      titleTemplate: '', descriptionTemplate: '  ',
    }, NOW)).toEqual({
      kind: 'schedule', cron: '0 9 * * *', timezone: 'Asia/Tokyo', object_id: 'obj-1',
      title_template: null, description_template: null,
      // 9:00 in Asia/Tokyo after 2026-11-06T01:00:00Z is the next day's 00:00Z.
      next_run_at: '2026-11-07T00:00:00.000Z',
    });
  });

  it('keeps a non-empty template as written', () => {
    const shaped = bindingUpdateOf({
      kind: 'schedule', cron: '0 9 * * *', timezone: 'Asia/Tokyo', objectId: 'obj-1',
      titleTemplate: '{date} の問い合わせ', descriptionTemplate: '本文',
    }, NOW);
    expect(shaped.title_template).toBe('{date} の問い合わせ');
    expect(shaped.description_template).toBe('本文');
  });

  it('shapes a webhook edit with no cron and no next run, whatever cron it was handed', () => {
    expect(bindingUpdateOf({
      kind: 'webhook', cron: '0 9 * * *', timezone: 'Asia/Tokyo', objectId: 'obj-1',
      titleTemplate: null, descriptionTemplate: null,
    }, NOW)).toEqual({
      kind: 'webhook', cron: null, timezone: 'Asia/Tokyo', object_id: 'obj-1',
      title_template: null, description_template: null, next_run_at: null,
    });
  });

  it('leaves the next run empty for a cron that cannot be read or never runs', () => {
    const base = { kind: 'schedule' as const, timezone: 'Asia/Tokyo', objectId: 'obj-1', titleTemplate: null, descriptionTemplate: null };
    expect(bindingUpdateOf({ ...base, cron: 'not a cron' }, NOW).next_run_at).toBeNull();
    expect(bindingUpdateOf({ ...base, cron: '0 9 31 2 *' }, NOW).next_run_at).toBeNull();
    expect(bindingUpdateOf({ ...base, cron: null }, NOW).next_run_at).toBeNull();
  });

  it('falls back to Asia/Tokyo when the timezone is empty, as the promotion binding does', () => {
    const shaped = bindingUpdateOf({
      kind: 'schedule', cron: '0 9 * * *', timezone: ' ', objectId: 'obj-1',
      titleTemplate: null, descriptionTemplate: null,
    }, NOW);
    expect(shaped.timezone).toBe('Asia/Tokyo');
    expect(shaped.next_run_at).toBe('2026-11-07T00:00:00.000Z');
  });

  it('exports the next-run computation creation uses, agreeing with the shaping', () => {
    expect(nextRunOf('webhook', '0 9 * * *', 'Asia/Tokyo')).toBeNull();
    expect(nextRunOf('schedule', 'not a cron', 'Asia/Tokyo')).toBeNull();
    expect(nextRunOf('schedule', null, 'Asia/Tokyo')).toBeNull();
    expect(typeof nextRunOf('schedule', '0 9 * * *', 'Asia/Tokyo')).toBe('string');
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
