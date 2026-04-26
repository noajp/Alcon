// Generate an AI-authored docx report for a single Element.
//
// Pipeline:
//   1. Fetch the Element + parent Object + assignees + subelements from Supabase.
//   2. Ask Claude (Messages API) to write Python that builds a docx via python-docx.
//      The Code Execution tool runs the code in Anthropic's sandbox and produces
//      a file we can download by file_id (Files API).
//   3. Download the docx, upload to Supabase Storage, return a signed URL.
//   4. Delete the Anthropic-side file so we don't fill the org's 500GB quota.
//
// Required env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_BETAS = "code-execution-2025-08-25,files-api-2025-04-14";
const MODEL = "claude-sonnet-4-6";

type ElementRow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  display_id: string | null;
  object_id: string | null;
  alcon_objects?: { id: string; name: string; description: string | null } | null;
  subelements?: { id: string; title: string; is_completed: boolean | null }[];
  element_assignees?: { workers: { name: string; type: string } | null }[];
};

function buildPrompt(element: ElementRow): string {
  // Hand the model a self-contained JSON payload + an explicit instruction set.
  // Hard-coding the file path ensures the response surfaces the file via file_id.
  const payload = {
    element: {
      id: element.id,
      display_id: element.display_id,
      title: element.title,
      description: element.description,
      status: element.status,
      priority: element.priority,
      start_date: element.start_date,
      due_date: element.due_date,
    },
    parent_object: element.alcon_objects
      ? { id: element.alcon_objects.id, name: element.alcon_objects.name, description: element.alcon_objects.description }
      : null,
    assignees: (element.element_assignees ?? [])
      .map((a) => a.workers)
      .filter((w): w is { name: string; type: string } => !!w),
    subelements: (element.subelements ?? []).map((s) => ({ title: s.title, is_completed: !!s.is_completed })),
  };

  return [
    "あなたはプロジェクト報告書のテンプレ職人です。以下の Element データから、Word(.docx) 形式の進捗レポートを生成してください。",
    "",
    "## 出力要件",
    "- ライブラリ: python-docx（サンドボックスにプリインストール済み）",
    "- ファイル: `/tmp/outputs/report.docx` に保存",
    "- セクション構成:",
    "  1. タイトル（Element 名）",
    "  2. 概要（親 Object 名 / display_id / status / priority / due_date を表で）",
    "  3. 説明（description を本文で。空なら『記載なし』）",
    "  4. 担当者（assignees の name, type を箇条書き）",
    "  5. サブタスク（subelements を ✓/□ で表示）",
    "  6. フッター: 生成日時（UTC ISO8601）",
    "- 日本語フォントは Noto Sans CJK JP を試行、なければデフォルト",
    "- 余計な説明文は出力に含めない（チャット応答も短く）",
    "",
    "## データ",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

async function callAnthropic(apiKey: string, prompt: string): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": ANTHROPIC_BETAS,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      tools: [{ type: "code_execution_20250825", name: "code_execution" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Walk the response and pick the first file_id produced by the code execution tool.
function extractFileId(message: any): string | null {
  for (const block of message.content ?? []) {
    if (block.type !== "code_execution_tool_result") continue;
    const inner = block.content;
    if (!inner) continue;
    const items: any[] = Array.isArray(inner.content) ? inner.content : Array.isArray(inner) ? inner : [];
    for (const item of items) {
      if (item?.file_id) return item.file_id as string;
      if (item?.type === "code_execution_output" && item?.file_id) return item.file_id as string;
    }
  }
  return null;
}

async function downloadAnthropicFile(apiKey: string, fileId: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.anthropic.com/v1/files/${fileId}/content`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
  });
  if (!res.ok) throw new Error(`Files API download failed ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function deleteAnthropicFile(apiKey: string, fileId: string): Promise<void> {
  // Best-effort cleanup. Quota mistakes shouldn't take down the request.
  try {
    await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
      },
    });
  } catch (e) {
    console.warn("Failed to delete Anthropic file:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { element_id } = await req.json().catch(() => ({}));
    if (!element_id) {
      return new Response(JSON.stringify({ error: "element_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Pull the Element bundle.
    const { data: element, error: fetchErr } = await supabase
      .from("elements")
      .select(
        `id, title, description, status, priority, start_date, due_date, display_id, object_id,
         alcon_objects:object_id (id, name, description),
         subelements (id, title, is_completed),
         element_assignees (workers:worker_id (name, type))`,
      )
      .eq("id", element_id)
      .single();
    if (fetchErr || !element) throw new Error(`Element not found: ${fetchErr?.message ?? "unknown"}`);

    // 2. Ask Claude to author the docx via Code Execution.
    const message = await callAnthropic(anthropicKey, buildPrompt(element as unknown as ElementRow));
    const fileId = extractFileId(message);
    if (!fileId) {
      return new Response(
        JSON.stringify({ error: "Code execution finished without producing a file", raw: message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Pull the docx from Anthropic, push it to Supabase Storage.
    const bytes = await downloadAnthropicFile(anthropicKey, fileId);
    const storagePath = `elements/${element.id}/${Date.now()}_report.docx`;
    const { error: uploadErr } = await supabase.storage
      .from("reports")
      .upload(storagePath, bytes, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: false,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: signed, error: signErr } = await supabase.storage
      .from("reports")
      .createSignedUrl(storagePath, 60 * 60); // 1 hour
    if (signErr || !signed) throw new Error(`Signed URL failed: ${signErr?.message ?? "unknown"}`);

    // 4. Free the Anthropic-side copy.
    await deleteAnthropicFile(anthropicKey, fileId);

    return new Response(
      JSON.stringify({
        path: storagePath,
        signed_url: signed.signedUrl,
        filename: `${element.display_id ?? element.id}_report.docx`,
        bytes: bytes.byteLength,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-element-report failed:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
