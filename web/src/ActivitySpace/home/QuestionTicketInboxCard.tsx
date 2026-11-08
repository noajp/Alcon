'use client';

import { useState } from 'react';
import { ExternalLink } from '@/ui/icons';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { answerQuestionTicket, fetchQuestionTicketById, useQuestionTicket } from '@/AIP/ai/agentData';
import { questionTicketView } from '@/Function/shared/questionTicketModel';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';

// A run's question, answered where the notification landed: the
// Inbox (B12). The question leads; what decision turns on it and
// the material the agent pointed at follow; the options are the
// answer — one tap each — and free text is the exception path
// below them. The answer travels the engine's answer entry as the
// person's own words (their pick's label, or their text verbatim);
// the agent never phrases it. Only the run's starter may answer —
// the engine refuses anyone else, and the card says so instead of
// offering buttons it would refuse.
export function QuestionTicketInboxCard({ ticketId }: { ticketId: string }) {
  const { t, locale } = useI18n();
  const { ticket, canAnswer, loading, error, refresh } = useQuestionTicket(ticketId);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [freeText, setFreeText] = useState('');

  if (error) return <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not read the question.')}</p>;
  if (loading && !ticket) return <p className={`${FONT.sm} text-muted-foreground`}>{t('Opening…')}</p>;
  if (!ticket) return <p className={`${FONT.sm} text-muted-foreground`}>{t('This question is no longer available.')}</p>;

  const view = questionTicketView(ticket);
  const when = (iso: string) => new Date(iso).toLocaleString(locale);
  const statusLine =
    view.status === 'open' ? t('Waiting for your answer until {time}', { time: when(view.expiresAt) })
    : view.status === 'answered' ? t('Answered — the work has resumed')
    : t('Expired without an answer — the work ended as blocked');
  const statusTone = view.status === 'open' ? 'text-[var(--status-info)]'
    : view.status === 'answered' ? 'text-[var(--status-success)]'
    : 'text-[var(--status-danger)]';

  const answer = async (choice: { option?: string; text?: string }) => {
    setFailed(false);
    setWorking(true);
    try {
      await answerQuestionTicket({ runId: ticket.run_id, ticketId: ticket.id, ...choice });
      // The resume marks the ticket answered as it takes the run up;
      // follow it briefly, then re-read the card at its rest.
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const now = await fetchQuestionTicketById(ticket.id).catch(() => null);
        if (!now || now.status !== 'open') break;
      }
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">{view.question}</h1>
      <p className={`mt-3 ${FONT.sm} ${statusTone}`}>{statusLine}</p>
      {view.decision && (
        <p className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{view.decision}</p>
      )}
      {view.links.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {view.links.map((l, i) => (
            <li key={i} className={FONT.sm}>
              {l.url ? (
                <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-default)] hover:underline">
                  {l.label}<ExternalLink size={12} />
                </a>
              ) : (
                <span className="text-foreground/80">{l.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6">
        <h2 className="text-[13px] font-medium text-foreground">{t('What the agent tried first')}</h2>
        <p className={`mt-1 whitespace-pre-wrap ${FONT.sm} text-muted-foreground`}>{view.tried}</p>
      </div>

      {view.status === 'answered' && view.answer && (
        <div className="mt-8">
          <h2 className="text-[13px] font-medium text-foreground">{t('Your answer')}</h2>
          <p className="mt-1 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{view.answer}</p>
        </div>
      )}

      {view.status === 'open' && !canAnswer && (
        <p className={`mt-8 ${FONT.sm} text-muted-foreground`}>
          {t('Only the person who started this run can answer it.')}
        </p>
      )}

      {view.status === 'open' && canAnswer && (
        <div className="mt-8 space-y-4">
          {view.options.length > 0 && (
            <div className="flex flex-col items-start gap-2">
              {view.options.map((o) => (
                <Button key={o.label} variant="secondary" disabled={working}
                  onClick={() => void answer({ option: o.label })} className="gap-2">
                  <span>{o.label}</span>
                  {o.recommended && <span className="text-[11px] text-muted-foreground">{t('Recommended')}</span>}
                </Button>
              ))}
            </div>
          )}
          <div>
            <label htmlFor={`question-free-${ticket.id}`} className={`${FONT.sm} text-muted-foreground`}>
              {t(view.options.length ? 'Or answer in your own words' : 'Answer in your own words')}
            </label>
            <Textarea id={`question-free-${ticket.id}`} value={freeText} rows={3} disabled={working}
              onChange={(e) => setFreeText(e.target.value)} className="mt-1.5" />
            <div className="mt-2">
              <Button disabled={working || !freeText.trim()} onClick={() => void answer({ text: freeText })}>
                {t('Send answer')}
              </Button>
            </div>
          </div>
          {failed && <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not send the answer. Try again.')}</p>}
        </div>
      )}
    </div>
  );
}
