// run-agent — Alcon's autonomous execution engine (Symphony-style).
//
// Executes a single Element end-to-end: plans, works the task, ticks off
// existing sub-elements, posts its deliverable as a comment, and stops the
// Element at "review" for a human to approve. Every step is written to
// agent_run_steps so the frontend can stream a live "Workpad".
//
// Request:
//   { runId: string }            → execute the queued agent_runs row
//   { ping: true }               → connection check (used by Domain API Settings)
//
// Auth: verify_jwt=true (only authenticated users can trigger a run). DB writes
// use the service role. The Anthropic key is the ANTHROPIC_API_KEY secret.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const ALLOWED_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"];
const DEFAULT_MAX_STEPS = 6;

const SYSTEM_PROMPT = `あなたは Alcon の自律実行エージェントです。1つの Element（最小の実行単位＝タスク）を受け取り、自力で遂行して成果物を残します。

# 進め方（Symphony の Ralph ループ）
1. record_plan — 最初に必ず1度だけ、2〜5ステップの実行計画を宣言する
2. log_progress — 進捗・判断・調査の過程を逐次記録する（人間が後から追える「作業ログ」）
3. complete_subelement — Element にサブ要素（チェックリスト）がある場合、対応が完了したものを1つずつ閉じる
4. submit_result — 最後に必ず1度だけ、成果物を提出する。これで Element は「レビュー待ち」になる

# 重要な原則
- 「何をするか」を説明するだけでなく、実際にタスクを遂行して成果物そのものを作る
- submit_result の body は実際の成果物（Markdown）。下書き・分析・計画・提案など、タスクが求めるアウトプットを完成形で書く。「〜する必要がある」ではなく完成物を出す
- 業界語彙に依存しない。与えられた title / description / 文脈だけで判断する
- 情報が足りない場合も、妥当な前提を置いて最後まで完了させる。置いた前提は body の冒頭に明記する
- サブ要素は新規作成しない。既存のものを閉じるだけ
- 簡潔・具体的に。冗長な思考の垂れ流しはしない
- 全工程で日本語を使う

必ず record_plan から始め、submit_result で終えること。`;

