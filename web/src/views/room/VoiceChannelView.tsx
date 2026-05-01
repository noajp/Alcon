'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Volume2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type { Channel } from '@/types/database';

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

function PreJoin({ channel, onJoin, busy, error }: {
  channel: Channel;
  onJoin: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <ChannelHeader channel={channel} />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
            <Volume2 size={24} />
          </div>
          <h2 className="text-[15px] font-semibold text-foreground mb-1">{channel.name}</h2>
          <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
            この voice channel に参加してマイクで会話できます。
          </p>
          {error && (
            <p className="text-[11px] text-destructive leading-relaxed mb-3 break-words">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onJoin}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 h-9 rounded-md bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Joining…' : 'Join voice'}
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

export function VoiceChannelView({ channel }: { channel: Channel }) {
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
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={true}
      audio={true}
      video={false}
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
  );
}
