'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================
// useTypingIndicator — Teams-style "X が入力中…" via Supabase Realtime
// broadcast (no DB writes). The composer calls notifyTyping() on keystrokes
// (throttled here); peers show the name until it goes quiet for EXPIRE_MS.
// ============================================

const THROTTLE_MS = 1500; // min gap between broadcasts while typing
const EXPIRE_MS = 4000;   // hide a peer this long after their last signal

interface TypingPeer {
  name: string;
  expiresAt: number;
}

export function useTypingIndicator(
  conversationId: string | null,
  myId: string | null,
  myName: string,
) {
  const [peers, setPeers] = useState<Map<string, TypingPeer>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    setPeers(new Map());
    if (!conversationId) return;
    const ch = supabase.channel(`typing:${conversationId}`);
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const p = payload as { userId: string; name: string };
      if (!p?.userId || p.userId === myId) return;
      setPeers((prev) => {
        const next = new Map(prev);
        next.set(p.userId, { name: p.name, expiresAt: Date.now() + EXPIRE_MS });
        return next;
      });
    });
    ch.subscribe();
    channelRef.current = ch;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [conversationId, myId]);

  // Prune expired peers on a coarse tick (only while someone is typing).
  useEffect(() => {
    if (peers.size === 0) return;
    const t = setInterval(() => {
      setPeers((prev) => {
        const now = Date.now();
        const next = new Map([...prev].filter(([, v]) => v.expiresAt > now));
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [peers.size]);

  const notifyTyping = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !myId) return;
    const now = Date.now();
    if (now - lastSentRef.current < THROTTLE_MS) return;
    lastSentRef.current = now;
    void ch.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, name: myName } });
  }, [myId, myName]);

  const typingNames = [...peers.values()].map((p) => p.name);
  return { typingNames, notifyTyping };
}
