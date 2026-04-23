'use client';

import { useEffect } from 'react';
import type { Ticket } from './types';

interface TicketViewDialogProps {
  ticket: Ticket;
  onClose: () => void;
  onOpenSource?: () => void;
  onDelete?: () => void;
}

export function TicketViewDialog({ ticket, onClose, onOpenSource, onDelete }: TicketViewDialogProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const s = ticket.structured;
  const hasStructured =
    !!s &&
    (s.overview ||
      s.decisions.length ||
      s.action_items.length ||
      s.questions.length ||
      s.participants.length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] bg-card border border-border shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Commit
          </div>
          <div className="text-[18px] font-semibold text-foreground tracking-[-0.3px] leading-snug">
            {ticket.title}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {hasStructured ? (
            <>
              {s!.overview && (
                <Section label="Overview">
                  <p className="text-[13px] leading-[1.65] text-foreground/90 whitespace-pre-wrap">
                    {s!.overview}
                  </p>
                </Section>
              )}

              {s!.decisions.length > 0 && (
                <Section label="Decisions" count={s!.decisions.length}>
                  <ul className="space-y-1.5">
                    {s!.decisions.map((d, i) => (
                      <ItemRow key={i} title={d.title} detail={d.detail} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.action_items.length > 0 && (
                <Section label="Action Items" count={s!.action_items.length}>
                  <ul className="space-y-1.5">
                    {s!.action_items.map((a, i) => (
                      <ItemRow
                        key={i}
                        title={a.title}
                        meta={[a.owner, a.due].filter(Boolean).join(' · ')}
                      />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.questions.length > 0 && (
                <Section label="Open Questions" count={s!.questions.length}>
                  <ul className="space-y-1.5">
                    {s!.questions.map((q, i) => (
                      <ItemRow key={i} title={q.title} detail={q.detail} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.participants.length > 0 && (
                <Section label="Participants" count={s!.participants.length}>
                  <ul className="space-y-1.5">
                    {s!.participants.map((p, i) => (
                      <ItemRow key={i} title={p.name} meta={p.role} />
                    ))}
                  </ul>
                </Section>
              )}
            </>
          ) : (
            <Section label="Summary">
              <p className="text-[13px] leading-[1.65] text-foreground/90 whitespace-pre-wrap">
                {ticket.summary || <span className="text-muted-foreground/60">No summary</span>}
              </p>
            </Section>
          )}

          <div className="flex items-center gap-3 text-[11px] text-muted-foreground border-t border-border pt-3">
            <span>
              Source:{' '}
              <button
                type="button"
                onClick={onOpenSource}
                className="text-foreground/80 hover:text-foreground underline-offset-2 hover:underline"
              >
                {ticket.sourceFileName}
              </button>
            </span>
            <span className="opacity-40">·</span>
            <span>{ticket.createdBy}</span>
            <span className="opacity-40">·</span>
            <span>{formatAbsolute(ticket.createdAt)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="text-[12px] px-2 py-1.5 text-muted-foreground hover:text-destructive"
            >
              Delete
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-medium px-3 py-1.5 bg-foreground text-background"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {typeof count === 'number' && (
          <span className="text-[11px] text-muted-foreground/60 tabular-nums">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function ItemRow({
  title,
  detail,
  meta,
}: {
  title: string;
  detail?: string;
  meta?: string;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 w-[6px] h-[6px] shrink-0 rounded-full bg-foreground/40" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.5] break-words">{title}</div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.5] break-words">
            {detail}
          </div>
        )}
        {meta && (
          <div className="text-[11px] text-muted-foreground/70 mt-0.5 tabular-nums">{meta}</div>
        )}
      </div>
    </li>
  );
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
