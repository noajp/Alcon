// The coding loop's pure core (coding capability PR2): everything
// about a coding run that can be decided without touching the world —
// which repository this run may touch, the commands that deliver its
// tree and capture its change set, what counts as test evidence, and
// what the finish gate says about a coding finish. The I/O halves
// live in codingDelivery.ts (tree delivery) and run-agent (the gate's
// record reads, the patch's save); this file is what the tests pin.
//
// The principles (coding design §4.2, §6, §8):
// - The target is resolved from the definition's declared set, never
//   invented: a repository outside the set is a different definition,
//   not a run-time exception.
// - "Tests passed" is a fact of the run's own record — the declared
//   test command, run in this run's workspace, with its exit code in
//   an asset_calls row. The model's assertion is never evidence.
// - An honest red is a result: a failing test reported as a partial
//   finish stands; a failing test dressed as "completed" is sent
//   back. An empty change set is likewise a stated result, never a
//   success.
// - Step titles and summaries carry hashes and file names, never
//   file contents (§7 audit discipline). The patch itself is the one
//   content-bearing record, saved as a run artifact by the driver.

import type { CodingDeclaration } from "./definition.ts";
import type { FinishClaim } from "./finishClaims.ts";

/** The directory inside the workspace the delivered tree lives in. */
export const CODING_WORKDIR = "alcon-repo";

/** The marker lines the capture command prints around its two halves. */
const STATUS_MARK = "__ALCON_STATUS__";
const DIFF_MARK = "__ALCON_DIFF__";

// ── The target ─────────────────────────────────────────────────────────

export interface CodingTarget { repo: string; baseBranch: string }

export type TargetRefusal = "no_repo_declared" | "repo_ambiguous" | "repo_outside_set";

/** Pure. The "owner/repo" tokens a text names, in order of appearance. */
export function reposMentionedIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|[\s"'「（(])((?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/(?:[A-Za-z0-9_.-]+))/gm)) {
    const tok = m[1];
    if (tok && !tok.includes("..") && !out.includes(tok)) out.push(tok);
  }
  return out;
}

/**
 * Pure. This run's target: the declared set is the whole law. A
 * repository the work's own text names wins when it is in the set;
 * naming one outside the set is a refusal (the definition, not this
 * run, decides what may be touched). With no name in the text, a
 * single-repo set is the target; a multi-repo set with no name is
 * ambiguous and refuses rather than guessing.
 */
export function resolveCodingTarget(
  decl: CodingDeclaration,
  texts: readonly string[],
): { ok: true; target: CodingTarget } | { ok: false; reason: TargetRefusal } {
  if (!decl.repositories.length) return { ok: false, reason: "no_repo_declared" };
  const mentioned = new Set<string>();
  for (const t of texts) for (const r of reposMentionedIn(t)) mentioned.add(r);
  for (const r of mentioned) {
    if (!decl.repositories.includes(r)) return { ok: false, reason: "repo_outside_set" };
  }
  const named = decl.repositories.filter((r) => mentioned.has(r));
  if (named.length === 1) return { ok: true, target: { repo: named[0], baseBranch: decl.baseBranch } };
  if (named.length > 1) return { ok: false, reason: "repo_ambiguous" };
  if (decl.repositories.length === 1) return { ok: true, target: { repo: decl.repositories[0], baseBranch: decl.baseBranch } };
  return { ok: false, reason: "repo_ambiguous" };
}

/** Pure. Why a refused target is refused, in the run's own words. */
export function targetRefusalText(reason: TargetRefusal, decl: CodingDeclaration): string {
  switch (reason) {
    case "no_repo_declared":
      return "定義に対象リポジトリが宣言されていないため、ツリーを届けられませんでした。「# 条件」に「- リポジトリ: owner/repo」を書いてください。";
    case "repo_outside_set":
      return `この仕事の文面が、定義の宣言したリポジトリ（${decl.repositories.join("、")}）の外のリポジトリを指しているため、ツリーを届けられませんでした。リポジトリの追加は定義の変更として承認し直してください。`;
    case "repo_ambiguous":
      return `定義は複数のリポジトリ（${decl.repositories.join("、")}）を宣言していますが、この仕事がどれを指すか文面から決められないため、ツリーを届けられませんでした。`;
  }
}

// ── Tree delivery: the commands ────────────────────────────────────────

