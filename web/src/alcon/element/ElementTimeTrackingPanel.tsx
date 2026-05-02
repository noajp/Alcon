'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Trash2, Plus, Timer } from 'lucide-react';
import {
  fetchTimeEntries,
  startTimer,
  stopTimer,
  logTime,
  deleteTimeEntry,
  getRunningTimer,
  type TimeEntry,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';

interface Props {
  elementId: string;
  estimatedHours: number | null;
  onRefresh?: () => void;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ElementTimeTrackingPanel({ elementId, estimatedHours, onRefresh }: Props) {
  const { user, profile } = useAuthContext();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [logHours, setLogHours] = useState('');
  const [showLog, setShowLog] = useState(false);
  const tickRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const [e, r] = await Promise.all([
      fetchTimeEntries(elementId),
      getRunningTimer(user.id),
    ]);
    setEntries(e);
    setRunning(r && r.element_id === elementId ? r : null);
  }, [elementId, user]);

  useEffect(() => { reload().catch(console.error); }, [reload]);

  useEffect(() => {
    if (!running) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    tickRef.current = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [running]);

  const totalSec = useMemo(
    () => entries.reduce((sum, e) => sum + (e.duration_sec || 0), 0),
    [entries],
  );
  const liveSec = useMemo(() => {
    if (!running) return 0;
    return Math.floor((nowMs - new Date(running.started_at).getTime()) / 1000);
  }, [running, nowMs]);
  const grandTotalSec = totalSec + liveSec;

  const onStart = async () => {
    if (!user) return;
    const userName = profile?.display_name || user.email?.split('@')[0];
    await startTimer({ elementId, userId: user.id, userName });
    await reload();
    onRefresh?.();
  };

  const onStop = async () => {
    if (!running) return;
    await stopTimer(running.id);
    await reload();
    onRefresh?.();
  };

  const onLog = async () => {
    if (!user) return;
    const hours = parseFloat(logHours);
    if (!isFinite(hours) || hours <= 0) return;
    const userName = profile?.display_name || user.email?.split('@')[0];
    await logTime({
      elementId,
      userId: user.id,
      userName,
      durationSec: Math.round(hours * 3600),
    });
    setLogHours('');
    setShowLog(false);
    await reload();
    onRefresh?.();
  };

  const onDelete = async (id: string) => {
    await deleteTimeEntry(id);
    await reload();
    onRefresh?.();
  };

  const estimatedSec = estimatedHours ? estimatedHours * 3600 : 0;
  const progress = estimatedSec > 0 ? Math.min(100, (grandTotalSec / estimatedSec) * 100) : 0;
  const over = estimatedSec > 0 && grandTotalSec > estimatedSec;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">Time Tracking</span>
        </div>
        <button
          onClick={() => setShowLog(s => !s)}
          className="text-muted-foreground hover:text-foreground"
          title="Log time manually"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Big timer */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-mono tabular-nums text-foreground">
              {formatDuration(grandTotalSec)}
            </div>
            {estimatedHours && (
              <div className="text-[11px] text-muted-foreground">
                of {estimatedHours}h estimated
              </div>
            )}
          </div>
          {running ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/15 text-red-300 hover:bg-red-500/25 rounded-md text-[13px] transition-colors"
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={!user}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 rounded-md text-[13px] transition-colors disabled:opacity-50"
            >
              <Play size={12} /> Start
            </button>
          )}
        </div>

        {estimatedHours ? (
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-emerald-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : null}

        {showLog && (
          <div className="border-t border-border pt-3 space-y-2">
            <input
              type="number"
              step="0.25"
              min="0"
              value={logHours}
              onChange={(e) => setLogHours(e.target.value)}
              placeholder="Hours (e.g. 1.5)"
              className="w-full px-2 py-1.5 text-[13px] bg-muted/30 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowLog(false); setLogHours(''); }}
                className="px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-muted rounded"
              >Cancel</button>
              <button
                onClick={onLog}
                disabled={!logHours}
                className="px-2.5 py-1 text-[12px] bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >Log</button>
            </div>
          </div>
        )}

        {entries.length > 0 && (
          <div className="border-t border-border pt-2 space-y-1.5 max-h-40 overflow-auto">
            {entries.slice(0, 8).map(e => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-[12px] group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono tabular-nums text-foreground">
                      {e.duration_sec ? formatDuration(e.duration_sec) : '— running'}
                    </span>
                    <span className="text-muted-foreground truncate">· {e.user_name || 'Unknown'}</span>
                  </div>
                  <div className="text-muted-foreground/80 text-[11px]">{formatRelative(e.started_at)}</div>
                </div>
                <button
                  onClick={() => onDelete(e.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
