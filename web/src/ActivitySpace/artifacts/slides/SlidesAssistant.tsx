'use client';

import { ChatComposer, ChatPanel } from './kata/components/panels/ChatPanel';
import { useKataLocale } from './useKataLocale';

/**
 * The open deck's conversation, shown in Clayware's AI panel while Slides is the
 * active view — one AI panel across the app, whose subject follows the screen.
 * Paste notes or ask for a change here; the deck on the canvas updates.
 */
export function SlidesAssistant() {
  useKataLocale();
  return (
    <div className="kata-root flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col"><ChatPanel /></div>
      <ChatComposer />
    </div>
  );
}
