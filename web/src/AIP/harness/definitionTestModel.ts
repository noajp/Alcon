import { canonicalJson } from '@/AIP/connectors/draftModel';
import type { DefinitionTest } from '@/types/database';

// Definition tests (B14), the display model: what the harness
// editor's tests section and the constraint review's summary line
// compute from a test row — the latest verdict read tolerantly, the
// two freshness axes (the tried body moved on; the fixture aged),
// and the counts a review line states. Pure throughout, like the
// calibration and constraint models beside it.

/** Days after which a fixture shows as old (D3 — the memory
 *  episode TTL's相場）. Age never blocks a launch and never deletes
 *  anything; it is a label, not a gate. */
const FIXTURE_STALE_DAYS = 90;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The definition body hash a test result binds to — the web twin
 *  of the server recipe (_shared/definitionTests.ts'
 *  definitionBodyHash, itself B6's): sha256 of the canonical
 *  { kind, body }. The agreement test pins them together. */
export async function definitionBodyHashWeb(body: string): Promise<string> {
  return sha256Hex(canonicalJson({ kind: 'definition', body }));
}

export interface TestVerdictView {
  outcome: 'pass' | 'fail';
  classification: string;
  expectedClassification: string;
  consumed: number;
  total: number;
  firstDivergence: { kind: string; action: string } | null;
  at: string;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The stored verdict, read tolerantly for display: a malformed
 *  record shows as no result, never as a pass. */
export function readTestVerdict(value: unknown): TestVerdictView | null {
  if (!isObj(value)) return null;
  if (value.outcome !== 'pass' && value.outcome !== 'fail') return null;
  if (typeof value.classification !== 'string' || typeof value.expectedClassification !== 'string') return null;
  if (typeof value.consumed !== 'number' || typeof value.total !== 'number') return null;
  const divergences = Array.isArray(value.divergences) ? value.divergences : [];
  const first = divergences.find(isObj);
  return {
    outcome: value.outcome,
    classification: value.classification,
    expectedClassification: value.expectedClassification,
    consumed: value.consumed,
    total: value.total,
    firstDivergence: first && typeof first.kind === 'string' && typeof first.action === 'string'
      ? { kind: first.kind, action: first.action } : null,
    at: typeof value.at === 'string' ? value.at : '',
  };
}

export function fixtureExchangeCount(test: DefinitionTest): number {
  if (!isObj(test.fixture) || !Array.isArray(test.fixture.exchanges)) return 0;
  return test.fixture.exchanges.length;
}

export interface TestFreshness {
  /** The latest result tried a body that is no longer the saved
   *  one — a version fact, its own axis, separate from age. */
  staleBody: boolean;
  /** The fixture itself is older than the staleness threshold. */
  oldFixture: boolean;
  ageDays: number;
}

export function testFreshness(test: DefinitionTest, currentBodyHash: string | null, now: Date): TestFreshness {
  const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(test.captured_at).getTime()) / 86_400_000));
  return {
    staleBody: !!test.last_body_hash && !!currentBodyHash && test.last_body_hash !== currentBodyHash,
    oldFixture: ageDays > FIXTURE_STALE_DAYS,
    ageDays,
  };
}

export interface ConstraintTestSummary {
  total: number;
  /** Tests whose latest result was measured against the CURRENT body. */
  passCurrent: number;
  failCurrent: number;
  /** Tests whose latest result tried an older body (or none yet). */
  oldVersion: number;
}

/** The constraint review's one line (§8.3): how the target
 *  definition's tests stand against its CURRENT body. Null when the
 *  definition has no tests — absence is not a warning (D2), and a
 *  failing test never blocks activation; the line informs, the
 *  owner's judgement decides. */
export function constraintTestSummary(
  tests: readonly DefinitionTest[],
  currentBodyHash: string | null,
): ConstraintTestSummary | null {
  if (!tests.length) return null;
  let passCurrent = 0;
  let failCurrent = 0;
  let oldVersion = 0;
  for (const test of tests) {
    const verdict = readTestVerdict(test.last_result);
    if (!verdict || !test.last_body_hash || !currentBodyHash || test.last_body_hash !== currentBodyHash) {
      oldVersion++;
    } else if (verdict.outcome === 'pass') passCurrent++;
    else failCurrent++;
  }
  return { total: tests.length, passCurrent, failCurrent, oldVersion };
}

/** The canonical actions one connection's manifest declares
 *  today: its commands' actions plus the targets of its aliases.
 *  Connections without a manifest (Drive's fixed tools, a raw HTTP
 *  connection) contribute nothing — their actions do not live in a
 *  manifest and cannot vanish by a manifest edit. */
export function manifestActionsByIntegration(
  rows: readonly { id: string; manifest: unknown }[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!isObj(row.manifest)) continue;
    const actions = new Set<string>();
    const commands = (row.manifest as { commands?: unknown }).commands;
    if (Array.isArray(commands)) {
      for (const c of commands) {
        if (isObj(c) && typeof c.action === 'string') actions.add(c.action);
      }
    }
    const aliases = (row.manifest as { aliases?: unknown }).aliases;
    if (isObj(aliases)) {
      for (const v of Object.values(aliases)) if (typeof v === 'string') actions.add(v);
    }
    out.set(row.id, actions);
  }
  return out;
}

/** Fixture actions that no longer exist on their own connection
 *  (§5.4's preflight note): the manifest was edited under the
 *  fixture, or the connection itself is gone. Checked per exchange
 *  against ITS connection's manifest; exchanges on manifest-less
 *  connections are not checkable here and never flagged. Shown on
 *  the launch surface as information — launching is NOT blocked;
 *  the replay itself names the same fact precisely, as a
 *  divergence. */
export function vanishedActions(
  test: DefinitionTest,
  manifestActions: ReadonlyMap<string, ReadonlySet<string>>,
  knownIntegrationIds: ReadonlySet<string>,
): string[] {
  if (!isObj(test.fixture) || !Array.isArray(test.fixture.exchanges)) return [];
  const gone = new Set<string>();
  for (const e of test.fixture.exchanges) {
    if (!isObj(e) || typeof e.action !== 'string' || typeof e.integrationId !== 'string') continue;
    const actions = manifestActions.get(e.integrationId);
    if (actions) { if (!actions.has(e.action)) gone.add(e.action); }
    else if (!knownIntegrationIds.has(e.integrationId)) gone.add(e.action);
  }
  return [...gone];
}
