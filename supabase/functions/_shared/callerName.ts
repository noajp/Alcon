// The name a caller goes by in the Activity record ("Claude Code", "n8n").
// It comes from the caller (a URL parameter, a header, a token's name), so it
// is reduced before it is written anywhere.

const NAME_UNSAFE = /[^\p{L}\p{N} ._-]/gu;

/** Pure. A caller-supplied name, reduced to letters, digits, space and ._- and at most 40 characters. */
export function sanitizeName(raw: string | null | undefined): string {
  return (raw ?? "").replace(NAME_UNSAFE, "").trim().slice(0, 40).trim();
}
