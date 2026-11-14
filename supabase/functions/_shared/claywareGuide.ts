import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorMessage, HUMAN_ELEMENT_ACTIONS, resolveElementId, type ToolDef, type ToolResult } from "./boardTools.ts";
import { runStrategyTool } from "./strategyTools.ts";
import { runHarnessTool } from "./harnessTools.ts";

// How Clayware thinks, for an AI outside Clayware (clayware-mcp) that works
// in it as the person. Three layers, from always-present to just-in-time:
//   1. GUIDE_SUMMARY — the server instructions every client gets at connect.
//   2. getClaywareGuide — the whole of it, with the caller's Spaces: their
//      top Strategies and harnesses. The summary says to read it first.
//   3. steerRefusal / steeredDescription — a call that cuts across the
//      model is answered with why and where the thing belongs, and the
//      tools most often misused say so in their own description.

/** The design in a few lines: sent to every client at initialize. */
export const GUIDE_SUMMARY = [
  "Clayware は、組織の仕事を人と AI が一緒に進める運用基盤。あなたは Clayware の AI（Athena）の代わりに、接続した本人として働く。",
  "仕事を始める前に getClaywareGuide を一度読む。設計の考え方と、その Space の目指す姿・ハーネスが分かる。",
  "人は判断・承認・対外的な約束、AI は調査・下書き・集計・分析・実行。judge / decide / approve / answer の Element は人の仕事なので、代わりに閉じない。",
  "Strategy（目的・成功条件・前提・意思決定）から Object（持ち場）と Element（行動の最小単位）へ。Element は何のためにあるか（basisIntentIds）を Strategy に結び付ける。",
  "顧客・候補・問い合わせのような外の世界のものは Object にせず、Table の行（tableData）に置く。Object は入れ子にしない。",
  "仕事のやり方はハーネスに書いてある。合うものを readHarness で読み、それに従う。決めたことと結果は記録に残し、次の AI がそれを読んで進められるようにする。",
].join("\n");

/** The whole of it, returned by getClaywareGuide. */
export const GUIDE_PRINCIPLES = `# Clayware の考え方

## 何のための道具か
組織の仕事を人と AI が一緒に進める運用基盤。チームの誰かに頼むように AI に伝えると、AI が計画を立てて作業を進め、人は判断と評価をする。クリエイティブな作業ではなく、現実の課題を解決するために使う。

## 人と AI の分担
- AI：調査・下書き・集計・分析・実行。
- 人：判断・承認・対外的な約束。
- Element の動詞のうち judge（選択肢を量る）・decide（決めて確定させる）・approve（承認する）・answer（人にしか分からないことを答える）は人だけの仕事。AI はその材料を揃え、reportOutcome の blocked やコメントで人に回す。代わりに完了やレビュー待ちにしない。
- 人の判断が要るところは、AI の Element の中に埋め込まず、judge / decide / answer の Element として分けて作る。title には判断してほしい問いそのもの（何と何から選ぶのか、何を決めるのか）を書く。

## 概念のつながり
| 分類 | 何を扱うか | 単位 |
|---|---|---|
| Strategy | 何を達成し、どう勝つか | Strategy（入れ子にできる。最上位が Space の目指す姿、配下がそれを勝ち取る筋道） |
| Execution | 実際に行動する | Domain（活動の場）→ Object（Element をまとめる持ち場。プロジェクトに近い）→ Element（行動の最小単位） |
| Sustainment | 活動を続ける道具 | Table / ファイル / Team / Calendar |

- Strategy は目的・前提・意思決定・成功条件を持ち、担当や進捗は持たない。担当・期限・進捗・依存は Execution 側で扱う。
- Element を作るときは、何のためにあるか（Strategy の成功条件・前提・意思決定の intent id）を basisIntentIds に渡す。Strategy が変わったとき、影響を受ける Element を見つけるのに使う。
- Object は入れ子にしない。一つの Element を複数の Object に属させるときは linkElementToObject を使う。
- 顧客・候補・問い合わせのような外の世界のものは Object ではなく Table の行に置く。分類は Table、文章はファイル、仕事のやり方はハーネスに置く。

## 仕事のやり方（ハーネス）
ハーネスは、進め方・止める条件・成果物の形を書いた Space の定義。仕事に合うものを listHarnesses で探して readHarness で読み、それに従う。Space のハーネスは createHarness / updateHarness で作り、書き換える。Strategy 固有のやり方は writeInitiativeDefinition で書く。どれも保存の前にアプリと同じ検査を通り、エラーがあれば保存されない。ハーネスと記憶（remember）は、その Space で Clayware の AI がどう働くかも変えるので、書き換える前に本人に確かめる。

## 進め方
1. 対象の Element が属する Object の Strategy を getInitiative で読み、目的と成功条件を確かめる。
2. claimElement で着手を宣言する。断られたら、その Element は別の誰かが進めている。
3. 節目ごとに logProgress で計画と進捗を残す。
4. reportOutcome で締める。completed（達成）、partial（一部）、blocked（人の判断や資格情報が要る）。
5. 決めたこと、分かったこと、作ったものは記録（コメント・ファイル・Table・Strategy の意思決定）に残す。会話の中だけに置かない。

## 書き込むとき
- 書き込みは接続元の AI 名で記録される。
- 削除・一括変更・上書きは、何が変わるかを本人に示して了解を得てから行う。
- 架空のデータは作らない。本人が頼んだもの、根拠のあるものだけを書く。`;

