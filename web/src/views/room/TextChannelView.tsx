'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Hash,
  Send,
  Pencil,
  Trash2,
  X,
  Check,
  SmilePlus,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Download,
} from 'lucide-react';
import { useChannelMessages, type MessageWithExtras, type PendingAttachment } from '@/hooks/useChannelMessages';
import { useAuthContext } from '@/providers/AuthProvider';
import type { Channel, MessageAttachment } from '@/types/database';

// Discord-style limited reaction palette. Could be expanded with a
// full picker later — for now, the most common 8 cover the use case.
const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '✅', '🙏'];
const MENTION_REGEX = /(@[A-Za-z0-9._\-]+)/g;

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

function renderBody(body: string): React.ReactNode {
  if (!body) return null;
  const parts = body.split(MENTION_REGEX);
  return parts.map((p, i) =>
    MENTION_REGEX.test(p) ? (
      <span
        key={i}
        className="inline-block px-1 rounded bg-blue-500/15 text-blue-500 dark:text-blue-300 font-medium"
      >
        {p}
      </span>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    )
  );
}

function ReactionChips({
  message,
  myUserId,
  onToggle,
}: {
  message: MessageWithExtras;
  myUserId: string | null;
  onToggle: (emoji: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean; users: string[] }>();
    for (const r of message.reactions) {
      const cur = map.get(r.emoji) ?? { count: 0, mine: false, users: [] };
      cur.count += 1;
      cur.users.push(r.user_id);
      if (myUserId && r.user_id === myUserId) cur.mine = true;
      map.set(r.emoji, cur);
    }
    return Array.from(map.entries()).map(([emoji, info]) => ({ emoji, ...info }));
  }, [message.reactions, myUserId]);

  if (grouped.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {grouped.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => onToggle(g.emoji)}
          className={`flex items-center gap-1 px-1.5 h-5 rounded-full border text-[11px] transition-colors ${
            g.mine
              ? 'bg-blue-500/15 border-blue-500/40 text-foreground'
              : 'bg-muted/40 border-border hover:bg-muted/60 text-foreground/80'
          }`}
        >
          <span>{g.emoji}</span>
          <span className="tabular-nums">{g.count}</span>
        </button>
      ))}
    </div>
  );
}

function EmojiPickerPopover({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute z-30 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg p-1 flex gap-0.5"
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => { onPick(emoji); onClose(); }}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted text-[16px]"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function AttachmentList({
  attachments,
  attachmentPublicUrl,
}: {
  attachments: MessageAttachment[];
  attachmentPublicUrl: (path: string) => string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      {attachments.map((att) => {
        const url = attachmentPublicUrl(att.storage_path);
        const isImage = att.mime?.startsWith('image/');
        const isVideo = att.mime?.startsWith('video/');
        const isAudio = att.mime?.startsWith('audio/');
        if (isImage) {
          return (
            <a key={att.id} href={url} target="_blank" rel="noreferrer" className="block w-fit max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={att.name}
                className="max-h-72 rounded-md border border-border object-contain bg-muted/20"
              />
            </a>
          );
        }
        if (isVideo) {
          return (
            <video key={att.id} src={url} controls className="max-h-72 rounded-md border border-border bg-black" />
          );
        }
        if (isAudio) {
          return <audio key={att.id} src={url} controls className="w-full max-w-sm" />;
        }
        return (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/20 hover:bg-muted/40 max-w-sm"
          >
            <FileText size={16} className="text-muted-foreground flex-shrink-0" />
            <span className="text-[12px] text-foreground truncate flex-1">{att.name}</span>
            <Download size={13} className="text-muted-foreground flex-shrink-0" />
          </a>
        );
      })}
    </div>
  );
}

