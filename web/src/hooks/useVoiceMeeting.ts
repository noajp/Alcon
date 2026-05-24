'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { VoiceMeetingMinutes } from '@/types/database';

// ============================================
// useVoiceMeeting hooks — power the live transcript + rolling
// meeting minutes feature for voice channels.
//
//   useVoiceSession      — resolves (find-or-create) the active
//                          voice_meeting_minutes row for a channel.
//   useVoiceTranscriber  — drives Web Speech API in the user's
//                          browser, INSERTing final phrases into
//                          voice_transcript_lines.
//   useVoiceSummarizer   — every N minutes, invokes the
//                          voice-summarize Edge Function which
//                          rewrites the markdown via Claude.
//   useVoiceMinutes      — subscribes to the minutes row over
//                          Supabase Realtime so the UI re-renders
//                          when the summary updates.
//
// Together these let VoiceChannelView mount the whole stack with a
// few lines, while keeping each piece testable and replaceable.
// ============================================

// ----- Web Speech API type bridge (browsers ship it under two names) -----
//
// We only model the slice we use. Don't import lib.dom's SpeechRecognition
// because it isn't in all TS targets yet (and Safari ships nothing).

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionResultList {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

// ============================================
// useVoiceSession — resolve the active session id
// ============================================

interface UseVoiceSessionResult {
  sessionId: string | null;
  status: 'idle' | 'resolving' | 'ready' | 'error';
  error: string | null;
}

export function useVoiceSession(
  channelId: string | null,
  enabled: boolean,
): UseVoiceSessionResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<UseVoiceSessionResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !channelId) {
      setSessionId(null);
      setStatus('idle');
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus('resolving');
    setError(null);

    (async () => {
      // 1. Look for an existing open session on this channel.
      const { data: existing, error: findErr } = await supabase
        .from('voice_meeting_minutes')
        .select('id')
        .eq('channel_id', channelId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (findErr) {
        setStatus('error');
        setError(findErr.message);
        return;
      }
      if (existing) {
        setSessionId(existing.id);
        setStatus('ready');
        return;
      }

      // 2. None open — create a fresh one. The partial unique index
      //    on (channel_id) WHERE ended_at IS NULL keeps concurrent
      //    joiners from racing two sessions, so handle 23505 by
      //    re-querying.
      const { data: inserted, error: insertErr } = await supabase
        .from('voice_meeting_minutes')
        .insert({ channel_id: channelId })
        .select('id')
        .single();
      if (cancelled) return;
      if (insertErr) {
        if (insertErr.code === '23505') {
          const { data: retry } = await supabase
            .from('voice_meeting_minutes')
            .select('id')
            .eq('channel_id', channelId)
            .is('ended_at', null)
            .maybeSingle();
          if (!cancelled && retry) {
            setSessionId(retry.id);
            setStatus('ready');
            return;
          }
        }
        setStatus('error');
        setError(insertErr.message);
        return;
      }
      if (inserted) {
        setSessionId(inserted.id);
        setStatus('ready');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId, enabled]);

  return { sessionId, status, error };
}

// ============================================
// useVoiceTranscriber — Web Speech API → DB inserts
// ============================================

interface UseVoiceTranscriberParams {
  sessionId: string | null;
  channelId: string;
  speakerId: string;
  speakerName: string;
  enabled: boolean;
  /** BCP-47 language tag — defaults to 'ja-JP'. */
  lang?: string;
}

interface UseVoiceTranscriberResult {
  /** True while a SpeechRecognition is actively listening. */
  listening: boolean;
  /** Whether this browser supports the API at all. */
  supported: boolean;
  /** Last non-fatal error from the recognizer, surface-able in UI. */
  error: string | null;
}

export function useVoiceTranscriber({
  sessionId,
  channelId,
  speakerId,
  speakerName,
  enabled,
  lang = 'ja-JP',
}: UseVoiceTranscriberParams): UseVoiceTranscriberResult {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = isSpeechRecognitionSupported();

  // We keep mutable refs so the recognizer callbacks always read the
  // current session id / speaker info even if React re-renders.
  const sessionIdRef = useRef(sessionId);
  const speakerIdRef = useRef(speakerId);
  const speakerNameRef = useRef(speakerName);
  const channelIdRef = useRef(channelId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    speakerIdRef.current = speakerId;
  }, [speakerId]);
  useEffect(() => {
    speakerNameRef.current = speakerName;
  }, [speakerName]);
  useEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId]);

  useEffect(() => {
    if (!enabled || !sessionId || !supported) {
      setListening(false);
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    let shouldRun = true;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const text = (result[0]?.transcript ?? '').trim();
        if (!text) continue;
        const currentSession = sessionIdRef.current;
        if (!currentSession) continue;
        // Fire-and-forget — we don't want to block subsequent results
        // on the network round-trip.
        supabase
          .from('voice_transcript_lines')
          .insert({
            session_id: currentSession,
            channel_id: channelIdRef.current,
            speaker_id: speakerIdRef.current,
            speaker_name: speakerNameRef.current,
            text,
          })
          .then(({ error: insertErr }) => {
            if (insertErr) {
              console.warn('[voice-transcriber] insert failed', insertErr);
            }
          });
      }
    };

    recognition.onerror = (event) => {
      // 'no-speech' / 'aborted' are routine — not worth surfacing.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(event.error);
      console.warn('[voice-transcriber] error', event.error);
    };

    recognition.onend = () => {
      // Chrome drops the connection every ~60s. Re-start until the
      // hook unmounts.
      if (!shouldRun) {
        setListening(false);
        return;
      }
      try {
        recognition.start();
      } catch (e) {
        console.warn('[voice-transcriber] restart failed', e);
        setListening(false);
      }
    };

    try {
      recognition.start();
      setListening(true);
    } catch (e) {
      console.warn('[voice-transcriber] initial start failed', e);
      setError((e as Error).message);
    }

    return () => {
      shouldRun = false;
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      setListening(false);
    };
  }, [enabled, sessionId, supported, lang]);

  return { listening, supported, error };
}

