// Draft an Alcon Object proposal + Elements from a Commit's structured content.
// Request:  {
//   title: string;
//   overview?: string;
//   summary?: string;
//   decisions?: { title: string; detail?: string }[];
//   action_items?: { title: string; owner?: string; due?: string }[];
// }
// Response: {
//   name: string;
//   description: string;
//   color?: string | null;
//   elements: { title: string; description?: string | null; priority?: string | null }[];
// }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `あなたは Alcon の Object (構造単位) と Element (実行単位) をドラフト提案するアシスタントです。

Alcon の概念モデル:
- Object = 部門 / プロジェクト / 作戦 / 案件 など業界横断の容れ物
- Element = その中の最小の実行単位 (タスク / 案件 / 仕訳)
- Subelement (Element のサブタスク) はこの流れでは生成しない。Element までに留める

与えられた Commit (Note から抽出された構造化情報) を元に、以下を提案してください:

1. Object 自体:
   - name: 15-25 字程度の実務的な名前
   - description: 2〜3 行の概要 (平文)
   - color: 落ち着いた中間色の hex (e.g. #6B7280)。決められない時は null

2. Elements (Object に紐づく実行単位):
   - Commit の action_items が存在するなら、それぞれを Element として提案する
   - title は action_items の title をベースに簡潔化
   - description に owner や due の自然文を入れて良い (例: "担当: Noa / 期限: 1週間以内")
   - priority: 文脈から自然に判定 (低優先=low, 通常=medium, 高=high, 急ぎ=urgent)。迷ったら medium
   - action_items が空なら elements は空配列で良い

重要:
- 原文に無い情報を盛らない。action_items を水増ししない
- Subelement は出さない`;

interface RequestBody {
  title?: string;
  overview?: string;
  summary?: string;
  decisions?: Array<{ title?: string; detail?: string | null }>;
  action_items?: Array<{ title?: string; owner?: string | null; due?: string | null }>;
}

type Priority = 'low' | 'medium' | 'high' | 'urgent';
interface ElementDraft {
  title: string;
  description: string | null;
  priority: Priority | null;
}
interface DraftOutput {
  name: string;
  description: string;
  color: string | null;
  elements: ElementDraft[];
}

const tool = {
  name: "emit_object_draft",
  description: "Draft an Alcon Object (+ nested Elements) proposal from the Commit content.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short actionable name, 15-25 chars" },
      description: { type: "string", description: "2-3 line description in plain Japanese" },
      color: { type: ["string", "null"], description: "Optional hex like #6B7280, or null" },
      elements: {
        type: "array",
        description: "Elements derived from the Commit's action items. Empty array if none.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: ["string", "null"] },
            priority: {
              type: ["string", "null"],
              enum: ["low", "medium", "high", "urgent", null],
            },
          },
          required: ["title", "description", "priority"],
        },
      },
    },
    required: ["name", "description", "color", "elements"],
  },
};

interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: DraftOutput;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const title = (body.title ?? "").trim();
    if (!title) {
      return jsonResponse({ error: "title is required" }, 400);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const parts: string[] = [`タイトル: ${title}`];
    if (body.overview) parts.push(`Overview: ${body.overview}`);
    if (body.summary) parts.push(`Summary: ${body.summary}`);
    if (body.decisions?.length) {
      parts.push(
        "Decisions:\n" +
          body.decisions
            .filter((d) => d.title)
            .map((d) => `- ${d.title}${d.detail ? ` (${d.detail})` : ""}`)
            .join("\n")
      );
    }
    if (body.action_items?.length) {
      parts.push(
        "Action Items:\n" +
          body.action_items
            .filter((a) => a.title)
            .map((a) => {
              const meta = [a.owner, a.due].filter(Boolean).join(" / ");
              return `- ${a.title}${meta ? ` [${meta}]` : ""}`;
            })
            .join("\n")
      );
    }
    const userPrompt = parts.join("\n\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [tool],
        tool_choice: { type: "tool", name: "emit_object_draft" },
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error", response.status, errorText);
      return jsonResponse({ error: `Anthropic API error: ${errorText}` }, 502);
    }

    const result = (await response.json()) as AnthropicResponse;
    const toolBlock = result.content?.find(
      (b) => b.type === "tool_use" && b.name === "emit_object_draft"
    );
    const output = toolBlock?.input;
    if (!output || typeof output !== "object") {
      console.error("No tool output", JSON.stringify(result));
      return jsonResponse({ error: "No draft returned" }, 502);
    }

    return jsonResponse({
      name: output.name ?? "",
      description: output.description ?? "",
      color: output.color ?? null,
      elements: (output.elements ?? []).map((e) => ({
        title: e.title,
        description: e.description ?? null,
        priority: e.priority ?? null,
      })),
    });
  } catch (err) {
    console.error("Unhandled error", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