export const GUIDE_TOOL: ToolDef = {
  name: "getClaywareGuide",
  description: "Clayware の設計の考え方（人と AI の分担、Strategy → Object → Element、Table とハーネスの使い分け、進め方）と、見られる Space ごとの目指す姿（最上位の Strategy）とハーネスの一覧を返す。仕事を始める前に一度読む。",
  input_schema: {
    type: "object",
    properties: { spaceId: { type: "string", description: "その Space のものだけにするとき、Space の UUID（省略可）" } },
    additionalProperties: false,
  },
};

/** Reads the guide and the caller's context. A context read that fails leaves its part out. */
export async function runGuideTool(db: SupabaseClient, input: Record<string, unknown>): Promise<ToolResult> {
  const spaceId = typeof input.spaceId === "string" && input.spaceId.trim() ? input.spaceId.trim() : undefined;
  const [strategies, harnesses] = await Promise.all([
    runStrategyTool(db, "listInitiatives", { status: "active", ...(spaceId ? { spaceId } : {}) }).catch((e) => ({ ok: false as const, error: errorMessage(e) })),
    runHarnessTool(db, "listHarnesses", spaceId ? { spaceId } : {}).catch((e) => ({ ok: false as const, error: errorMessage(e) })),
  ]);
  const top = strategies.ok
    ? (strategies.data as { id: string; name: string; description: string | null; parentIds: string[] }[])
      .filter((s) => !s.parentIds.length)
      .map((s) => ({ id: s.id, name: s.name, description: s.description }))
    : null;
  return {
    ok: true,
    data: {
      principles: GUIDE_PRINCIPLES,
      topStrategies: top,
      harnesses: harnesses.ok ? harnesses.data : null,
    },
  };
}

// ── Steering ────────────────────────────────────────────────────────────────

const HUMAN = new Set<string>(HUMAN_ELEMENT_ACTIONS);
const CLOSING = new Set(["done", "review"]);

/** Pure. The Element ids a call would close (move to done or review), with how. */
export function closingTargets(name: string, args: Record<string, unknown>): string[] {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? [v.trim()] : []);
  switch (name) {
    case "updateElement":
      return CLOSING.has(String(args.status)) ? str(args.id) : [];
    case "bulkUpdateElements":
      return CLOSING.has(String(args.status)) && Array.isArray(args.ids) ? args.ids.flatMap(str) : [];
    case "toggleSubelementComplete":
      // Omitted isCompleted toggles: it may close, so it is checked.
      return args.isCompleted === false ? [] : str(args.id);
    case "updateSubelement":
      return args.isCompleted === true ? str(args.id) : [];
    case "reportOutcome":
      return args.outcome === "completed" ? str(args.elementId) : [];
    default:
      return [];
  }
}

/** Pure. Why a person's Element is not closed by an AI, and what to do instead. */
export function humanActionRefusal(title: string, action: string): string {
  return `「${title}」は ${action} の Element で、人が判断する仕事です。AI が代わりに完了やレビュー待ちにはしません。` +
    "判断の材料（選択肢・根拠・おすすめ）をコメントに書くか、reportOutcome の blocked で人に回してください。";
}

/**
 * Why this call cuts across how Clayware works, or null when it does not.
 * Reads only what the caller can see; an Element it cannot read is left to
 * the tool, which refuses it the usual way.
 */
export async function steerRefusal(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<string | null> {
  // Taking a person's verb off an Element, then closing it, is the same act.
  const retyping = name === "updateElement" && args.action !== undefined && !HUMAN.has(String(args.action));
  const targets = [...new Set([...closingTargets(name, args), ...(retyping ? [String(args.id ?? "")] : [])])].filter(Boolean);
  if (!targets.length) return null;
  const ids = (await Promise.all(targets.map((t) => resolveElementId(db, t).catch(() => null)))).filter((id): id is string => !!id);
  if (!ids.length) return null;
  const { data } = await db.from("elements").select("id, title, action").in("id", ids);
  const human = ((data ?? []) as { title: string; action: string | null }[]).find((e) => HUMAN.has(e.action ?? ""));
  if (!human) return null;
  return retyping && !closingTargets(name, args).length
    ? `「${human.title}」は ${human.action} の Element で、人が判断する仕事です。AI がその動詞を外すことはしません。判断の材料をコメントに書くか、reportOutcome の blocked で人に回してください。`
    : humanActionRefusal(human.title, human.action!);
}

/** What the most misused tools add to their description for an outside AI. */
const DESCRIPTION_NOTES: Record<string, string> = {
  createObject: "Object は Element をまとめる持ち場（プロジェクトに近い）。顧客・候補・問い合わせのような外の世界のものは Object にせず tableData の行に置く。Object は入れ子にしない。",
  createElement: "人の判断が要るところは AI の Element に埋め込まず、action が judge / decide / answer の Element として分け、title に判断してほしい問いを書く。basisIntentIds で何のためにあるかを Strategy に結び付ける。",
  createElements: "人の判断が要るところは judge / decide / answer の Element として分ける。",
  updateElement: "judge / decide / approve / answer の Element は人の仕事なので、done や review にしない。",
  tableData: "外の世界のもの（顧客・候補・問い合わせなど）と分類はここに置く。",
};

/** Pure. A tool's description as an outside AI reads it. */
export function steeredDescription(name: string, description: string): string {
  const note = DESCRIPTION_NOTES[name];
  return note ? `${description}\n${note}` : description;
}
