'use client';

// The CRM's AI runs through alcon-copilot in its tool-free JSON mode, under
// the caller's own session. Pasted customer text is untrusted: it is sent only
// after the server confirms that mode exists, so nothing in an email can make
// the model touch the board. Every answer is a proposal the person applies.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { extractJson, captureInstruction, parseAiCapture, type CaptureProposal } from './crmCapture';
import type { CrmDeal, CrmStage } from './crmModel';

async function request(body: object, signal?: AbortSignal): Promise<Response> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!base) throw new Error('AI is not configured for this workspace.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sign in to use AI.');
  return fetch(`${base.replace(/\/$/, '')}/functions/v1/alcon-copilot`, {
    method: 'POST', signal,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      'Content-Type': 'application/json', Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

let probe: Promise<boolean> | null = null;
/** Whether the deployed function offers the tool-free mode. The probe runs no
 * model; an older deployment rejects it, and AI stays off until it is updated. */
function jsonModeAvailable(): Promise<boolean> {
  probe ??= request({ mode: 'probe', messages: [] })
    .then(async response => response.ok && ((await response.json()) as { modes?: string[] }).modes?.includes('json') === true)
    .catch(() => false)
    .then(ok => { if (!ok) probe = null; return ok; });
  return probe;
}

export type AiState = 'checking' | 'ready' | 'unavailable';
export function useCrmAi(): AiState {
  const [state, setState] = useState<AiState>('checking');
  useEffect(() => {
    let live = true;
    void jsonModeAvailable().then(ok => { if (live) setState(ok ? 'ready' : 'unavailable'); });
    return () => { live = false; };
  }, []);
  return state;
}

async function askCopilot(prompt: string, signal?: AbortSignal): Promise<string> {
  if (!(await jsonModeAvailable())) throw new Error('AI needs the updated alcon-copilot function. The quick reading still works.');
  const response = await request({ mode: 'json', messages: [{ role: 'user', content: prompt }], context: { viewLabel: 'CRM' } }, signal);
  if (!response.ok || !response.body) throw new Error((await response.text().catch(() => '')) || `AI request failed (${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.+)$/m.exec(raw)?.[1];
      const data = /^data: (.+)$/m.exec(raw)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data) as { delta?: string; error?: string };
      // Defence in depth: this request offers no tools, so a tool call means
      // the server is not honouring the mode. Stop reading and refuse the answer.
      if (event === 'tool_use') { await reader.cancel(); throw new Error('AI tried to use a tool; the answer was discarded.'); }
      if (event === 'text' && payload.delta) reply += payload.delta;
      if (event === 'error') throw new Error(payload.error ?? 'AI request failed.');
    }
  }
  return reply;
}

export async function aiCapture(input: string, today: string, deals: readonly CrmDeal[], stages: readonly CrmStage[], signal?: AbortSignal): Promise<CaptureProposal> {
  const reply = await askCopilot(captureInstruction(input, today, deals, stages), signal);
  const proposal = parseAiCapture(reply, input, deals, stages);
  if (!proposal) throw new Error('The AI reply could not be read. The local reading is shown instead.');
  return proposal;
}

function dealContext(deal: CrmDeal, today: string): string {
  return [
    `Today: ${today}`,
    `Deal: ${deal.name}`, `Account: ${deal.account ?? '-'}`, `Contact: ${deal.contact ?? '-'} ${deal.email ? `<${deal.email}>` : ''}`,
    `Stage: ${deal.stage?.label ?? '-'}`, `Amount: ${deal.amount ?? '-'} ${deal.currency ?? ''}`, `Probability: ${deal.probability ?? '-'}%`,
    `Close date: ${deal.closeDate ?? '-'}`, `Last contact: ${deal.lastContact ?? '-'}`,
    `Next action: ${deal.nextActionDate ?? '-'} ${deal.nextStep ?? ''}`,
    `Health: ${deal.health.score ?? '-'} (${deal.health.level})`,
    'Activity (newest first):', ...(deal.activity.length ? deal.activity.slice(0, 25).map(entry => `- ${entry.date ?? ''} ${entry.type}: ${entry.text}`) : ['- none recorded']),
  ].join('\n');
}

export interface DealBrief { summary: string; risks: string[]; nextStep: string; questions: string[] }

export async function aiBrief(deal: CrmDeal, today: string, language: string, signal?: AbortSignal): Promise<DealBrief> {
  const reply = await askCopilot([
    'You are a sales coach. Do not call any tools. Reply with one JSON object and nothing else.',
    `Write in the language with code "${language}".`,
    'Schema: {"summary": "2-3 sentences: where the deal stands and why", "risks": ["specific risk", ...max 3],',
    ' "nextStep": "the single most valuable next action, imperative", "questions": ["question to ask the buyer", ...max 3]}',
    'Ground every statement in the record below; when information is missing, say what to find out instead of guessing.',
    dealContext(deal, today),
  ].join('\n'), signal);
  const json = extractJson(reply);
  const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 3) : [];
  if (!json || typeof json.summary !== 'string') throw new Error('The AI reply could not be read. Try again.');
  return { summary: json.summary, risks: list(json.risks), nextStep: typeof json.nextStep === 'string' ? json.nextStep : '', questions: list(json.questions) };
}

export interface DealEmail { subject: string; body: string }

export async function aiEmail(deal: CrmDeal, today: string, language: string, intent: string, signal?: AbortSignal): Promise<DealEmail> {
  const reply = await askCopilot([
    'You draft sales follow-up emails. Do not call any tools. Reply with one JSON object and nothing else.',
    `Write in the language with code "${language}" unless the activity shows the buyer uses another language.`,
    'Schema: {"subject": string, "body": string}. Plain text body, under 150 words, warm and specific, one clear ask with a proposed date.',
    'Use only facts from the record; leave a [placeholder] for anything you would need to invent. Sign off without a name.',
    intent.trim() ? `Seller's intent: ${intent.trim().slice(0, 500)}` : 'Intent: move the deal to its next step.',
    dealContext(deal, today),
  ].join('\n'), signal);
  const json = extractJson(reply);
  if (!json || typeof json.subject !== 'string' || typeof json.body !== 'string') throw new Error('The AI reply could not be read. Try again.');
  return { subject: json.subject, body: json.body };
}
