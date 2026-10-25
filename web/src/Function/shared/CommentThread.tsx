'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { SendIcon } from '@/Function/shared/SendIcon';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_SEPARATOR } from '@/Function/shared/menu/MenuShell';
import type { CommentAuthorKind } from '@/types/database';
import { MarkdownLite } from './MarkdownLite';
import { translate, useI18n } from '@/Function/i18n/I18nProvider';

// =============================================================
// The parts every comment thread is made of.
//
// Alcon has two threads — one on an Element, one on a Initiative — and they are
// the same object with two homes, so they render through the same parts. What
// differs between them (reactions, pinning, who may delete) is passed in as
// slots rather than forked: a second hand-rolled entry is where the two
// quietly stop looking alike.
// =============================================================

/** The subset of a comment row an entry actually renders — both
 *  ElementComment and StrategyComment satisfy it. */
export interface CommentEntryData {
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
  if (m < 1) return translate('just now');
  if (m < 60) return translate('{n}m', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return translate('{n}h', { n: h });
  return translate('{n}d', { n: Math.floor(h / 24) });
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

// Local copies of the providers' official icons keep historical comments
// independent of external image availability. Sources: github.com/openai.png;
// assets.claude.com/95a868946ac8a31e5ff832e2899f294aa368b836.png.
const AI_COMMENT_LOGOS = new Map([
  ['claude', '/ai-logos/claude.png'],
  ['chatgpt', '/ai-logos/chatgpt.png'],
  ['codex', '/ai-logos/chatgpt.png'],
]);

/** Prefer the Worker's configured photo. Historical AI comments often have
 *  no author_id, so recognized provider names get a logo as a visual fallback.
 *  This never resolves identity or permissions, and never applies to humans. */
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
  const logo = kind === 'ai_agent' ? AI_COMMENT_LOGOS.get(name?.trim().toLowerCase() ?? '') : undefined;
  const imageUrl = avatarUrl || logo;
  if (imageUrl) {
    return (
      <WorkerAvatar
        worker={{ name: name ?? '', avatar_url: imageUrl }}
        size={20}
        className="flex-shrink-0"
      />
    );
  }
  return (
    <div
      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 ${
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

export function CommentEntry({
  comment,
  avatar,
  meta,
  footer,
  menu,
}: {
  comment: CommentEntryData;
  avatar: React.ReactNode;
  /** Extra marks on the byline (pin, badges). */
  meta?: React.ReactNode;
  /** Under the body, aligned with it (reactions). */
  footer?: React.ReactNode;
  /** The "…" trigger at the end of the byline — revealed on hover, like the
   *  rest of the row's own verbs. */
  menu?: React.ReactNode;
}) {
  // A thread is a record of the work, not a chat: every entry hangs from the
  // same left edge, unboxed, so the body lines up with the document above it
  // whoever wrote it. Byline on one line with the avatar; the body starts
  // under the name (avatar 20px + gap 8px).
  const { t } = useI18n();
  return (
    <div className="group min-w-0">
      <div className="flex items-center gap-2 h-6 min-w-0">
        {avatar}
        <span className="text-[13px] font-medium text-foreground truncate">{comment.author_name || t('Unknown')}</span>
        {meta}
        <span className="text-[12px] text-muted-foreground shrink-0">{formatCommentAge(comment.created_at)}</span>
        {menu && <span className="ml-auto shrink-0">{menu}</span>}
      </div>
      {comment.author_kind === 'ai_agent' ? (
        // Agents write reports in Markdown — headings, tables, lists — so
        // they read as a document rather than raw marks.
        <div className="pl-7 break-words"><MarkdownLite text={comment.content} className="text-foreground/90" /></div>
      ) : (
        <div className="pl-7 text-[13px] leading-[1.6] text-foreground/90 whitespace-pre-wrap break-words">
          {renderWithMentions(comment.content)}
        </div>
      )}
      {footer && <div className="pl-7">{footer}</div>}
    </div>
  );
}

/** The "…" trigger and its dropdown — one entry point for a comment's own
 *  verbs (react, pin, delete, …) instead of a row of hover icons. Sits in
 *  the byline, at the end furthest from the avatar, and only shows once the
 *  row is hovered or the menu is already open.
 *
 *  Built on the app's one menu surface (`MenuShell` over Radix's
 *  `DropdownMenu`), not hand-rolled — that's what makes Escape, outside-click,
 *  keyboard nav, and portal-based positioning (so the menu can't be clipped by
 *  a scrolling comment list, and won't render its own row highlight invisible
 *  on the white light-theme surface) come for free instead of missing.
 *
 *  `children` is a render prop so callers can close the menu after acting.
 *  A {@link CommentMenuItem} closes itself (Radix closes on select); the
 *  render prop exists for content that isn't one, like a row of quick-react
 *  emoji buttons, which call `close()` themselves. */
export function CommentMenu({
  align = 'end',
  children,
}: {
  /** Which edge the dropdown hangs from — pick the side with panel room to grow into. */
  align?: 'start' | 'end';
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('More')}
          className={`p-0.5 rounded hover:bg-muted/60 hover:text-foreground transition-opacity ${
            open ? 'opacity-100 text-foreground' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <MoreHorizontal size={12} />
        </button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align={align}>
        {children(() => setOpen(false))}
      </MenuShell>
    </DropdownMenu>
  );
}

/** The divider between a {@link CommentMenu}'s non-item content (the
 *  quick-react row) and its verb list. */
export const CommentMenuSeparator = MENU_SEPARATOR;

/** One row inside a {@link CommentMenu} — a thin wrapper over the shared
 *  `DropdownMenuItem` so it inherits the app's one menu-row look (correct
 *  hover color in every theme, destructive icon tinting) and closes on
 *  select without the caller managing that itself. */
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
  const { t } = useI18n();
  return (
    <DropdownMenuItem variant={destructive ? 'destructive' : 'default'} onClick={onClick} className="gap-2">
      {icon}
      {t(label)}
    </DropdownMenuItem>
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
  /** Settings > Preferences > "Send comment on…" (default matches the DB
   *  column default, '⌘+Enter'). 'Enter' sends on plain Enter, newline on
   *  Shift+Enter. '⌘+Enter' flips that: plain Enter (and Shift+Enter) always
   *  insert a newline, only the modifier sends. */
  sendShortcut = '⌘+Enter',
  children,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
  placeholder?: string;
  submitting?: boolean;
  enterHeldBy?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  sendShortcut?: '⌘+Enter' | 'Enter';
  /** Anything anchored to the composer — the mention popover. */
  children?: React.ReactNode;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useI18n();

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
          placeholder={t(placeholder)}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground/70 max-h-40 no-focus-ring"
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (e.defaultPrevented || e.nativeEvent.isComposing) return; // mid-IME
            // Shift always means "newline, don't send" regardless of mode.
            // The mention list only ever contests plain Enter (there is no
            // Cmd/Ctrl+Enter binding anywhere it could claim), so `enterHeldBy`
            // must not block the modifier chord — otherwise ⌘+Enter mode has
            // no way to send at all while `@partial-name` is still on screen.
            if (e.key !== 'Enter' || e.shiftKey) return;
            const sends = sendShortcut === '⌘+Enter'
              ? (e.metaKey || e.ctrlKey)
              : !enterHeldBy;
            if (sends) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          onClick={onSubmit}
          disabled={!value.trim() || submitting}
          aria-label={t('Send')}
          className="h-7 px-2.5 flex items-center justify-center rounded-lg bg-[var(--rail-active)] text-white border border-white/20 hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
        >
          <SendIcon size={16} />
        </button>
      </div>
      {children}
    </div>
  );
}
