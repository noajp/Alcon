// The rehearsal substrate: a run that tries a definition with its
// writes blocked. This module is the substrate's pure half — the
// report a rehearsal accumulates, the classification of a finished
// one, and the words that explain it — and it is deliberately general:
// the promotion path is its first user (design §5.1), but trying a
// hand-written definition safely is the same machinery, and nothing
// here knows about drafts.
//
// The executor's side lives in run-agent's execute(): when a run
// carries the rehearsal mark, reads run live and are recorded here,
// writes are assembly-validated and recorded as plans, and the run's
// own bookkeeping tools keep working. The report rides the run's
// transcript, so it survives the platform's slices like the rest of
// the run's memory.

import {
  primaryPromotionFailure,
  type PromotionFailureClass,
} from "./promotion.ts";

export interface RehearsalReadRecord {
  tool: string;
  ok: boolean;
  /** The read failed the way an unusable connection fails (auth) —
   *  the connector_missing class's evidence. */
  authFailure: boolean;
}

export interface RehearsalWriteRecord {
  tool: string;
  /** The call could have been assembled (its request built, its
   *  required fields present, its policy not a deny). */
  valid: boolean;
  problem: string | null;
}

export interface RehearsalReport {
  reads: RehearsalReadRecord[];
  writes: RehearsalWriteRecord[];
  /** Set on the draft's copy when the rehearsal is settled: 'tested'
   *  or the failure class it ended in. A run's own copy never judges
   *  itself, so it stays unset there. */
  outcome?: string | null;
  /** When the settle happened (the draft's copy). */
  at?: string | null;
}

export function emptyRehearsalReport(): RehearsalReport {
  return { reads: [], writes: [], outcome: null, at: null };
}

/** Tolerant reader for a stored report (a transcript's or a draft's
 *  jsonb): anything unreadable is an empty report — which classifies
 *  as unverifiable, the honest answer for missing evidence. */
export function readRehearsalReport(json: unknown): RehearsalReport {
  if (!json || typeof json !== "object" || Array.isArray(json)) return emptyRehearsalReport();
  const r = json as Record<string, unknown>;
  const reads = (Array.isArray(r.reads) ? r.reads : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return typeof o.tool === "string"
      ? [{ tool: o.tool, ok: o.ok === true, authFailure: o.authFailure === true }]
      : [];
  });
  const writes = (Array.isArray(r.writes) ? r.writes : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return typeof o.tool === "string"
      ? [{ tool: o.tool, valid: o.valid === true, problem: typeof o.problem === "string" ? o.problem : null }]
      : [];
  });
  return {
    reads, writes,
    outcome: typeof r.outcome === "string" ? r.outcome : null,
    at: typeof r.at === "string" ? r.at : null,
  };
}

export type RehearsalOutcome = "tested" | PromotionFailureClass;

/**
 * Pure. What a finished rehearsal proved, in the design's classes
 * (§4.6): a run that failed outright is read_failed's evidence (what
 * it managed before failing still counts); a write that could not be
 * assembled is write_plan_invalid; a read that failed on auth is a
 * connector the rehearsal could not use (connector_missing — the
 * connection exists on paper, or the run could not have named it);
 * any other failed read is read_failed. Several classes at once
 * resolve by the standing precedence (the earliest stage's problem is
 * the one worth surfacing). No reads at all — with or without planned
 * writes — is unverifiable: a procedure that only writes, or reads
 * nothing the rehearsal could reach, cannot be rehearsed into
 * evidence; the owner's acknowledgment is its only way forward.
 */
export function classifyRehearsal(report: RehearsalReport, runFailed: boolean): RehearsalOutcome {
  const classes: PromotionFailureClass[] = [];
  if (runFailed) classes.push("read_failed");
  if (report.writes.some((w) => !w.valid)) classes.push("write_plan_invalid");
  if (report.reads.some((r) => !r.ok && r.authFailure)) classes.push("connector_missing");
  if (report.reads.some((r) => !r.ok && !r.authFailure)) classes.push("read_failed");
  const primary = primaryPromotionFailure(classes);
  if (primary) return primary;
  if (report.reads.length === 0) return "unverifiable";
  return "tested";
}

/** Pure. The report in words — for the settle's step, the drafter's
 *  "fix this" message, and the review screen's evidence block, so all
 *  three tell the same story. */
export function summarizeRehearsalReport(report: RehearsalReport, outcome: RehearsalOutcome): string {
  const readsOk = report.reads.filter((r) => r.ok).length;
  const writesOk = report.writes.filter((w) => w.valid).length;
  const lines = [
    outcome === "tested"
      ? "試走の結果: 合格（読み取りが実際に通り、書き込みは計画として組み立てられました）"
      : `試走の結果: 分類 ${outcome}`,
    `- 読み取り ${report.reads.length} 件（成功 ${readsOk}・失敗 ${report.reads.length - readsOk}）`,
    `- 書き込みの計画 ${report.writes.length} 件（組み立て可能 ${writesOk}・問題あり ${report.writes.length - writesOk}）`,
  ];
  for (const w of report.writes.filter((x) => !x.valid)) {
    lines.push(`- 組み立てられなかった書き込み: ${w.tool}${w.problem ? ` — ${w.problem}` : ""}`);
  }
  for (const r of report.reads.filter((x) => !x.ok)) {
    lines.push(`- 失敗した読み取り: ${r.tool}${r.authFailure ? "（認証で失敗。接続が使えませんでした）" : ""}`);
  }
  return lines.join("\n");
}

/** What the agent is told when its run is a rehearsal, appended to the
 *  task: reads are real, writes come back as plans, and the work is to
 *  walk the definition's procedure to its end so the plans cover it. */
export const REHEARSAL_TASK_NOTICE = `# この実行は試走（リハーサル）です
いま試している定義の試走です。読み取りは実際に行われますが、書き込みは実行されず「計画」として記録されます。書き込みの道具を呼ぶと、組み立ての可否とともに「計画として記録しました」と返ります。それを前提に、定義の手順どおり最後まで進めてください。保存や送信が実際に起きる必要はありません。`;
