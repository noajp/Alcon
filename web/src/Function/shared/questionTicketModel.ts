import type { QuestionTicket } from '@/types/database';

// A question ticket's display shape (B12), read defensively from the
// row the engine wrote: options and context are jsonb, and a reader
// never trusts a shape it did not check — the same parsers the
// server keeps in _shared/questionTickets.ts, in the web's twin.
// The card answers through the engine (agentData.answerQuestionTicket);
// this file only reads.

export interface TicketOptionView { label: string; recommended: boolean }
export interface TicketLinkView { label: string; url: string | null }

export interface QuestionTicketView {
  question: string;
  /** What decision turns on the answer, when the agent said. */
  decision: string | null;
  links: TicketLinkView[];
  /** The topic this answer will be kept under for later runs, when the
   *  agent declared one — the person may hold the answer to this run. */
  standingTopic: string | null;
  options: TicketOptionView[];
  /** What the agent tried before asking — part of judging the ask. */
  tried: string;
  status: QuestionTicket['status'];
  /** The person's answer, verbatim, once given. */
  answer: string | null;
  expiresAt: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Pure. The ticket's options as the card's tappable answers. */
function ticketOptionsOf(raw: unknown): TicketOptionView[] {
  if (!Array.isArray(raw)) return [];
  const out: TicketOptionView[] = [];
  for (const o of raw) {
    if (typeof o === 'string' && o.trim()) { out.push({ label: o.trim(), recommended: false }); continue; }
    if (o && typeof o === 'object') {
      const label = text((o as { label?: unknown }).label).trim();
      if (label) out.push({ label, recommended: (o as { recommended?: unknown }).recommended === true });
    }
  }
  return out;
}

/** Pure. The ticket's context: the decision line and its links. */
function ticketContextOf(raw: unknown): { decision: string | null; links: TicketLinkView[]; standingTopic: string | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { decision: null, links: [], standingTopic: null };
  const c = raw as { decision?: unknown; links?: unknown; standing_topic?: unknown };
  const decision = text(c.decision).trim() || null;
  const standingTopic = text(c.standing_topic).trim() || null;
  const links: TicketLinkView[] = [];
  if (Array.isArray(c.links)) {
    for (const l of c.links) {
      if (!l || typeof l !== 'object') continue;
      const label = text((l as { label?: unknown }).label).trim();
      if (!label) continue;
      links.push({ label, url: text((l as { url?: unknown }).url).trim() || null });
    }
  }
  return { decision, links, standingTopic };
}

/** Pure. A ticket row as the Inbox card shows it. */
export function questionTicketView(ticket: QuestionTicket): QuestionTicketView {
  const { decision, links, standingTopic } = ticketContextOf(ticket.context);
  return {
    question: ticket.question,
    decision,
    links,
    standingTopic,
    options: ticketOptionsOf(ticket.options),
    tried: ticket.tried,
    status: ticket.status,
    answer: ticket.answer,
    expiresAt: ticket.expires_at,
  };
}
