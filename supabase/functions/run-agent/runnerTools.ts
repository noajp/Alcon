// The browser on a person's own computer, as an agent's tools. A runner
// (sdk/node/alcon-runner.mjs) announces itself to the Space through the asset
// relay with the capability "browser"; once the person accepts it, their runs
// may ask it to open, read and click pages in a Chrome profile of its own.
// The call goes into asset_calls; the runner takes it, does it and answers.
// The runner refuses form submissions unless it was started to allow them, so
// these tools only read: no approval is asked. Pure: index.ts does the I/O.

import type { ToolDef } from "../_shared/boardTools.ts";

export const RUNNER_PREFIX = "pc_";

/** How recently a runner must have asked for work to count as on. */
export const RUNNER_ONLINE_MS = 2 * 60_000;

const PAGE_NOTE = "答えは、そのページの URL・タイトル・本文（長いと途中まで）・リンクの一覧（文字と URL）。";

export const RUNNER_TOOLS: ToolDef[] = [
  {
    name: "pc_open",
    description: `依頼した人の PC のブラウザで URL を開いて読む。検索では中身が取れない一覧ページ・検索結果・詳細ページに使う。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
  {
    name: "pc_read",
    description: `PC のブラウザで今開いているページを読み直す。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pc_click",
    description: `PC のブラウザで、見えている文字（リンク・ボタン・タブ・「次へ」など）をクリックし、移った先を読む。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: { text: { type: "string", description: "クリックする要素に書かれた文字" } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "pc_type",
    description: `PC のブラウザで入力欄（検索欄・絞り込み条件など）に文字を入れる。submit が true なら Enter を押して結果を読む。${PAGE_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        field: { type: "string", description: "入力欄のラベル・プレースホルダ・近くの文字" },
        text: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["field", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "pc_back",
    description: `PC のブラウザで前のページに戻って読む。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pc_sign_in",
    description: "PC のブラウザで開いているページがログイン画面で止まっているときに使う。この Space に保存されたそのサイトのサインイン情報があれば、サーバーがブラウザに入力してログインを試みる。パスワードを引数に取ることは決してない（自分でパスワードを打ったり、チャットで聞いたりしない）。origin は、今いると思うサイトのアドレス（https://example.com の形、任意）。保存された情報がそのページのサイトと一致しない場合は何も入力されない。",
    input_schema: {
      type: "object",
      properties: { origin: { type: "string", description: "今いると思うサイトのアドレス（任意）" } },
      additionalProperties: false,
    },
  },
];

/**
 * A disposable machine (a runner that declared itself isolated, e.g. a
 * Vercel Sandbox): the agent may run commands and read and write files there.
 * Never offered for a runner on a computer someone works on.
 */
export const MACHINE_PREFIX = "vm_";

export const MACHINE_TOOLS: ToolDef[] = [
  {
    name: "vm_shell",
    description: "使い捨ての仮想マシン（Linux、Node・Python 入り、ネット可）で bash コマンドを実行し、終了コード・標準出力・標準エラーを返す。1 回 40 秒まで。インストールやビルドのような長い処理は nohup … > log 2>&1 & で裏に回し、後で tail で確かめる。sudo 可。作業フォルダは呼び出しをまたいで残る。",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" }, timeout_s: { type: "number", description: "秒（最大 40）" } },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "vm_write_file",
    description: "仮想マシンにファイルを書く（作業フォルダからの相対パスか絶対パス）。コードや設定を置くのに使う。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "vm_read_file",
    description: "仮想マシンのファイルを読む（最大 60,000 文字）。",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
];

const NAMES = new Set(RUNNER_TOOLS.map((t) => t.name));
const MACHINE_NAMES = new Set(MACHINE_TOOLS.map((t) => t.name));

export function isRunnerTool(name: string): boolean {
  return NAMES.has(name);
}

export function isMachineTool(name: string): boolean {
  return MACHINE_NAMES.has(name);
}

/** Pure. The runner's own name for a tool: pc_open → open, vm_shell → shell. */
export function runnerOperation(name: string): string {
  if (name.startsWith(RUNNER_PREFIX)) return name.slice(RUNNER_PREFIX.length);
  if (name.startsWith(MACHINE_PREFIX)) return name.slice(MACHINE_PREFIX.length);
  return name;
}

export interface RunnerRow { id: string; name: string; manifest: unknown; last_seen_at: string | null }

const capsOf = (r: RunnerRow): string[] => {
  const caps = r.manifest && typeof r.manifest === "object" ? (r.manifest as { capabilities?: unknown }).capabilities : null;
  return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === "string") : [];
};
const isolatedOf = (r: RunnerRow) => !!(r.manifest && typeof r.manifest === "object" && (r.manifest as { isolated?: unknown }).isolated === true);

/** Pure. The runner a run may use for a capability: one that offers it and
 *  asked for work recently, the most recent first. "shell" is only ever an
 *  isolated runner's. */
export function pickRunner(rows: readonly RunnerRow[], now: number, capability: "browser" | "shell" = "browser"): RunnerRow | null {
  const live = rows.filter((r) => capsOf(r).includes(capability) && (capability !== "shell" || isolatedOf(r))
    && !!r.last_seen_at && now - new Date(r.last_seen_at).getTime() <= RUNNER_ONLINE_MS);
  live.sort((a, b) => new Date(b.last_seen_at!).getTime() - new Date(a.last_seen_at!).getTime());
  return live[0] ?? null;
}

/**
 * Pure. One line for the run log.
 *
 * A pc_type into a password field never shows its text: the typed
 * value would land in a member-readable record verbatim (the leak
 * the secure-login design closes). The runner reports whether the
 * field it filled was a password field; `maskTypeText` is that
 * report read conservatively — masked unless the runner affirmatively
 * said the field was an ordinary one.
 */
export function runnerStep(name: string, input: Record<string, unknown>, maskTypeText = false): string {
  switch (name) {
    case "pc_open": return `PC: 開く ${String(input.url ?? "")}`;
    case "pc_click": return `PC: クリック「${String(input.text ?? "")}」`;
    case "pc_type": return maskTypeText
      ? `PC: 入力「${String(input.field ?? "")}」← ••••••（パスワード欄のため表示しません）`
      : `PC: 入力「${String(input.field ?? "")}」← ${String(input.text ?? "")}`;
    case "pc_back": return "PC: 戻る";
    case "pc_sign_in": return `PC: サインイン ${String(input.origin ?? "")}`.trim();
    case "vm_shell": return `VM: $ ${String(input.command ?? "").slice(0, 200)}`;
    case "vm_write_file": return `VM: 書く ${String(input.path ?? "")}`;
    case "vm_read_file": return `VM: 読む ${String(input.path ?? "")}`;
    default: return "PC: 読む";
  }
}

/**
 * Pure. Whether the field a pc_type filled was a password field, as
 * the runner reported it in the result: true / false when it said,
 * undefined when the answer carries no report (an old runner, a
 * failed call) — the caller masks on anything but an affirmative
 * false.
 */
export function passwordFieldOf(result: unknown): boolean | undefined {
  const r = result && typeof result === "object" ? result as { password_field?: unknown } : {};
  return typeof r.password_field === "boolean" ? r.password_field : undefined;
}

/**
 * Pure. A sign-in's answer as the agent reads it: the outcome in the
 * server's own words first (the runner's reason code, worded here —
 * its free text never travels), then the page it landed on. Failure
 * lines say what the agent may conclude: a refusal means nothing was
 * typed; a wall that stayed means the stored pair did not open it.
 */
export function signInResultText(result: unknown): string {
  const r = result && typeof result === "object" ? result as { signed_in?: unknown; reason?: unknown } : {};
  const page = runnerResultText(result);
  if (r.signed_in === true) return `サインインしました。\n\n${page}`;
  switch (r.reason) {
    case "page_moved": return `ページが移動していたため、サインイン情報は入力しませんでした。\n\n${page}`;
    case "no_form": return `このページにログインの入力欄が見つからなかったため、サインインできませんでした。\n\n${page}`;
    case "still_walled": return `サインインを試みましたが、ログイン画面が残りました。保存された情報が合っていない可能性があります。\n\n${page}`;
    case "no_pair": return `サインイン情報が届かなかったため、入力しませんでした。\n\n${page}`;
    default: return `サインインできませんでした。\n\n${page}`;
  }
}

/** Pure. A machine's answer as the agent reads it. */
export function machineResultText(result: unknown): string {
  const r = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if ("exit_code" in r) {
    return [`exit ${String(r.exit_code)}`, r.stdout ? `--- stdout\n${String(r.stdout)}` : "", r.stderr ? `--- stderr\n${String(r.stderr)}` : ""]
      .filter(Boolean).join("\n").slice(0, 16_000);
  }
  if ("content" in r) return `${String(r.path ?? "")}${r.truncated ? "（途中まで）" : ""}\n${String(r.content ?? "")}`.slice(0, 60_000);
  return JSON.stringify(r).slice(0, 4_000);
}

/** Pure. The runner's answer as the agent reads it. */
export function runnerResultText(result: unknown): string {
  const r = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const links = Array.isArray(r.links) ? (r.links as { text?: unknown; href?: unknown }[]) : [];
  const lines = [
    `URL: ${String(r.url ?? "")}`,
    `タイトル: ${String(r.title ?? "")}`,
    "",
    // Pages are long and stay in the context for the rest of the run: keep
    // what an agent reads per page modest.
    String(r.text ?? "").slice(0, 8_000),
  ];
  if (links.length) {
    lines.push("", "# リンク");
    for (const l of links.slice(0, 80)) lines.push(`- ${String(l.text ?? "").slice(0, 80)} → ${String(l.href ?? "")}`);
  }
  if (r.note) lines.push("", `注: ${String(r.note)}`);
  return lines.join("\n").slice(0, 12_000);
}