/** Pure. One value, single-quoted for a shell command line. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Pure. The one command that turns a delivered snapshot into the
 * box's base commit: download the run-scoped snapshot, unpack it
 * (GitHub's tarball wraps the tree in one top directory), initialise
 * local git whose first commit IS the base tree, and report the file
 * count. No credential is in it: the URL is a short-lived signed URL
 * for this run's snapshot object and nothing else, and the box's git
 * identity is two -c flags on the commit, never a stored config.
 */
export function deliveryCommand(input: { url: string; target: CodingTarget; baseSha: string }): string {
  return [
    `rm -rf ${CODING_WORKDIR} alcon-tree.tar.gz`,
    `curl -fsSL ${shellQuote(input.url)} -o alcon-tree.tar.gz`,
    `mkdir -p ${CODING_WORKDIR}`,
    `tar -xzf alcon-tree.tar.gz -C ${CODING_WORKDIR} --strip-components=1`,
    `rm -f alcon-tree.tar.gz`,
    `cd ${CODING_WORKDIR}`,
    `git init -q -b ${shellQuote(input.target.baseBranch)}`,
    `git add -A`,
    `git -c user.name=Alcon -c user.email=alcon@localhost commit -qm ${shellQuote(`base: ${input.target.repo}@${input.baseSha}`)}`,
    `echo FILES $(git ls-files | wc -l)`,
  ].join(" && ");
}

/** Pure. The delivered file count a delivery result reports, or null. */
export function parseDeliveryResult(stdout: string): { files: number } | null {
  const m = /FILES\s+(\d+)/.exec(stdout);
  return m ? { files: Number(m[1]) } : null;
}

/** Pure. The step title a delivery lands under — a step carrying this
 *  exact prefix is the run's delivery record, which is also how a
 *  later slice knows the tree already arrived. Carries the short
 *  base hash, never content (§7). */
export function deliveryStepTitle(target: CodingTarget, baseSha: string): string {
  return `コードを受け取りました: ${target.repo} @ ${baseSha.slice(0, 7)}`;
}

/** Pure. The delivery facts a delivery step's detail carries, read
 *  back by a later slice (the branch may have moved since; the patch
 *  is against THIS base, so the record, not a re-resolution, is the
 *  truth). */
export function parseDeliveryDetail(detail: string | null | undefined): { repo: string; baseBranch: string; baseSha: string } | null {
  if (!detail) return null;
  const repo = /^repo=(\S+)$/m.exec(detail)?.[1];
  const baseBranch = /^base=(\S+)$/m.exec(detail)?.[1];
  const baseSha = /^sha=([0-9a-f]{7,64})$/m.exec(detail)?.[1];
  return repo && baseBranch && baseSha ? { repo, baseBranch, baseSha } : null;
}

// ── Test evidence: the run's own record ────────────────────────────────

/** One settled shell call of a run, as the gate reads it: the
 *  asset_calls row reduced to what evidence is made of. */
export interface ShellCallRecord {
  id: string;
  command: string;
  /** The call's transport state: only "done" calls ran at all. */
  status: string;
  /** The command's exit code; null when the result carries none. */
  exitCode: number | null;
  /** When the call settled (ISO), for "the last run of it" ordering. */
  at: string;
}

export type TestEvidence =
  | { state: "ran"; exitCode: number; callId: string; at: string }
  | { state: "missing" };

const normalizeCommand = (c: string): string => c.trim().replace(/\s+/g, " ");

/**
 * Pure. The evidence that the declared test command ran in THIS run:
 * the last settled shell call whose command is the declared one,
 * exactly as declared (a pipeline or a wrapper is a different
 * command — the declaration is the contract, and the send-back tells
 * the agent to run it as written). No such call, or no command
 * declared, is "missing": not a failure of the world, just no
 * evidence — and without evidence a tests-passed claim cannot stand.
 */
export function testEvidenceOf(calls: readonly ShellCallRecord[], testCommand: string | null): TestEvidence {
  if (!testCommand) return { state: "missing" };
  const want = normalizeCommand(testCommand);
  let best: ShellCallRecord | null = null;
  for (const c of calls) {
    if (c.status !== "done" || c.exitCode == null) continue;
    if (normalizeCommand(c.command) !== want) continue;
    if (!best || c.at >= best.at) best = c;
  }
  return best ? { state: "ran", exitCode: best.exitCode, callId: best.id, at: best.at } : { state: "missing" };
}

