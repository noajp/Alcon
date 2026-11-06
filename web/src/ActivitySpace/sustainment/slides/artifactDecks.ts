'use client';

import { placeDeck } from '@/hooks/artifactData';
import { createDeckHere } from './SlidesSidebar';
import { slidesReady } from './sync';
import { useKata } from './kata/store/useKata';

// Decks made or opened from Artifacts. Slides loads its decks once its view
// mounts, so each waits for that first.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const whenReady = async () => { for (let i = 0; i < 100 && !slidesReady(); i++) await wait(100); };

/** Makes a deck and puts it in `folderId` once Slides has saved it. */
export async function createDeckInFolder(folderId: string | null): Promise<string | null> {
  await whenReady();
  const id = createDeckHere();
  if (!id || !folderId) return id;
  for (let i = 0; i < 60; i++) {
    if (await placeDeck(id, folderId)) return id;
    await wait(250);
  }
  return id;
}

/** Opens a deck in Slides. */
export async function openDeck(id: string): Promise<void> {
  await whenReady();
  useKata.getState().selectFile(id);
}
