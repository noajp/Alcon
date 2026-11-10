// Code changes: the pull requests that carry out an Element, read as a diff
// next to the intent they were built for. The pure rules behind the review
// screen — reading GitHub's per-file patch into lines, pairing them for the
// split view, folding paths into a file tree, telling implementation from
// tests and docs, reading the stored intent check, the guided walk-through and
// the team's verdicts — and which changes wait on whom in the Reviews inbox,
// and what an agent is asked when the review sends a change back.
//
// Pure — no React, no Supabase — so the rules are unit-tested in
// tests/diffModel.test.ts.

// ── Pull request URL ───────────────────────────────────────────────────────
//
// The same rule as parsePullUrl in supabase/functions/_shared/github.ts,
// which the server applies; web code cannot import Edge Function modules.

export interface PullRef { repo: string; number: number }

export function parsePullUrl(raw: string): PullRef | null {
  const m = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[3]);
  return n > 0 ? { repo: `${m[1]}/${m[2]}`, number: n } : null;
}

// ── Patch → lines ──────────────────────────────────────────────────────────

export type DiffLineKind = 'context' | 'add' | 'del' | 'note';

export interface DiffLine {
  kind: DiffLineKind;
  /** Line number in the old file; null for an added line or a note. */
  oldNo: number | null;
  /** Line number in the new file; null for a deleted line or a note. */
  newNo: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  /** The text after the second @@ — usually the enclosing function. */
  section: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

/** Reads a GitHub file patch (hunks, no file headers) into numbered lines.
 *  Lines before the first hunk header are ignored; "\ No newline at end of
 *  file" becomes a note. */
export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split('\n')) {
    const h = HUNK.exec(raw);
    if (h) {
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      cur = { header: raw, section: h[3] ?? '', oldStart: oldNo, newStart: newNo, lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    const mark = raw[0];
    const text = raw.slice(1);
    if (mark === '+') cur.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text });
    else if (mark === '-') cur.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text });
    else if (mark === '\\') cur.lines.push({ kind: 'note', oldNo: null, newNo: null, text: raw.slice(2) });
    else cur.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: mark === ' ' ? text : raw });
  }
  // A patch ending in a newline leaves one empty context line behind.
  const last = hunks[hunks.length - 1];
  const tail = last?.lines[last.lines.length - 1];
  if (tail && tail.kind === 'context' && tail.text === '' && patch.endsWith('\n')) last.lines.pop();
  return hunks;
}

/** How many unchanged lines sit before each hunk — the stretch the patch
 *  leaves out between the previous hunk (or the top of the file) and it. */
export function unchangedBefore(hunks: readonly DiffHunk[]): number[] {
  let lastOld = 0;
  return hunks.map((h) => {
    const gap = Math.max(0, h.oldStart - lastOld - 1);
    const olds = h.lines.map((l) => l.oldNo).filter((n): n is number => n != null);
    // A hunk with no old lines (a new file) still starts at its header's line.
    lastOld = olds.length ? Math.max(...olds) : Math.max(lastOld, h.oldStart);
    return gap;
  });
}

/** A path as a name and the folder it sits in. */
export function splitPath(path: string): { name: string; dir: string } {
  const at = path.lastIndexOf('/');
  return at < 0 ? { name: path, dir: '' } : { name: path.slice(at + 1), dir: path.slice(0, at + 1) };
}

export interface SplitRow { left: DiffLine | null; right: DiffLine | null }

/** Pairs a hunk's lines for side-by-side reading: context on both sides, and
 *  each run of deletions beside the run of additions that follows it. */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === 'context') { rows.push({ left: line, right: line }); i++; continue; }
    if (line.kind === 'note') { rows.push({ left: line, right: null }); i++; continue; }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}

// ── File kinds ─────────────────────────────────────────────────────────────

export type FileKind = 'implementation' | 'test' | 'docs' | 'generated';

/** What a changed file is, by its path — tests and docs are counted apart
 *  from the implementation, so a change's size reads as the code it changes. */
export function fileKind(path: string): FileKind {
  const p = path.toLowerCase();
  const name = p.split('/').pop() ?? p;
  if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|cargo\.lock|poetry\.lock|go\.sum)$/.test(p)
    || /(^|\/)(dist|build|generated|__generated__|vendor)\//.test(p) || /\.(min\.js|snap)$/.test(p)) return 'generated';
  if (/(^|\/)(tests?|__tests__|spec|e2e)\//.test(p) || /\.(test|spec)\.[a-z0-9]+$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.(go|py|rb)$/.test(name)) return 'test';
  if (/\.(md|mdx|rst|txt|adoc)$/.test(name) || /(^|\/)docs?\//.test(p)) return 'docs';
  return 'implementation';
}

export interface ChangedFileStat { filename: string; additions: number; deletions: number }

/** Lines changed in implementation files, and in all files. */
export function changeSize(files: readonly ChangedFileStat[]): { additions: number; deletions: number; totalAdditions: number; totalDeletions: number } {
  let additions = 0, deletions = 0, totalAdditions = 0, totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
    if (fileKind(f.filename) === 'implementation') { additions += f.additions; deletions += f.deletions; }
  }
  return { additions, deletions, totalAdditions, totalDeletions };
}