function PendingFileChip({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const isImage = file.type.startsWith('image/');
  const previewUrl = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-border bg-muted/30">
      {isImage && previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={file.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
      ) : (
        <ImageIcon size={14} className="text-muted-foreground flex-shrink-0" />
      )}
      <span className="text-[11px] text-foreground truncate max-w-[140px]">{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Remove"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function MessageRow({
  message,
  showHeader,
  ownByMe,
  myUserId,
  attachmentPublicUrl,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  message: MessageWithExtras;
  showHeader: boolean;
  ownByMe: boolean;
  myUserId: string | null;
  attachmentPublicUrl: (path: string) => string;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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
    <div className={`group relative flex gap-3 ${showHeader ? 'mt-3' : 'mt-0.5'} px-4 py-0.5 hover:bg-muted/30 rounded`}>
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
          <>
            {message.body && (
              <div className="text-[13px] text-foreground whitespace-pre-wrap break-words">
                {renderBody(message.body)}
                {message.edited_at && (
                  <span className="ml-1 text-[10px] text-muted-foreground">(edited)</span>
                )}
              </div>
            )}
            <AttachmentList attachments={message.attachments} attachmentPublicUrl={attachmentPublicUrl} />
            <ReactionChips
              message={message}
              myUserId={myUserId}
              onToggle={(emoji) => onToggleReaction(message.id, emoji)}
            />
          </>
        )}
      </div>

      {!editing && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-0 flex items-start gap-1 flex-shrink-0">
          {confirmingDelete ? (
            <>
              <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy} className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:bg-muted">Cancel</button>
              <button type="button" onClick={remove} disabled={busy} className="text-[10px] px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</button>
            </>
          ) : (
            <div className="bg-popover border border-border rounded-md shadow-sm flex items-center px-0.5 py-0.5 relative">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Add reaction"
              >
                <SmilePlus size={12} />
              </button>
              {ownByMe && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
              {pickerOpen && (
                <EmojiPickerPopover
                  onPick={(emoji) => onToggleReaction(message.id, emoji)}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageInput({
  channel,
  onSend,
  onUploadFile,
  disabled,
}: {
  channel: Channel;
  onSend: (body: string, attachments: PendingAttachment[]) => Promise<void>;
  onUploadFile: (file: File) => Promise<PendingAttachment>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ file: File; uploaded: PendingAttachment | null }[]>([]);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(''); setPending([]); }, [channel.id]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = 8 * 20;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
  }, [draft]);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    // Add placeholders, then upload each
    setPending((prev) => [...prev, ...arr.map((f) => ({ file: f, uploaded: null as PendingAttachment | null }))]);
    for (const f of arr) {
      try {
        const up = await onUploadFile(f);
        setPending((prev) => prev.map((p) => (p.file === f ? { ...p, uploaded: up } : p)));
      } catch (e) {
        console.error('Upload failed:', e);
        setPending((prev) => prev.filter((p) => p.file !== f));
      }
    }
  };

  const submit = async () => {
    const stillUploading = pending.some((p) => !p.uploaded);
    if (stillUploading || sending || disabled) return;
    if (!draft.trim() && pending.length === 0) return;
    setSending(true);
    try {
      await onSend(draft, pending.map((p) => p.uploaded!).filter(Boolean));
      setDraft('');
      setPending([]);
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const stillUploading = pending.some((p) => !p.uploaded);
  const canSend = !disabled && !sending && !stillUploading && (draft.trim().length > 0 || pending.length > 0);

  return (
    <div className="px-4 pb-4 pt-2 border-t border-border/60 flex-shrink-0">
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pending.map((p, idx) => (
            <PendingFileChip
              key={idx}
              file={p.file}
              onRemove={() => setPending((prev) => prev.filter((x) => x !== p))}
            />
          ))}
          {stillUploading && (
            <span className="text-[10px] text-muted-foreground self-center">Uploading…</span>
          )}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          title="Attach files"
        >
          <Paperclip size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
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
          disabled={!canSend}
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
  const {
    messages,
    loading,
    error,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    uploadAttachment,
    attachmentPublicUrl,
  } = useChannelMessages(channel.id);
  const { user, profile } = useAuthContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, channel.id]);

  const groupedFlags = useMemo(() => {
    return messages.map((m, i) => {
      if (i === 0) return true;
      const prev = messages[i - 1];
      if (prev.author_id !== m.author_id) return true;
      const gap = new Date(m.created_at).getTime() - new Date(prev.created_at).getTime();
      return gap > 5 * 60 * 1000;
    });
  }, [messages]);

  const handleSend = async (body: string, attachments: PendingAttachment[]) => {
    await sendMessage(
      body,
      {
        id: user?.id ?? null,
        kind: 'human',
        name: profile?.display_name ?? user?.email ?? 'Unknown',
      },
      attachments
    );
  };

  const handleUpload = async (file: File): Promise<PendingAttachment> => {
    if (!user?.id) throw new Error('Not signed in');
    return uploadAttachment(user.id, file);
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user?.id) return;
    await toggleReaction(messageId, emoji, user.id);
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
            myUserId={user?.id ?? null}
            attachmentPublicUrl={attachmentPublicUrl}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onToggleReaction={handleToggleReaction}
          />
        ))}
      </div>

      <MessageInput
        channel={channel}
        onSend={handleSend}
        onUploadFile={handleUpload}
        disabled={!user}
      />
    </div>
  );
}
