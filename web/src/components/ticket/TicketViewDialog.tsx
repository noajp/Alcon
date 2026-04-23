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
        <div className="px-5 pt-5 pb-3 border-b border-border flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Commit
          </div>
          <div className="text-[11px] text-muted-foreground">
            <button
              type="button"
              onClick={onOpenSource}
              className="text-foreground/80 hover:text-foreground underline-offset-2 hover:underline"
            >
              {ticket.sourceFileName}
            </button>
            <span className="opacity-40 mx-2">·</span>
            <span>{formatAbsolute(ticket.createdAt)}</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-8 pt-6 pb-8">
          <h2 className="text-[22px] font-semibold text-foreground tracking-[-0.4px] leading-[1.2]">
            {ticket.title}
          </h2>

          {hasStructured ? (
            <>
              {s!.overview && (
                <p className="mt-3 text-[13px] leading-[1.7] text-foreground/80 whitespace-pre-wrap">
                  {s!.overview}
                </p>
              )}

              {s!.decisions.length > 0 && (
                <Section label="Key Decisions">
                  <ul className="space-y-2">
                    {s!.decisions.map((d, i) => (
                      <BulletItem key={i} title={d.title} detail={d.detail} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.action_items.length > 0 && (
                <Section label="Action Items">
                  <ul className="space-y-1.5">
                    {s!.action_items.map((a, i) => (
                      <ActionItem key={i} title={a.title} owner={a.owner} due={a.due} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.questions.length > 0 && (
                <Section label="Open Questions">
                  <ul className="space-y-1.5">
                    {s!.questions.map((q, i) => (
                      <QuestionItem key={i} title={q.title} detail={q.detail} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.participants.length > 0 && (
                <Section label="Participants">
                  <ul className="flex flex-wrap gap-1.5">
                    {s!.participants.map((p, i) => (
                      <ParticipantChip key={i} name={p.name} role={p.role} />
                    ))}
                  </ul>
                </Section>
              )}
            </>
          ) : (
            <p className="mt-3 text-[13px] leading-[1.7] text-foreground/80 whitespace-pre-wrap">
              {ticket.summary || <span className="text-muted-foreground/60">No summary</span>}
            </p>
          )}
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
          ) : (
            <span />
          )}
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 pt-5 border-t border-border/60">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 mb-2.5">
        {label}
      </div>
      {children}
    </section>
  );
}

function BulletItem({ title, detail }: { title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[7px] w-[5px] h-[5px] shrink-0 rounded-full bg-foreground/50" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
    </li>
  );
}

function ActionItem({
  title,
  owner,
  due,
}: {
  title: string;
  owner?: string;
  due?: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[3px] w-[14px] h-[14px] shrink-0 border border-foreground/40" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {(owner || due) && (
          <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-2">
            {owner && <span>@{owner}</span>}
            {due && <span>⏰ {due}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function QuestionItem({ title, detail }: { title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="text-[13px] leading-[1.55] text-foreground/50 shrink-0">?</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] italic text-foreground/85 leading-[1.55] break-words">
          {title}
        </div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
    </li>
  );
}

function ParticipantChip({ name, role }: { name: string; role?: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 text-[12px] bg-accent/60 px-2 py-1">
      <span className="text-foreground/90">{name}</span>
      {role && <span className="text-muted-foreground/80">· {role}</span>}
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
