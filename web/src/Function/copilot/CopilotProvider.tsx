'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useAlconCopilot } from './useAlconCopilot';

// One conversation with the AI across the app: the pop-up and the AI screen
// are two windows onto it, so expanding the pop-up carries the talk along.
type Conversation = ReturnType<typeof useAlconCopilot>;

const CopilotContext = createContext<Conversation | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const conversation = useAlconCopilot();
  return <CopilotContext.Provider value={conversation}>{children}</CopilotContext.Provider>;
}

export function useCopilotConversation(): Conversation {
  const conversation = useContext(CopilotContext);
  if (!conversation) throw new Error('useCopilotConversation needs a CopilotProvider');
  return conversation;
}
