import type { AcceptanceLine } from '@/types/database';

// Acceptance criteria live in one jsonb column, so a save writes the whole
// list. Replacing it with the list this tab holds is how one person's new
// criterion disappears when another person edits a different one.
//
// Rows carry ids, so what this tab did can be said as a diff — this line's
// text changed, this one is gone, this one is new — and applied to the list
// the server holds now. Rows nobody here touched stay exactly as they are,
// including ones added while this tab was editing.
export function mergeAcceptance(
  base: AcceptanceLine[],
  mine: AcceptanceLine[],
  theirs: AcceptanceLine[],
): AcceptanceLine[] {
  const baseById = new Map(base.map((line) => [line.id, line]));
  const mineById = new Map(mine.map((line) => [line.id, line]));

  // Removed here: present when this tab started, absent now.
  const removed = new Set([...baseById.keys()].filter((id) => !mineById.has(id)));

  const merged: AcceptanceLine[] = [];
  for (const line of theirs) {
    if (removed.has(line.id)) continue;
    const ours = mineById.get(line.id);
    const wasEdited = ours && baseById.get(line.id)?.text !== ours.text;
    // An edit here wins over the same row's text there. Two people typing
    // into one row is the one case a merge cannot resolve without asking,
    // and asking mid-keystroke would cost more than it saves.
    merged.push(wasEdited ? ours : line);
  }

  // New here: absent when this tab started, absent from the server's list.
  const known = new Set(theirs.map((line) => line.id));
  for (let i = 0; i < mine.length; i += 1) {
    const line = mine[i];
    if (baseById.has(line.id) || known.has(line.id)) continue;
    // Kept where it was put: after the row it follows here, or at the front
    // when it is the first line.
    const previous = mine[i - 1];
    const at = previous ? merged.findIndex((m) => m.id === previous.id) : -1;
    if (at === -1) merged.push(line);
    else merged.splice(at + 1, 0, line);
  }
  return merged;
}

export const sameAcceptance = (a: AcceptanceLine[], b: AcceptanceLine[]): boolean =>
  a.length === b.length && a.every((line, i) => line.id === b[i].id && line.text === b[i].text);
