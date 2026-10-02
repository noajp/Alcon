// Comments and agents. Pure.
//
// agentMention: a person talks to an agent in a comment by writing "@AI" or
// "@<AI Worker name>"; the comment becomes the agent's next instruction.
//
// foldAgentRuns: a long stretch of agent comments (progress, approvals,
// reports) folds to one line so people's own comments and the conclusion
// stay in sight. The last comment of a stretch is always shown.

export interface AiWorkerRef { id: string; name: string }

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Which agent a comment addresses, or null. `@AI` addresses the default agent (workerId null). */
export function agentMention(text: string, aiWorkers: AiWorkerRef[]): { workerId: string | null } | null {
  // Longest names first, so "@Claude Code" wins over "@Claude".
  for (const w of [...aiWorkers].sort((a, b) => b.name.length - a.name.length)) {
    if (!w.name.trim()) continue;
    if (new RegExp(`(^|\\s)@${escape(w.name)}(?=$|[\\s、。,.!?！？:：])`, 'i').test(text)) return { workerId: w.id };
  }
  if (/(^|\s)@ai(?=$|[\s、。,.!?！？:：])/i.test(text)) return { workerId: null };
  return null;
}

export type CommentSegment<T> =
  | { kind: 'one'; comment: T }
  | { kind: 'fold'; key: string; hidden: T[]; last: T };

/** Fold runs of at least `min` consecutive agent comments, unless one of them is `keepOpenId`. */
export function foldAgentRuns<T extends { id: string; author_kind: string }>(comments: T[], min = 4, keepOpenId?: string | null): CommentSegment<T>[] {
  const out: CommentSegment<T>[] = [];
  let i = 0;
  while (i < comments.length) {
    if (comments[i].author_kind !== 'ai_agent') { out.push({ kind: 'one', comment: comments[i] }); i++; continue; }
    let j = i;
    while (j < comments.length && comments[j].author_kind === 'ai_agent') j++;
    const run = comments.slice(i, j);
    if (run.length >= min && !run.some((c) => c.id === keepOpenId)) {
      out.push({ kind: 'fold', key: run[0].id, hidden: run.slice(0, -1), last: run[run.length - 1] });
    } else {
      for (const c of run) out.push({ kind: 'one', comment: c });
    }
    i = j;
  }
  return out;
}

/** Pure. The first line of a comment without Markdown marks, for the fold's summary. */
export function plainFirstLine(content: string): string {
  const line = content.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
