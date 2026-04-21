'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Ticket as TicketType, TicketActivity, TicketColor } from './types';
import { TICKET_COLORS } from './types';
import { BlockEditor } from '@/components/editor/BlockEditor';

interface TicketDetailViewProps {
  ticket: TicketType;
  onClose: () => void;
  onUpdate: (patch: Partial<TicketType>) => void;
  onAddActivity: (activity: Omit<TicketActivity, 'id' | 'createdAt'>) => void;
}

// Caller should mount this with key={ticket.id} so drafts reset on ticket change.
export function TicketDetailView({ ticket, onClose, onUpdate, onAddActivity }: TicketDetailViewProps) {
  const color = TICKET_COLORS[ticket.color];
  const [draftTitle, setDraftTitle] = useState(ticket.title);
  const [commentDraft, setCommentDraft] = useState('');

  const commitTitle = useCallback(() => {
    const next = draftTitle.trim();
    if (next && next !== ticket.title) {
      onUpdate({ title: next, updatedAt: new Date().toISOString() });
      onAddActivity({ kind: 'edit', actor: 'Noa', actorKind: 'human', message: 'renamed ticket' });
    }
  }, [draftTitle, ticket.title, onUpdate, onAddActivity]);

  const handleContentChange = useCallback(
    (json: string) => {
      if (json !== ticket.content) {
        onUpdate({ content: json, updatedAt: new Date().toISOString() });
      }
    },
    [ticket.content, onUpdate]
  );

  const submitComment = useCallback(() => {
    const text = commentDraft.trim();
    if (!text) return;
    onAddActivity({ kind: 'comment', actor: 'Noa', actorKind: 'human', message: text });
    setCommentDraft('');
  }, [commentDraft, onAddActivity]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const setColor = useCallback(
    (c: TicketColor) => {
      onUpdate({ color: c, updatedAt: new Date().toISOString() });
    },
    [onUpdate]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-5xl h-full max-h-[88vh] bg-card border border-border shadow-2xl flex overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Left color bar (full height) */}
        <div
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[6px]"
          style={{ backgroundColor: color.bar }}
        />

        {/* Punch card hole (top-left) */}
        <div
          aria-hidden
          className="absolute left-[22px] top-[22px] w-[14px] h-[14px] rounded-full"
          style={{
            background: 'radial-gradient(circle at 35% 35%, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.22) 60%, rgba(0,0,0,0.32) 100%)',
            boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.25), inset 0 -1px 0 rgba(255,255,255,0.15)',
          }}
        />

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent z-10"
        >
          <CloseIcon />
        </button>

        {/* Main content (editable) */}
        <div className="flex-1 min-w-0 flex flex-col pl-[56px] pr-10 pt-14 pb-6 overflow-hidden">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="Untitled"
            className="w-full bg-transparent outline-none text-2xl font-semibold text-foreground tracking-[-0.4px] mb-3"
          />

          <div className="flex items-center gap-2 mb-6 text-[12px] text-muted-foreground">
            <ColorPicker current={ticket.color} onChange={setColor} />
            <span className="opacity-40">·</span>
            <span>{ticket.createdBy}</span>
            <span className="opacity-40">·</span>
            <span>created {formatAbsolute(ticket.createdAt)}</span>
          </div>

          {/* Notion-style block editor */}
          <div className="flex-1 overflow-auto -mx-2">
            <BlockEditor
              initialContent={ticket.content}
              onChange={handleContentChange}
            />
          </div>
        </div>

        {/* Activity log (right panel) */}
        <aside className="w-[320px] shrink-0 border-l border-border flex flex-col bg-background/40">
          <div className="px-4 pt-4 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Activity
          </div>
          <div className="flex-1 overflow-auto px-4 pb-3">
            <ActivityTimeline activity={ticket.activity} />
          </div>
          <div className="border-t border-border p-3 flex gap-2">
            <input
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submitComment();
                }
              }}
              placeholder="Add a comment…"
              className="flex-1 bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground/60 border border-border px-2 py-1.5"
            />
            <button
              type="button"
              onClick={submitComment}
              disabled={!commentDraft.trim()}
              className="text-[12px] font-medium px-3 py-1.5 bg-foreground text-background disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ColorPicker({ current, onChange }: { current: TicketColor; onChange: (c: TicketColor) => void }) {
  const [open, setOpen] = useState(false);
  const colors = Object.keys(TICKET_COLORS) as TicketColor[];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-1.5 py-1 hover:bg-accent"
        aria-label="Change color"
      >
        <span
          className="w-3 h-3 inline-block"
          style={{ backgroundColor: TICKET_COLORS[current].bar }}
        />
        <span>{TICKET_COLORS[current].label}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-10 bg-popover border border-border shadow-md py-1 min-w-[120px]">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1 hover:bg-accent flex items-center gap-2 text-[12px]"
            >
              <span className="w-3 h-3 inline-block" style={{ backgroundColor: TICKET_COLORS[c].bar }} />
              {TICKET_COLORS[c].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityTimeline({ activity }: { activity: TicketActivity[] }) {
  if (activity.length === 0) {
    return <div className="text-[12px] text-muted-foreground/60 py-2">No activity yet.</div>;
  }
  const sorted = [...activity].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <ol className="space-y-3 py-2">
      {sorted.map((a) => (
        <li key={a.id} className="flex gap-2.5 text-[12px]">
          <ActivityDot kind={a.kind} actorKind={a.actorKind} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-foreground">
              <span className="font-medium truncate">{a.actor}</span>
              {a.actorKind === 'ai_agent' && (
                <span className="text-[10px] px-1 bg-accent text-muted-foreground">AI</span>
              )}
              <span className="text-muted-foreground truncate">{labelForKind(a.kind)}</span>
            </div>
            <div className="text-muted-foreground mt-0.5 break-words leading-[1.5]">{a.message}</div>
            <div className="text-[11px] text-muted-foreground/60 mt-0.5">{formatAbsolute(a.createdAt)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ActivityDot({ kind, actorKind }: { kind: TicketActivity['kind']; actorKind?: 'human' | 'ai_agent' }) {
  const isAI = actorKind === 'ai_agent';
  const bg =
    kind === 'ai_action' || isAI ? '#8B5CF6' :
    kind === 'comment' ? '#3B82F6' :
    kind === 'edit' ? '#F59E0B' :
    kind === 'created' ? '#10B981' :
    '#A3A3A3';
  return (
    <span
      aria-hidden
      className="mt-1 w-[7px] h-[7px] shrink-0 rounded-full"
      style={{ backgroundColor: bg }}
    />
  );
}

function labelForKind(kind: TicketActivity['kind']): string {
  switch (kind) {
    case 'created': return 'created this';
    case 'edit': return '·';
    case 'comment': return 'commented';
    case 'ai_action': return 'ran AI action';
    case 'move': return 'moved';
  }
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

