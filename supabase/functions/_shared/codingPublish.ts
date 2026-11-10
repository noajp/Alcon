// Publishing a coding run's patch (coding capability PR3; design
// §6 outbound, §7, §8): everything about turning the run's patch
// artifact into a pull request that can be decided without touching
// the world — reading the patch as files and hunks, applying it to
// the base tree's contents exactly or not at all, judging its
// integrity, and composing the publish plan the governed calls are
// built from. The I/O halves live in run-agent (the base contents
// arrive through the connection's read plumbing; the plan's calls
// travel the manifest through the run's own call seam); this file
// is what the tests pin.
//
// The principles:
// - The patch is applied by code, never transcribed by a model: a
//   hunk whose context does not match the base content exactly
//   fails the whole publish, in the open. A truncated or partial
//   patch is refused as what it is — never applied as if whole
//   (PR2's known limit: a very large change set's capture can be
//   cut by the runner's per-call caps, so integrity is proven from
//   the hunk headers' own declared counts, not assumed).
// - Binary changes cannot ride a text patch: the diff names them
//   but carries no content, so they refuse the publish rather than
//   corrupt a file.
// - The target law is PR2's, re-stated at the publish seam: a
//   repository outside the definition's declared set is a critical
//   class (design §7) — its publish always asks, in every mode,
//   and approving it widens nothing.

import type { CodingDeclaration } from "./definition.ts";
import type { ChangeSet, CodingTarget } from "./codingLoop.ts";

// ── The patch, read as files ─────────────────────────────────────────

export interface PatchHunkLine {
  kind: "context" | "add" | "del";
  text: string;
  /** The line is its file version's last, with no trailing newline
   *  (the diff's "\ No newline at end of file" marker). */
  noNewline?: boolean;
  /** A line the diff grammar does not admit (a cut capture's tail
   *  can end anywhere): it is counted as nothing and it breaks its
   *  hunk — present in the record so the break is visible, never
   *  applied. */
  broken?: boolean;
}

export interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: PatchHunkLine[];
  /** The hunk's lines are all present: its context+del lines number
   *  its header's old count, its context+add lines its new count. A
   *  cut capture breaks exactly this. */
  complete: boolean;
}

export type PatchFileKind = "add" | "modify" | "delete" | "rename";

export interface PatchFile {
  /** The path in the base tree; null when the file is new. */
  oldPath: string | null;
  /** The path in the published tree; null when the file is deleted. */
  newPath: string | null;
  kind: PatchFileKind;
  binary: boolean;
  hunks: PatchHunk[];
}

/** Pure. A git-quoted path token read back (paths with unusual
 *  characters arrive C-quoted; the common path passes untouched). */
function unquotePath(token: string): string {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    try {
      return JSON.parse(token) as string;
    } catch {
      return token.slice(1, -1);
    }
  }
  return token;
}

/**
 * Pure. A unified diff read as its files. Deliberately forgiving
 * about headers it does not need (modes, similarity, index lines)
 * and strict about the parts integrity is judged from: hunk headers
 * and their line counts. A line that fits nowhere marks its hunk
 * incomplete rather than being quietly absorbed.
 */
