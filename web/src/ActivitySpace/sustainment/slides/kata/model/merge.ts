import type { ChatMessage, KataFile, Slide } from "./types";

// 2人が同じ資料を同時に直したときの突き合わせ（3方向）。元（最後にそろっていた版）・
// 自分・相手を比べ、ページ（スライド）ごとに、変えた側の版を取る。片方だけが変えた
// ページはその変更が残り、両方が別々に変えたページは自分の版を取って、ぶつかった
// ページとして返す。並び順は、並べ替えた側の順に、もう片方が足したページを
// 足した位置（直前のページの後ろ）に入れる。資料の題などのページ以外の項目も、
// 変えた側を取る。

/** キーの順に左右されない比較（DB の jsonb はキーを並べ替えて返す） */
function canon(v: unknown): string {
  if (v === undefined) return "u";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}
const same = (a: unknown, b: unknown) => a === b || canon(a) === canon(b);

/** 1つの項目：自分が変えていなければ相手の、変えていれば自分の */
const pick = <T,>(base: T, mine: T, theirs: T): T => (same(mine, base) ? theirs : mine);

export interface MergedFile {
  file: KataFile;
  /** 両方が別々に変えたページ（自分の版を取った）の題 */
  clashes: string[];
}

/** 純粋。元・自分・相手の資料を、ページごとに突き合わせて1つにする */
export function mergeFiles(base: KataFile, mine: KataFile, theirs: KataFile): MergedFile {
  const byId = (slides: Slide[]) => new Map(slides.map((s) => [s.id, s]));
  const b = byId(base.deck.slides);
  const m = byId(mine.deck.slides);
  const t = byId(theirs.deck.slides);
  const clashes: string[] = [];
  const kept = new Map<string, Slide>();
  for (const id of new Set([...m.keys(), ...t.keys(), ...b.keys()])) {
    const bs = b.get(id), ms = m.get(id), ts = t.get(id);
    const mineChanged = !same(ms, bs), theirsChanged = !same(ts, bs);
    let out: Slide | undefined;
    if (!mineChanged) out = ts;
    else if (!theirsChanged || same(ms, ts)) out = ms;
    // 片方が消し、もう片方が直したページは、直した方を残す
    else if (!ms) out = ts;
    else if (!ts) out = ms;
    else { out = ms; clashes.push(ms.title || id); }
    if (out) kept.set(id, out);
  }

  // 並び順：並べ替えた（または足した・消した）側の順を土台に、もう片方だけにあるページを
  // その直前のページの後ろへ
  const order = (slides: Slide[]) => slides.map((s) => s.id);
  const mineMoved = !same(order(mine.deck.slides), order(base.deck.slides));
  const [first, second] = mineMoved ? [mine.deck.slides, theirs.deck.slides] : [theirs.deck.slides, mine.deck.slides];
  const ids = order(first).filter((id) => kept.has(id));
  const secondIds = order(second);
  secondIds.forEach((id, i) => {
    if (!kept.has(id) || ids.includes(id)) return;
    const before = secondIds.slice(0, i).reverse().find((p) => ids.includes(p));
    ids.splice(before ? ids.indexOf(before) + 1 : 0, 0, id);
  });
  for (const id of kept.keys()) if (!ids.includes(id)) ids.push(id);
  const slides = ids.map((id) => kept.get(id)!);

  // 会話は両方の分を合わせる
  const chat = new Map<string, ChatMessage>();
  for (const c of [...theirs.chat, ...mine.chat]) chat.set(c.id, c);

  const bd = base.deck, md = mine.deck, td = theirs.deck;
  const file: KataFile = {
    ...mine,
    name: pick(base.name, mine.name, theirs.name),
    folderId: pick(base.folderId, mine.folderId, theirs.folderId),
    mix: pick(base.mix, mine.mix, theirs.mix),
    chat: [...chat.values()].sort((x, y) => x.at - y.at),
    updatedAt: Math.max(mine.updatedAt, theirs.updatedAt),
    deck: {
      ...md,
      title: pick(bd.title, md.title, td.title),
      mode: pick(bd.mode, md.mode, td.mode),
      storyline: pick(bd.storyline, md.storyline, td.storyline),
      sourceDoc: pick(bd.sourceDoc, md.sourceDoc, td.sourceDoc),
      slides,
    },
  };
  return { file, clashes };
}

/** 純粋。突き合わせた結果が相手の版と同じか（同じなら書き直すものはない） */
export const sameFile = (a: KataFile, b: KataFile) =>
  same({ ...a, updatedAt: 0 }, { ...b, updatedAt: 0 });
