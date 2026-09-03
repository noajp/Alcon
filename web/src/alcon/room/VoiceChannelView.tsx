'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import {
  Volume2,
  Video,
  Captions,
  Loader2,
  FileText,
  Mic,
  MicOff,
  CircleStop,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import {
  useVoiceSession,
  useVoiceTranscriber,
  useVoiceTranscript,
  useVoiceSummarizer,
  useVoiceMinutes,
  endVoiceSession,
} from '@/hooks/useVoiceMeeting';
import type { Channel, VoiceMeetingMinutes, VoiceTranscriptLine } from '@/types/database';
import { TextChannelContent } from './TextChannelView';
import { MessageIcon } from '@/alcon/shared/conceptIcons';

function ChannelHeader({ channel, participantCount }: { channel: Channel; participantCount?: number }) {
  return (
    <div className="h-12 flex items-center gap-2 px-4 border-b border-border/60 flex-shrink-0">
      <Volume2 size={18} className="text-muted-foreground" />
      <span className="text-[14px] font-semibold text-foreground">{channel.name}</span>
      {channel.topic && (
        <>
          <span className="w-px h-5 bg-border/60 mx-2" />
          <span className="text-[12px] text-muted-foreground truncate">{channel.topic}</span>
        </>
      )}
      {typeof participantCount === 'number' && (
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {participantCount} connected
        </span>
      )}
    </div>
  );
}


// Map LiveKit / browser permission errors to a clearer human message.
// `getUserMedia` typically rejects with "Permission denied", "Permission
// dismissed", or a NotAllowedError. The same message string shows up in
// some sandboxed preview environments where the mic API isn't available
// at all — we surface a hint either way.
function friendlyJoinError(raw: string): { title: string; hint: string | null } {
  const lower = raw.toLowerCase();
  if (
    lower.includes('permission denied') ||
    lower.includes('permission dismissed') ||
    lower.includes('notallowed') ||
    lower.includes('not allowed')
  ) {
    return {
      title: "Microphone access blocked",
      hint: "Click the lock icon in the address bar and allow microphone access, then retry. Sandboxed preview windows may block mic access entirely.",
    };
  }
  if (lower.includes('notfound') || lower.includes('devicenotfound')) {
    return {
      title: "No microphone detected",
      hint: "Make sure a microphone is plugged in and selected as the default input device.",
    };
  }
  if (lower.includes('insecure') || lower.includes('secure context')) {
    return {
      title: "Secure connection required",
      hint: "Microphone access only works over HTTPS or on localhost.",
    };
  }
  return { title: raw || 'Failed to join voice', hint: null };
}

function PreJoin({ channel, onJoin, busy, error }: {
  channel: Channel;
  onJoin: () => void;
  busy: boolean;
  error: string | null;
}) {
  const friendly = error ? friendlyJoinError(error) : null;
  return (
    <div className="flex-1 flex flex-col">
      <ChannelHeader channel={channel} />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
            <Video size={24} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground mb-1">{channel.name}</h2>
          <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
            カメラとマイクでビデオ会議に参加します。<br />
            発言は自動で文字起こしされ、議事録にまとまります。
          </p>
          {friendly && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-left">
              <p className="text-[12px] font-semibold text-destructive mb-0.5">
                {friendly.title}
              </p>
              {friendly.hint && (
                <p className="text-[11px] text-destructive/80 leading-relaxed">
                  {friendly.hint}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onJoin}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 h-9 rounded-md bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Joining…' : friendly ? 'Retry' : 'Join meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ParticipantStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  return (
    <div className="flex-1 min-h-0 p-3">
      <GridLayout tracks={tracks} className="h-full">
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}

// Pick the text channel that pairs with this voice channel for the
// in-call chat sidepanel. Priority:
//   1. same name (case-insensitive)
//   2. first text channel in the room
// Returns null when no text channels exist.
function pickChatChannel(siblings: Channel[], voice: Channel): Channel | null {
  const texts = siblings.filter((c) => c.kind === 'text');
  if (texts.length === 0) return null;
  const sameName = texts.find((c) => c.name.toLowerCase() === voice.name.toLowerCase());
  return sameName ?? texts[0];
}

// ---------------------------------------------------------------------------
// MinutesRenderer — a tiny markdown subset renderer good enough for the
// shape Claude emits in voice-summarize (## headings, - bullets, plain
// paragraphs, **bold** spans). Avoids adding react-markdown as a dep
// when the document grammar is this small.
// ---------------------------------------------------------------------------

function renderInline(text: string, keyBase: string): React.ReactNode {
  // Split on **bold** and apply font-medium.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <span key={`${keyBase}-b-${i}`} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </span>
      );
    }
    return <React.Fragment key={`${keyBase}-t-${i}`}>{part}</React.Fragment>;
  });
}

function MinutesRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  return (
    <div className="text-[12px] leading-relaxed text-muted-foreground">
      {lines.map((line, i) => {
        const trimmed = line.trimEnd();
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={i} className="text-[12px] font-semibold mt-2 mb-0.5 text-foreground">
              {renderInline(trimmed.slice(4), `h4-${i}`)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={i} className="text-[13px] font-semibold mt-3 mb-1 text-foreground">
              {renderInline(trimmed.slice(3), `h3-${i}`)}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={i} className="text-[14px] font-bold mt-3 mb-1 text-foreground">
              {renderInline(trimmed.slice(2), `h2-${i}`)}
            </h2>
          );
        }
        if (/^\s*[-*]\s/.test(trimmed)) {
          const content = trimmed.replace(/^\s*[-*]\s/, '');
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="select-none text-muted-foreground/60">•</span>
              <span>{renderInline(content, `li-${i}`)}</span>
            </div>
          );
        }
        if (trimmed === '') {
          return <div key={i} className="h-1.5" />;
        }
        return <p key={i}>{renderInline(trimmed, `p-${i}`)}</p>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TranscriberStatus — shared status line surfacing whether the local
// transcriber is actually listening. Reused by the Live and Minutes tabs.
// ---------------------------------------------------------------------------

function TranscriberStatus({
  listening,
  supported,
  error,
  hint,
}: {
  listening: boolean;
  supported: boolean;
  error: string | null;
  hint: string;
}) {
  return (
    <div className="px-4 py-2 border-b border-border/60 flex items-center gap-2 text-[11px]">
      {!supported ? (
        <>
          <MicOff size={12} className="text-muted-foreground" />
          <span className="text-muted-foreground">
            このブラウザは文字起こし非対応 (Chrome / Edge 推奨)
          </span>
        </>
      ) : listening ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <Mic size={12} className="text-emerald-600" />
          <span className="text-foreground/70">録音中・{hint}</span>
        </>
      ) : (
        <>
          <MicOff size={12} className="text-muted-foreground" />
          <span className="text-muted-foreground">
            {error ? `Mic: ${error}` : '待機中'}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TranscriptPanel — the live captions feed. Committed lines stream in over
// Realtime (every participant's browser); the local speaker's in-progress
// phrase shows as a dimmed "…" line at the bottom. Auto-scrolls to follow.
// ---------------------------------------------------------------------------

function TranscriptPanel({
  lines,
  interim,
  listening,
  supported,
  error,
}: {
  lines: VoiceTranscriptLine[];
  interim: string;
  listening: boolean;
  supported: boolean;
  error: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, interim]);

  const empty = lines.length === 0 && !interim;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TranscriberStatus listening={listening} supported={supported} error={error} hint="自動文字起こし" />
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5">
        {empty ? (
          <div className="h-full flex items-center justify-center text-center">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              話し始めると、ここに文字起こしが<br />
              リアルタイムで流れます。
            </p>
          </div>
        ) : (
          <>
            {lines.map((l) => (
              <div key={l.id} className="text-[12px] leading-relaxed">
                <span className="font-medium text-foreground">{l.speaker_name}</span>
                <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground/50">
                  {new Date(l.spoken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="block text-muted-foreground">{l.text}</span>
              </div>
            ))}
            {interim && (
              <div className="text-[12px] leading-relaxed opacity-50">
                <span className="block italic text-muted-foreground">{interim}…</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MinutesPanel — renders the rolling draft minutes during the call and the
// confirmed final minutes once the session ends. The "End & まとめ"
// affordance triggers the final-synthesis Edge Function.
// ---------------------------------------------------------------------------

interface MinutesPanelProps {
  sessionId: string | null;
  minutes: VoiceMeetingMinutes | null;
  listening: boolean;
  transcriberSupported: boolean;
  transcriberError: string | null;
}

function MinutesPanel({
  sessionId,
  minutes,
  listening,
  transcriberSupported,
  transcriberError,
}: MinutesPanelProps) {
  const [ending, setEnding] = useState(false);
  const finalMd = minutes?.final_markdown?.trim() ?? '';
  const draftMd = minutes?.markdown?.trim() ?? '';
  const displayMd = finalMd || draftMd;
  const hasContent = !!displayMd;
  const finalized = !!finalMd;

  const onEnd = useCallback(async () => {
    if (!sessionId) return;
    setEnding(true);
    await endVoiceSession(sessionId);
    setEnding(false);
  }, [sessionId]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TranscriberStatus listening={listening} supported={transcriberSupported} error={transcriberError} hint="3 分ごとに要約" />

      {hasContent && (
        <div className="px-4 pt-2.5 pb-0.5 flex items-center gap-1.5">
          {finalized ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
              <CheckCircle2 size={11} /> 確定議事録
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">ドラフト・3 分ごとに自動更新</span>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {ending && !finalized ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
            <p className="text-[12px] text-muted-foreground">最終議事録を生成中…</p>
          </div>
        ) : hasContent ? (
          <MinutesRenderer markdown={displayMd} />
        ) : (
          <div className="h-full flex items-center justify-center text-center">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              議事録は会話開始から数分後に<br />
              最初のドラフトが出ます。
            </p>
          </div>
        )}
      </div>

      {sessionId && (
        <div className="px-3 py-2 border-t border-border/60 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {minutes?.last_summarized_at
              ? `更新: ${new Date(minutes.last_summarized_at).toLocaleTimeString()}`
              : '未要約'}
          </span>
          {finalized ? (
            <span className="inline-flex items-center gap-1 px-2 h-7 text-[11px] text-emerald-600">
              <CheckCircle2 size={12} /> 確定済み
            </span>
          ) : (
            <button
              type="button"
              onClick={onEnd}
              disabled={ending || !draftMd}
              className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              title="この session を終了して最終議事録を生成"
            >
              {ending ? <Loader2 size={12} className="animate-spin" /> : <CircleStop size={12} />}
              {ending ? 'まとめ生成中…' : 'End & まとめ'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatSidepanel — tabbed (Chat | Live | Minutes) panel docked beside the
// call. Owns the transcription stack (useVoiceTranscriber +
// useVoiceTranscript) so the high-frequency caption re-renders stay inside
// this subtree and never reach the sibling LiveKitRoom canvas.
// ---------------------------------------------------------------------------

type SidepanelTab = 'chat' | 'live' | 'minutes';

interface ChatSidepanelProps {
  chatChannel: Channel | null;
  sessionId: string | null;
  channelId: string;
  speakerId: string;
  speakerName: string;
  /** True once the LiveKit connection is up — gates the transcriber. */
  connected: boolean;
  minutes: VoiceMeetingMinutes | null;
}

function ChatSidepanel({
  chatChannel,
  sessionId,
  channelId,
  speakerId,
  speakerName,
  connected,
  minutes,
}: ChatSidepanelProps) {
  const [tab, setTab] = useState<SidepanelTab>('live');

  // Transcription runs for the whole call regardless of the active tab,
  // because this panel stays mounted while connected.
  const transcriber = useVoiceTranscriber({
    sessionId,
    channelId,
    speakerId,
    speakerName,
    enabled: connected && !!speakerId,
  });
  const transcript = useVoiceTranscript(sessionId);

  return (
    <aside className="w-[320px] shrink-0 flex flex-col border-l border-border/60 bg-card min-h-0">
      {/* Tab bar */}
      <div className="h-12 flex items-center px-2 border-b border-border/60 flex-shrink-0 gap-1">
        <TabButton
          active={tab === 'chat'}
          onClick={() => setTab('chat')}
          icon={<MessageIcon size={14} />}
          label="Chat"
          sub={chatChannel ? `#${chatChannel.name}` : undefined}
        />
        <TabButton
          active={tab === 'live'}
          onClick={() => setTab('live')}
          icon={<Captions size={14} />}
          label="Live"
        />
        <TabButton
          active={tab === 'minutes'}
          onClick={() => setTab('minutes')}
          icon={<FileText size={14} />}
          label="Minutes"
        />
      </div>

      {tab === 'chat' ? (
        chatChannel ? (
          <TextChannelContent channel={chatChannel} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-center px-6">
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              この Room に text channel がまだありません。<br />
              text channel を作るとここに表示されます。
            </p>
          </div>
        )
      ) : tab === 'live' ? (
        <TranscriptPanel
          lines={transcript}
          interim={transcriber.interim}
          listening={transcriber.listening}
          supported={transcriber.supported}
          error={transcriber.error}
        />
      ) : (
        <MinutesPanel
          sessionId={sessionId}
          minutes={minutes}
          listening={transcriber.listening}
          transcriberSupported={transcriber.supported}
          transcriberError={transcriber.error}
        />
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex-1 h-8 px-2 inline-flex items-center justify-center gap-1.5 rounded-md text-[12px] transition-colors ' +
        (active
          ? 'bg-muted text-foreground font-semibold'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60')
      }
    >
      {icon}
      <span>{label}</span>
      {sub && active && (
        <span className="text-[11px] text-muted-foreground font-normal ml-1 truncate max-w-[80px]">
          {sub}
        </span>
      )}
    </button>
  );
}

interface VoiceChannelViewProps {
  channel: Channel;
  /** Sibling channels in the same room — used to find the paired text
   *  channel for the in-call chat sidepanel. */
  channels?: Channel[];
}

export function VoiceChannelView({ channel, channels = [] }: VoiceChannelViewProps) {
  const { user, profile } = useAuthContext();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset token when channel changes (so we re-join the new channel's room)
  useEffect(() => {
    setToken(null);
    setServerUrl(null);
    setError(null);
  }, [channel.id]);

  const displayName = useMemo(
    () => profile?.display_name ?? user?.email ?? 'Guest',
    [profile, user]
  );
  const chatChannel = useMemo(() => pickChatChannel(channels, channel), [channels, channel]);

  // Voice meeting stack — bound to "we have a LiveKit connection" so we
  // don't churn DB rows for users sitting on the PreJoin screen.
  const connected = !!(token && serverUrl);
  const speakerId = user?.id ?? '';
  const { sessionId } = useVoiceSession(channel.id, connected);
  // The transcriber + live transcript hooks live inside ChatSidepanel so
  // their frequent caption re-renders never reach the LiveKit canvas.
  useVoiceSummarizer({ sessionId, enabled: connected });
  const minutes = useVoiceMinutes(sessionId);

  const handleJoin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        token: string;
        url: string;
      }>('livekit-token', {
        body: { channelId: channel.id, displayName },
      });
      if (invokeErr) throw invokeErr;
      if (!data?.token || !data?.url) throw new Error('No token returned');
      setToken(data.token);
      setServerUrl(data.url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to join voice';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [channel.id, displayName]);

  const handleDisconnect = useCallback(() => {
    setToken(null);
    setServerUrl(null);
  }, []);

  if (!token || !serverUrl) {
    return <PreJoin channel={channel} onJoin={handleJoin} busy={busy} error={error} />;
  }

  return (
    // Two-column shell so the chat sidepanel sits beside the call. A
    // brighter `bg-muted/30` lifts the LiveKit canvas off the page so
    // the empty void around the participant tile reads as a stage
    // rather than a black slab.
    <div className="flex-1 flex min-h-0 bg-muted/30">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        audio={true}
        video={true}
        onDisconnected={handleDisconnect}
        onError={(e) => setError(e.message)}
        data-lk-theme="default"
        className="flex-1 flex flex-col min-h-0"
      >
        <ChannelHeader channel={channel} />
        <ParticipantStage />
        <RoomAudioRenderer />
        <div className="px-3 pb-3 pt-1 border-t border-border/60 flex-shrink-0">
          <ControlBar variation="minimal" controls={{ microphone: true, camera: true, screenShare: true, leave: true }} />
        </div>
      </LiveKitRoom>
      <ChatSidepanel
        chatChannel={chatChannel}
        sessionId={sessionId}
        channelId={channel.id}
        speakerId={speakerId}
        speakerName={displayName}
        connected={connected}
        minutes={minutes}
      />
    </div>
  );
}
