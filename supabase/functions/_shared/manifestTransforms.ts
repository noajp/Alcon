// Named response transforms (Sim prototype P1T; design
// ~/workspace/dev/clayware-sim-prototype-design.md §3.4) and named
// request-body builders (P2; design §4.2) — the registry's two
// halves, one for each direction a call crosses.
//
// A manifest command may name ONE transform: a server-side pure
// function that shapes the service's raw answer into the form a
// reader works from. Some answers are not readable as they arrive —
// a Gmail message resource is a tree of MIME parts holding base64 —
// and no field mapping in the manifest's HTTP declaration can walk
// it (§1.3 (c) of the design). A named transform is the honest
// middle: the manifest stays the one route (#7), and the one place
// code helps is named in it, where a person can see it.
//
// The registry is closed. A name exists only because a person added
// it here, in code review; the manifest parser refuses any other
// name and leaves the command out (connectorManifest.ts — fail
// -closed, as with verify / quota / undo), and a G4 draft may not
// name one at all (connectorDraft.ts refuses), so a drafted manifest
// can never invent a code reference. Transforms are first-party
// equipment.
//
// A manifest command may likewise name ONE body builder (an HTTP
// mapping's bodyFrom): a server-side pure function that assembles
// the request body from the call's input, in place of the mapping's
// field list — for bodies that are computed documents no field list
// can express (an RFC 822 message, base64url'd). The same closed
// registry, the same fail-closed parse, the same draft ban. A
// builder receives the call's input exactly as the approval bound
// it and returns the body value; it runs once, on the live path in
// executeIntegrationTool, at the point a declared command becomes a
// request — never for a replayed call (a fixture already holds the
// request's outcome), and it never does I/O: anything a builder
// needs (a replied-to message's headers, say) arrives as an input
// the caller read first.
//
// A transform receives the call's result text exactly as the
// transport shaped it (an HTTP answer carries its `HTTP <status>`
// first line; the text is already capped by the transport) and
// returns the text that stands in its place. It is applied once, on
// the live path in executeIntegrationTool (integrationTools.ts),
// after the transport and before any verify read-back — so the
// read-back, the call log and the model all work from the shaped
// text — and never to an error answer: an error is feedback, not
// data. A replayed call (B14) never reaches the shaping point, and
// must not: a fixture holds the shaped string the source run saw,
// so shaping is a live-path act, exactly once. A text that is not
// the transform's resource passes through unchanged — shaping is an
// offer about a known shape, not a gate on the answer.

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");

// ── gmail_message ────────────────────────────────────────────────────────

/** The shaped body's own cap, in the transport's truncation style: a
 *  shaped answer is headers plus a plain-text body, and the body is
 *  the only part that can grow without bound. */
export const GMAIL_MESSAGE_BODY_MAX = 10_000;

interface GmailPart {
  mimeType: string;
  filename: string;
  headers: { name: string; value: string }[];
  bodyData: string | null;
  attachmentId: string | null;
  parts: GmailPart[];
}

/** Pure. A Gmail message part (or the payload itself) read tolerantly:
 *  the fields the shaping reads, nothing else carried. */
function partOf(raw: unknown): GmailPart | null {
  const x = obj(raw);
  if (!x) return null;
  const body = obj(x.body);
  return {
    mimeType: str(x.mimeType).split(";")[0].trim().toLowerCase(),
    filename: str(x.filename),
    headers: (Array.isArray(x.headers) ? x.headers : []).flatMap((h) => {
      const y = obj(h);
      return y && typeof y.name === "string" && typeof y.value === "string" ? [{ name: y.name, value: y.value }] : [];
    }),
    bodyData: typeof body?.data === "string" && body.data ? body.data : null,
    attachmentId: typeof body?.attachmentId === "string" && body.attachmentId ? body.attachmentId : null,
    parts: (Array.isArray(x.parts) ? x.parts : []).map(partOf).filter((p): p is GmailPart => p !== null),
  };
}

/** Pure. A part tree's leaves (the parts that hold content), in
 *  document order: a container is walked, never itself a leaf. */
function leavesOf(part: GmailPart, out: GmailPart[]): void {
  if (part.parts.length) {
    for (const p of part.parts) leavesOf(p, out);
    return;
  }
  out.push(part);
}

/** Pure. The attachments in a part tree: a part carrying both an
 *  attachment id and a file name (the API's own marks of one). */
