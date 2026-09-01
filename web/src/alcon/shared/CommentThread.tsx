'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { SendIcon } from '@/alcon/shared/SendIcon';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';
import type { CommentAuthorKind } from '@/types/database';

// =============================================================
// The parts every comment thread is made of.
//
// Alcon has two threads — one on an Element, one on a Campaign — and they are
// the same object with two homes, so they render through the same parts. What
// differs between them (reactions, pinning, who may delete) is passed in as
// slots rather than forked: a second hand-rolled bubble is where the two
// quietly stop looking alike.
// =============================================================

/** The subset of a comment row a bubble actually renders — both
 *  ElementComment and StrategyComment satisfy it. */
export interface CommentBubbleData {
  author_name: string | null;
  author_kind: CommentAuthorKind;
  content: string;
  created_at: string;
}

/** Relative age, coarse on purpose: a thread reads as a conversation, and an
 *  exact timestamp on every line makes it read as a log. */
export function formatCommentAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Tint @name runs so a mention is findable when skimming. Purely visual —
 *  the authoritative mention list is the row's `mentions` column. */
export function renderWithMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[\w.\-]+(?:\s\w+)?)/g);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <span key={i} className="text-primary font-medium">{p}</span>
      : <span key={i}>{p}</span>,
  );
}

/** The author's face: their real photo when the Worker record has one, and a
 *  colour-coded initial when it doesn't. Both threads resolve the Worker
 *  themselves (humans by user_id, agents by worker id) and hand the URL in. */
export function CommentAvatar({
  name,
  kind,
  isMine,
  avatarUrl,
}: {
  name: string | null;
  kind: CommentAuthorKind;
  isMine: boolean;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <WorkerAvatar
        worker={{ name: name ?? '', avatar_url: avatarUrl }}
        size={28}
        className="flex-shrink-0"
      />
    );
  }
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium flex-shrink-0 ${
        kind === 'ai_agent'
          ? 'bg-purple-500/15 text-purple-300'
          : isMine
          ? 'bg-primary/15 text-primary'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {(name || '?').charAt(0).toUpperCase()}
    </div>
  );
}

export function CommentBubble({
  comment,
  isMine,
  avatar,
  meta,
  footer,
  menu,
}: {
  comment: CommentBubbleData;
  /** Own comments hang on the right, everyone else's on the left. */
  isMine: boolean;
  avatar: React.ReactNode;
  /** Extra marks on the byline (pin, badges). */
  meta?: React.ReactNode;
  /** Under the bubble, aligned with it (reactions). */
  footer?: React.ReactNode;
  /** The "…" trigger, anchored at the end of the byline furthest from the
   *  avatar — revealed on hover, like the rest of the row's own verbs. */
  menu?: React.ReactNode;
}) {
  const isAi = comment.author_kind === 'ai_agent';
  return (
    <div className={`group flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
      {avatar}
      <div className={`flex flex-col max-w-[78%] min-w-0 ${isMine ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-1.5 mb-0.5 text-[10px] text-muted-foreground ${isMine ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium text-foreground/85">{comment.author_name || 'Unknown'}</span>
          {isAi && <span className="text-[9px] px-1 bg-purple-500/15 text-purple-300 rounded">AI</span>}
          {meta}
          <span>{formatCommentAge(comment.created_at)}</span>
          {menu}
        </div>
        <div
          className={`relative px-3 py-1.5 rounded-2xl text-[12px] leading-[1.5] whitespace-pre-wrap break-words ${
            isMine
              ? 'bg-primary/15 text-foreground rounded-tr-sm'
              : 'bg-muted/60 text-foreground/90 rounded-tl-sm'
          }`}
        >
          {renderWithMentions(comment.content)}
        </div>
        {footer}
      </div>
    </div>
  );
}

/** The "…" trigger and its dropdown — one entry point for a comment's own
 *  verbs (react, pin, delete, …) instead of a row of hover icons. Sits in
 *  the byline, at the end furthest from the avatar, and only shows once the
 *  row is hovered or the menu is already open.
 *
 *  `children` is a render prop so callers can close the menu after acting —
 *  each item calls `close()` itself, since what "acting" means (react vs.
 *  delete) is the caller's business, not this component's. */
export function CommentMenu({
  align = 'right',
  children,
}: {
  /** Which edge the dropdown hangs from — pick the side with panel room to grow into. */
  align?: 'left' | 'right';
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="More"
        className={`p-0.5 rounded hover:bg-muted/60 hover:text-foreground transition-opacity ${
          open ? 'opacity-100 text-foreground' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <MoreHorizontal size={12} />
      </button>
      {open && (
        <div
          onMouseLeave={close}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 z-20 min-w-[132px] bg-popover border border-border rounded-md shadow-lg py-1`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** One row of text inside a {@link CommentMenu}. */
export function CommentMenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-left hover:bg-accent ${
        destructive ? 'text-destructive' : 'text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function CommentComposer({
  value,
  onChange,
  onSubmit,
  placeholder = 'Leave a comment…',
  submitting = false,
  /** True while an overlay (the @mention list) is claiming Enter. */
  enterHeldBy = false,
  onKeyDown,
  children,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  placeholder?: string;
  submitting?: boolean;
  enterHeldBy?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Anything anchored to the composer — the mention popover. */
  children?: React.ReactNode;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Grow to fit, capped, and shrink back when the draft is cleared on send.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  }, [value]);

  return (
    <div className="pt-1 relative">
      <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] px-3 py-2">
        <textarea
          ref={taRef}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground/70 max-h-40 no-focus-ring"
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            // Enter sends — but never mid-IME-composition (Japanese/Chinese
            // conversion), and never while the mention list has Enter.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !enterHeldBy) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          onClick={onSubmit}
          disabled={!value.trim() || submitting}
          aria-label="Send"
          className="h-7 px-2.5 flex items-center justify-center rounded-lg bg-[var(--rail-active)] text-white border border-white/20 hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
        >
          <SendIcon size={16} />
        </button>
      </div>
      {children}
    </div>
  );
}
