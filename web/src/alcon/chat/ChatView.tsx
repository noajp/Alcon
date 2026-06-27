'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pencil,
  Trash2,
  X,
  Check,
  SmilePlus,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Download,
  Users,
  Settings as SettingsIcon,
  MessageSquare,
} from 'lucide-react';
import { SendIcon } from '@/alcon/shared/SendIcon';
import {
  useConversationMessages,
  type DirectMessageWithExtras,
  type PendingAttachment,
} from '@/hooks/useConversationMessages';
import { useConversations } from '@/hooks/useConversations';
import { useAuthContext } from '@/providers/AuthProvider';
import type { DmAttachment } from '@/types/database';
import { conversationTitle, conversationAvatarUrl, initialOf } from './chatUtils';
import { ChatGroupDialog } from './ChatGroupDialog';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '✅', '🙏'];
const GROUP_GAP_MS = 5 * 60 * 1000;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------- Avatar
function Avatar({ url, name, size = 28 }: { url: string | null; name: string | null; size?: number }) {
  return (
    <span
      className="rounded-full bg-muted flex items-center justify-center font-semibold text-foreground/70 overflow-hidden flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        initialOf(name)
      )}
    </span>
  );
}

// --------------------------------------------------------- Reaction chips
function ReactionChips({
  message,
  myUserId,
  align,
  onToggle,
}: {
  message: DirectMessageWithExtras;
  myUserId: string | null;
  align: 'start' | 'end';
  onToggle: (emoji: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; mine: boolean }>();
    for (const r of message.reactions) {
      const cur = map.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (myUserId && r.user_id === myUserId) cur.mine = true;
      map.set(r.emoji, cur);
    }
    return Array.from(map.entries()).map(([emoji, info]) => ({ emoji, ...info }));
  }, [message.reactions, myUserId]);

  if (grouped.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      {grouped.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => onToggle(g.emoji)}
          className={`flex items-center gap-1 px-1.5 h-5 rounded-full border text-[11px] transition-colors ${
            g.mine
              ? 'bg-blue-500/15 border-blue-500/40 text-foreground'
              : 'bg-muted/50 border-border hover:bg-muted text-foreground/80'
          }`}
        >
          <span>{g.emoji}</span>
          <span className="tabular-nums">{g.count}</span>
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------- Emoji picker
function EmojiPickerPopover({
  align,
  onPick,
  onClose,
}: {
  align: 'left' | 'right';
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
      className={`absolute z-30 top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} bg-popover border border-border rounded-md shadow-lg p-1 flex gap-0.5`}
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted text-[16px]"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------- Attachments
function AttachmentList({
  attachments,
  align,
  attachmentPublicUrl,
}: {
  attachments: DmAttachment[];
  align: 'start' | 'end';
  attachmentPublicUrl: (path: string) => string;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={`mt-1 flex flex-col gap-1 ${align === 'end' ? 'items-end' : 'items-start'}`}>
      {attachments.map((att) => {
        const url = attachmentPublicUrl(att.storage_path);
        if (att.mime?.startsWith('image/')) {
          return (
            <a key={att.id} href={url} target="_blank" rel="noreferrer" className="block w-fit max-w-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={att.name}
                className="max-h-64 rounded-lg border border-border object-contain bg-muted/20"
              />
            </a>
          );
        }
        if (att.mime?.startsWith('video/')) {
          return (
            <video key={att.id} src={url} controls className="max-h-64 rounded-lg border border-border bg-black" />
          );
        }
        if (att.mime?.startsWith('audio/')) {
          return <audio key={att.id} src={url} controls className="w-60" />;
        }
        return (
          <a
            key={att.id}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 max-w-xs"
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

function PendingFileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith('image/');
  const previewUrl = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
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

// --------------------------------------------------------- Message row
function MessageRow({
  message,
  mine,
  groupStart,
  showName,
  authorAvatar,
  myUserId,
  attachmentPublicUrl,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  message: DirectMessageWithExtras;
  mine: boolean;
  groupStart: boolean;
  showName: boolean;
  authorAvatar: string | null;
  myUserId: string | null;
  attachmentPublicUrl: (path: string) => string;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!draft.trim() || draft.trim() === message.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onEdit(message.id, draft);
      setEditing(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(message.id);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const align: 'start' | 'end' = mine ? 'end' : 'start';

  const toolbar = !editing && (
    <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center flex-shrink-0">
      {confirmingDelete ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            disabled={busy}
            className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-[10px] px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </button>
        </div>
      ) : (
        <div className="relative bg-popover border border-border rounded-md shadow-sm flex items-center px-0.5 py-0.5">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Add reaction"
          >
            <SmilePlus size={12} />
          </button>
          {mine && (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(message.body);
                  setEditing(true);
                }}
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
              align={mine ? 'left' : 'right'}
              onPick={(emoji) => onToggleReaction(message.id, emoji)}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`group flex gap-2 px-3 ${groupStart ? 'mt-3' : 'mt-0.5'} ${
        mine ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      {!mine && (
        <div className="w-7 flex-shrink-0 pt-0.5">
          {groupStart && <Avatar url={authorAvatar} name={message.author_name} />}
        </div>
      )}

      <div className={`flex flex-col min-w-0 max-w-[78%] ${mine ? 'items-end' : 'items-start'}`}>
        {groupStart && (
          <div className="flex items-baseline gap-2 mb-0.5 px-1">
            {showName && !mine && (
              <span className="text-[12px] font-semibold text-foreground">
                {message.author_name ?? 'Unknown'}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatTime(message.created_at)}
            </span>
          </div>
        )}

        {editing ? (
          <div className="flex items-start gap-1.5 w-72">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              autoFocus
              rows={Math.min(6, draft.split('\n').length)}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none"
            />
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Cancel"
            >
              <X size={12} />
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Save"
            >
              <Check size={12} />
            </button>
          </div>
        ) : (
          <>
            {message.body && (
              <div
                className={`px-3 py-1.5 text-[13px] whitespace-pre-wrap break-words ${
                  mine
                    ? 'bg-foreground text-background rounded-2xl rounded-br-md'
                    : 'bg-muted text-foreground rounded-2xl rounded-bl-md'
                }`}
              >
                {message.body}
                {message.edited_at && (
                  <span className={`ml-1 text-[10px] ${mine ? 'text-background/50' : 'text-muted-foreground'}`}>
                    (edited)
                  </span>
                )}
              </div>
            )}
            <AttachmentList
              attachments={message.attachments}
              align={align}
              attachmentPublicUrl={attachmentPublicUrl}
            />
            <ReactionChips
              message={message}
              myUserId={myUserId}
              align={align}
              onToggle={(emoji) => onToggleReaction(message.id, emoji)}
            />
          </>
        )}
      </div>

      {toolbar}
    </div>
  );
}

// --------------------------------------------------------- Composer
function Composer({
  placeholder,
  disabled,
  onSend,
  onUploadFile,
}: {
  placeholder: string;
  disabled: boolean;
  onSend: (body: string, attachments: PendingAttachment[]) => Promise<void>;
  onUploadFile: (file: File) => Promise<PendingAttachment>;
}) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ file: File; uploaded: PendingAttachment | null }[]>([]);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [draft]);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
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

  const stillUploading = pending.some((p) => !p.uploaded);
  const canSend = !disabled && !sending && !stillUploading && (draft.trim().length > 0 || pending.length > 0);

  const submit = async () => {
    if (!canSend) return;
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

  return (
    <div className="px-4 pb-4 pt-2 flex-shrink-0">
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pending.map((p, idx) => (
            <PendingFileChip
              key={idx}
              file={p.file}
              onRemove={() => setPending((prev) => prev.filter((x) => x !== p))}
            />
          ))}
          {stillUploading && <span className="text-[10px] text-muted-foreground self-center">Uploading…</span>}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] px-3 py-2">
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
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled || sending}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-[13px] text-foreground placeholder:text-muted-foreground/70 max-h-40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="h-7 px-2.5 flex items-center justify-center rounded-lg bg-[var(--rail-active)] text-white border border-white/20 shadow-[0_1px_4px_rgba(0,0,0,0.35)] hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
          title="Send"
        >
          <SendIcon size={16} />
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------- Empty state
function ChatEmpty({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-card">
      <div className="text-center max-w-sm px-6">
        <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
          {icon}
        </div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">{title}</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

// --------------------------------------------------------- ChatView
interface ChatViewProps {
  selectedConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
}

export function ChatView({ selectedConversationId, onSelectConversation }: ChatViewProps) {
  const { user, profile } = useAuthContext();
  const myId = user?.id ?? null;
  const {
    conversations,
    loading: convLoading,
    markRead,
    renameConversation,
    addMembers,
    leaveConversation,
  } = useConversations();
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
  } = useConversationMessages(selectedConversationId);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  // Avatar lookup for message authors, keyed by user id.
  const avatarById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of conversation?.members ?? []) map.set(m.user_id, m.avatar_url);
    return map;
  }, [conversation]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedConversationId]);

  // Mark the conversation read whenever it's open and the log changes.
  useEffect(() => {
    if (selectedConversationId) void markRead(selectedConversationId);
  }, [selectedConversationId, messages.length, markRead]);

  const groupFlags = useMemo(
    () =>
      messages.map((m, i) => {
        if (i === 0) return true;
        const prev = messages[i - 1];
        if (prev.author_id !== m.author_id) return true;
        return new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_GAP_MS;
      }),
    [messages]
  );

  if (!selectedConversationId) {
    return (
      <ChatEmpty
        icon={<MessageSquare size={24} />}
        title="Chat"
        message="左の一覧から会話を選ぶか、+ で新しいチャットを始めてください。"
      />
    );
  }

  if (!conversation) {
    return (
      <ChatEmpty
        icon={<MessageSquare size={24} />}
        title="Chat"
        message={convLoading ? '読み込み中…' : '会話が見つかりませんでした。'}
      />
    );
  }

  const name = conversationTitle(conversation, myId);
  const isGroup = conversation.kind === 'group';

  const handleSend = async (body: string, attachments: PendingAttachment[]) => {
    await sendMessage(
      body,
      { id: myId, name: profile?.display_name ?? user?.email ?? 'Unknown' },
      attachments
    );
  };
  const handleUpload = (file: File): Promise<PendingAttachment> => {
    if (!myId) throw new Error('Not signed in');
    return uploadAttachment(myId, file);
  };
  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (myId) await toggleReaction(messageId, emoji, myId);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-card">
      {/* header */}
      <div className="h-[50px] flex items-center gap-2.5 px-4 border-b border-border/40 flex-shrink-0">
        {isGroup ? (
          <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            <Users size={15} className="text-muted-foreground" />
          </span>
        ) : (
          <Avatar url={conversationAvatarUrl(conversation, myId)} name={name} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground truncate">{name}</div>
          {isGroup && (
            <div className="text-[11px] text-muted-foreground">{conversation.members.length} members</div>
          )}
        </div>
        {isGroup && (
          <button
            type="button"
            onClick={() => setGroupDialogOpen(true)}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Group settings"
          >
            <SettingsIcon size={15} />
          </button>
        )}
      </div>

      {/* thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        {loading && messages.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">Loading messages…</div>
        )}
        {!loading && error && (
          <div className="px-4 py-8 text-center text-[12px] text-destructive">エラー: {error.message}</div>
        )}
        {!loading && !error && messages.length === 0 && (
          <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">
            最初のメッセージを送ってみよう。
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow
            key={m.id}
            message={m}
            mine={!!myId && m.author_id === myId}
            groupStart={groupFlags[i]}
            showName={isGroup}
            authorAvatar={m.author_id ? avatarById.get(m.author_id) ?? null : null}
            myUserId={myId}
            attachmentPublicUrl={attachmentPublicUrl}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onToggleReaction={handleToggleReaction}
          />
        ))}
      </div>

      <Composer
        key={conversation.id}
        placeholder="Messaging..."
        disabled={!user}
        onSend={handleSend}
        onUploadFile={handleUpload}
      />

      {isGroup && (
        <ChatGroupDialog
          open={groupDialogOpen}
          onOpenChange={setGroupDialogOpen}
          conversation={conversation}
          myId={myId}
          onRename={(title) => renameConversation(conversation.id, title)}
          onAddMembers={(ids) => addMembers(conversation.id, ids)}
          onLeave={async () => {
            await leaveConversation(conversation.id);
            onSelectConversation(null);
          }}
        />
      )}
    </div>
  );
}