const TOOLS = [
  {
    name: "record_plan",
    description: "実行計画を宣言する。タスク開始時に最初に1度だけ呼ぶ。",
    input_schema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "2〜5個の実行ステップ",
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "log_progress",
    description: "進捗・判断・調査の過程を作業ログに1件記録する。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "短い見出し（例: 要件を分析）" },
        detail: { type: ["string", "null"], description: "詳細（任意）" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_subelement",
    description: "対応が完了した既存のサブ要素を1つ閉じる（is_completed=true）。",
    input_schema: {
      type: "object",
      properties: {
        subelement_id: { type: "string", description: "サブ要素のUUID" },
        note: { type: ["string", "null"], description: "完了メモ（任意）" },
      },
      required: ["subelement_id"],
    },
  },
  {
    name: "submit_result",
    description: "成果物を提出してタスクをレビュー待ちにする。最後に1度だけ呼ぶ。",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "成果物の1行要約（80文字程度）" },
        body: { type: "string", description: "成果物そのもの（Markdown）" },
      },
      required: ["summary", "body"],
    },
  },
];

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
interface AnthropicResponse {
  content?: ContentBlock[];
  stop_reason?: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  let body: { runId?: string; ping?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  // Connection check for the Domain API Settings screen.
  if (body.ping) {
    return jsonResponse({
      ok: !!anthropicKey,
      key_configured: !!anthropicKey,
      model_default: DEFAULT_MODEL,
      allowed_models: ALLOWED_MODELS,
    });
  }

  const runId = body.runId;
  if (!runId) return jsonResponse({ error: "runId is required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase service env not configured" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Load the run ──────────────────────────────────────────────────────────
  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) {
    return jsonResponse({ error: "agent run not found" }, 404);
  }
  if (run.status !== "queued") {
    return jsonResponse({ error: `run is not queued (status: ${run.status})` }, 409);
  }

  let stepIdx = 0;
  const addStep = async (type: string, title: string, detail?: string | null) => {
    await supabase.from("agent_run_steps").insert({
      run_id: runId,
      idx: stepIdx++,
      type,
      title,
      detail: detail ?? null,
    });
    await supabase.from("agent_runs").update({ step_count: stepIdx }).eq("id", runId);
  };

  const fail = async (message: string) => {
    await addStep("error", "実行に失敗しました", message).catch(() => {});
    await supabase
      .from("agent_runs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", runId);
    if (run.triggered_by) {
      await supabase.from("notifications").insert({
        recipient_id: run.triggered_by,
        actor_name: "Alcon Agent",
        kind: "status_change",
        element_id: run.element_id,
        title: "エージェント実行が失敗しました",
        body: message.slice(0, 200),
      }).then(() => {}, () => {});
    }
    return jsonResponse({ error: message }, 200);
  };

  try {
    if (!anthropicKey) {
      return await fail("ANTHROPIC_API_KEY が設定されていません。Domain の API 設定を確認してください。");
    }

    // ── Load Element + context ──────────────────────────────────────────────
    const { data: element, error: elErr } = await supabase
      .from("elements")
      .select("*")
      .eq("id", run.element_id)
      .single();
    if (elErr || !element) return await fail("対象の Element が見つかりません。");

    const { data: subelements } = await supabase
      .from("subelements")
      .select("*")
      .eq("element_id", element.id)
      .order("order_index");
    const subs: { id: string; title: string; is_completed: boolean }[] = (subelements ?? []).map(
      (s: { id: string; title: string; is_completed: boolean | null }) => ({
        id: s.id,
        title: s.title,
        is_completed: !!s.is_completed,
      }),
    );

    let objectContext = "";
    if (element.object_id) {
      const { data: obj } = await supabase
        .from("objects")
        .select("name, description")
        .eq("id", element.object_id)
        .single();
      if (obj) {
        objectContext = `所属 Object: ${obj.name}${obj.description ? ` — ${obj.description}` : ""}`;
      }
    }

    const { data: comments } = await supabase
      .from("element_comments")
      .select("author_name, author_kind, content, created_at")
      .eq("element_id", element.id)
      .order("created_at", { ascending: true })
      .limit(8);
    const commentContext = (comments ?? [])
      .map(
        (c: { author_name: string | null; content: string }) =>
          `- ${c.author_name ?? "不明"}: ${c.content}`,
      )
      .join("\n");

    // ── Resolve config (Domain ai_config → defaults) ────────────────────────
    let aiConfig: Record<string, unknown> = {};
    if (run.domain_id) {
      const { data: domain } = await supabase
        .from("domains")
        .select("ai_config")
        .eq("id", run.domain_id)
        .single();
      if (domain?.ai_config && typeof domain.ai_config === "object") {
        aiConfig = domain.ai_config as Record<string, unknown>;
      }
    }
    if (aiConfig.enabled === false) {
      return await fail("この Domain ではエージェント実行が無効化されています。");
    }
    const model =
      typeof aiConfig.model === "string" && ALLOWED_MODELS.includes(aiConfig.model)
        ? aiConfig.model
        : DEFAULT_MODEL;
    const maxSteps =
      typeof aiConfig.max_steps === "number" && aiConfig.max_steps > 0 && aiConfig.max_steps <= 12
        ? Math.floor(aiConfig.max_steps)
        : DEFAULT_MAX_STEPS;
    const extraInstructions =
      typeof aiConfig.instructions === "string" && aiConfig.instructions.trim()
        ? `\n\n# この Domain 固有の指示\n${aiConfig.instructions.trim()}`
        : "";

    let agentName = "Alcon Agent";
    if (run.worker_id) {
      const { data: worker } = await supabase
        .from("workers")
        .select("name")
        .eq("id", run.worker_id)
        .single();
      if (worker?.name) agentName = worker.name;
    }

    // ── Mark running ────────────────────────────────────────────────────────
    await supabase
      .from("agent_runs")
      .update({ status: "running", model, started_at: new Date().toISOString() })
      .eq("id", runId);

    // ── Build the task prompt ───────────────────────────────────────────────
    const subList = subs.length
      ? subs.map((s) => `- [${s.is_completed ? "x" : " "}] ${s.title} (id: ${s.id})`).join("\n")
      : "(なし)";
    const userPrompt = `# Element（実行対象タスク）
タイトル: ${element.title}
説明: ${element.description || "(なし)"}
${objectContext || "(Object 未所属)"}
現在のステータス: ${element.status ?? "todo"}
優先度: ${element.priority ?? "medium"}

# サブ要素（チェックリスト）
${subList}

# これまでのコメント / 文脈
${commentContext || "(なし)"}

上記タスクを遂行し、成果物を提出してください。`;

    // ── Agent loop ──────────────────────────────────────────────────────────
    const messages: { role: string; content: unknown }[] = [
      { role: "user", content: userPrompt },
    ];
    let submitted: { summary: string; body: string } | null = null;

    const callClaude = async (
      toolChoice?: { type: string; name: string },
    ): Promise<AnthropicResponse> => {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          system: SYSTEM_PROMPT + extraInstructions,
          tools: TOOLS,
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          messages,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Anthropic API error ${resp.status}: ${t.slice(0, 300)}`);
      }
      return (await resp.json()) as AnthropicResponse;
    };

    const runTurn = async (toolChoice?: { type: string; name: string }) => {
      const resp = await callClaude(toolChoice);
      const blocks = resp.content ?? [];
      messages.push({ role: "assistant", content: blocks });
      const toolUses = blocks.filter((b) => b.type === "tool_use");

      if (toolUses.length === 0) {
        messages.push({
          role: "user",
          content:
            "ツールを使って進めてください（record_plan / log_progress / complete_subelement / submit_result）。",
        });
        return;
      }

      const toolResults: unknown[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        let resultText = "";
        if (tu.name === "record_plan") {
          const steps = Array.isArray(input.steps) ? (input.steps as string[]) : [];
          await addStep(
            "plan",
            "実行計画",
            steps.map((s, i) => `${i + 1}. ${s}`).join("\n") || "(計画なし)",
          );
          resultText = "計画を記録しました。";
        } else if (tu.name === "log_progress") {
          await addStep(
            "thought",
            String(input.title ?? "進捗"),
            input.detail ? String(input.detail) : null,
          );
          resultText = "作業ログに記録しました。";
        } else if (tu.name === "complete_subelement") {
          const sid = String(input.subelement_id ?? "");
          const sub = subs.find((s) => s.id === sid);
          if (!sub) {
            resultText = "指定された subelement_id は存在しません。";
          } else if (sub.is_completed) {
            resultText = `「${sub.title}」は既に完了しています。`;
          } else {
            await supabase
              .from("subelements")
              .update({ is_completed: true, updated_at: new Date().toISOString() })
              .eq("id", sid);
            sub.is_completed = true;
            await addStep(
              "subelement",
              `サブ要素を完了: ${sub.title}`,
              input.note ? String(input.note) : null,
            );
            resultText = `「${sub.title}」を完了にしました。`;
          }
        } else if (tu.name === "submit_result") {
          submitted = {
            summary: String(input.summary ?? "").trim() || "成果物を提出しました",
            body: String(input.body ?? "").trim(),
          };
          resultText = "成果物を受け取りました。タスクはレビュー待ちになります。";
        } else {
          resultText = "不明なツールです。";
        }
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultText });
      }
      messages.push({ role: "user", content: toolResults });
    };

    for (let turn = 0; turn < maxSteps && !submitted; turn++) {
      // Honour mid-flight cancellation.
      const { data: fresh } = await supabase
        .from("agent_runs")
        .select("status")
        .eq("id", runId)
        .single();
      if (fresh?.status === "cancelled") {
        return jsonResponse({ status: "cancelled" }, 200);
      }
      await runTurn();
    }

    // Didn't finish on its own — force a final deliverable.
    if (!submitted) {
      await addStep("thought", "ステップ上限に到達 — 成果物を確定します");
      await runTurn({ type: "tool", name: "submit_result" });
    }
    if (!submitted) {
      return await fail("エージェントが成果物を提出できませんでした。");
    }
    const result = submitted as { summary: string; body: string };

    // ── Finalize: post deliverable, move Element to review ──────────────────
    const deliverable = result.body || result.summary;
    await supabase.from("element_comments").insert({
      element_id: element.id,
      author_id: null,
      author_kind: "ai_agent",
      author_name: agentName,
      content: `**🤖 エージェント成果物**\n\n${deliverable}`,
    });
    await addStep("comment", "成果物をコメントとして投稿", result.summary);

    const terminalStatuses = ["done", "cancelled"];
    if (!terminalStatuses.includes(element.status ?? "")) {
      await supabase
        .from("elements")
        .update({ status: "review", updated_at: new Date().toISOString() })
        .eq("id", element.id);
      await addStep("status", "Element を「レビュー待ち」に移動");
    }

    await addStep("result", result.summary, deliverable);

    await supabase
      .from("agent_runs")
      .update({
        status: "awaiting_review",
        summary: result.summary,
        result: deliverable,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    if (run.triggered_by) {
      await supabase.from("notifications").insert({
        recipient_id: run.triggered_by,
        actor_name: agentName,
        kind: "status_change",
        element_id: element.id,
        title: `エージェントが「${element.title}」を完了しました`,
        body: result.summary,
      }).then(() => {}, () => {});
    }

    return jsonResponse({ status: "awaiting_review", summary: result.summary });
  } catch (err) {
    console.error("run-agent error", err);
    return await fail((err as Error).message ?? "不明なエラー");
  }
});
