// Two people's edits to one Note, put together paragraph by paragraph.
//
// A body is a list of top-level blocks (paragraph, heading, list, table, …).
// Given the body both started from (base), this side's (mine) and the other
// side's (theirs), each side's changes are kept, so edits to different
// paragraphs — even neighbouring ones — both survive. Where both changed the
// same paragraphs, this side's version is kept: the person typing never sees
// their words replaced under the caret. Read with DOMParser — the browser,
// or jsdom in the tests.

/** Pure. A body's top-level blocks as HTML (loose text becomes its own block). */
function blocksOf(html: string): string[] {
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const out: string[] = [];
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType === 1) out.push((node as Element).outerHTML);
    else if (node.nodeType === 3 && node.textContent?.trim()) out.push(node.textContent);
  }
  return out;
}

/** Pure. Index pairs [i in a, j in b] of a longest common subsequence. */
function commonBlocks(a: string[], b: string[]): [number, number][] {
  // Trim the shared start and end first: edits are usually local, so the
  // quadratic table only spans the part that differs.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start, m = endB - start;
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  if (n > 0 && m > 0) {
    const len: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        len[i][j] = a[start + i] === b[start + j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
      }
    }
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[start + i] === b[start + j]) { pairs.push([start + i, start + j]); i++; j++; }
      else if (len[i + 1][j] >= len[i][j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

/** One side's change to the base: base[s, e) replaced by `lines`. */
interface Hunk { s: number; e: number; lines: string[] }

function hunksOf(base: string[], side: string[]): Hunk[] {
  const out: Hunk[] = [];
  let b = 0, k = 0;
  for (const [i, j] of [...commonBlocks(base, side), [base.length, side.length] as [number, number]]) {
    if (i > b || j > k) out.push({ s: b, e: i, lines: side.slice(k, j) });
    b = i + 1; k = j + 1;
  }
  return out;
}

/** Whether two changes touch the same base paragraphs: they overlap, insert
 *  at the same place, or one inserts inside what the other replaces. */
function clash(x: Hunk, y: Hunk): boolean {
  if (x.s < y.e && y.s < x.e) return true;
  if (x.s === x.e && y.s === y.e) return x.s === y.s;
  const [ins, rep] = x.s === x.e ? [x, y] : [y, x];
  return ins.s === ins.e && rep.s < ins.s && ins.s < rep.e;
}

/** base[s, e) with one side's changes inside it applied. */
function applyIn(base: string[], hunks: Hunk[], s: number, e: number): string[] {
  const out: string[] = [];
  let pos = s;
  for (const h of hunks) {
    out.push(...base.slice(pos, h.s), ...h.lines);
    pos = h.e;
  }
  out.push(...base.slice(pos, e));
  return out;
}

/** Pure. The blocks of mine and theirs put together over their common base:
 *  each side's changes are kept unless both changed the same paragraphs, and
 *  there mine is kept (two insertions at one place keep both, mine first). */
function mergeBlocks(base: string[], mine: string[], theirs: string[]): string[] {
  const all = [
    ...hunksOf(base, mine).map((h) => ({ ...h, mine: true })),
    ...hunksOf(base, theirs).map((h) => ({ ...h, mine: false })),
  ].sort((x, y) => x.s - y.s || x.e - y.e);
  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < all.length;) {
    // A cluster: the changes that clash with each other, transitively.
    const group = [all[i]];
    let s = all[i].s, e = all[i].e;
    for (i++; i < all.length && group.some((g) => clash(g, all[i])); i++) {
      group.push(all[i]);
      s = Math.min(s, all[i].s); e = Math.max(e, all[i].e);
    }
    out.push(...base.slice(pos, s));
    const ours = group.filter((g) => g.mine), others = group.filter((g) => !g.mine);
    const minePart = applyIn(base, ours, s, e);
    if (!others.length) out.push(...minePart);
    else if (!ours.length) out.push(...applyIn(base, others, s, e));
    else if (group.every((g) => g.s === g.e)) out.push(...ours.flatMap((g) => g.lines), ...others.flatMap((g) => g.lines));
    else out.push(...minePart);
    pos = e;
  }
  out.push(...base.slice(pos));
  return out;
}

/** Pure. Merge three bodies; identical sides short-circuit. */
export function mergeNote(base: string, mine: string, theirs: string): string {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  return mergeBlocks(blocksOf(base), blocksOf(mine), blocksOf(theirs)).join('');
}
