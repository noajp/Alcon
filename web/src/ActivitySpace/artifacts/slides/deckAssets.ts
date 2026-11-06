'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Deck } from './kata/model/types';

// Pictures on a deck live in the private `deck-assets` bucket, not in the
// deck's JSON. A picture placed or imported arrives as a data URL; before a
// deck is written, each one is stored once per Space under the hash of its
// bytes and the deck keeps only a reference to it — the row stays small
// enough to save and to reach other viewers over Realtime, and the same
// picture on many slides is one object. A reference is shown through a
// short-lived signed link, and read back to bytes where a picture must
// travel with the deck (a .pptx, a .kata.json).

const BUCKET = 'deck-assets';
const PREFIX = 'deck-asset:';
const LINK_SECONDS = 3600;

const isData = (src: string) => src.startsWith('data:');
const pathOf = (src: string) => (src.startsWith(PREFIX) ? src.slice(PREFIX.length) : null);

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/** The bytes and type in a data URL. */
function decode(src: string): { bytes: Uint8Array; type: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(src);
  if (!m) return null;
  const type = m[1] || 'application/octet-stream';
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, type };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), type };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A data URL already stored this session, by the string itself.
const stored = new Map<string, Promise<string>>();

/** Stores one picture (if it is not stored yet) and returns its reference. */
function store(src: string, spaceId: string): Promise<string> {
  const key = `${spaceId}|${src}`;
  let done = stored.get(key);
  if (!done) {
    done = (async () => {
      const data = decode(src);
      if (!data) return src;
      const path = `${spaceId}/${await sha256(data.bytes)}.${EXT[data.type] ?? 'bin'}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([data.bytes as BlobPart], { type: data.type }), { contentType: data.type, upsert: false });
      // The same picture stored before (by anyone in the Space) is the same object.
      if (error && !/exists|duplicate/i.test(error.message)) throw error;
      return PREFIX + path;
    })();
    done.catch(() => stored.delete(key));
    stored.set(key, done);
  }
  return done;
}

/** The deck with every placed picture stored and referenced. The same deck
 *  (not a copy) when it holds no data URL. */
export async function externalizeDeck(deck: Deck, spaceId: string): Promise<Deck> {
  if (!deck.slides.some((s) => s.objects?.some((o) => o.src && isData(o.src)))) return deck;
  const slides = await Promise.all(deck.slides.map(async (slide) => {
    if (!slide.objects?.some((o) => o.src && isData(o.src))) return slide;
    const objects = await Promise.all(slide.objects.map(async (o) => (o.src && isData(o.src) ? { ...o, src: await store(o.src, spaceId) } : o)));
    return { ...slide, objects };
  }));
  return { ...deck, slides };
}

// Signed links, by path, until shortly before they lapse.
const links = new Map<string, { url: Promise<string>; until: number }>();

function linkFor(path: string): Promise<string> {
  const hit = links.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const url = supabase.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS).then(({ data, error }) => {
    if (error || !data?.signedUrl) throw error ?? new Error('Could not open the picture.');
    return data.signedUrl;
  });
  url.catch(() => links.delete(path));
  links.set(path, { url, until: Date.now() + (LINK_SECONDS - 300) * 1000 });
  return url;
}

/** A picture's src as an <img> can load it: a stored picture's signed link
 *  (null while it is fetched), anything else as it is. */
export function useAssetSrc(src: string | undefined): string | null {
  const path = src ? pathOf(src) : null;
  const [link, setLink] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    linkFor(path).then((url) => { if (live) setLink({ path, url }); }).catch(() => {});
    return () => { live = false; };
  }, [path]);
  if (!src) return null;
  if (!path) return src;
  return link?.path === path ? link.url : null;
}

/** The deck with stored pictures read back into data URLs, for a file that
 *  carries its pictures with it. */
export async function inlineDeck(deck: Deck): Promise<Deck> {
  const read = new Map<string, Promise<string>>();
  const inline = (path: string) => {
    let done = read.get(path);
    if (!done) {
      done = supabase.storage.from(BUCKET).download(path).then(({ data, error }) => {
        if (error || !data) throw error ?? new Error('Could not read the picture.');
        return new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(data);
        });
      });
      read.set(path, done);
    }
    return done;
  };
  const slides = await Promise.all(deck.slides.map(async (slide) => {
    if (!slide.objects?.some((o) => o.src && pathOf(o.src))) return slide;
    const objects = await Promise.all(slide.objects.map(async (o) => {
      const path = o.src ? pathOf(o.src) : null;
      return path ? { ...o, src: await inline(path) } : o;
    }));
    return { ...slide, objects };
  }));
  return { ...deck, slides };
}
