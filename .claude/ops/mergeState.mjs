// What a branch's relationship to main means for the sweep — as a decision,
// separate from the git calls that feed it, so the decision can be tested.
//
// Zero commits ahead of main is not one state. `git cherry` cannot tell
// "merged, and main moved on" from "nothing was ever committed" — there is
// no patch to compare — and a sweep that calls both 「取り込み済み」 lies
// about the second (ELE_OPS-042). A tip still equal to origin/main is the
// second case for certain; a tip behind main may be either, and the wording
// has to say so.

/**
 * @param {{ behindEmpty: boolean, sameTip: boolean, missing: number }} facts
 *   behindEmpty — `origin/main..branch` lists nothing
 *   sameTip     — branch tip === origin/main tip
 *   missing     — `git cherry` lines starting with `+` (patches not upstream)
 * @returns {{ kind: 'untouched' | 'ancestor' | 'unmerged' | 'equivalent', count?: number }}
 */
export function classifyMergeState({ behindEmpty, sameTip, missing }) {
  if (behindEmpty) return { kind: sameTip ? 'untouched' : 'ancestor' };
  return missing > 0 ? { kind: 'unmerged', count: missing } : { kind: 'equivalent' };
}

/** The reason the sweep prints for a state it is allowed to remove. */
export const REMOVAL_REASON = {
  untouched: 'コミット0件 — 未着手のまま、origin/main と同一',
  ancestor: '差分コミット0件 — main に含まれる（未着手の可能性あり）',
  equivalent: 'rebase/squash 済み、内容は main にあり',
  // A worktree with no branch: nothing was compared, so nothing is claimed.
  detached: 'detached — ブランチなし、比較対象なし',
};
