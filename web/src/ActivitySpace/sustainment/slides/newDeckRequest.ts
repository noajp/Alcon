'use client';

import { useEffect } from 'react';
import { useKata } from './kata/store/useKata';
import { tx } from './kata/i18n';
import { slidesReady } from './sync';

// A new, named deck asked for from outside Slides (an Element's "Open in →
// Slides"). The decks of the Space may not be loaded yet — a deck made before
// the load would be replaced by it — so the request waits until Slides has
// them, then makes the deck and opens it.

let pending: string | null = null;

function make(name: string) {
  const st = useKata.getState();
  const active = st.files.find((x) => x.id === st.activeFileId);
  st.createFile(active?.folderId ?? st.folders[0]?.id ?? st.createFolder(tx('マイ資料', 'My decks')), name);
}

/** Makes a deck named `name` and opens it — now if the decks are loaded,
 *  else as soon as Slides has loaded them. */
export function requestNewDeck(name: string): void {
  if (slidesReady()) make(name);
  else pending = name;
}

/** Slides calls this with whether its decks are loaded; a waiting request is
 *  fulfilled once they are. */
export function useNewDeckRequest(ready: boolean): void {
  useEffect(() => {
    if (!ready || pending === null) return;
    const name = pending;
    pending = null;
    make(name);
  }, [ready]);
}
