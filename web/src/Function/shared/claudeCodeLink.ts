// Starting a Claude Code session on an Element or an Object. A web page
// cannot open a terminal, but the Claude desktop app answers
// `claude://code/new?q=…` with a new Claude Code session holding that prompt
// (the browser asks first). The prompt says what to work on, in the shape
// Linear's "Work on issue" uses.

/** What the prompt is about. */
export interface ClaudeCodeSubject {
  kind: 'Element' | 'Object';
  /** The display id people use (ELE-12, OBJ_PH1); the title stands alone without one. */
  identifier?: string | null;
  title: string;
  /** Rich text or plain; tags are dropped. */
  description?: string | null;
  /** Where it sits, outermost first — Domain, Object. */
  path?: string[];
}

const MAX_DESCRIPTION = 1500;

/** Pure. Text of an HTML fragment, whitespace collapsed. */
function plainText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Pure. The prompt a Claude Code session starts with. */
export function claudeCodePrompt(s: ClaudeCodeSubject): string {
  const tag = s.kind.toLowerCase();
  const head = s.identifier ? `Work on Alcon ${s.kind} ${s.identifier}:` : `Work on Alcon ${s.kind} "${s.title}":`;
  let description = s.description ? plainText(s.description) : '';
  if (description.length > MAX_DESCRIPTION) description = `${description.slice(0, MAX_DESCRIPTION)}…`;
  const lines = [
    head,
    '',
    `<${tag}${s.identifier ? ` identifier="${s.identifier}"` : ''}>`,
    `<title>${s.title}</title>`,
    ...(s.path?.length ? [`<location>${s.path.join(' > ')}</location>`] : []),
    ...(description ? [`<description>\n${description}\n</description>`] : []),
    `</${tag}>`,
  ];
  return lines.join('\n');
}

/** Pure. The link that opens a Claude Code session with `prompt`. */
export function claudeCodeUrl(prompt: string): string {
  return `claude://code/new?q=${encodeURIComponent(prompt)}`;
}
