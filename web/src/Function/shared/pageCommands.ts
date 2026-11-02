'use client';

import { useEffect, useRef, useSyncExternalStore, type ComponentType } from 'react';

// Commands the open page lends to ⌘K — what can be done to the thing on
// screen (handing the open Element to an AI Worker), offered beside search
// and navigation while that page is mounted. The page registers on mount and
// withdraws on unmount; the newest registration of an id wins, so a peeked
// Element over a list offers its own commands, not the list's.

export interface PageCommand {
  id: string;
  /** An i18n key, shown through t(). */
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Extra words ⌘K matches (English and Japanese), never shown. */
  keywords?: string[];
  run: () => void;
}

let entries: { token: number; command: PageCommand }[] = [];
let snapshot: PageCommand[] = [];
let nextToken = 0;
const listeners = new Set<() => void>();

function publish() {
  // Newest first per id: a later registration shadows an earlier one.
  const seen = new Set<string>();
  const out: PageCommand[] = [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const { command } = entries[i];
    if (seen.has(command.id)) continue;
    seen.add(command.id);
    out.unshift(command);
  }
  snapshot = out;
  listeners.forEach((l) => l());
}

/** Adds a command; the returned function withdraws exactly this one. */
export function registerPageCommand(command: PageCommand): () => void {
  const token = (nextToken += 1);
  entries = [...entries, { token, command }];
  publish();
  return () => {
    entries = entries.filter((e) => e.token !== token);
    publish();
  };
}

export function getPageCommands(): PageCommand[] {
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const EMPTY: PageCommand[] = [];

export function usePageCommands(): PageCommand[] {
  return useSyncExternalStore(subscribe, getPageCommands, () => EMPTY);
}

/** Offers `command` in ⌘K while the calling component is mounted. `run`
 *  always calls the latest closure; null offers nothing. */
export function useRegisterPageCommand(command: PageCommand | null) {
  const runRef = useRef<() => void>(() => {});
  useEffect(() => { runRef.current = command?.run ?? (() => {}); });
  const id = command?.id ?? null;
  const label = command?.label ?? '';
  const icon = command?.icon ?? null;
  const keywords = command?.keywords?.join(' ') ?? '';
  useEffect(() => {
    if (!id || !icon) return;
    return registerPageCommand({
      id, label, icon, keywords: keywords ? keywords.split(' ') : undefined,
      run: () => runRef.current(),
    });
  }, [id, label, icon, keywords]);
}
