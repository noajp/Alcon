import type { ToolDef } from "../_shared/boardTools.ts";
import { RECORD_TOOLS } from "./records.ts";
import { isCatalogTool, toolsFor } from "../_shared/catalog.ts";
import type { RunToolDef } from "../_shared/toolLoading.ts";
import type { ToolKind } from "../_shared/agentLoop.ts";
// Integration tool naming lives in _shared/integrationTools.ts, with the
// rest of the integration machinery every caller shares; re-exported here
// because the run's own modules (and the engine tests) import them from here.
import { INTEGRATION_SEPARATOR, integrationPrefix, uniqueToolName } from "../_shared/integrationTools.ts";
export { INTEGRATION_SEPARATOR, integrationPrefix, uniqueToolName };
export { approvalSummary } from "../_shared/integrationTools.ts";

// What an Element-executing agent can do. Alcon's own operations come from the
// one catalog under the Element policy (reads and writes, nothing that
// removes) — the same tools and executor as the AI panel and a conversation,
// with RLS deciding what each call may touch. The internal tools are how the
// agent reports. External services (integrations) add their own at run time.

export const INTERNAL_TOOLS: ToolDef[] = [
  {
    name: "record_plan",
    description: "作業の計画を宣言する。最初に一度呼ぶ。計画が大きく変わったら呼び直してよい。",
    input_schema: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" }, description: "2〜8 個の手順" } },
      required: ["steps"],
      additionalProperties: false,
    },
  },
  {
    name: "log_progress",
    description: "進捗・判断・調べた結果を作業ログに残す。人が後から追えるように、節目ごとに短く書く。",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, detail: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_question",
    description: "自分では決められない・分からないことを、人に質問として出す。質問はチケットとして人の Inbox に届き、この実行は回答があるまで休止する（依存する作業は止まるが、関係ない作業は止まらない）。回答はこの呼び出しの結果として、その人の言葉のまま返る。7日以内に回答がなければ、この実行はブロックで終了し、質問は記録に残る。使う前に、自分で調べられる手段（道具・記録・Web）を尽くすこと：tried に、先に試したことを必ず書く（無い質問は受け付けられない）。推測で進めたいときや、些細な確認には使わない。",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "人に決めてほしい・教えてほしいこと（1 つの質問として具体的に）" },
        options: {
          type: "array", minItems: 2, maxItems: 5,
          description: "選択肢で答えられる質問なら 2〜5 件。人はタップ 1 つで答えられる。自分のおすすめがある場合は 1 件だけ recommended: true を付ける。選択肢にできない質問では付けない",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "選択肢の文言" },
              recommended: { type: "boolean", description: "これが自分のおすすめなら true（最大 1 件）" },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
        context: {
          type: "object",
          description: "人が判断するために必要な材料。要点だけを渡す（文章の塊ではなく、判断材料へのリンクとして）",
          properties: {
            decision: { type: "string", description: "この回答で何が決まるか（1 行）" },
            links: {
              type: "array", maxItems: 5,
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "資料の名前（成果物・記録など）" },
                  url: { type: "string", description: "資料の URL（あれば）" },
                },
                required: ["label"],
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        tried: { type: "string", description: "人に聞く前に自分で試したこと（調べた記録・使った道具・試した手段）。必須" },
      },
      required: ["question", "tried"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_subelement",
    description: "この Element の Sub-element（この Element を親に持つ Element）のうち、終えたものを完了（status done）にする。新しい Sub-element は作らない。",
    input_schema: {
      type: "object",
      properties: { subelement_id: { type: "string" }, note: { type: "string" } },
      required: ["subelement_id"],
      additionalProperties: false,
    },
  },
  {
    name: "save_artifact",
    description: "成果物（文書・表・下書き・データなど）を Element に保存する。Space の Artifacts にもファイル（markdown なら .md）として置かれ、Element を見られる人なら誰でも読める。title には版番号や日付を入れない：同じ title で保存し直すと、同じファイルの新しい版になる。任務が成果物を求めるときだけ使う。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "成果物の本文" },
        format: { type: "string", enum: ["markdown", "html", "text", "csv", "json"] },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "任務を終える。必ず最後に一度呼ぶ。outcome: completed（達成）/ partial（一部だけ）/ blocked（人の判断や資格情報が要る）。message は Element にコメントとして残る完了報告で、何をしたか・件数・失敗・残り・人に確認してほしいことを具体的に書く。成功条件の値を実際に測ったときは readings で報告する（下の「報告できる成功条件」にある measure だけ、推測や目標値ではなく実測値）。",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["completed", "partial", "blocked"] },
        summary: { type: "string", description: "1 行の要約" },
        message: { type: "string", description: "完了報告（Markdown）" },
        readings: {
          type: "array", maxItems: 10,
          items: {
            type: "object",
            properties: {
              measureId: { type: "string", description: "この実行が仕える Strategy の成功条件（measure）の id。下の「報告できる成功条件」にあるものだけ" },
              value: { type: "number", description: "実際に数えた・測った値。推測や目標値を書かない" },
            },
            required: ["measureId", "value"], additionalProperties: false,
          },
        },
        claims: {
          type: "array", maxItems: 50,
          description: "報告で事実として述べる内容は、ここに 1 件ずつ挙げる。出典と取得時刻と種別が機械的に検査される（出典なし・古すぎる出典は差し戻される）。自分がこの実行で作った・変更したもの（ファイル、PR、成果物）は source に run-record と書く。",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "事実の内容（1 行）" },
              source: { type: "string", description: "出典：調べた URL・文書名。自分がこの実行で行ったことは run-record" },
              retrievedAt: { type: "string", description: "その情報を取得した時刻（ISO 8601）。今取得したなら現在時刻" },
              type: { type: "string", description: "情報の種別：価格や相場は price、在庫や空き状況は availability、組織や人物の事実は org、法規や規約は legal。定義に鮮度の上限が宣言された種別があればそれを使う" },
            },
            required: ["text"], additionalProperties: false,
          },
        },
        unconfirmed: {
          type: "array", maxItems: 20, items: { type: "string" },
          description: "どうしても確かめられなかった点を 1 件ずつ。ここに挙げれば差し戻しにはならないが、実行の記録に未確認として残り、人の目に触れる。本文に紛れ込ませず、必ずここに挙げる",
        },
      },
      required: ["outcome", "summary", "message"],
      additionalProperties: false,
    },
  },
];