/** Pure. Whether a finish asserts that the tests passed — in a claim
 *  (B1's facts) or in its summary line. Only an assertion is bound to
 *  the record; a finish that reports a failure honestly asserts the
 *  opposite and is judged by the outcome rules instead. */
export function claimsTestsPassed(input: { claims?: readonly FinishClaim[]; summary?: string }): boolean {
  const texts = [...(input.claims ?? []).map((c) => c.text), input.summary ?? ""];
  return texts.some((t) => /(テスト|test)/i.test(t) && /(合格|パス|通った|通って|成功|passed|passing|pass\b|green)/i.test(t));
}

// ── The change set ─────────────────────────────────────────────────────

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface ChangeSet {
  files: ChangedFile[];
  additions: number;
  deletions: number;
  /** The unified diff itself — the patch artifact's content. */
  patch: string;
  empty: boolean;
}

/**
 * Pure. The one capture command: stage everything (the box's index
 * is local and synthetic — staging is how the change set is read,
 * not a publication), then print the status and the diff under the
 * two markers parseChangeSet reads.
 */
export function captureCommand(): string {
  return `cd ${CODING_WORKDIR} && git add -A && echo ${STATUS_MARK} && git status --porcelain=v1 && echo ${DIFF_MARK} && git diff --cached --no-color`;
}

/**
 * Pure. A capture result read as a change set. The status half names
 * the files and their kind (after `git add -A` the first column is
 * the staged state); the diff half prices them (+/− per file, binary
 * files counted as changed with no lines). Null when the output does
 * not carry both markers — a capture that failed is no evidence, and
 * the gate words it as such instead of reading tea leaves.
 */
export function parseChangeSet(output: string): ChangeSet | null {
  const sAt = output.indexOf(STATUS_MARK);
  const dAt = output.indexOf(DIFF_MARK);
  if (sAt < 0 || dAt < sAt) return null;
  const statusText = output.slice(sAt + STATUS_MARK.length, dAt);
  const patch = output.slice(dAt + DIFF_MARK.length).replace(/^\n+/, "");
  const byPath = new Map<string, ChangedFile>();
  for (const line of statusText.split("\n")) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    let status: ChangedFile["status"] = "modified";
    if (code.includes("A") || code.includes("?")) status = "added";
    else if (code.includes("D")) status = "deleted";
    else if (code.includes("R")) {
      status = "renamed";
      const arrow = path.indexOf(" -> ");
      if (arrow >= 0) path = path.slice(arrow + 4);
    }
    if (path) byPath.set(path, { path, status, additions: 0, deletions: 0, binary: false });
  }
  // The diff's per-file counts. Headers name the b/ path; +++ and
  // --- lines are headers, not content; a "Binary files differ" line
  // marks a file the line count cannot price.
  let current: ChangedFile | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const p = m?.[2];
      current = p ? byPath.get(p) ?? null : null;
      if (p && !current) {
        current = { path: p, status: "modified", additions: 0, deletions: 0, binary: false };
        byPath.set(p, current);
      }
      continue;
    }
    if (!current) continue;
    if (/^Binary files .* differ$/.test(line)) { current.binary = true; continue; }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) current.additions++;
    else if (line.startsWith("-")) current.deletions++;
  }
  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    patch,
    empty: files.length === 0,
  };
}

/** Pure. The patch artifact's title for a target — the same title on
 *  every attempt, so a re-capture replaces the run's patch instead
 *  of piling up versions of it. */
export function patchArtifactTitle(target: CodingTarget): string {
  return `変更パッチ (${target.repo})`;
}

/** Pure. The change-set summary the run record shows (§8): the files
 *  with their +/−, the totals, and the test evidence line. Names and
 *  numbers only — the patch itself is the artifact beside it. */
export function changeSetSummaryText(input: {
  target: CodingTarget; baseSha: string; changeSet: ChangeSet; evidence: TestEvidence; testCommand: string | null;
}): string {
  const { target, changeSet: cs, evidence } = input;
  const lines = [
    `${target.repo} @ ${input.baseSha.slice(0, 7)} への変更: ${cs.files.length} ファイル、+${cs.additions} / -${cs.deletions}`,
    ...cs.files.map((f) => `- ${f.path}（${f.status === "added" ? "追加" : f.status === "deleted" ? "削除" : f.status === "renamed" ? "改名" : "変更"}、+${f.additions} / -${f.deletions}${f.binary ? "、バイナリ" : ""}）`),
  ];
  if (input.testCommand) {
    lines.push(evidence.state === "ran"
      ? `テスト: 「${input.testCommand}」を実行し、終了コード ${evidence.exitCode} でした（この実行自身の記録より）`
      : `テスト: 「${input.testCommand}」がこの実行で走った記録はありません`);
  }
  return lines.join("\n");
}