export function parsePatchFiles(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let hunk: PatchHunk | null = null;
  const closeHunk = () => {
    if (!hunk) return;
    const sound = hunk.lines.filter((l) => !l.broken);
    const oldLines = sound.filter((l) => l.kind !== "add").length;
    const newLines = sound.filter((l) => l.kind !== "del").length;
    hunk.complete = sound.length === hunk.lines.length
      && oldLines === hunk.oldCount && newLines === hunk.newCount;
    hunk = null;
  };
  const closeFile = () => {
    closeHunk();
    if (file) files.push(file);
    file = null;
  };
  const rawLines = patch.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    // The split's trailing empty element (the patch text ends with
    // a newline) is not a diff line. An empty line anywhere else is.
    if (line === "" && i === rawLines.length - 1) continue;
    const diffHead = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffHead) {
      closeFile();
      file = {
        oldPath: unquotePath(diffHead[1]), newPath: unquotePath(diffHead[2]),
        kind: "modify", binary: false, hunks: [],
      };
      continue;
    }
    if (!file) continue;
    if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      file.binary = true;
      continue;
    }
    const renameFrom = /^rename from (.+)$/.exec(line);
    if (renameFrom) {
      file.kind = "rename";
      file.oldPath = unquotePath(renameFrom[1]);
      continue;
    }
    const renameTo = /^rename to (.+)$/.exec(line);
    if (renameTo) {
      file.kind = "rename";
      file.newPath = unquotePath(renameTo[1]);
      continue;
    }
    if (line.startsWith("--- ")) {
      const p = line.slice(4);
      if (p === "/dev/null") {
        file.kind = "add";
        file.oldPath = null;
      } else if (p.startsWith("a/")) file.oldPath = unquotePath(p.slice(2));
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      if (p === "/dev/null") {
        file.kind = "delete";
        file.newPath = null;
      } else if (p.startsWith("b/")) file.newPath = unquotePath(p.slice(2));
      continue;
    }
    const hunkHead = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkHead) {
      closeHunk();
      hunk = {
        oldStart: Number(hunkHead[1]), oldCount: hunkHead[2] === undefined ? 1 : Number(hunkHead[2]),
        newStart: Number(hunkHead[3]), newCount: hunkHead[4] === undefined ? 1 : Number(hunkHead[4]),
        lines: [], complete: false,
      };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue; // an extended header line (mode, index, similarity…)
    if (line.startsWith("\\")) {
      // "\ No newline at end of file": it describes the line before it.
      const last = hunk.lines[hunk.lines.length - 1];
      if (last) last.noNewline = true;
      continue;
    }
    const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith(" ") ? "context" : null;
    if (kind === null) {
      // A line the diff grammar does not admit (a cut capture's tail
      // can end anywhere): the hunk cannot be proven whole.
      hunk.complete = false;
      hunk.lines.push({ kind: "context", text: line, broken: true });
      continue;
    }
    hunk.lines.push({ kind, text: line.slice(1) });
  }
  closeFile();
  return files;
}

// ── Application: the patch against the base contents ─────────────────

/** A text read as its lines, and whether it ended with a newline. */
function splitText(content: string): { lines: string[]; endsWithNewline: boolean } {
  if (content === "") return { lines: [], endsWithNewline: false };
  const endsWithNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (endsWithNewline) lines.pop();
  return { lines, endsWithNewline };
}

export type ApplyResult =
  | { ok: true; content: string | null }
  | { ok: false; reason: string };

/**
 * Pure. One file of the patch applied to its base content: the new
 * content, or null for a deletion. Exact or nothing — every context
 * and deleted line must match the base at the hunk's declared
 * position, so a patch computed against another base (or cut short)
 * refuses instead of producing a plausible wrong file. An added
 * file's base is null; a deleted file must consume its base whole.
 */
export function applyPatchFile(base: string | null, file: PatchFile): ApplyResult {
  const path = file.newPath ?? file.oldPath ?? "(unknown)";
  if (file.binary) return { ok: false, reason: `${path} はバイナリファイルのため、テキストのパッチでは公開できません` };
  if (file.hunks.some((h) => !h.complete)) {
    return { ok: false, reason: `${path} のパッチが不完全です（途中で切れている可能性があります）。部分的な変更として公開はしません` };
  }
  if (file.kind === "add") {
    if (file.hunks.some((h) => h.lines.some((l) => l.kind !== "add"))) {
      return { ok: false, reason: `${path} の追加パッチに、追加ではない行が含まれています` };
    }
    const lines = file.hunks.flatMap((h) => h.lines.map((l) => l.text));
    const lastLine = file.hunks.at(-1)?.lines.at(-1);
    return { ok: true, content: lines.length === 0 ? "" : lines.join("\n") + (lastLine?.noNewline ? "" : "\n") };
  }
  if (base === null) {
    return { ok: false, reason: `${path} のベース内容を取得できなかったため、パッチを適用できません` };
  }
  const { lines: baseLines, endsWithNewline } = splitText(base);
  const out: string[] = [];
  let cursor = 0; // 0-based index into baseLines: the next unconsumed line
  let lastNewNoNewline: boolean | null = null;
  for (const h of file.hunks) {
    const at = h.oldCount === 0 ? h.oldStart : h.oldStart - 1;
    if (at < cursor || at > baseLines.length) {
      return { ok: false, reason: `${path} のパッチ位置がベースと合いません（パッチが不完全か、ベースが動いています）` };
    }
    while (cursor < at) out.push(baseLines[cursor++]);
    for (const l of h.lines) {
      if (l.kind === "add") {
        out.push(l.text);
        lastNewNoNewline = l.noNewline ?? false;
      } else {
        if (baseLines[cursor] !== l.text) {
          return { ok: false, reason: `${path} のパッチがベースの内容と一致しません（${cursor + 1} 行目）。パッチが不完全か、ベースが動いています` };
        }
        cursor++;
        if (l.kind === "context") {
          out.push(l.text);
          lastNewNoNewline = l.noNewline ?? false;
        }
      }
    }
  }
  // Whether the hunks reached the base's last line before the
  // untouched remainder is appended: it decides whose ending the
  // new content has — the last hunk line's own marker, a plain
  // newline when the end was deleted away, or the base's ending
  // for a tail the patch never touched.
  const reachedEnd = cursor === baseLines.length;
  while (cursor < baseLines.length) out.push(baseLines[cursor++]);
  if (file.kind === "delete") {
    if (out.length > 0) return { ok: false, reason: `${path} の削除パッチがベース全体を消していません` };
    return { ok: true, content: null };
  }
  if (out.length === 0) return { ok: true, content: "" };
  const noTrail = reachedEnd
    ? (lastNewNoNewline !== null ? lastNewNoNewline : false)
    : !endsWithNewline;
  return { ok: true, content: out.join("\n") + (noTrail ? "" : "\n") };
}