/**
 * Anthropic's server tools: web search and page fetch run on Anthropic's side
 * within the same model call, so they need no executor here. The current
 * Sonnet and Opus take the variants that filter results with code; other
 * models get plain search only. `max_uses` caps one model call; research
 * needs room (5 ran out before a single market survey had its numbers), and
 * the run's cost cap still bounds the whole.
 */
export function webTools(model: string): Record<string, unknown>[] {
  const filtering = model === "claude-sonnet-5-5" || model === "claude-opus-5-5";
  if (!filtering) return [{ type: "web_search_20250305", name: "web_search", max_uses: 15 }];
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: 15 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
  ];
}

/** Pure. One line for the run log per server-tool call in a response. */
export function webSteps(content: { type: string; name?: string; input?: unknown }[]): string[] {
  return content.filter((b) => b.type === "server_tool_use").map((b) => {
    const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;
    if (b.name === "web_search") return `Web 検索: ${String(input.query ?? "")}`;
    if (b.name === "web_fetch") return `Web ページ: ${String(input.url ?? "")}`;
    // The search tools filter their results with code under the hood.
    if (b.name === "code_execution") return "検索結果を絞り込み";
    if (b.name === "tool_search_tool_bm25") return `道具を探す: ${String(input.query ?? "")}`;
    return `${b.name ?? "server tool"}`;
  });
}


/** A round of a loop, for an Element whose definition names a metric. */
export const ROUND_TOOL: ToolDef = {
  name: "record_round",
  description: "ループの 1 周を記録する。計測した指標の値・変えたこと・残したか戻したかを書く。止める条件や点検の周に当たれば、答えで知らせる。",
  input_schema: {
    type: "object",
    properties: {
      value: { type: "number", description: "この周で計測した指標の値。計測できなかったら省く" },
      change: { type: "string", description: "この周で変えたこと（仮説と変更）" },
      kept: { type: "boolean", description: "変更を残したら true、戻したら false" },
      note: { type: "string" },
    },
    required: ["change", "kept"],
    additionalProperties: false,
  },
};

// Saving and reading the Strategy's Tables is the run's own work, like saving an artifact.
const INTERNAL = new Set([...INTERNAL_TOOLS.map((t) => t.name), ROUND_TOOL.name, ...RECORD_TOOLS.map((t) => t.name)]);

/** The run's own tools, then the catalog's (its core loaded, the rest found by search). */
export function baseAgentTools(): RunToolDef[] {
  return [...INTERNAL_TOOLS, ...toolsFor("element")];
}

export function baseKindOf(name: string): ToolKind | null {
  if (name === "finish") return "finish";
  if (INTERNAL.has(name)) return "internal";
  if (isCatalogTool(name)) return "board";
  return null;
}