function countAttachments(part: GmailPart): number {
  let n = part.attachmentId && part.filename ? 1 : 0;
  for (const p of part.parts) n += countAttachments(p);
  return n;
}

/** Pure. Base64url → UTF-8 text; an undecodable value is no body. */
function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let bin: string;
  try { bin = atob(padded); } catch { return ""; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Pure. One RFC 2047 encoded word decoded, or null when it cannot be
 *  (an unknown charset, a bad payload): the caller keeps the word as
 *  written rather than inventing a reading of it. */
function decodeEncodedWord(charset: string, encoding: string, text: string): string | null {
  try {
    let bytes: Uint8Array;
    if (encoding.toUpperCase() === "B") {
      const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
      const bin = atob(padded);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      const arr: number[] = [];
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "_") arr.push(0x20);
        else if (c === "=") {
          const v = parseInt(text.slice(i + 1, i + 3), 16);
          if (Number.isNaN(v)) return null;
          arr.push(v);
          i += 2;
        } else arr.push(c.charCodeAt(0));
      }
      bytes = new Uint8Array(arr);
    }
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch { return null; }
}

/**
 * Pure. A header value with its RFC 2047 encoded words decoded — a
 * Japanese subject arrives as `=?UTF-8?B?…?=` and is not readable
 * until it is read. Words separated only by whitespace are one
 * logical string: the whitespace between them is not content
 * (RFC 2047 §6.2), so it is dropped before decoding.
 */
export function decodeHeaderValue(value: string): string {
  const joined = value.replace(/(\?=)[ \t]+(=\?)/g, "$1$2");
  return joined.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (whole, charset: string, enc: string, text: string) =>
    decodeEncodedWord(charset, enc, text) ?? whole);
}

/** Pure. An HTML body as plain text, best-effort and self-contained:
 *  script and style dropped whole, line and block breaks become
 *  newlines, the remaining tags go, entities are read (&amp; last,
 *  so a doubly-encoded one is decoded exactly once). */
