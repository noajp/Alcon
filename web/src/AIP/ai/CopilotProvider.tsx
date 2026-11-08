'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAlconCopilot, type CopilotMessage } from './useAlconCopilot';
import { useAiConversations } from '@/hooks/useAiConversations';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';

// One conversation with the AI across the app: the pop-up and the AI screen
// are two windows onto it, so expanding the pop-up carries the talk along.
// Each conversation is kept as a session once its first answer is in, in the
// person's folders for the Space (the AI screen's sidebar lists them).
type Conversation = ReturnType<typeof useAlconCopilot> & {
  library: ReturnType<typeof useAiConversations>;
  /** The kept session on screen; null for one not yet answered. */
  sessionId: string | null;
  openSession: (id: string) => Promise<void>;
  /** A fresh conversation, kept in this folder once answered (none: loose). */
  newConversation: (folderId?: string | null) => void;
};

const CopilotContext = createContext<Conversation | null>(null);

/** A session's title: the start of its first question. */
const titleOf = (messages: CopilotMessage[]) => {
  const first = messages.find((m) => m.role === 'user');
  // A question sent with only a file takes the file's name.
  return (first?.content || first?.attachments?.[0]?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
};

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // The hook reads the session through refs: it is created before the
  // library exists, and its callbacks must see the current session, not
  // the one from the render that created them.
  const sessionIdRef = useRef<string | null>(null);
  const loadRef = useRef<((kept: CopilotMessage[]) => void) | null>(null);
  const loadMessagesRef = useRef<((id: string) => Promise<unknown[] | null>) | null>(null);
  const adoptSession = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);
  const conversation = useAlconCopilot({
    getSessionId: () => sessionIdRef.current,
    // A turn's first event: the function anchored it on this session (it
    // creates the row on a first turn), so the kept conversation the
    // provider saves at the end is that row, not a second one.
    onSessionId: adoptSession,
    reloadSession: async () => {
      const id = sessionIdRef.current;
      if (!id || !loadMessagesRef.current || !loadRef.current) return false;
      const kept = await loadMessagesRef.current(id);
      if (!kept) return false;
      loadRef.current(kept as CopilotMessage[]);
      return true;
    },
  });
  const spaceId = useActiveSpaceId();
  const library = useAiConversations(spaceId);
  const folderForNew = useRef<string | null>(null);
  const { messages, streaming, reset, load } = conversation;
  const { saveSession, loadMessages } = library;
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { loadMessagesRef.current = loadMessages; }, [loadMessages]);

  const newConversation = useCallback((folderId: string | null = null) => {
    reset();
    folderForNew.current = folderId;
    adoptSession(null);
  }, [reset, adoptSession]);

  const openSession = useCallback(async (id: string) => {
    const kept = await loadMessages(id);
    if (!kept) return;
    load(kept as CopilotMessage[]);
    adoptSession(id);
  }, [loadMessages, load, adoptSession]);

  // Another Space has its own conversations.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the Space is an outside store; its change starts afresh
  useEffect(() => { newConversation(); }, [spaceId, newConversation]);

  // Keep the conversation each time an answer finishes.
  const wasStreaming = useRef(false);
  useEffect(() => {
    const finished = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!finished || messages.length === 0) return;
    // A file's contents are not kept, only its name. An approval card is
    // kept whole: a batch left pending can still be decided when the
    // conversation is reopened — a persisted card through its run and
    // action, an unanchored one through its calls and hash.
    const kept = messages.map(({ role, content, toolEvents, attachments, approvals }) => ({
      role, content,
      ...(toolEvents?.length ? { toolEvents } : {}),
      ...(approvals?.length ? { approvals } : {}),
      ...(attachments?.length ? { attachments: attachments.map(({ name, mediaType }) => ({ name, mediaType })) } : {}),
    }));
    void saveSession(sessionId, { title: titleOf(messages), folder_id: folderForNew.current, messages: kept })
      .then((id) => { if (id && id !== sessionId) adoptSession(id); });
  }, [streaming, messages, sessionId, saveSession, adoptSession]);

  return (
    <CopilotContext.Provider value={{ ...conversation, library, sessionId, openSession, newConversation }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilotConversation(): Conversation {
  const conversation = useContext(CopilotContext);
  if (!conversation) throw new Error('useCopilotConversation needs a CopilotProvider');
  return conversation;
}