// ============================================
// useVoiceSummarizer — periodic Edge Function trigger
// ============================================

interface UseVoiceSummarizerParams {
  sessionId: string | null;
  enabled: boolean;
  /** Milliseconds between summarize calls. Defaults to 3 minutes. */
  intervalMs?: number;
}

export function useVoiceSummarizer({
  sessionId,
  enabled,
  intervalMs = 3 * 60 * 1000,
}: UseVoiceSummarizerParams) {
  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;

    const tick = async () => {
      const { error: invokeErr } = await supabase.functions.invoke(
        'voice-summarize',
        { body: { sessionId } },
      );
      if (!cancelled && invokeErr) {
        console.warn('[voice-summarizer] invoke failed', invokeErr);
      }
    };

    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, sessionId, intervalMs]);
}

// ============================================
// useVoiceMinutes — Realtime subscription to the minutes row
// ============================================

export function useVoiceMinutes(sessionId: string | null): VoiceMeetingMinutes | null {
  const [minutes, setMinutes] = useState<VoiceMeetingMinutes | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setMinutes(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('voice_meeting_minutes')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();
      if (!cancelled && data) setMinutes(data);
    })();

    const channel = supabase
      .channel(`voice_meeting_minutes:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'voice_meeting_minutes',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (cancelled) return;
          setMinutes(payload.new as VoiceMeetingMinutes);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return minutes;
}

// ============================================
// endVoiceSession — manually close the active session (used by the
// "End session" affordance in the Minutes tab and by the
// onDisconnected leave handler when we know we were the last
// participant).
// ============================================

export async function endVoiceSession(sessionId: string): Promise<void> {
  const { error: updateErr } = await supabase
    .from('voice_meeting_minutes')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (updateErr) {
    console.warn('[voice-session] end failed', updateErr);
  }
}
