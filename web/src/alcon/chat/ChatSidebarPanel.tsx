'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useConversations } from '@/hooks/useConversations';
import { useAuthContext } from '@/providers/AuthProvider';
import type { ConversationListItem } from '@/types/database';
import { NewConversationDialog } from './NewConversationDialog';
import { conversationTitle, conversationAvatarUrl, initialOf } from './chatUtils';

interface ChatSidebarPanelProps {
  selectedConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
}

// Conversation-list sidebar mounted by AppSidebar when the Mode strip is
// in Chat mode. Owns the useConversations call + new-conversation dialog;
// ChatView in the main content area renders the active thread.
export function ChatSidebarPanel({ selectedConversationId, onSelectConversation }: ChatSidebarPanelProps) {
  const { user } = useAuthContext();
  const myId = user?.id ?? null;
  const { conversations, loading, createDirect, createGroup } = useConversations();
  const [dialogOpen, setDialogOpen] = useState(false);

  // The bottom "+ Create new" button in the AppSidebar fires this event
  // when in Chat mode so the dialog state stays co-located with the
  // panel that owns it.
  useEffect(() => {
    const handler = () => setDialogOpen(true);
    window.addEventListener('alcon:chat-new-conversation', handler);
    return () => window.removeEventListener('alcon:chat-new-conversation', handler);
  }, []);

  // Auto-select the most recent conversation when none is chosen.
  useEffect(() => {
    if (selectedConversationId) return;
    if (!conversations.length) return;
    onSelectConversation(conversations[0].id);
  }, [selectedConversationId, conversations, onSelectConversation]);

  // Clear a stale selection when the conversation disappears.
  useEffect(() => {
    if (
      selectedConversationId &&
      conversations.length &&
      !conversations.some((c) => c.id === selectedConversationId)
    ) {
      onSelectConversation(null);
    }
  }, [selectedConversationId, conversations, onSelectConversation]);

  const handleCreateDirect = async (otherUserId: string) => {
    onSelectConversation(await createDirect(otherUserId));
  };
  const handleCreateGroup = async (title: string, memberIds: string[]) => {
    onSelectConversation(await createGroup(title, memberIds));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* ChatSpace header — matches the per-mode "Space" labels (NoteSpace,
          TalkSpace, Activity Space). No top + button: the bottom "+ Create
          new" in AppSidebar fires `alcon:chat-new-conversation`. */}
      <div className="flex items-center px-3 pt-3 pb-2">
        <span className="text-[16px] font-bold text-muted-foreground select-none">
          ChatSpace
        </span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 pt-1 pb-2">
        {loading && conversations.length === 0 && (
          <div className="py-8 text-center text-[12px] text-muted-foreground">Loading…</div>
        )}
        {!loading && conversations.length === 0 && (
          <div className="py-10 px-3 text-center">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              まだ会話がありません。
              <br />
              + で新しいチャットを始めよう。
            </p>
          </div>
        )}
        {conversations.map((c) => (
          <ConversationRow
            key={c.id}
            conversation={c}
            myId={myId}
            selected={c.id === selectedConversationId}
            onSelect={() => onSelectConversation(c.id)}
          />
        ))}
      </div>

      <NewConversationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreateDirect={handleCreateDirect}
        onCreateGroup={handleCreateGroup}
      />
    </div>
  );
}

function ConversationRow({
  conversation: c,
  myId,
  selected,
  onSelect,
}: {
  conversation: ConversationListItem;
  myId: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = conversationTitle(c, myId);
  const avatar = conversationAvatarUrl(c, myId);
  const preview = c.last_message_body?.trim()
    ? c.last_message_body
    : c.last_message_author
      ? '添付ファイル'
      : 'メッセージはまだありません';
  const unread = c.unread_count > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-2 h-11 px-2 rounded-md transition-colors ${
        selected ? 'bg-accent' : 'hover:bg-muted/40'
      }`}
    >
      <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-foreground/70 overflow-hidden flex-shrink-0">
        {c.kind === 'group' ? (
          <Users size={13} className="text-muted-foreground" />
        ) : avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="w-full h-full object-cover" />
        ) : (
          initialOf(name)
        )}
      </span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span
          className={`text-left text-[12px] truncate ${
            unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'
          }`}
        >
          {name}
        </span>
        <span
          className={`text-left text-[10.5px] truncate ${
            unread ? 'text-foreground/80' : 'text-muted-foreground'
          }`}
        >
          {preview}
        </span>
      </span>
      {unread && (
        <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0">
          {c.unread_count > 9 ? '9+' : c.unread_count}
        </span>
      )}
    </button>
  );
}