// ── File tree ──────────────────────────────────────────────────────────────

export interface FileTreeNode {
  /** The segment shown — a folder chain with one child is folded into one ("src/app"). */
  name: string;
  path: string;
  /** Set on files: the changed file's full path. */
  file: string | null;
  children: FileTreeNode[];
}

/** Folds changed paths into a tree: folders first, then files, each by name;
 *  a folder holding only one folder is shown as one row. */
export function buildFileTree(paths: readonly string[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', path: '', file: null, children: [] };
  for (const full of paths) {
    const parts = full.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      const isFile = i === parts.length - 1;
      let next = node.children.find((c) => c.path === path && (c.file !== null) === isFile);
      if (!next) {
        next = { name: part, path, file: isFile ? full : null, children: [] };
        node.children.push(next);
      }
      node = next;
    });
  }
  const byKindThenName = (a: FileTreeNode, b: FileTreeNode) =>
    (a.file === null) === (b.file === null) ? a.name.localeCompare(b.name) : a.file === null ? -1 : 1;
  const fold = (n: FileTreeNode): FileTreeNode => {
    let cur = n;
    while (cur.file === null && cur.children.length === 1 && cur.children[0].file === null) {
      const only = cur.children[0];
      cur = { ...only, name: `${cur.name}/${only.name}` };
    }
    return { ...cur, children: cur.children.map(fold).sort(byKindThenName) };
  };
  return root.children.map(fold).sort(byKindThenName);
}

/** The files in the order the tree shows them, for the diff column. */
export function treeOrder(nodes: readonly FileTreeNode[]): string[] {
  return nodes.flatMap((n) => (n.file ? [n.file] : treeOrder(n.children)));
}

// ── Intent check ───────────────────────────────────────────────────────────

export type IntentVerdict = 'aligned' | 'partial' | 'misaligned' | 'unclear';
export type CriterionVerdict = 'met' | 'partial' | 'not_met' | 'contradicts' | 'unclear';

export interface IntentCriterion {
  intent: string;
  kind: string;
  verdict: CriterionVerdict;
  evidence: string;
  files: string[];
}

export interface IntentCheck {
  verdict: IntentVerdict;
  summary: string;
  criteria: IntentCriterion[];
  outOfScope: { path: string; note: string }[];
  questions: string[];
  headSha: string | null;
  at: string | null;
}

const INTENT_VERDICTS = new Set<IntentVerdict>(['aligned', 'partial', 'misaligned', 'unclear']);
const CRITERION_VERDICTS = new Set<CriterionVerdict>(['met', 'partial', 'not_met', 'contradicts', 'unclear']);

const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** A list the model sometimes sends JSON-encoded as a string. */
const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  try { const parsed: unknown = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};
const strings = (v: unknown) => list(v).filter((x): x is string => typeof x === 'string');

/** Reads the stored intent_check jsonb. Anything malformed reads as null (not
 *  checked yet) rather than throwing in the render. */
export function readIntentCheck(raw: unknown): IntentCheck | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!INTENT_VERDICTS.has(r.verdict as IntentVerdict)) return null;
  const objects = (v: unknown) => list(v).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  return {
    verdict: r.verdict as IntentVerdict,
    summary: str(r.summary),
    criteria: objects(r.criteria).filter((c) => typeof c.intent === 'string').map((c) => ({
      intent: c.intent as string,
      kind: str(c.kind) || 'element',
      verdict: CRITERION_VERDICTS.has(c.verdict as CriterionVerdict) ? (c.verdict as CriterionVerdict) : 'unclear',
      evidence: str(c.evidence),
      files: strings(c.files),
    })),
    outOfScope: objects(r.out_of_scope).filter((o) => typeof o.path === 'string').map((o) => ({ path: o.path as string, note: str(o.note) })),
    questions: strings(r.questions),
    headSha: typeof r.head_sha === 'string' ? r.head_sha : null,
    at: typeof r.at === 'string' ? r.at : null,
  };
}

/** Whether a check was made against an older commit than the one now at the head. */
export function isCheckStale(check: IntentCheck | null, headSha: string | null): boolean {
  return !!check && !!check.headSha && !!headSha && check.headSha !== headSha;
}

// ── The team's verdicts ────────────────────────────────────────────────────

export type ReviewVerdict = 'matches' | 'needs_changes' | 'comment';

export interface ReviewRecord {
  reviewer_id: string;
  reviewer_name: string | null;
  verdict: ReviewVerdict;
  head_sha: string | null;
  created_at: string;
}

export interface ReviewState {
  /** Each reviewer's latest verdict (comments aside), newest first. */
  latest: (ReviewRecord & { stale: boolean })[];
  matches: number;
  needsChanges: number;
  /** needs_changes wins over matches; nothing current reads as pending. */
  overall: 'matches' | 'needs_changes' | 'pending';
}

