'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { copilotTitleOf, toKeptMessages, useAlconCopilot, type CopilotMessage } from './useAlconCopilot';
import { useAiConversations } from '@/hooks/useAiConversations';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';

// One conversation with the AI across the app: the pop-up and the AI screen
// are two windows onto it, so expanding the pop-up carries the talk along.
// Each conversation is kept as a session in the person's folders for the
// Space (the AI screen's sidebar lists them): a first send makes its row,
// the engine (Athena) writes its messages as its turns run, and this
// provider only files it — a title once it has one, and the folder it was
// started in.
type Conversation = ReturnType<typeof useAlconCopilot> & {
  library: ReturnType<typeof useAiConversations>;
  /** The kept session on screen; null for one not yet answered. */
  sessionId: string | null;
  openSession: (id: string) => Promise<void>;
  /** A fresh conversation, kept in this folder once answered (none: loose). */
  newConversation: (folderId?: string | null) => void;
};

const CopilotContext = createContext<Conversation | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // The hook reads the session through refs: it is created before the
  // library exists, and its callbacks must see the current session, not
  // the one from the render that created them.
  const sessionIdRef = useRef<string | null>(null);
  const loadRef = useRef<((kept: CopilotMessage[]) => void) | null>(null);
  const loadMessagesRef = useRef<((id: string) => Promise<unknown[] | null>) | null>(null);
  const saveSessionRef = useRef<((id: string | null, patch: { title?: string; folder_id?: string | null; messages: unknown[] }) => Promise<string | null>) | null>(null);
  const folderForNew = useRef<string | null>(null);
  const adoptSession = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);
  const conversation = useAlconCopilot({
    getSessionId: () => sessionIdRef.current,
    // A first send makes the kept conversation's row through the
    // library's insert — in the folder the conversation was started
    // in — and adopts it; the engine writes its messages from there.
    ensureSession: async () => {
      const existing = sessionIdRef.current;
      if (existing) return existing;
      const save = saveSessionRef.current;
      if (!save) return null;
      const id = await save(null, { title: '', folder_id: folderForNew.current, messages: [] });
      if (id) adoptSession(id);
      return id;
    },
    onSessionId: adoptSession,
    reloadSession: async () => {
      const id = sessionIdRef.current;
      if (!id || !loadMessagesRef.current || !loadRef.current) return false;
      const kept = await loadMessagesRef.current(id);
      if (!kept) return false;
      loadRef.current(kept as CopilotMessage[]);
      return true;
    },
    // A cut-back (an edited question, a retry) is the person's own
    // write of the kept conversation: what remains of it, in its kept
    // shape, re-filed under its title. The turns themselves are the
    // engine's to write.
    onTruncate: async (kept) => {
      const id = sessionIdRef.current;
      const save = saveSessionRef.current;
      if (!id || !save) return;
      await save(id, { title: copilotTitleOf(kept), messages: toKeptMessages(kept) });
    },
  });
  const spaceId = useActiveSpaceId();
  const library = useAiConversations(spaceId);
  const { messages, streaming, reset, load } = conversation;
  const { saveSession, loadMessages, fileSession } = library;
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { loadMessagesRef.current = loadMessages; }, [loadMessages]);
  useEffect(() => { saveSessionRef.current = saveSession; }, [saveSession]);

  const newConversation = useCallback((folderId: string | null = null) => {
    reset();
    folderForNew.current = folderId;
    adoptSession(null);
  }, [reset, adoptSession]);

  const openSession = useCallback(async (id: string) => {
    const kept = await loadMessages(id);
    if (!kept) return;
    load(kept as CopilotMessage[]);
    // A kept conversation is already filed; its saves never move it.
    folderForNew.current = null;
    adoptSession(id);
  }, [loadMessages, load, adoptSession]);

  // Another Space has its own conversations.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the Space is an outside store; its change starts afresh
  useEffect(() => { newConversation(); }, [spaceId, newConversation]);

  // File the conversation each time an answer finishes: its title
  // (only while it is still untitled) and the folder it was started
  // in, once. The messages themselves are the engine's record now.
  const wasStreaming = useRef(false);
  useEffect(() => {
    const finished = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!finished || messages.length === 0 || !sessionId) return;
    const folderId = folderForNew.current;
    folderForNew.current = null;
    void fileSession(sessionId, { title: copilotTitleOf(messages), folder_id: folderId });
  }, [streaming, messages, sessionId, fileSession]);

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
