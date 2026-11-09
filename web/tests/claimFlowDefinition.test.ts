import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The claim-handling flow (Sim-incorporation P4; design §6) ships
// as a catalog seed (migration 20261215090000): reviewable draft
// material a person adds from Discover and activates through the
// normal paths — never installed or activated by the seed itself.
// These tests read the shipped text out of the migration and pin
// what §6 promises of it: it parses as a definition, it passes the
// checks a promotion package must pass, its steps project to the
// flow the canvas draws, its tool references are the real P1/P2
// command names, and the canvas edits work on it like any body.
import { checkHarness, parseDefinition } from '@/AIP/harness/harnessDefinition';
import { GMAIL_MANIFEST } from '@/AIP/connectors/gmailManifest';
import {
  deleteFlowStep, editFlowStepLine, flowStepTitles, moveFlowStep,
} from '@/Function/shared/flowEdit';
import { projectDefinitionFlow, type FlowContext } from '@/Function/shared/flowProjection';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261215090000_claim_flow_catalog.sql', import.meta.url),
  'utf8',
);

function seedBody(): string {
  const at = sql.indexOf("'def.claim-intake-gmail'");
  expect(at).toBeGreaterThan(-1);
  const open = sql.indexOf('$def$', at);
  const close = sql.indexOf('$def$', open + 5);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

const BODY = seedBody();
const NO_ROW: FlowContext = { trigger: null, objectName: null };

describe('the claim-flow seed migration', () => {
  it('is guarded for preview replay and lands as a definition catalog row', () => {
    expect(sql).toContain("if to_regclass('public.catalog_items') is null then");
    expect(sql).toContain('raise notice');
    expect(sql).toContain("'def.claim-intake-gmail', 'definition'");
    expect(sql).toContain('on conflict (id) do update');
  });

  it('installs and activates nothing itself — it only offers the text', () => {
    expect(sql).not.toMatch(/insert into public\.(definitions|automations|promotion_drafts)/);
    expect(sql).not.toMatch(/update public\.(definitions|automations)/);
  });
});

describe('the claim-flow body', () => {
  const def = parseDefinition(BODY);

  it('parses as a definition naming the Gmail connector', () => {
    expect(def.connectors).toEqual(['Gmail']);
    expect(def.sections.goal).toContain('クレームメール');
    expect(def.output?.format).toBe('markdown');
  });

  it('passes the harness check with no errors', () => {
    const problems = checkHarness(def).filter((d) => d.severity === 'error');
    expect(problems).toEqual([]);
  });

  it('carries what the promotion package gate demands: a numeric budget and checks', () => {
    // promotionPackageGate (server _shared/promotion.ts) refuses a
    // package whose Stop section names no numeric budget and warns
    // without checks; the seed must clear both as written.
    expect(def.stop.budgetUsd).toBe(2);
    expect(def.checks.items.length).toBeGreaterThan(0);
  });

  it('references only real Gmail commands — the ones P1/P2 shipped', () => {
    const commands = (GMAIL_MANIFEST as { commands: { name: string }[] }).commands.map((c) => c.name);
    const referenced = [...new Set(BODY.match(/gmail_[a-z_]+/g) ?? [])];
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) expect(commands).toContain(name);
    // The flow itself: search → read → the processed mark.
    expect(referenced).toEqual(expect.arrayContaining([
      'gmail_search', 'gmail_read', 'gmail_modify_labels',
    ]));
    // Never a send: the flow tickets work for people; it does not reply.
    expect(referenced).not.toContain('gmail_send');
  });

  it('projects to the §6 flow: search, read, the urgent branch, ticket, mark', () => {
    const flow = projectDefinitionFlow(def, {
      trigger: { kind: 'schedule', cron: '*/15 * * * *', timezone: 'Asia/Tokyo' },
      objectName: '問い合わせ対応',
    });
    expect(flow.nodes.map((n) => n.kind)).toEqual([
      'trigger', 'target', 'step', 'step', 'condition', 'step', 'step', 'checks', 'output', 'stop',
    ]);
    expect(flow.edges.find((e) => e.kind === 'branch')).toMatchObject({ source: 'step-1', target: 'step-2' });
    expect(flow.connectors).toEqual(['Gmail']);
    expect(flow.assignment).toContain('対応表の担当者');
    expect(flowStepTitles(BODY)).toEqual([
      'gmail_search で未処理のクレームメールを検索する（is:unread label:claim -label:processed、最大 10 件）',
      'gmail_read でメールを 1 件ずつ読み、内容を要約して分類する（請求・障害・その他）',
      '緊急の場合は担当者にすぐ知らせる',
      '分類に応じて対象 Object に Element を起票する。要約と、次に人が判断すべきことを書く',
      'gmail_modify_labels で起票したメールに processed ラベルを付け、処理済みにする',
    ]);
  });

  it('takes the canvas edits like any body, the rest byte for byte', () => {
    // Delete the condition step: the branch leaves the projection.
    const noCondition = deleteFlowStep(BODY, 2)!;
    const flow = projectDefinitionFlow(parseDefinition(noCondition), NO_ROW);
    expect(flow.nodes.some((n) => n.kind === 'condition')).toBe(false);
    // Edit the search line's text: only that line changes.
    const edited = editFlowStepLine(BODY, 0, 'gmail_search で未処理のクレームメールを検索する（label:claim、最大 5 件）')!;
    expect(edited).toBe(BODY.replace(
      '- gmail_search で未処理のクレームメールを検索する（is:unread label:claim -label:processed、最大 10 件）',
      '- gmail_search で未処理のクレームメールを検索する（label:claim、最大 5 件）',
    ));
    // Move the processed-mark step up: the order changes, nothing else.
    const moved = moveFlowStep(BODY, 4, -1)!;
    expect(flowStepTitles(moved)[3]).toContain('gmail_modify_labels');
    expect(flowStepTitles(moved)[4]).toContain('Element を起票する');
    // A delete inside the Procedure leaves everything outside it untouched.
    const cut = deleteFlowStep(BODY, 0)!;
    expect(cut.slice(0, cut.indexOf('# 進め方'))).toBe(BODY.slice(0, BODY.indexOf('# 進め方')));
    expect(cut.slice(cut.indexOf('# 点検'))).toBe(BODY.slice(BODY.indexOf('# 点検')));
  });
});