/** Where the team stands: each person's latest verdict counts once, and a
 *  verdict given on an older head commit is shown but no longer counted. */
export function reviewState(reviews: readonly ReviewRecord[], headSha: string | null): ReviewState {
  const byReviewer = new Map<string, ReviewRecord>();
  for (const r of reviews) {
    if (r.verdict === 'comment') continue;
    const prev = byReviewer.get(r.reviewer_id);
    if (!prev || prev.created_at < r.created_at) byReviewer.set(r.reviewer_id, r);
  }
  const latest = [...byReviewer.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => ({ ...r, stale: !!headSha && !!r.head_sha && r.head_sha !== headSha }));
  const current = latest.filter((r) => !r.stale);
  const matches = current.filter((r) => r.verdict === 'matches').length;
  const needsChanges = current.filter((r) => r.verdict === 'needs_changes').length;
  return { latest, matches, needsChanges, overall: needsChanges > 0 ? 'needs_changes' : matches > 0 ? 'matches' : 'pending' };
}

// ── Matching a cited path ──────────────────────────────────────────────────

/** The changed file a path names. The model may cite a path by its tail, so
 *  a file that ends with it (or that it ends with) matches too. */
export function matchFile(path: string, filenames: readonly string[]): string | null {
  const p = path.trim().replace(/^\.?\//, '');
  if (!p) return null;
  return filenames.find((f) => f === p)
    ?? filenames.find((f) => f.endsWith(`/${p}`) || p.endsWith(`/${f}`))
    ?? null;
}

// ── Guided review ──────────────────────────────────────────────────────────

export interface GuideSection {
  title: string;
  what: string;
  why: string;
  /** Changed files, as the diff names them. */
  files: string[];
  /** The files the guide left out, gathered at the end. */
  rest?: boolean;
}

export interface ReviewGuide {
  summary: string;
  sections: GuideSection[];
  headSha: string | null;
  at: string | null;
}

/** Reads the stored guide against the files actually changed: each file sits
 *  in the first section that names it, sections left empty are dropped, and
 *  files no section names follow in a last section. Malformed reads as null. */
export function readGuide(raw: unknown, filenames: readonly string[]): ReviewGuide | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const placed = new Set<string>();
  const sections: GuideSection[] = [];
  for (const x of list(r.sections)) {
    if (!x || typeof x !== 'object') continue;
    const sec = x as Record<string, unknown>;
    const files: string[] = [];
    for (const cited of strings(sec.files)) {
      const f = matchFile(cited, filenames);
      if (f && !placed.has(f)) { placed.add(f); files.push(f); }
    }
    if (files.length === 0 || !str(sec.title)) continue;
    sections.push({ title: str(sec.title), what: str(sec.what), why: str(sec.why), files });
  }
  if (sections.length === 0) return null;
  const rest = filenames.filter((f) => !placed.has(f));
  if (rest.length) sections.push({ title: '', what: '', why: '', files: rest, rest: true });
  return {
    summary: str(r.summary),
    sections,
    headSha: typeof r.head_sha === 'string' ? r.head_sha : null,
    at: typeof r.at === 'string' ? r.at : null,
  };
}

// ── Sending a change back to its agent ─────────────────────────────────────

export interface IterateInput {
  repo: string;
  number: number;
  url: string;
  headRef: string | null;
  comments: readonly { path: string; line: number; body: string; author: string | null; resolved: boolean }[];
  reviews: readonly { verdict: ReviewVerdict; body: string; reviewer: string | null; stale: boolean }[];
}

/** Pure. What the agent is asked: fix the open points on the same pull
 *  request. Resolved comments and verdicts on an older head are left out.
 *  Null when there is nothing to address. */
export function iteratePrompt(input: IterateInput): string | null {
  const comments = input.comments.filter((c) => !c.resolved && c.body.trim());
  const reviews = input.reviews.filter((r) => !r.stale && r.verdict !== 'matches' && r.body.trim());
  if (comments.length === 0 && reviews.length === 0) return null;
  const lines = [
    `レビューで指摘された点を、Pull Request ${input.repo}#${input.number}（${input.url}）で直してください。`,
    input.headRef
      ? `新しい PR は開かず、同じブランチ \`${input.headRef}\` にコミットを追加して push してください。マージはしないでください。`
      : '新しい PR は開かず、同じ PR のブランチにコミットを追加して push してください。マージはしないでください。',
    '',
  ];
  if (reviews.length) {
    lines.push('## レビュー');
    for (const r of reviews) lines.push(`- ${r.reviewer ?? 'レビュアー'}: ${r.body.trim()}`);
    lines.push('');
  }
  if (comments.length) {
    lines.push('## 行コメント');
    for (const c of comments) lines.push(`- \`${c.path}:${c.line}\`（${c.author ?? 'レビュアー'}）: ${c.body.trim()}`);
    lines.push('');
  }
  lines.push('直し終えたら、何をどう直したかを報告してください。指摘が意図と食い違うと考えるときは、直さずにその理由を報告してください。');
  return lines.join('\n');
}