// ── Integrity: the patch against the change set it came with ─────────

export interface PatchIntegrity {
  ok: boolean;
  /** Why the patch cannot be published as a whole change set, in
   *  the run's own words — empty when it can. */
  problems: string[];
}

/**
 * Pure. Whether this patch is the whole, untruncated change set it
 * claims to be: every change-set file is in the patch and every
 * patch file is in the change set, every hunk's declared counts
 * match the lines actually present (the truncation test — a capture
 * cut by the runner's caps fails here), and no file is binary (a
 * text patch carries no binary content to publish).
 */
export function patchIntegrity(changeSet: ChangeSet, files: PatchFile[]): PatchIntegrity {
  const problems: string[] = [];
  if (changeSet.empty || changeSet.files.length === 0) {
    problems.push("変更が空のため、公開するものがありません");
    return { ok: false, problems };
  }
  const inPatch = new Map<string, PatchFile>();
  for (const f of files) inPatch.set(f.newPath ?? f.oldPath ?? "", f);
  for (const cf of changeSet.files) {
    const pf = inPatch.get(cf.path);
    if (!pf) {
      problems.push(`変更セットの ${cf.path} がパッチに含まれていません（パッチが途中で切れている可能性があります）`);
      continue;
    }
    if (pf.binary) {
      problems.push(`${cf.path} はバイナリファイルのため、テキストのパッチでは公開できません`);
      continue;
    }
    if (pf.hunks.some((h) => !h.complete)) {
      problems.push(`${cf.path} のパッチが不完全です（途中で切れている可能性があります）。部分的な変更として公開はしません`);
    }
    const adds = pf.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0);
    const dels = pf.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "del").length, 0);
    if (adds !== cf.additions || dels !== cf.deletions) {
      problems.push(`${cf.path} のパッチの行数（+${adds} / -${dels}）が変更セットの記録（+${cf.additions} / -${cf.deletions}）と一致しません`);
    }
  }
  for (const f of files) {
    const primary = f.newPath ?? f.oldPath ?? "";
    if (!changeSet.files.some((cf) => cf.path === primary)) {
      problems.push(`パッチの ${primary} が変更セットに記録されていません`);
    }
  }
  return { ok: problems.length === 0, problems };
}

// ── The publish plan ─────────────────────────────────────────────────

/** The content the publish may carry in one composition: past this,
 *  the honest answer is to split the work, not to push a heavier
 *  batch through the connection and the approval record. */
export const MAX_PUBLISH_CONTENT_CHARS = 1_000_000;

export interface PublishPlan {
  branch: string;
  /** Files the one tree commit carries, contents resolved. */
  writes: { path: string; content: string }[];
  /** Files the publish removes, each with its blob SHA at the base
   *  (the delete call names the file it removes by it). */
  deletes: { path: string; sha: string }[];
  commitMessage: string;
  pr: { title: string; body: string; head: string; base: string };
}

/** Pure. The branch a run publishes on: one run, one branch, named
 *  for its run so a re-drive of the same finish composes the same
 *  plan (and a different run never collides with it). */
