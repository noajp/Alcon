// Summarize a Note into a structured Ticket recap (Loop-style).
// Request:  { title: string; plainText: string }
// Response: {
//   overview: string;
//   decisions:    { title: string; detail?: string }[];
//   action_items: { title: string; owner?: string; due?: string }[];
//   questions:    { title: string; detail?: string }[];
//   participants: { name: string; role?: string }[];
//   summary:      string;   // one-line fallback
// }
// Uses Claude tool_use for schema-guaranteed JSON output.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `あなたはビジネスドキュメントを構造化する抽出アシスタントです。

与えられた Note (会議メモ / 企画書 / 進捗報告 など) から、Ticket として残すべき情報を抽出してください。

ルール:
- 日本語で返す
- 原文に書かれていない情報は勝手に補わない。推測になるものは含めない
- action_items は「誰が」「何を」「いつまでに」を優先して埋める。決まってない項目は null/空で良い
- participants は明示的に登場した人物のみ。本文内で主張・発言・決定した主体
- overview は 1〜2 行、事実ベースで簡潔に
- summary は 1 行 (80 文字程度) の要約
- 決定事項と Action Items は混同しない。決定=確定した方針、Action=誰かが実行するタスク`;

interface RequestBody {
  title?: string;
  plainText?: string;
}

interface Decision  { title: string; detail?: string | null }
interface Action    { title: string; owner?: string | null; due?: string | null }
interface Question  { title: string; detail?: string | null }
interface Participant { name: string; role?: string | null }
interface StructuredOutput {
  overview: string;
  decisions: Decision[];
  action_items: Action[];
  questions: Question[];
  participants: Participant[];
  summary: string;
}

// Tool schema — Claude is forced to call this, giving us typed JSON.
const tool = {
  name: "emit_ticket_recap",
  description: "Emit the structured ticket recap extracted from the note.",
  input_schema: {
    type: "object",
    properties: {
      overview:     { type: "string", description: "1〜2行の事実ベース概要" },
      summary:      { type: "string", description: "1行の要約 (80文字程度)" },
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:  { type: "string" },
            detail: { type: ["string", "null"] },
          },
          required: ["title"],
        },
      },
      action_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            owner: { type: ["string", "null"], description: "担当者名 / 空欄可" },
            due:   { type: ["string", "null"], description: "期限 (原文記述のまま)" },
          },
          required: ["title"],
        },
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:  { type: "string" },
            detail: { type: ["string", "null"] },
          },
          required: ["title"],
        },
      },
      participants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: ["string", "null"] },
          },
          required: ["name"],
        },
      },
    },
    required: ["overview", "summary", "decisions", "action_items", "questions", "participants"],
  },
};

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: StructuredOutput;
}
interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const title = (body.title ?? "").trim();
    const plainText = (body.plainText ?? "").trim();

    if (!plainText && !title) {
      return jsonResponse({ error: "title or plainText is required" }, 400);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const userPrompt = `タイトル: ${title || "(未定)"}\n\n本文:\n${plainText || "(本文なし)"}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [tool],
        tool_choice: { type: "tool", name: "emit_ticket_recap" },
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
      (b) => b.type === "tool_use" && b.name === "emit_ticket_recap"
    );
    const output = toolBlock?.input;
    if (!output || typeof output !== "object") {
      console.error("No structured tool output", JSON.stringify(result));
      return jsonResponse({ error: "No structured output returned" }, 502);
    }

    // Normalise nulls to undefined to simplify client rendering.
    const normalised: StructuredOutput = {
      overview: output.overview ?? "",
      summary: output.summary ?? "",
      decisions: (output.decisions ?? []).map((d) => ({
        title: d.title,
        detail: d.detail ?? undefined,
      })),
      action_items: (output.action_items ?? []).map((a) => ({
        title: a.title,
        owner: a.owner ?? undefined,
        due: a.due ?? undefined,
      })),
      questions: (output.questions ?? []).map((q) => ({
        title: q.title,
        detail: q.detail ?? undefined,
      })),
      participants: (output.participants ?? []).map((p) => ({
        name: p.name,
        role: p.role ?? undefined,
      })),
    };

    return jsonResponse(normalised);
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
