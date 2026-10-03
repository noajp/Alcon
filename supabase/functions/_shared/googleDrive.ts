// Google Drive tools for agents (ADR 0034). A google-drive integration gives
// the agent these typed tools instead of the generic http_request:
//
//   drive_search          read   list files matching a query
//   drive_read            read   a file's text (Docs → text, Sheets → CSV)
//   drive_create          write  a new Doc (html), Sheet (csv) or text file
//   drive_update          write  replace a file's content and/or rename it
//   drive_create_folder   write  a new folder
//
// Every URL is built here from server-side constants; the agent supplies
// only names, queries, content and file ids (checked against FILE_ID). The
// request builders are pure so web/tests checks them; runDriveTool sends
// them with the access token in the Authorization header.

import { readCapped } from "./integrationClient.ts";

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const FILE_ID = /^[A-Za-z0-9_-]{10,}$/;
const FILE_FIELDS = "id,name,mimeType,webViewLink,modifiedTime";
const MAX_CONTENT_CHARS = 2_000_000;
const MAX_READ_BYTES = 1_000_000;
const MAX_RESULT_CHARS = 20_000;
const TIMEOUT_MS = 30_000;

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOC_MIME = "application/vnd.google-apps.document";
export const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const SLIDES_MIME = "application/vnd.google-apps.presentation";

export type ContentKind = "html" | "csv" | "text";

/** What a content kind uploads as, and what Drive stores it as. */
export const CONTENT_KINDS: Record<ContentKind, { media: string; target: string }> = {
  html: { media: "text/html", target: DOC_MIME },
  csv: { media: "text/csv", target: SHEET_MIME },
  text: { media: "text/plain", target: "text/plain" },
};

export type DriveToolName = "drive_search" | "drive_read" | "drive_create" | "drive_update" | "drive_create_folder";

const SCOPE_NOTE = "Alcon は drive.file 権限で接続しているので、見えるのは Alcon が作ったファイルと、利用者が Alcon に渡したファイルだけです。";

