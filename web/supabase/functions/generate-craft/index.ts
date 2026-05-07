// Craft a deliverable (slide deck) for an Alcon Element.
// Claude is forced to follow an HTML contract: each slide is a
// <section class="slide"> with a fixed 1600x900 stage. The full deck
// is wrapped in <deck-stage>...</deck-stage> so the client can extract
// it deterministically and render it inside a sandboxed iframe.
//
// Request:
// {
//   element: { title: string; description?: string | null };
//   format?: 'slides';                                // future: 'lp' | 'report'
//   prompt: string;                                   // latest user instruction
//   history?: { role: 'user' | 'assistant'; content: string }[];
//   currentHtml?: string;                             // last accepted draft
// }
//
// Response: { reply: string; html: string | null }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HTML_CONTRACT = `あなたは Alcon のクラフトツール (Claude Design ライク) です。Element の文脈から
納品物 (まずはスライド) を 1 つの自己完結した HTML として生成します。

# HTML Contract — 厳守

- 出力は必ず <deck-stage> ... </deck-stage> で 1 回だけ囲む。前後に説明文を置かない。
- <deck-stage> の中は <!doctype html> から始まる完結した HTML を入れる。
- 1 スライド = 1 つの <section class="slide">。固定 1600x900 のステージを前提に組む。
- <head> 内の <style> に CSS をすべて埋め込む。外部 CSS / 外部 JS は禁止。
- 使用可能な CSS: flex / grid / linear-gradient / radial-gradient / box-shadow / transform / border-radius
  / opacity / filter (blur まで)。
- 禁止: <script>, @keyframes, animation, vh / vw, position: fixed, 相対パスの <img src> (data: と https: は可)。
- フォントは system-ui / -apple-system / 'Inter' を基本に、必要なら Google Fonts を <link> せず
  CSS の font-family 名のみ指定 (フォールバック前提)。
- ブランドカラーが渡されていれば優先して使う。無ければ落ち着いたモノトーン + 1 色のアクセント。
- 文字は 1 スライド最大 6 行。詰め込みすぎず余白を取る。

# スライドの粒度

- ユーザーの指示と Element の title / description を踏まえ、表紙 + 本文 (3〜6 枚) + クロージングを
  目安に構成。指示で枚数が指定されていれば従う。

# 応答ルール

- <deck-stage> ブロックの "前" に、1〜2 行で何をどう作ったかを日本語で簡潔に説明する。
- "後" には何も書かない。
- 既存の HTML が渡されている場合は、ユーザーの指示に従って差分修正した完全版を返す
  (部分パッチではなく、毎回フル HTML を <deck-stage> で出す)。`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  element?: { title?: string; description?: string | null };
  format?: "slides";
  prompt?: string;
  history?: ChatMessage[];
  currentHtml?: string;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  stop_reason?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
      return jsonResponse({ error: "prompt is required" }, 400);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const elementTitle = body.element?.title?.trim() || "(無題の Element)";
    const elementDesc = body.element?.description?.trim();
    const contextLines = [
      `# Element 文脈`,
      `タイトル: ${elementTitle}`,
      elementDesc ? `説明: ${elementDesc}` : null,
    ].filter(Boolean);

    const messages: ChatMessage[] = [];
    // Seed: element context as a system-style first user turn so multi-turn
    // chat keeps it cached. Subsequent turns just append.
    messages.push({
      role: "user",
      content:
        contextLines.join("\n") +
        (body.currentHtml
          ? `\n\n# 現在の HTML (差分修正のベース)\n以下を起点に、新しい指示で書き直してください。\n` +
            "```html\n" +
            body.currentHtml +
            "\n```"
          : ""),
    });
    messages.push({
      role: "assistant",
      content: "了解しました。指示をください。",
    });

    for (const turn of body.history ?? []) {
      if (turn.role === "user" || turn.role === "assistant") {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
    messages.push({ role: "user", content: prompt });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: HTML_CONTRACT,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error", response.status, errorText);
      return jsonResponse({ error: `Anthropic API error: ${errorText}` }, 502);
    }

    const result = (await response.json()) as AnthropicResponse;
    const text =
      result.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") ?? "";

    const { reply, html } = splitDeckStage(text);

    return jsonResponse({ reply, html });
  } catch (err) {
    console.error("Unhandled error", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

// Pull the <deck-stage> ... </deck-stage> block out of the assistant's
// reply. Returns the surrounding text as `reply` and the inner HTML as
// `html` (or null if the contract was not followed).
function splitDeckStage(text: string): { reply: string; html: string | null } {
  const match = text.match(/<deck-stage[^>]*>([\s\S]*?)<\/deck-stage>/i);
  if (!match) {
    return { reply: text.trim(), html: null };
  }
  const html = match[1].trim();
  const reply = (text.slice(0, match.index).trim() + "\n" + text.slice(match.index! + match[0].length).trim()).trim();
  return { reply: reply || "(deck updated)", html };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
