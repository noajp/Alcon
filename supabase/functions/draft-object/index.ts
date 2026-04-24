// Draft an Alcon Object proposal from a Commit's structured content.
// Request:  {
//   title: string;
//   overview?: string;
//   summary?: string;
//   decisions?: { title: string; detail?: string }[];
//   action_items?: { title: string; owner?: string; due?: string }[];
// }
// Response: { name: string; description: string; color?: string | null }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `あなたは Alcon の Object (組織/プロジェクト/構造単位) をドラフト提案するアシスタントです。

Alcon の概念モデル:
- Object = 中間の構造単位 (部門 / プロジェクト / 作戦 / 案件 など業界横断の容れ物)
- ∞ネスト可能、複数の親を持てる
- Element (実行単位) を束ねる

与えられた Commit (Note から抽出された構造化情報) を元に、自然な Object 名と説明を提案してください。

ルール:
- name: 短く実務的な名前。15-25 字程度。業界語は避け抽象名を使う
- description: 2〜3 行の概要。Commit の overview / key decisions から意図を抜き出す。平文、箇条書きなし
- color: Objectのアクセント色 (任意)。落ち着いた中間色の hex (#6B7280, #10B981 等)。ビビッドすぎる色は避ける。決められない時は null
- AI の推測で盛らない。Commit に根拠がある形で返す`;

interface RequestBody {
  title?: string;
  overview?: string;
  summary?: string;
  decisions?: Array<{ title?: string; detail?: string | null }>;
  action_items?: Array<{ title?: string; owner?: string | null; due?: string | null }>;
}

interface DraftOutput {
  name: string;
  description: string;
  color: string | null;
}

const tool = {
  name: "emit_object_draft",
  description: "Draft an Alcon Object proposal from the Commit content.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short actionable name, 15-25 chars" },
      description: { type: "string", description: "2-3 line description in plain Japanese" },
      color: { type: ["string", "null"], description: "Optional hex like #6B7280, or null" },
    },
    required: ["name", "description", "color"],
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
        max_tokens: 512,
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
