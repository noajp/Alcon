// Generate an AI-authored docx report for an Object (project / department / etc.).
//
// Same pipeline as the (now-deleted) element version, but the input is an
// Object: we include the Object's metadata, every direct Element with its
// status / assignees / due dates, and a shallow list of child Objects. Claude
// writes Python that builds the docx via python-docx, the file is uploaded to
// Supabase Storage, and a 1h signed URL is returned.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_BETAS = "code-execution-2025-08-25,files-api-2025-04-14";
const MODEL = "claude-sonnet-4-6";

function buildPrompt(payload: any): string {
  return [
    "Object のメタデータと配下 Element を集計し、Word(.docx) 形式の進捗レポートを作成してください。",
    "",
    "### 重要な実行ルール",
    "- python-docx を使う(プリインストール済み)",
    "- 出力ファイルは `/tmp/report.docx` に保存(`/tmp/` 直下、自動アップロードされる)",
    "- 保存後 `print(f'SAVED: {path}')` で確認ログ",
    "- チャット応答は1行(『report.docx を生成しました』)",
    "",
    "### レポート構成(目安)",
    "1. 表紙: Object 名(タイトル) + 『進捗レポート』(サブタイトル) + 生成日時(UTC)",
    "2. 概要表: 親 Object / Display ID / 直下 Element 数 / 完了率 / 期限超過件数",
    "3. 説明: Object.description(空なら『記載なし』)",
    "4. 子 Object 一覧: 名前 + Element 件数 + 完了率 を表で",
    "5. Element 一覧: Status グループ毎(todo / in_progress / review / done / blocked など)に箇条書き、各行に [優先度] タイトル — 担当者 — 期限",
    "6. 期限超過 / 期限間近(7日以内): 別表で強調",
    "7. フッター: 生成日時(UTC ISO8601)",
    "",
    "### スタイル指針",
    "- Title / Subtitle / Heading 1〜2 など python-docx の組み込みスタイルを使う(色・フォントが効く)",
    "- 表は Word の Light Grid Accent 1 など組み込みテーブルスタイルを適用",
    "- 日本語フォントは 游ゴシック を試行、なければデフォルト",
    "",
    "### データ",
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
      max_tokens: 8192,
      tools: [{ type: "code_execution_20250825", name: "code_execution" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Recursive walker: pull every file_id from the response no matter where it sits.
function collectFileIds(node: any, found: string[] = []): string[] {
  if (!node || typeof node !== "object") return found;
  if (typeof node.file_id === "string") found.push(node.file_id);
  if (Array.isArray(node)) {
    for (const item of node) collectFileIds(item, found);
  } else {
    for (const key of Object.keys(node)) collectFileIds(node[key], found);
  }
  return found;
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
  try {
    await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
      },
    });
  } catch (e) { console.warn("Failed to delete Anthropic file:", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { object_id } = await req.json().catch(() => ({}));
    if (!object_id) {
      return new Response(JSON.stringify({ error: "object_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Fetching Object:", object_id);

    // The Object itself + parent name (single fetch).
    const { data: obj, error: objErr } = await supabase
      .from("alcon_objects")
      .select(`id, name, description, display_id, parent_object_id,
               parent:parent_object_id (id, name, display_id)`)
      .eq("id", object_id).single();
    if (objErr || !obj) throw new Error(`Object not found: ${objErr?.message ?? "unknown"}`);

    // Direct child Objects (one level).
    const { data: children } = await supabase
      .from("alcon_objects")
      .select("id, name, display_id")
      .eq("parent_object_id", object_id);

    // Per-child Element counts (one query per child is fine for small sets).
    const childSummaries = await Promise.all(
      (children ?? []).map(async (c) => {
        const { data: els } = await supabase
          .from("elements")
          .select("id, status")
          .eq("object_id", c.id);
        const total = els?.length ?? 0;
        const done = (els ?? []).filter((e: any) => e.status === "done").length;
        return {
          id: c.id, name: c.name, display_id: c.display_id,
          element_total: total, element_done: done,
          completion_rate: total > 0 ? Math.round((done / total) * 100) : 0,
        };
      }),
    );

    // Direct Elements with assignees + sub-elements counts.
    const { data: elements } = await supabase
      .from("elements")
      .select(`id, title, description, status, priority, due_date, due_time, display_id,
               element_assignees (workers:worker_id (name, type)),
               subelements (id, is_completed)`)
      .eq("object_id", object_id);

    const today = new Date();
    const upcomingCutoff = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const elementSummaries = (elements ?? []).map((e: any) => {
      const due = e.due_date ? new Date(e.due_date) : null;
      const overdue = due ? due < today && e.status !== "done" : false;
      const upcoming = due ? !overdue && due <= upcomingCutoff && e.status !== "done" : false;
      return {
        id: e.id, display_id: e.display_id, title: e.title,
        status: e.status, priority: e.priority, due_date: e.due_date,
        assignees: (e.element_assignees ?? []).map((a: any) => a.workers).filter(Boolean),
        subelement_total: e.subelements?.length ?? 0,
        subelement_done: (e.subelements ?? []).filter((s: any) => s.is_completed).length,
        overdue, upcoming,
      };
    });

    const total = elementSummaries.length;
    const done = elementSummaries.filter((e) => e.status === "done").length;
    const overdueCount = elementSummaries.filter((e) => e.overdue).length;

    const payload = {
      object: {
        id: obj.id,
        name: obj.name,
        display_id: obj.display_id,
        description: obj.description,
        parent: obj.parent ?? null,
      },
      stats: {
        element_total: total,
        element_done: done,
        completion_rate: total > 0 ? Math.round((done / total) * 100) : 0,
        overdue_count: overdueCount,
        child_object_count: childSummaries.length,
      },
      children: childSummaries,
      elements: elementSummaries,
      generated_at: new Date().toISOString(),
    };

    console.log("Calling Anthropic Code Execution...");
    const message = await callAnthropic(anthropicKey, buildPrompt(payload));
    console.log("Anthropic stop_reason:", message.stop_reason);

    const fileIds = collectFileIds(message);
    console.log("Found file_ids:", fileIds);
    if (fileIds.length === 0) {
      return new Response(
        JSON.stringify({
          error: "Code execution finished without producing a file",
          stop_reason: message.stop_reason,
          content_types: (message.content ?? []).map((b: any) => b.type),
          raw: message,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fileId = fileIds[0];
    const bytes = await downloadAnthropicFile(anthropicKey, fileId);
    const storagePath = `objects/${obj.id}/${Date.now()}_report.docx`;
    const { error: uploadErr } = await supabase.storage
      .from("reports")
      .upload(storagePath, bytes, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: false,
      });
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: signed, error: signErr } = await supabase.storage
      .from("reports").createSignedUrl(storagePath, 60 * 60);
    if (signErr || !signed) throw new Error(`Signed URL failed: ${signErr?.message ?? "unknown"}`);

    await deleteAnthropicFile(anthropicKey, fileId);

    return new Response(JSON.stringify({
      path: storagePath,
      signed_url: signed.signedUrl,
      filename: `${obj.display_id ?? obj.id}_report.docx`,
      bytes: bytes.byteLength,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-object-report failed:", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
