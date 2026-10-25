import type { StorylineId } from "./types";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

export interface StorylineDef {
  id: StorylineId;
  name: string;
  short: string;
  desc: string;
  /** 役割の並び。先頭は導入、末尾は結び */
  roles: string[];
  /** 本体の役割ごとの重み（導入と結びを除く） */
  weights: number[];
  /** この型の出どころ */
  basis?: string;
}

export const STORYLINES: StorylineDef[] = [
  { id: "scr", get name() { return tx("状況→難しさ→解決", "Situation → Complication → Resolution"); }, get short() { return tx("SCR", "SCR"); }, get desc() { return tx("共感を集めたい構想に", "For ideas you need people to buy into"); }, roles: ["要約", "状況", "難しさ", "解決", "次の一歩"], weights: [2, 3, 4], basis: "Minto: Situation–Complication–Resolution" },
  { id: "pyramid", get name() { return tx("結論→根拠", "Answer first → reasons"); }, get short() { return tx("結論先出し", "Answer first"); }, get desc() { return tx("忙しい相手に、結論から", "For busy readers: lead with the conclusion"); }, roles: ["結論", "根拠1", "根拠2", "根拠3", "次の一歩"], weights: [1, 1, 1], basis: "Minto: The Pyramid Principle" },
  { id: "skyrain", get name() { return tx("空→雨→傘", "Sky → Rain → Umbrella"); }, get short() { return tx("空雨傘", "Fact→Meaning→Action"); }, get desc() { return tx("調べた事実から打ち手へ", "From observed facts to action"); }, roles: ["要約", "空（事実）", "雨（解釈）", "傘（打ち手）", "次の一歩"], weights: [3, 2, 3], basis: "Sky–Rain–Umbrella (fact → meaning → action)" },
  { id: "issue", get name() { return tx("課題→原因→解決", "Issue → Cause → Fix"); }, get short() { return tx("課題起点", "Issue-led"); }, get desc() { return tx("問題を掘って直す", "Dig into a problem and fix it"); }, roles: ["要約", "課題", "原因", "解決", "次の一歩"], weights: [2, 3, 4], basis: "Issue tree / root-cause" },
  { id: "scqa", get name() { return tx("状況→難しさ→問い→答え", "Situation → Complication → Question → Answer"); }, get short() { return "SCQA"; }, get desc() { return tx("ミントの SCQA。問いを立ててから答える", "Minto's SCQA: pose the question, then answer it"); }, roles: ["要約", "状況", "難しさ", "問い", "答え", "次の一歩"], weights: [2, 2, 1, 4], basis: "Minto: SCQA" },
];

export const STORYLINE_BY_ID = Object.fromEntries(STORYLINES.map((s) => [s.id, s])) as Record<StorylineId, StorylineDef>;

/** n 枚のデッキに、語る順番の型から役割を割り振る。表紙は「表紙」、最終ページは結び */
export function rolesFor(id: StorylineId, n: number, hasCover = true): string[] {
  const def = STORYLINE_BY_ID[id];
  const out: string[] = [];
  if (n <= 0) return out;
  let start = 0;
  if (hasCover) {
    out.push("表紙");
    start = 1;
  }
  const rest = n - start;
  if (rest <= 0) return out;
  if (rest === 1) return [...out, def.roles[0]];
  out.push(def.roles[0]);
  const body = rest - 2;
  const tail = def.roles[def.roles.length - 1];
  if (body > 0) {
    const mids = def.roles.slice(1, -1);
    const total = def.weights.reduce((a, b) => a + b, 0);
    const exact = def.weights.map((w) => (w / total) * body);
    const counts = exact.map(Math.floor);
    let left = body - counts.reduce((a, b) => a + b, 0);
    // 端数の大きい役割から順に1枚ずつ足す（最大剰余法）
    const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || b.i - a.i);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k].i]++;
    // 各役割に最低1枚（枚数が足りる限り）
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] === 0 && body >= counts.length) {
        const donor = counts.indexOf(Math.max(...counts));
        counts[donor]--;
        counts[i]++;
      }
    }
    mids.forEach((r, i) => {
      for (let j = 0; j < counts[i]; j++) out.push(r);
    });
  }
  out.push(tail);
  return out;
}

export function roleOptions(id: StorylineId): string[] {
  return ["表紙", ...STORYLINE_BY_ID[id].roles];
}
