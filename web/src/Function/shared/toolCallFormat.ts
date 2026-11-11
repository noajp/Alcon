// Pure. What a tool call card prints: its duration, its arguments or result
// as text, and the JSON tokens the card colors.

/** 0.4s, 12.3s, 2m 05s, 3h 12m, 2d 4h. A live timer always shows tenths
 *  below a minute; a settled one under a second shows ms. */
export function formatToolDuration(ms: number, live: boolean): string {
  if (!live && ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** A value as the card shows it: objects pretty-printed, JSON strings parsed
 *  and pretty-printed, any other text as it is. */
export function toolCallText(value: unknown): { text: string; json: boolean } {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return { text: JSON.stringify(JSON.parse(trimmed), null, 2), json: true }; } catch { /* plain text */ }
    }
    return { text: value, json: false };
  }
  try {
    const s = JSON.stringify(value, null, 2);
    return s === undefined ? { text: String(value), json: false } : { text: s, json: true };
  } catch {
    return { text: String(value), json: false };
  }
}

export type JsonToken = { kind: 'plain' | 'key' | 'str' | 'num' | 'lit'; text: string };

// Strings (keys when a colon follows), literals and numbers; the rest is punctuation.
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Pretty-printed JSON as colored tokens; joined back, the text is unchanged. */
export function highlightTokens(text: string): JsonToken[] {
  const out: JsonToken[] = [];
  const re = new RegExp(TOKEN.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: 'plain', text: text.slice(last, m.index) });
    if (m[1] && m[2]) {
      out.push({ kind: 'key', text: m[1] }, { kind: 'plain', text: m[2] });
    } else {
      out.push({ kind: m[1] ? 'str' : /^[tfn]/.test(m[0]) ? 'lit' : 'num', text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'plain', text: text.slice(last) });
  return out;
}