export function htmlToPlainText(html: string): string {
  const decoded = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|table|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => {
      const cp = parseInt(h, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&#(\d+);/g, (m, d: string) => {
      const cp = parseInt(d, 10);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
  return decoded
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pure. A Gmail message resource (the answer to GET messages/{id})
 * as the flat record a reader works from — the shape Sim's gmail_read
 * v2 outputs declare, plus the two threading headers a reply is built
 * from (the prototype design §3.3 / §4.2): the message's id and
 * thread, its labels, the From / To / Subject / Date headers with
 * encoded words decoded, the plain-text body (a text/plain part
 * anywhere in the MIME tree wins; an HTML-only message is read as
 * text; the body is capped), and the attachment count — never the
 * attachments themselves. The Message-ID header rides as
 * `messageIdHeader`, apart from the resource's own `id`.
 *
 * The input is a call's result text: an HTTP answer's `HTTP <status>`
 * line is stepped over (draftTest.ts strips it the same way). A text
 * that is not a message resource — a list answer, an error body, a
 * truncated one — is returned unchanged.
 */
export function gmailMessage(text: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(text.replace(/^HTTP \d{3}\n/, "")); } catch { return text; }
  const msg = obj(parsed);
  const payload = msg ? partOf(msg.payload) : null;
  if (!msg || !payload) return text;
  const header = (name: string): string => {
    const hit = payload.headers.find((h) => h.name.toLowerCase() === name);
    return hit ? decodeHeaderValue(hit.value) : "";
  };
  const leaves: GmailPart[] = [];
  leavesOf(payload, leaves);
  // A part carrying a file (a name, or an attachment id in place of
  // inline data) is an attachment, never the body.
  const bodyLeaves = leaves.filter((p) => !p.filename && !p.attachmentId && p.bodyData);
  const plain = bodyLeaves.find((p) => p.mimeType === "text/plain");
  const html = bodyLeaves.find((p) => p.mimeType === "text/html");
  let body = plain ? decodeBase64Url(plain.bodyData!) : html ? htmlToPlainText(decodeBase64Url(html.bodyData!)) : "";
  if (body.length > GMAIL_MESSAGE_BODY_MAX) {
    body = `${body.slice(0, GMAIL_MESSAGE_BODY_MAX)}\n…(${body.length - GMAIL_MESSAGE_BODY_MAX} chars truncated)`;
  }
  const attachments = countAttachments(payload);
  // labelIds are sorted: the API's own order is an accident of its
  // storage, and a shaped state a verify diff compares field-by-field
  // must read the same way every time (design §4.6).
  return JSON.stringify({
    id: str(msg.id),
    threadId: str(msg.threadId),
    labelIds: Array.isArray(msg.labelIds) ? msg.labelIds.filter((v): v is string => typeof v === "string").sort() : [],
    from: header("from"),
    to: header("to"),
    subject: header("subject"),
    date: header("date"),
    body,
    hasAttachments: attachments > 0,
    attachmentCount: attachments,
    messageIdHeader: header("message-id"),
    references: header("references"),
  });
}

// ── The registry ─────────────────────────────────────────────────────────

/** The named response transforms a manifest may reference. Closed:
 *  a name is added here, in code review, or not at all. */
export const RESPONSE_TRANSFORMS: Readonly<Record<string, (text: string) => string>> = {
  gmail_message: gmailMessage,
};

/** The registry's names. The manifest grammar spells the same list
 *  (connectorManifest.ts RESPONSE_TRANSFORM_NAMES — that module stays
 *  import-free for the web's type check) and the web twin keeps a
 *  third copy (draftModel.ts); manifestTransforms.test.ts pins all
 *  three equal. */
export const RESPONSE_TRANSFORM_NAMES: readonly string[] = Object.keys(RESPONSE_TRANSFORMS);

/** Pure. Whether the registry holds this name. */
export function isResponseTransform(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(RESPONSE_TRANSFORMS, name);
}

/**
 * Pure. A result text shaped by the named transform. An unknown name
 * returns the text unchanged — the parser refuses such a manifest
 * before it can run, so this is the second lock, not the first.
 */
export function applyResponseTransform(name: string, text: string): string {
  const fn = RESPONSE_TRANSFORMS[name];
  return fn ? fn(text) : text;
}

// ── gmail_mime ───────────────────────────────────────────────────────────

/** Pure. UTF-8 text → base64 (the binary-string route, as the decoder
 *  above reads it back). */
function base64OfText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Pure. UTF-8 text → base64url without padding: the alphabet a Gmail
 *  `raw` travels in. */
function base64UrlOfText(text: string): string {
  return base64OfText(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * Pure. One chunk of header text as RFC 2047 B-encoded words: the
 * text is split on character boundaries so no word's UTF-8 runs past
 * 45 bytes — 60 base64 chars, a 72-char word, inside the RFC's 75.
 * Words are space-joined, which a reader folds back into one string
 * (the whitespace between encoded words is not content, RFC 2047
 * §6.2 — the same rule decodeHeaderValue reads by).
 */
function encodedWords(text: string): string {
  const words: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const ch of text) {
    const n = new TextEncoder().encode(ch).length;
    if (chunk && bytes + n > 45) { words.push(chunk); chunk = ""; bytes = 0; }
    chunk += ch;
    bytes += n;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64OfText(w)}?=`).join(" ");
}

/** Pure. A header value as it may be sent: printable ASCII as-is,
 *  anything else as encoded words. */
function encodeHeaderText(value: string): string {
  return PRINTABLE_ASCII.test(value) ? value : encodedWords(value);
}

/** Pure. A header value with CR / LF removed: a header is one line,
 *  and a value carrying a line break would be a second header the
 *  caller never declared (header injection). Runs collapse to one
 *  space, so words stay words. */
function cleanHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Pure. An address list split on its top-level commas — a comma
 *  inside a quoted display name or an address's angle brackets does
 *  not separate. */
function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of value) {
    if (quoted) { cur += ch; if (ch === '"') quoted = false; continue; }
    if (ch === '"') { quoted = true; cur += ch; continue; }
    if (ch === "<") depth++;
    else if (ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Pure. An address header (To / Cc / Bcc) as it may be sent: each
 * address as-is when it is printable ASCII; a non-ASCII display name
 * is encoded as words while its `<address>` stays plain — the form
 * mail readers expect — and a bare non-ASCII value is encoded whole.
 */
function encodeAddressHeader(value: string): string {
  return splitAddresses(value).map((part) => {
    if (PRINTABLE_ASCII.test(part)) return part;
    const m = part.match(/^(.*)<([^<>]*)>$/);
    if (m) {
      const name = m[1].trim();
      return `${name ? `${encodeHeaderText(name)} ` : ""}<${m[2].trim()}>`;
    }
    return encodeHeaderText(part);
  }).join(", ");
}

/** Pure. A message body as base64 content-transfer-encoding: the
 *  body's UTF-8, wrapped at 76 chars a line (RFC 2045 §6.8). */
function base64Body(text: string): string {
  return (base64OfText(text).match(/.{1,76}/g) ?? []).join("\r\n");
}

/**
 * Pure. The gmail_send body: an RFC 822 message assembled from the
 * send command's inputs, base64url'd into the `raw` the Gmail API's
 * messages.send takes, with the input's threadId riding beside it
 * when one was given (design §4.1 / §4.2 — the translation of Sim's
 * gmail_send v2 operation into the API's direct form).
 *
 * The inputs are the command's declared ones: to / cc / bcc /
 * subject / body / contentType ("html" sends text/html; anything
 * else, text/plain), and the threading inputs a reply carries —
 * threadId, and the replied-to message's Message-ID and References
 * headers (messageIdHeader / references, read from gmail_read's
 * shaped answer). Threading headers are inputs, never fetched: the
 * builder is pure. replyToMessageId (the Gmail id of the message
 * being answered) is a declared input the approval card shows, but
 * it is not a header — the API threads by threadId and the headers
 * above, so the builder does not use it. Header values are cleaned
 * of line breaks before anything is encoded, and non-ASCII subjects
 * and display names are RFC 2047 encoded. The body travels as
 * base64, so its own line breaks are content, untouched.
 */
export function gmailMimeBody(input: Record<string, unknown>): Record<string, unknown> {
  const field = (name: string) => (typeof input[name] === "string" ? input[name] as string : "");
  const headers: string[] = [];
  const to = cleanHeaderValue(field("to"));
  const cc = cleanHeaderValue(field("cc"));
  const bcc = cleanHeaderValue(field("bcc"));
  const subject = cleanHeaderValue(field("subject"));
  if (to) headers.push(`To: ${encodeAddressHeader(to)}`);
  if (cc) headers.push(`Cc: ${encodeAddressHeader(cc)}`);
  if (bcc) headers.push(`Bcc: ${encodeAddressHeader(bcc)}`);
  if (subject) headers.push(`Subject: ${encodeHeaderText(subject)}`);
  const messageId = cleanHeaderValue(field("messageIdHeader"));
  const references = cleanHeaderValue(field("references"));
  if (messageId) {
    headers.push(`In-Reply-To: ${messageId}`);
    headers.push(`References: ${references ? `${references} ${messageId}` : messageId}`);
  }
  headers.push("MIME-Version: 1.0");
  const html = field("contentType").trim().toLowerCase() === "html";
  headers.push(`Content-Type: ${html ? "text/html" : "text/plain"}; charset="UTF-8"`);
  headers.push("Content-Transfer-Encoding: base64");
  const message = `${headers.join("\r\n")}\r\n\r\n${base64Body(field("body"))}`;
  const out: Record<string, unknown> = { raw: base64UrlOfText(message) };
  const threadId = field("threadId").trim();
  if (threadId) out.threadId = threadId;
  return out;
}

// ── The body-builder registry ────────────────────────────────────────────

/** The named body builders a manifest may reference. Closed, like
 *  the transforms above: a name is added here, in code review, or
 *  not at all. */
export const BODY_BUILDERS: Readonly<Record<string, (input: Record<string, unknown>) => Record<string, unknown>>> = {
  gmail_mime: gmailMimeBody,
};

/** The registry's names. The manifest grammar spells the same list
 *  (connectorManifest.ts BODY_BUILDER_NAMES) and the web twin keeps
 *  a third copy (draftModel.ts); manifestTransforms.test.ts pins
 *  all three equal. */
export const BODY_BUILDER_NAMES: readonly string[] = Object.keys(BODY_BUILDERS);

/** Pure. Whether the registry holds this name. */
export function isBodyBuilder(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BODY_BUILDERS, name);
}

/**
 * Pure. A request body built by the named builder, or null for an
 * unknown name — the parser refuses such a manifest before it can
 * run, so this is the second lock, not the first: the executor
 * keeps the field-list body it already had, which for a builder
 * command is an empty body the service itself refuses, never a
 * silently different one.
 */
export function applyBodyBuilder(name: string, input: Record<string, unknown>): Record<string, unknown> | null {
  const fn = BODY_BUILDERS[name];
  return fn ? fn(input) : null;
}