// ── The finish gate ────────────────────────────────────────────────────

export interface CodingFinishFacts {
  decl: CodingDeclaration;
  outcome: "completed" | "partial" | "blocked";
  claims?: readonly FinishClaim[];
  summary?: string;
  /** Whether the tree ever reached the workspace in this run. */
  delivered: boolean;
  evidence: TestEvidence;
  /** The change set as captured at the gate; null when the capture
   *  itself could not be read (no workspace, a failed capture). */
  changeSet: ChangeSet | null;
}

/**
 * Pure. What the finish gate says about a coding finish — the gaps a
 * "completed" (or a tests-claiming) finish is sent back on. The rules
 * are the design's §4.2 step 5, mechanically:
 *
 *  1. A tests-passed claim the record contradicts or cannot support
 *     is refused for ANY outcome — a claim is a fact (B1), and this
 *     one has a record to check it against.
 *  2. A completed finish needs the declared test command's own
 *     record, at exit 0. A red test is a partial finish's honest
 *     result, never a completed one's.
 *  3. A completed finish needs a non-empty change set. An empty one
 *     is a stated result (partial), not a success.
 *
 * A partial or blocked finish that asserts nothing false is left
 * alone: the honest report is the result the design asks for.
 */
export function codingFinishGaps(facts: CodingFinishFacts): string[] {
  const gaps: string[] = [];
  const { decl, evidence } = facts;
  const cmd = decl.testCommand;
  const asserted = claimsTestsPassed({ claims: facts.claims, summary: facts.summary });
  if (asserted) {
    if (!cmd) {
      gaps.push("「テストが通った」と報告していますが、定義にテストコマンドが宣言されていないため、その事実を実行の記録で確かめられません。テストコマンドを宣言するか、報告から外してください。");
    } else if (evidence.state === "missing") {
      gaps.push(`「テストが通った」と報告していますが、宣言されたテストコマンド「${cmd}」がこの実行で走った記録（asset_calls）にありません。主張はモデルの言葉ではなく、この実行自身のステップ記録が裏付けます。ワークスペースで「${cmd}」をそのまま実行し、その終了コードを記録に残してください。`);
    } else if (evidence.exitCode !== 0) {
      gaps.push(`「テストが通った」と報告していますが、この実行の記録ではテストコマンド「${cmd}」の終了コードは ${evidence.exitCode} でした。記録と違う主張はできません。失敗した結果のまま、partial として正直に報告してください。`);
    }
  }
  if (facts.outcome !== "completed") return gaps;
  if (!facts.delivered) {
    gaps.push("リポジトリのツリーがこの実行のワークスペースに届いていないため、コードの変更は行われていません。完了にはできません。届けられなかった理由は実行の記録にあります。");
    return gaps;
  }
  if (cmd && evidence.state === "missing" && !asserted) {
    gaps.push(`完了の前に、宣言されたテストコマンド「${cmd}」をワークスペースで実行し、その終了コードを実行の記録に残してください（この実行で走った記録がありません）。テストの結果は主張ではなく記録で確かめます。`);
  }
  if (cmd && evidence.state === "ran" && evidence.exitCode !== 0 && !asserted) {
    gaps.push(`テストコマンド「${cmd}」は終了コード ${evidence.exitCode} で失敗しています。失敗は結果として報告できますが「完了」にはできません。直して再実行するか、失敗した出力とともに partial で報告してください（未確認として残すこと）。`);
  }
  if (!cmd) {
    gaps.push("定義にテストコマンドが宣言されていないため、「テスト済み」を確かめる手段がなく、コーディングの完了は受け付けられません。定義にテストコマンドを宣言してください。");
  }
  if (facts.changeSet && facts.changeSet.empty) {
    gaps.push("変更が空です（ベースからの差分がありません）。空の変更は「成功」ではなく結果として述べるものです。実際に変更するか、変更が要らなかった理由を partial で報告してください。");
  } else if (!facts.changeSet) {
    gaps.push("変更の有無をワークスペースから読み取れなかったため、完了を受け付けられません。ワークスペースが使える状態でもう一度 finish してください。");
  }
  return gaps;
}
