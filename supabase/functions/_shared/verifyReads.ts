// Verify-reads (back-half B2; Muse_3 proposal #1): after a write whose
// manifest command declares a `verify`, the engine reads the target state
// back through the declared read and compares it, mechanically, with what
// the write intended (stateDiff.ts). A write's success stops being a fact
// about an API response and becomes a fact about the world.
//
// Three outcomes, kept distinct because they mean different things:
//  - ok         — the read-back matched the intent.
//  - mismatch   — the read-back answered and disagreed: a diff, a fact the
//                 run must face (its tool result becomes an error naming
//                 the fields, so the run's own loop can correct it).
//  - unverified — the read itself could not be run or answered in error:
//                 absence of evidence, never recorded as a mismatch.
//
// The check never re-runs the write, and the read runs as a read — through
// the same executor and policy recheck as any read (integrationTools.ts
// supplies it as `callRead`), so it cannot ask and cannot be gated. Pure
// but for the injected read and sleep: the executor supplies both.

import type { Manifest, ManifestCommand, VerifyDeclaration } from "./connectorManifest.ts";
import { diffExpect, stateOfResult, type DiffMismatch } from "./stateDiff.ts";

/** The record a checked write leaves (on its action row, in its trace):
 *  `{ ok: true }`, or `{ ok: false, diff }` on a mismatch, or
 *  `{ ok: false, unverified }` with the reason the read could not judge. */
export interface VerifyCheck {
  ok: boolean;
  diff?: DiffMismatch[];
  unverified?: string;
}

/** A run's verify accounting, counted by code as its writes land — the
 *  tally the verdict record seals beside the claim accounting (B1's
 *  pattern: counts describe what the run's writes did, judged by nobody). */
export interface VerifyTally {
  checked: number;
  ok: number;
  mismatched: number;
  unverified: number;
}

export const emptyVerifyTally = (): VerifyTally => ({ checked: 0, ok: 0, mismatched: 0, unverified: 0 });

/** Pure. A tally with one more check folded in. */
export function tallyVerify(tally: VerifyTally, check: VerifyCheck): VerifyTally {
  return {
    checked: tally.checked + 1,
    ok: tally.ok + (check.ok ? 1 : 0),
    mismatched: tally.mismatched + (!check.ok && !check.unverified ? 1 : 0),
    unverified: tally.unverified + (check.unverified ? 1 : 0),
  };
}

/**
 * Pure. The expected state a verify declaration promises, built from the
 * write's input: an expect value that is a string naming one of the
 * write's input fields takes that field's value; anything else (a string
 * naming no input field, a number, a boolean, null, an object) is a
 * literal the read-back must carry as-is.
 */
export function expectedOfVerify(decl: VerifyDeclaration, writeInput: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(decl.expect)) {
    out[field] = typeof spec === "string" && Object.prototype.hasOwnProperty.call(writeInput, spec)
      ? writeInput[spec]
      : spec;
  }
  return out;
}

/**
 * Pure. The input the verify read is called with: the write's input
 * overlaid with the write result's own state (a created resource reports
 * its id/number there, and the read needs them), narrowed to the fields
 * the read command declares when it declares any. When it declares none
 * (an MCP command materialized from a tool list), long string payloads —
 * a written file's content above all — are left out: they are what was
 * written, never how the read is addressed.
 */
export function verifyReadInput(
  readCommand: ManifestCommand,
  writeInput: Record<string, unknown>,
  writeResultText: string,
): Record<string, unknown> {
  const candidate: Record<string, unknown> = { ...writeInput, ...stateOfResult(writeResultText) };
  const declared = Object.keys(readCommand.input ?? {});
  if (declared.length) {
    const out: Record<string, unknown> = {};
    for (const k of declared) if (candidate[k] !== undefined) out[k] = candidate[k];
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (typeof v === "string" && v.length > 1000) continue;
    out[k] = v;
  }
  return out;
}

export interface VerifyReadDeps {
  /** Runs the declared read through the caller's normal read path. */
  callRead: (command: ManifestCommand, input: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Runs one write's verify: resolve the declared read in the same
 * manifest, build the expected state from the write's input, read back,
 * diff. Read-after-write inconsistency gets exactly one bounded retry
 * after the declaration's delay (verify.delay_ms, default 0) — a mismatch
 * after the retry is a fact, not a cue for a third silent try — and
 * neither outcome ever re-runs the write.
 */
export async function runVerifyRead(args: {
  manifest: Manifest;
  declaration: VerifyDeclaration;
  writeInput: Record<string, unknown>;
  writeResultText: string;
  deps: VerifyReadDeps;
}): Promise<VerifyCheck> {
  const { manifest, declaration, writeInput, writeResultText, deps } = args;
  const readCommand = manifest.commands.find((c) => c.name === declaration.command);
  if (!readCommand || readCommand.effect !== "read") {
    return { ok: false, unverified: `確認用の読み取り「${declaration.command}」が manifest にありません` };
  }
  const input = verifyReadInput(readCommand, writeInput, writeResultText);
  const missing = readCommand.required.filter((f) => input[f] === undefined || input[f] === null || input[f] === "");
  if (missing.length) {
    return { ok: false, unverified: `確認用の読み取りに必要な項目がありません: ${missing.join(", ")}` };
  }
  const expected = expectedOfVerify(declaration, writeInput);
  const attempt = async (): Promise<VerifyCheck> => {
    let r: { text: string; isError: boolean };
    try {
      r = await deps.callRead(readCommand, input);
    } catch (e) {
      return { ok: false, unverified: `確認用の読み取りが失敗しました: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
    }
    if (r.isError) return { ok: false, unverified: `確認用の読み取りが失敗しました: ${r.text.slice(0, 200)}` };
    const diff = diffExpect(expected, stateOfResult(r.text));
    return diff.length ? { ok: false, diff } : { ok: true };
  };
  const first = await attempt();
  if (first.ok || declaration.delayMs <= 0) return first;
  await (deps.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms))))(declaration.delayMs);
  return attempt();
}

/** Pure. A check's one-line shape for a trace step or an error message:
 *  the fields that disagreed, each with what was intended and what was
 *  found, values capped so a whole file never rides into a log line. */
export function verifyDiffText(diff: readonly DiffMismatch[]): string {
  const show = (v: unknown): string => {
    if (v === undefined) return "(なし)";
    const s = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  };
  return diff.map((d) => `${d.field}: 期待 ${show(d.expected)} / 実際 ${show(d.actual)}`).join("、");
}
