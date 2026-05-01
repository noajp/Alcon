'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Send, Pencil, Trash2, X, Check } from 'lucide-react';
import { useChannelMessages } from '@/hooks/useChannelMessages';
import { useAuthContext } from '@/providers/AuthProvider';
import type { Channel, Message } from '@/types/database';

function ChannelHeader({ channel }: { channel: Channel }) {
  return (
    <div className="h-12 flex items-center gap-2 px-4 border-b border-border/60 flex-shrink-0">
      <Hash size={18} className="text-muted-foreground" />
      <span className="text-[14px] font-semibold text-foreground">{channel.name}</span>
      {channel.topic && (
        <>
          <span className="w-px h-5 bg-border/60 mx-2" />
          <span className="text-[12px] text-muted-foreground truncate">{channel.topic}</span>
        </>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function MessageRow({
  message,
  showHeader,
  ownByMe,
  onEdit,
  onDelete,
}: {
  message: Message;
  showHeader: boolean;
  ownByMe: boolean;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const initial = (message.author_name ?? '?').trim().charAt(0).toUpperCase();

  useEffect(() => { setDraft(message.body); }, [message.body, editing]);

  const submit = async () => {
    if (!draft.trim() || draft.trim() === message.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try { await onEdit(message.id, draft); setEditing(false); } catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await onDelete(message.id); } catch (e) { console.error(e); }
    finally { setBusy(false); setConfirmingDelete(false); }
  };

  return (
    <div className={`group flex gap-3 ${showHeader ? 'mt-3' : 'mt-0.5'} px-4 py-0.5 hover:bg-muted/30 rounded`}>
      <div className="w-8 flex-shrink-0">
        {showHeader && (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[12px] font-semibold text-foreground/70">
            {initial}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-foreground">
              {message.author_name ?? 'Unknown'}
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatTime(message.created_at)}
            </span>
            {message.author_kind === 'ai_agent' && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">AI</span>
            )}
          </div>
        )}

        {editing ? (
          <div className="mt-0.5 flex items-start gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
              }}
              autoFocus
              rows={Math.min(6, draft.split('\n').length)}
              className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground outline-none focus:border-ring"
            />
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="Cancel">
              <X size={12} />
            </button>
            <button type="button" onClick={submit} disabled={busy} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="Save">
              <Check size={12} />
            </button>
          </div>
        ) : (
          <div className="text-[13px] text-foreground whitespace-pre-wrap break-words">
            {message.body}
            {message.edited_at && (
              <span className="ml-1 text-[10px] text-muted-foreground">(edited)</span>
            )}
          </div>
        )}
      </div>

      {ownByMe && !editing && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-start gap-1 flex-shrink-0">
          {confirmingDelete ? (
            <>
              <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy} className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:bg-muted">Cancel</button>
              <button type="button" onClick={remove} disabled={busy} className="text-[10px] px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit">
                <Pencil size={12} />
              </button>
              <button type="button" onClick={() => setConfirmingDelete(true)} className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive" title="Delete">
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MessageInput({
  channel,
  onSend,
  disabled,
}: {
  channel: Channel;
  onSend: (body: string) => Promise<void>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Reset on channel change
  useEffect(() => { setDraft(''); }, [channel.id]);

  // Auto-resize textarea up to 8 lines
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = 8 * 20;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
  }, [draft]);

  const submit = async () => {
    if (!draft.trim() || sending || disabled) return;
    setSending(true);
    try { await onSend(draft); setDraft(''); } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  return (
    <div className="px-4 pb-4 pt-2 border-t border-border/60 flex-shrink-0">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          placeholder={`Message #${channel.name}`}
          disabled={disabled || sending}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground/70 max-h-40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || sending || !draft.trim()}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Send"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}

export function TextChannelView({ channel }: { channel: Channel }) {
  const { messages, loading, error, sendMessage, editMessage, deleteMessage } = useChannelMessages(channel.id);
  const { user, profile } = useAuthContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, channel.id]);

  // Decide where to start a new "header" group (different author or >5 min gap)
  const groupedFlags = useMemo(() => {
    return messages.map((m, i) => {
      if (i === 0) return true;
      const prev = messages[i - 1];
      if (prev.author_id !== m.author_id) return true;
      const gap = new Date(m.created_at).getTime() - new Date(prev.created_at).getTime();
      return gap > 5 * 60 * 1000;
    });
  }, [messages]);

  const handleSend = async (body: string) => {
    await sendMessage(body, {
      id: user?.id ?? null,
      kind: 'human',
      name: profile?.display_name ?? user?.email ?? 'Unknown',
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ChannelHeader channel={channel} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        {loading && messages.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">Loading messages...</div>
        )}
        {!loading && error && (
          <div className="px-4 py-8 text-center text-[12px] text-destructive">エラー: {error.message}</div>
        )}
        {!loading && !error && messages.length === 0 && (
          <div className="px-4 py-12 text-center">
            <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
              <Hash size={24} />
            </div>
            <h3 className="text-[14px] font-semibold text-foreground">Welcome to #{channel.name}</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">最初のメッセージを送ってみよう。</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow
            key={m.id}
            message={m}
            showHeader={groupedFlags[i]}
            ownByMe={!!user && m.author_id === user.id}
            onEdit={editMessage}
            onDelete={deleteMessage}
          />
        ))}
      </div>

      <MessageInput channel={channel} onSend={handleSend} disabled={!user} />
    </div>
  );
}