export function branchNameForRun(runId: string): string {
  return `alcon/run-${runId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "run"}`;
}

/** One base file, resolved for the composition: its text and its
 *  blob SHA at the base commit. Absent from the map, or null: the
 *  file could not be read at the base — a modify/delete/rename of
 *  it then refuses, honestly. */
export interface BaseFile { content: string; blobSha: string }

/**
 * Pure. The publish plan for one coding finish: the patch applied
 * to the base files it names, as one branch, one tree commit's
 * worth of file contents, the deletions, and the PR. A refusal
 * names its reason in the run's own words; a partial tree is never
 * composed as if it were the whole change.
 */
/** The writes and deletes one change set resolves to against the
 *  base files it names — the composition every publish shape shares
 *  (the first publish and an iteration's amend alike, PR4): the
 *  patch's integrity proven first, then each file applied exactly or
 *  the whole thing refused. `noun` is the act the refusal names
 *  (公開 for the first publish, 修正 for an amend). */
export function resolvePublishWrites(input: {
  changeSet: ChangeSet;
  patchFiles: PatchFile[];
  baseFiles: ReadonlyMap<string, BaseFile | null>;
  noun?: string;
}): { ok: true; writes: { path: string; content: string }[]; deletes: { path: string; sha: string }[] } | { ok: false; reason: string } {
  const noun = input.noun ?? "公開";
  const integrity = patchIntegrity(input.changeSet, input.patchFiles);
  if (!integrity.ok) return { ok: false, reason: integrity.problems.join("。") + "。" };
  const byNewPath = new Map(input.patchFiles.map((f) => [f.newPath ?? f.oldPath ?? "", f]));
  const writes: { path: string; content: string }[] = [];
  const deletes: { path: string; sha: string }[] = [];
  for (const cf of input.changeSet.files) {
    const pf = byNewPath.get(cf.path);
    if (!pf) return { ok: false, reason: `${cf.path} のパッチが見つかりません` };
    if (pf.kind === "add") {
      const applied = applyPatchFile(null, pf);
      if (!applied.ok) return applied;
      if (applied.content !== null) writes.push({ path: pf.newPath!, content: applied.content });
      continue;
    }
    const baseFile = pf.oldPath ? input.baseFiles.get(pf.oldPath) ?? null : null;
    if (!baseFile) {
      return { ok: false, reason: `${pf.oldPath ?? cf.path} のベース内容を取得できなかったため、${noun}できません（ベースが動いたか、読み取りに失敗しました）` };
    }
    if (baseFile.content.includes("\u0000")) {
      return { ok: false, reason: `${pf.oldPath} はバイナリファイルのため、この${noun}では扱えません` };
    }
    const applied = applyPatchFile(baseFile.content, pf);
    if (!applied.ok) return applied;
    if (pf.kind === "delete" || pf.kind === "rename") {
      deletes.push({ path: pf.oldPath!, sha: baseFile.blobSha });
    }
    if (applied.content !== null && pf.newPath) {
      // A modify the patch leaves byte-identical (a mode-only change)
      // carries no content the tree commit can express; it is not
      // written, and if nothing publishable remains the caller hears
      // so below.
      if (!(pf.kind === "modify" && applied.content === baseFile.content)) {
        writes.push({ path: pf.newPath, content: applied.content });
      }
    }
  }
  writes.sort((a, b) => a.path.localeCompare(b.path));
  deletes.sort((a, b) => a.path.localeCompare(b.path));
  const total = writes.reduce((n, w) => n + w.content.length, 0);
  if (total > MAX_PUBLISH_CONTENT_CHARS) {
    return { ok: false, reason: `変更の合計が ${total} 文字と大きく、一度の${noun}に収まりません。変更を分けてください` };
  }
  if (!writes.length && !deletes.length) {
    return { ok: false, reason: `${noun}できる内容の変更がありません（ファイルのモードのみの変更などは、内容として${noun}できません）` };
  }
  return { ok: true, writes, deletes };
}

export function composePublish(input: {
  target: CodingTarget;
  branch: string;
  changeSet: ChangeSet;
  patchFiles: PatchFile[];
  baseFiles: ReadonlyMap<string, BaseFile | null>;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}): { ok: true; plan: PublishPlan } | { ok: false; reason: string } {
  const resolved = resolvePublishWrites(input);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    plan: {
      branch: input.branch,
      writes: resolved.writes, deletes: resolved.deletes,
      commitMessage: input.commitMessage,
      pr: { title: input.prTitle, body: input.prBody, head: input.branch, base: input.target.baseBranch },
    },
  };
}

