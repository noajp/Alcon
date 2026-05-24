// Roll forward a voice channel's meeting minutes from new transcript
// lines. Called by the client every few minutes during a call.
//
// Request:  { sessionId: string }
// Response: { ok: true, markdown: string, lineCount: number, unchanged?: boolean }
//
// The handler:
//   1. Loads the active session row (RLS-gated via the caller's JWT).
//   2. Fetches transcript lines `spoken_at > last_summarized_at` for
//      this session.
//   3. If there's anything new, calls Claude to rewrite the rolling
//      minutes markdown from existing markdown + new lines.
//   4. UPDATEs `voice_meeting_minutes.markdown` and bumps
//      `last_summarized_at`. Realtime fires the row UPDATE to any
//      subscribed clients (Minutes tab).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `あなたは音声会議のファシリテーターです。
進行中の会議の transcript が新しく届くので、既存の議事録 markdown を最新化してください。

出力フォーマット:
- 直接 markdown のみ返す。コードフェンスや前置きは絶対に入れない
- セクション例:
  ## 概要
  ## 主要な議論
  ## 決定事項
  ## アクションアイテム (担当 / 期限があれば添える)
  ## 未解決 / 検討中
- セクションは内容が無ければ省略して良い
- 議事録は日本語で書く

更新ルール:
- 既存議事録があれば内容を保持しつつ、新しい transcript と矛盾しない形で統合
- 同じ話題の繰り返しはまとめる
- 短い相槌・雑談・「あー」「えーと」等のフィラーは捨てる
- transcript に無い事項は決して創作しない
- 話者名は transcript に書いてあるまま使う
- 内容がまだ薄ければ短く、十分なら丁寧に
`;

interface RequestBody {
  sessionId?: string;
}

interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  stop_reason?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatLines(
  lines: Array<{ speaker_name: string; text: string; spoken_at: string }>,
): string {
  return lines
    .map((l) => {
      const t = new Date(l.spoken_at);
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return `[${hh}:${mm}] ${l.speaker_name}: ${l.text}`;
    })
    .join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !supabaseAnon) {
    return jsonResponse({ error: "Supabase env vars missing" }, 500);
  }
  if (!anthropicKey) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const sessionId = body.sessionId;
  if (!sessionId) {
    return jsonResponse({ error: "sessionId is required" }, 400);
  }

  // RLS gates this — caller must own the parent room.
  const { data: session, error: sessionErr } = await supabase
    .from("voice_meeting_minutes")
    .select("id, channel_id, markdown, last_summarized_at, ended_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) {
    return jsonResponse({ error: sessionErr.message }, 500);
  }
  if (!session) {
    return jsonResponse({ error: "Session not found or no access" }, 403);
  }

  // Fetch transcript lines since the last summary.
  let lineQuery = supabase
    .from("voice_transcript_lines")
    .select("speaker_name, text, spoken_at")
    .eq("session_id", sessionId)
    .order("spoken_at", { ascending: true });
  if (session.last_summarized_at) {
    lineQuery = lineQuery.gt("spoken_at", session.last_summarized_at);
  }

  const { data: lines, error: linesErr } = await lineQuery;
  if (linesErr) {
    return jsonResponse({ error: linesErr.message }, 500);
  }
  if (!lines || lines.length === 0) {
    return jsonResponse({
      ok: true,
      unchanged: true,
      markdown: session.markdown,
      lineCount: 0,
    });
  }

  const existingMd = (session.markdown ?? "").trim();
  const newTranscript = formatLines(lines);

  const userPrompt = `【既存議事録】
${existingMd || "(まだ空)"}

【新しい transcript (まだ議事録に反映していない発言)】
${newTranscript}

これらを統合して、最新の議事録 markdown 全文を返してください。`;

  const llmRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!llmRes.ok) {
    const errorText = await llmRes.text();
    console.error("Anthropic API error", llmRes.status, errorText);
    return jsonResponse({ error: `Anthropic API error: ${errorText}` }, 502);
  }

  const result = (await llmRes.json()) as AnthropicResponse;
  const markdown = result.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();

  if (!markdown) {
    console.error("Empty Claude response", JSON.stringify(result));
    return jsonResponse({ error: "Empty summary from Claude" }, 502);
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("voice_meeting_minutes")
    .update({ markdown, last_summarized_at: now })
    .eq("id", sessionId);
  if (updateErr) {
    return jsonResponse({ error: updateErr.message }, 500);
  }

  return jsonResponse({ ok: true, markdown, lineCount: lines.length });
});