export const DRIVE_TOOLS: { name: DriveToolName; description: string; readOnly: boolean; input_schema: Record<string, unknown> }[] = [
  {
    name: "drive_search",
    readOnly: true,
    description: `Google Drive のファイルを検索する。text は名前と本文に含まれる語、query は Drive の検索式（例: mimeType = 'application/vnd.google-apps.document'）。ゴミ箱のファイルは除く。${SCOPE_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "名前か本文に含まれる語" },
        query: { type: "string", description: "Drive の検索式（q）。text と併用すると AND" },
        page_size: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "drive_read",
    readOnly: true,
    description: `Google Drive のファイルの中身をテキストで読む。Google ドキュメントはテキスト、スプレッドシートは CSV（最初のシート）、スライドはテキストで返す。テキスト以外のファイルは読めない。長いものは途中で切る。${SCOPE_NOTE}`,
    input_schema: {
      type: "object",
      properties: { file_id: { type: "string" } },
      required: ["file_id"],
      additionalProperties: false,
    },
  },
  {
    name: "drive_create",
    readOnly: false,
    description: `Google Drive にファイルを作る。kind が html なら Google ドキュメント、csv ならスプレッドシート、text ならテキストファイルになる。parent_id でフォルダを指定できる。ファイルは接続した Google アカウントの名義で作られる。${SCOPE_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: ["html", "csv", "text"] },
        content: { type: "string" },
        parent_id: { type: "string" },
      },
      required: ["name", "kind", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "drive_update",
    readOnly: false,
    description: `Google Drive のファイルの中身を置き換える、または名前を変える。content を渡すなら kind も渡す（html → ドキュメント、csv → スプレッドシート、text → テキスト）。${SCOPE_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        name: { type: "string" },
        kind: { type: "string", enum: ["html", "csv", "text"] },
        content: { type: "string" },
      },
      required: ["file_id"],
      additionalProperties: false,
    },
  },
  {
    name: "drive_create_folder",
    readOnly: false,
    description: `Google Drive にフォルダを作る。parent_id で親フォルダを指定できる。${SCOPE_NOTE}`,
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, parent_id: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

const READ_TOOLS = new Set(DRIVE_TOOLS.filter((t) => t.readOnly).map((t) => t.name as string));

export function isDriveTool(name: string): name is DriveToolName {
  return DRIVE_TOOLS.some((t) => t.name === name);
}

export function isDriveReadTool(name: string): boolean {
  return READ_TOOLS.has(name);
}

export interface DriveRequest {
  method: "GET" | "POST" | "PATCH";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export function assertFileId(id: unknown, label = "file_id"): string {
  if (typeof id !== "string" || !FILE_ID.test(id)) throw new Error(`${label} is not a Drive file id`);
  return id;
}

function requireName(name: unknown): string {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) throw new Error("name is required");
  if (n.length > 255) throw new Error("name is too long");
  return n;
}

function contentKind(kind: unknown): ContentKind {
  if (kind === "html" || kind === "csv" || kind === "text") return kind;
  throw new Error("kind must be html, csv or text");
}

function requireContent(content: unknown): string {
  if (typeof content !== "string") throw new Error("content is required");
  if (content.length > MAX_CONTENT_CHARS) throw new Error("content is too large");
  return content;
}

/** A Drive query string literal: backslash and quote escaped. */
export function driveQueryLiteral(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function buildSearchRequest(input: Record<string, unknown>): DriveRequest {
  const parts = ["trashed = false"];
  if (typeof input.text === "string" && input.text.trim()) {
    const lit = driveQueryLiteral(input.text.trim().slice(0, 200));
    parts.push(`(name contains ${lit} or fullText contains ${lit})`);
  }
  if (typeof input.query === "string" && input.query.trim()) parts.push(`(${input.query.trim().slice(0, 1000)})`);
  const size = Math.min(100, Math.max(1, Math.floor(Number(input.page_size) || 25)));
  const u = new URL(`${DRIVE_API}/files`);
  u.searchParams.set("q", parts.join(" and "));
  u.searchParams.set("fields", `files(${FILE_FIELDS})`);
  u.searchParams.set("pageSize", String(size));
  u.searchParams.set("orderBy", "modifiedTime desc");
  return { method: "GET", url: u.toString(), headers: { accept: "application/json" } };
}

export function buildMetadataRequest(fileId: unknown): DriveRequest {
  const id = assertFileId(fileId);
  return { method: "GET", url: `${DRIVE_API}/files/${id}?fields=id,name,mimeType,size,webViewLink`, headers: { accept: "application/json" } };
}

/** True for a non-Google file whose bytes read as text. */
export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/") || /^application\/(json|xml|csv|javascript|x-yaml|yaml|sql|x-sh)\b/.test(mime) || /\+(json|xml)$/.test(mime);
}

/** How to read a file's content as text, or why it cannot be. */
export function buildContentRequest(fileId: unknown, mimeType: string): DriveRequest {
  const id = assertFileId(fileId);
  const exportAs: Record<string, string> = { [DOC_MIME]: "text/plain", [SHEET_MIME]: "text/csv", [SLIDES_MIME]: "text/plain" };
  if (exportAs[mimeType]) {
    return { method: "GET", url: `${DRIVE_API}/files/${id}/export?mimeType=${encodeURIComponent(exportAs[mimeType])}`, headers: {} };
  }
  if (mimeType.startsWith("application/vnd.google-apps.")) throw new Error(`This kind of Google file (${mimeType}) cannot be read as text`);
  if (!isTextMime(mimeType)) throw new Error(`This file (${mimeType}) is not text and cannot be read`);
  return { method: "GET", url: `${DRIVE_API}/files/${id}?alt=media`, headers: {} };
}

/** A random multipart boundary. */
export function newBoundary(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return `alcon_${Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** A multipart/related body: JSON metadata, then the media part. */
export function multipartBody(metadata: Record<string, unknown>, media: { type: string; content: string }, boundary: string): string {
  const meta = JSON.stringify(metadata);
  if (media.content.includes(boundary) || meta.includes(boundary)) throw new Error("boundary collides with the content");
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    meta,
    `--${boundary}`,
    `Content-Type: ${media.type}; charset=UTF-8`,
    "",
    media.content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function buildCreateRequest(input: Record<string, unknown>, boundary = newBoundary()): DriveRequest {
  const name = requireName(input.name);
  const kind = contentKind(input.kind);
  const content = requireContent(input.content);
  const metadata: Record<string, unknown> = { name, mimeType: CONTENT_KINDS[kind].target };
  if (input.parent_id !== undefined && input.parent_id !== null && input.parent_id !== "") metadata.parents = [assertFileId(input.parent_id, "parent_id")];
  return {
    method: "POST",
    url: `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`,
    headers: { "content-type": `multipart/related; boundary=${boundary}`, accept: "application/json" },
    body: multipartBody(metadata, { type: CONTENT_KINDS[kind].media, content }, boundary),
  };
}

export function buildUpdateRequest(input: Record<string, unknown>, boundary = newBoundary()): DriveRequest {
  const id = assertFileId(input.file_id);
  const metadata: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== null && input.name !== "") metadata.name = requireName(input.name);
  if (input.content === undefined || input.content === null) {
    if (!metadata.name) throw new Error("Pass content (with kind) or name");
    return {
      method: "PATCH",
      url: `${DRIVE_API}/files/${id}?fields=id,name,webViewLink`,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(metadata),
    };
  }
  const kind = contentKind(input.kind);
  const content = requireContent(input.content);
  return {
    method: "PATCH",
    url: `${DRIVE_UPLOAD}/${id}?uploadType=multipart&fields=id,name,webViewLink`,
    headers: { "content-type": `multipart/related; boundary=${boundary}`, accept: "application/json" },
    body: multipartBody(metadata, { type: CONTENT_KINDS[kind].media, content }, boundary),
  };
}

export function buildCreateFolderRequest(input: Record<string, unknown>): DriveRequest {
  const metadata: Record<string, unknown> = { name: requireName(input.name), mimeType: FOLDER_MIME };
  if (input.parent_id !== undefined && input.parent_id !== null && input.parent_id !== "") metadata.parents = [assertFileId(input.parent_id, "parent_id")];
  return {
    method: "POST",
    url: `${DRIVE_API}/files?fields=id,name,webViewLink`,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(metadata),
  };
}

/** The operation a tool call shows on an approval card and in the run log. */
export function driveOperationLabel(name: string, input: Record<string, unknown>): string {
  const n = typeof input.name === "string" && input.name.trim() ? ` 「${input.name.trim().slice(0, 60)}」` : "";
  switch (name) {
    case "drive_create": return `ファイルを作成${n}`;
    case "drive_update": return `ファイルを更新${n}`;
    case "drive_create_folder": return `フォルダを作成${n}`;
    case "drive_search": return "ファイルを検索";
    case "drive_read": return "ファイルを読む";
    default: return name;
  }
}

function truncate(s: string): string {
  return s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n…(${s.length - MAX_RESULT_CHARS} chars truncated)` : s;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function send(req: DriveRequest, token: string, fetchImpl: FetchLike, limit?: number): Promise<{ status: number; text: string }> {
  // Only googleapis.com, over https: every builder above guarantees it.
  const u = new URL(req.url);
  if (u.protocol !== "https:" || u.hostname !== "www.googleapis.com") throw new Error("Drive request outside googleapis.com");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers: { ...req.headers, Authorization: `Bearer ${token}` },
      body: req.body,
      signal: ctl.signal,
      redirect: "manual",
    });
    return { status: res.status, text: await readCapped(res, limit) };
  } finally {
    clearTimeout(t);
  }
}

function errorOf(status: number, text: string): string {
  const msg = text.match(/"message"\s*:\s*"([^"]{1,300})"/)?.[1];
  return `Google Drive: HTTP ${status}${msg ? ` ${msg}` : ""}`;
}

/** Runs one Drive tool with the access token. Errors come back as text for the model. */
export async function runDriveTool(name: string, input: Record<string, unknown>, token: string, fetchImpl: FetchLike = fetch): Promise<{ text: string; isError: boolean }> {
  try {
    switch (name) {
      case "drive_search": {
        const r = await send(buildSearchRequest(input), token, fetchImpl);
        return r.status === 200 ? { text: truncate(r.text), isError: false } : { text: errorOf(r.status, r.text), isError: true };
      }
      case "drive_read": {
        const meta = await send(buildMetadataRequest(input.file_id), token, fetchImpl);
        if (meta.status !== 200) return { text: errorOf(meta.status, meta.text), isError: true };
        const m = JSON.parse(meta.text) as { name?: string; mimeType?: string; webViewLink?: string };
        const content = await send(buildContentRequest(input.file_id, String(m.mimeType ?? "")), token, fetchImpl, MAX_READ_BYTES);
        if (content.status !== 200) return { text: errorOf(content.status, content.text), isError: true };
        return { text: truncate(`# ${m.name ?? ""} (${m.mimeType ?? ""})${m.webViewLink ? `\n${m.webViewLink}` : ""}\n\n${content.text}`), isError: false };
      }
      case "drive_create":
      case "drive_update":
      case "drive_create_folder": {
        const req = name === "drive_create" ? buildCreateRequest(input) : name === "drive_update" ? buildUpdateRequest(input) : buildCreateFolderRequest(input);
        const r = await send(req, token, fetchImpl);
        return r.status >= 200 && r.status < 300 ? { text: truncate(r.text), isError: false } : { text: errorOf(r.status, r.text), isError: true };
      }
      default:
        return { text: `Unknown Drive tool ${name}`, isError: true };
    }
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}
