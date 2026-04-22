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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-card border border-border shadow-2xl flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
            Ticket
          </div>
          <div className="text-[16px] font-semibold text-foreground tracking-[-0.3px] leading-snug">
            {ticket.title}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              Summary
            </div>
            <p className="text-[13px] leading-[1.65] text-foreground/90 whitespace-pre-wrap">
              {ticket.summary || <span className="text-muted-foreground/60">No summary</span>}
            </p>
          </div>

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

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
