// Craft a deliverable for an Alcon Element. Two formats are supported:
//
//   documentation  — long-form one-page document (Notion / report style).
//                    Vertical scroll, content density first.
//   presentation   — slide deck. Each slide is a 1600x900 <section class="slide">.
//
// Either way, Claude is forced to follow an HTML contract: the full output
// is wrapped in <deck-stage>...</deck-stage> so the client can extract it
// deterministically and render it inside a sandboxed iframe.
//
// Request:
// {
//   element: { title: string; description?: string | null };
//   format: 'documentation' | 'presentation';
//   prompt: string;
//   history?: { role: 'user' | 'assistant'; content: string }[];
//   currentHtml?: string;
// }
//
// Response: { reply: string; html: string | null }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SHARED_RULES = `# 共通ルール — 厳守

- 出力は必ず <deck-stage> ... </deck-stage> で 1 回だけ囲む。前後に説明文を置かない。
- <deck-stage> の中は <!doctype html> から始まる完結した HTML を入れる。
- <head> 内の <style> に CSS をすべて埋め込む。外部 CSS / 外部 JS は禁止。
- 使用可能な CSS: flex / grid / linear-gradient / radial-gradient / box-shadow / transform
  / border-radius / opacity / filter (blur まで)。
- 禁止: <script>, @keyframes, animation, vh / vw, position: fixed, 相対パスの <img src>
  (data: と https: は可)。
- フォントは system-ui / -apple-system / 'Inter' を基本に、必要なら Google Fonts を <link>
  せず CSS の font-family 名のみ指定 (フォールバック前提)。
- ブランドカラーが渡されていれば優先して使う。

# 応答ルール

- <deck-stage> ブロックの "前" に、1〜2 行で何をどう作ったかを日本語で簡潔に説明する。
- "後" には何も書かない。
- 既存の HTML が渡されている場合は、ユーザーの指示に従って差分修正した完全版を返す
  (部分パッチではなく、毎回フル HTML を <deck-stage> で出す)。`;

const DOCUMENTATION_PROMPT = `あなたは Alcon の Crafting ツール (Documentation モード) です。Element の文脈から
1 つの自己完結した HTML ドキュメントを生成します。Notion ページ / 社内 wiki / 軽量レポート
のような縦スクロール 1 ページ構造です。

# レイアウト指針

- 上端に高さ 56px ほどの "ドキュメンテーションバー" を置く。背景は紺色〜青のグラデーション
  (例: linear-gradient(90deg, #0F2A52 0%, #1B4FA7 100%))、左にタイトル、右にメタ情報
  (Element name / 日付など) を白文字で。
- 本文は最大幅 760px のセンタリングカラム。背景は薄いグレー / 白、文字色は #111。
- 見出し (h1 / h2 / h3) のヒエラルキを明確に。h1 は 1 つ。h2 は 24px / h3 は 18px 目安。
- 段落 / リスト / 引用 / コードブロック / 表 / 画像のいずれも要請に応じて使う。
- 余白は本文段落間 16〜24px、セクション間 32〜48px。

# 表現の幅

- カバー的なヒーローセクション (タイトル + 1 行サブタイトル + メタ) を冒頭に置く。
- 必要なら目次 (TOC) を先頭に作る。
- 強調したい数字や引用は、淡い背景のカード (border-radius 12px, padding 24px) で囲む。
- 図解は CSS のみで作れる範囲に留める。

${SHARED_RULES}`;

const PRESENTATION_PROMPT = `あなたは Alcon の Crafting ツール (Presentation モード) です。Element の文脈から
スライドデッキを 1 つの自己完結した HTML として生成します (Claude Design ライク)。

# レイアウト指針

- 上端に高さ 48px ほどの "プレゼンテーションバー" を置く。背景は濃いオレンジ
  (例: linear-gradient(90deg, #B7410E 0%, #E2722C 100%))、左にタイトル、右にスライド番号 / Element name。
- 1 スライド = 1 つの <section class="slide">。固定 1600x900 のステージを前提に組む。
- スライド間に 24〜40px の余白を入れて縦に並べる。
- 文字は 1 スライド最大 6 行。詰め込みすぎず余白を取る。
- 表紙 + 本文 (3〜6 枚) + クロージング を目安に構成。指示で枚数が指定されていれば従う。
- 配色は落ち着いたモノトーン + アクセント 1 色を基本。指示があれば従う。

${SHARED_RULES}`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  element?: { title?: string; description?: string | null };
  format?: "documentation" | "presentation";
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

    const format = body.format === "documentation" ? "documentation" : "presentation";
    const systemPrompt = format === "documentation" ? DOCUMENTATION_PROMPT : PRESENTATION_PROMPT;

    const elementTitle = body.element?.title?.trim() || "(無題の Element)";
    const elementDesc = body.element?.description?.trim();
    const contextLines = [
      `# Element 文脈`,
      `タイトル: ${elementTitle}`,
      elementDesc ? `説明: ${elementDesc}` : null,
    ].filter(Boolean);

    const messages: ChatMessage[] = [];
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
        system: systemPrompt,
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
