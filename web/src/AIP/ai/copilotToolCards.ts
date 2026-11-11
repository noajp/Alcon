import type { ToolEvent } from './useAlconCopilot';
import { toolVerb } from './copilotFiles';

// Pure. A panel tool event as a tool call card reads it: the tool's name,
// a short summary, its status, its arguments and what came back. The chat
// driver records Anthropic's server-side steps (web search, page fetch, the
// filtering code, tool search) under their display line ("Web 検索: …"),
// so those lines are read back into the tool they came from.

export type ToolCardKind = 'web' | 'fetch' | 'code' | 'search' | 'read' | 'create' | 'update' | 'delete';

export interface ToolCardModel {
  name: string;
  /** The summary: a translatable verb, and the call's subject when it has one. */
  verb: string | null;
  subject: string | null;
  kind: ToolCardKind;
  status: 'running' | 'success' | 'error';
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

const SERVER_STEPS: { prefix: string; name: string; kind: ToolCardKind; verb: string }[] = [
  { prefix: 'Web 検索', name: 'web_search', kind: 'web', verb: 'Searched the web' },
  { prefix: 'Web ページ', name: 'web_fetch', kind: 'fetch', verb: 'Read a web page' },
  { prefix: '検索結果を絞り込み', name: 'code_execution', kind: 'code', verb: 'Filtered the search results' },
  { prefix: '道具を探す', name: 'tool_search', kind: 'search', verb: 'Looked for a tool' },
];

/** The input fields that name what a call is about, in the order tried. */
const SUBJECT_KEYS = ['title', 'name', 'query', 'q', 'url', 'path', 'search', 'text', 'id', 'elementId', 'strategyId'];

function subjectOf(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  for (const key of SUBJECT_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return null;
}

export function toolCardOf(event: ToolEvent): ToolCardModel {
  const r = event.result;
  const status = !r ? 'running' : r.ok ? 'success' : 'error';
  const result = r?.ok && r.rows != null ? { rows: r.rows } : undefined;
  const error = r && !r.ok ? r.error : undefined;

  const server = SERVER_STEPS.find((s) => event.name.startsWith(s.prefix));
  if (server) {
    const rest = event.name.slice(server.prefix.length).replace(/^[:：]\s*/, '').trim();
    return {
      name: server.name, verb: server.verb, subject: rest || null, kind: server.kind, status, result, error,
      ...(rest ? { args: server.kind === 'fetch' ? { url: rest } : { query: rest } } : {}),
    };
  }

  const verb = toolVerb(event.name, event.input);
  const kind: ToolCardKind = verb === 'Creating' ? 'create' : verb === 'Updating' ? 'update' : verb === 'Deleting' ? 'delete' : 'read';
  return {
    name: event.name, verb, subject: subjectOf(event.input), kind, status, result, error,
    ...(event.input && Object.keys(event.input).length ? { args: event.input } : {}),
  };
}