/** What an iteration's amend carries (coding capability PR4): the
 *  same resolution as a publish — the same integrity law, the same
 *  exact application — but no branch and no PR: the writes and
 *  deletes land as one added commit on the PR's existing branch,
 *  through the same manifest calls the first publish used. */
export interface AmendPlan {
  writes: { path: string; content: string }[];
  deletes: { path: string; sha: string }[];
}

/**
 * Pure. The amend plan for one follow-up finish: its patch applied
 * to the PR head's files it names (the caller reads those at the
 * delivered head SHA, exactly as the first publish read its base).
 */
export function composeAmend(input: {
  changeSet: ChangeSet;
  patchFiles: PatchFile[];
  baseFiles: ReadonlyMap<string, BaseFile | null>;
}): { ok: true; plan: AmendPlan } | { ok: false; reason: string } {
  const resolved = resolvePublishWrites({ ...input, noun: "修正" });
  if (!resolved.ok) return resolved;
  return { ok: true, plan: { writes: resolved.writes, deletes: resolved.deletes } };
}

/** Pure. The amend commit's message: the work's own name, marked as
 *  the follow-up it is. */
export function amendCommitMessage(elementTitle: string | null, prNumber: number): string {
  const t = (elementTitle ?? "").trim() || "コード変更";
  return `${t}（PR #${prNumber} への修正）`.slice(0, 200);
}

/** The manifest commands the publish is composed of, in order. */
export const PUBLISH_COMMANDS = ["create_branch", "push_files", "delete_file", "create_pull_request"] as const;
export type PublishCommand = (typeof PUBLISH_COMMANDS)[number];

/**
 * Pure. The publish command a manifest command is, or null: matched
 * on the server tool it wraps (the stable name — a connection's own
 * command names are a person's to restyle, the wrapped tool is the
 * act), falling back to the command's own name. The publish's calls
 * are recognised by this wherever they are judged or reported.
 */
export function publishCommandKind(command: { name?: string; mcp?: string | null } | undefined): PublishCommand | null {
  if (!command) return null;
  const key = command.mcp ?? command.name ?? "";
  return (PUBLISH_COMMANDS as readonly string[]).includes(key) ? key as PublishCommand : null;
}

// ── The critical law (design §7) ─────────────────────────────────────

/**
 * Pure. Whether publishing to this repository is the critical
 * class: a repository outside the definition's declared set is the
 * coding analogue of a first send to a new destination — it always
 * asks, in every approval mode, and an approval executes that one
 * publish without widening the set (adding the repository is a
 * definition change, re-approved as such). Inside the set, the
 * ordinary governance — modes, delegation, track records — applies.
 */
export function publishIsCritical(decl: CodingDeclaration, repo: string): boolean {
  return !decl.repositories.includes(repo);
}

/** Pure. Why a critical publish is being asked about, in the run's
 *  own words — it rides the approval as its reason. */
export function publishCriticalReason(decl: CodingDeclaration, repo: string): string {
  return `リポジトリ ${repo} は、この定義が宣言した対象（${decl.repositories.join("、") || "なし"}）の外です。宣言の外への初めての公開は重要な操作として常時確認します。承認しても宣言は広がりません（追加は定義の変更として承認し直してください）。`;
}

/** Pure. The PR's title: the work's own name where there is one. */
export function pullRequestTitle(elementTitle: string | null, finishSummary: string): string {
  const t = (elementTitle ?? "").trim() || finishSummary.trim() || "コード変更";
  return t.slice(0, 200);
}

/** Pure. The PR's body: the finish's own words over the change-set
 *  summary — what was done and how it was tested, then the record. */
export function pullRequestBody(input: { finishSummary: string; finishMessage: string; changeSummary: string }): string {
  const head = [input.finishSummary.trim(), input.finishMessage.trim()].filter(Boolean).join("\n\n");
  return [head, "---", input.changeSummary, "", "Alcon のコーディング実行が、検証済みのパッチを接続経由で適用して開いた PR です。"]
    .filter((s) => s !== "")
    .join("\n")
    .slice(0, 20_000);
}
