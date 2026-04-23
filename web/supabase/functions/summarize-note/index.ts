// Summarize a Note into a compact Japanese summary for Ticket creation.
// Request:  { title: string; plainText: string }
// Response: { summary: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `あなたはビジネスドキュメントの要約アシスタントです。
与えられた Note のタイトルと本文を、Ticket として保管するための日本語要約にしてください。

制約:
- 3〜5 行、200 文字以内
- 平文（箇条書きやマークダウン記号は使わない）
- キーワード・数値・固有名詞は保持
- 所感・誇張は不要、事実のみ
- 挨拶・前置きなし、本文のみ返す`;

interface RequestBody {
  title?: string;
  plainText?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
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
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return jsonResponse({ error: `Anthropic API error: ${errorText}` }, 502);
    }

    const result = (await response.json()) as AnthropicResponse;
    const summary =
      result.content
        ?.filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n")
        .trim() ?? "";

    return jsonResponse({ summary });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
