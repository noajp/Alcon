'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import {
  Check,
  CircleDot,
  Clock,
  Flag,
  Image as ImageIcon,
  MapPin,
  MousePointer2,
  Palette,
  Plus,
  Square,
  Tag,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { TYPE_META, OVERLAY_COLOR_SWATCHES, DEFAULT_OVERLAY_COLOR, type FlagType } from './customColorScheme';

type MediaKind = 'image' | 'video';
type Tool = 'select' | 'pin' | 'box' | 'polygon';
type FlagShape = 'pin' | 'box' | 'polygon';
type FlagPriority = 'low' | 'normal' | 'high' | 'critical';

type Point = { x: number; y: number };

interface MediaAsset {
  name: string;
  kind: MediaKind;
  src: string;
}

interface CustomFlag {
  id: string;
  shape: FlagShape;
  type: FlagType;
  priority: FlagPriority;
  label: string;
  notes: string;
  linkedElementId: string | null;
  mediaTime: number | null;
  x: number;
  y: number;
  w?: number;
  h?: number;
  points?: Point[];
  createdAt: string;
}

interface DraftBox {
  start: Point;
  current: Point;
}

interface ContextMenuState {
  x: number;
  y: number;
  point: Point | null;
  flagId: string | null;
}

interface CustomViewProps {
  scopeId: string;
  scopeLabel?: string | null;
  elements?: ElementWithDetails[];
}

const PRIORITY_META: Record<FlagPriority, { label: string; className: string }> = {
  low: { label: 'Low', className: 'text-zinc-400' },
  normal: { label: 'Normal', className: 'text-zinc-100' },
  high: { label: 'High', className: 'text-amber-300' },
  critical: { label: 'Critical', className: 'text-[var(--status-danger)]' },
};

const TOOL_META: Array<{ id: Tool; label: string; icon: React.ReactNode }> = [
  { id: 'select', label: 'Select', icon: <MousePointer2 size={14} /> },
  { id: 'pin', label: 'Pin', icon: <MapPin size={14} /> },
  { id: 'box', label: 'Box', icon: <Square size={14} /> },
  { id: 'polygon', label: 'Area', icon: <CircleDot size={14} /> },
];

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

function pctFromEvent(e: React.PointerEvent | React.MouseEvent, el: HTMLElement): Point {
  const rect = el.getBoundingClientRect();
  return {
    x: clampPct(((e.clientX - rect.left) / rect.width) * 100),
    y: clampPct(((e.clientY - rect.top) / rect.height) * 100),
  };
}

function timeLabel(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

function storageKey(scopeId: string) {
  return `alcon:custom-view:${scopeId}`;
}

function loadStoredFlags(scopeId: string): CustomFlag[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(scopeId));
    return raw ? JSON.parse(raw) as CustomFlag[] : [];
  } catch {
    return [];
  }
}

function newFlag(partial: Pick<CustomFlag, 'shape' | 'x' | 'y'> & Partial<CustomFlag>): CustomFlag {
  return {
    id: `flag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    shape: partial.shape,
    type: partial.type ?? 'unknown',
    priority: partial.priority ?? 'normal',
    label: partial.label ?? '',
    notes: partial.notes ?? '',
    linkedElementId: partial.linkedElementId ?? null,
    mediaTime: partial.mediaTime ?? null,
    x: partial.x,
    y: partial.y,
    w: partial.w,
    h: partial.h,
    points: partial.points,
    createdAt: new Date().toISOString(),
  };
}

export function CustomView({ scopeId, scopeLabel, elements = [] }: CustomViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaUrlRef = useRef<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [media, setMedia] = useState<MediaAsset | null>(null);
  const [tool, setTool] = useState<Tool>('pin');
  const [flags, setFlags] = useState<CustomFlag[]>(() => loadStoredFlags(scopeId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [overlayColor, setOverlayColor] = useState(DEFAULT_OVERLAY_COLOR);
  const [showLabels, setShowLabels] = useState(true);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(scopeId), JSON.stringify(flags));
    } catch {
      // Annotation state remains in memory if storage quota is unavailable.
    }
  }, [flags, scopeId]);

  useEffect(() => () => {
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
  }, []);

  useEscapeLayer(menu !== null, () => setMenu(null));
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const selectedFlag = useMemo(
    () => flags.find((flag) => flag.id === selectedId) ?? null,
    [flags, selectedId],
  );

  const menuFlag = useMemo(
    () => flags.find((flag) => flag.id === menu?.flagId) ?? selectedFlag ?? null,
    [flags, menu?.flagId, selectedFlag],
  );

  const currentTime = useCallback(() => {
    if (media?.kind !== 'video') return null;
    return videoRef.current?.currentTime ?? null;
  }, [media?.kind]);

  const addFlag = useCallback((flag: CustomFlag) => {
    setFlags((current) => [...current, flag]);
    setSelectedId(flag.id);
  }, []);

  const updateFlag = useCallback((id: string, updates: Partial<CustomFlag>) => {
    setFlags((current) => current.map((flag) => (
      flag.id === id ? { ...flag, ...updates } : flag
    )));
  }, []);


  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const kind: MediaKind = file.type.startsWith('video/') ? 'video' : 'image';
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    const src = URL.createObjectURL(file);
    mediaUrlRef.current = src;
    setMedia({ name: file.name, kind, src });
    setSelectedId(null);
    setPolygonPoints([]);
    setDraftBox(null);
    setMenu(null);
  };

  const handleDropMedia = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingMedia(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const addPinAt = useCallback((point: Point) => {
    addFlag(newFlag({ shape: 'pin', x: point.x, y: point.y, mediaTime: currentTime() }));
  }, [addFlag, currentTime]);

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!media || !stageRef.current || menu) return;
    if (e.target !== e.currentTarget && !(e.target instanceof HTMLImageElement) && !(e.target instanceof HTMLVideoElement)) return;
    const point = pctFromEvent(e, stageRef.current);
    if (tool === 'pin') {
      addPinAt(point);
      return;
    }
    if (tool === 'polygon') {
      setPolygonPoints((current) => [...current, point]);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!media || tool !== 'box' || !stageRef.current || menu) return;
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget && !(e.target instanceof HTMLImageElement) && !(e.target instanceof HTMLVideoElement)) return;
    const point = pctFromEvent(e, stageRef.current);
    setDraftBox({ start: point, current: point });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draftBox || !stageRef.current) return;
    setDraftBox({ ...draftBox, current: pctFromEvent(e, stageRef.current) });
  };

  const handlePointerUp = () => {
    if (!draftBox) return;
    const x = Math.min(draftBox.start.x, draftBox.current.x);
    const y = Math.min(draftBox.start.y, draftBox.current.y);
    const w = Math.abs(draftBox.start.x - draftBox.current.x);
    const h = Math.abs(draftBox.start.y - draftBox.current.y);
    setDraftBox(null);
    if (w < 1 || h < 1) return;
    addFlag(newFlag({ shape: 'box', x, y, w, h, mediaTime: currentTime() }));
  };

  const finishPolygon = () => {
    if (polygonPoints.length < 3) {
      setPolygonPoints([]);
      return;
    }
    const x = polygonPoints.reduce((sum, p) => sum + p.x, 0) / polygonPoints.length;
    const y = polygonPoints.reduce((sum, p) => sum + p.y, 0) / polygonPoints.length;
    addFlag(newFlag({ shape: 'polygon', x, y, points: polygonPoints, mediaTime: currentTime() }));
    setPolygonPoints([]);
    setMenu(null);
  };

  const deleteFlag = (id: string) => {
    setFlags((current) => current.filter((flag) => flag.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    setMenu(null);
  };

  const jumpToFlag = (flag: CustomFlag) => {
    setSelectedId(flag.id);
    if (media?.kind === 'video' && flag.mediaTime != null && videoRef.current) {
      videoRef.current.currentTime = flag.mediaTime;
    }
  };

  const openMenu = (e: React.MouseEvent, point: Point | null, flagId: string | null = null) => {
    e.preventDefault();
    e.stopPropagation();
    if (flagId) setSelectedId(flagId);
    setMenu({ x: e.clientX, y: e.clientY, point, flagId });
  };

  const handleStageContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const point = stageRef.current ? pctFromEvent(e, stageRef.current) : null;
    openMenu(e, point);
  };

  const menuX = menu ? Math.min(menu.x, Math.max(0, window.innerWidth - 320)) : 0;
  const menuY = menu ? Math.min(menu.y, Math.max(0, window.innerHeight - 560)) : 0;

  return (
    <div className={`h-full w-full min-h-[360px] relative overflow-hidden ${media ? 'bg-black text-white' : 'bg-card text-foreground'}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {!media ? (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center px-6 py-20 select-none transition-colors ${isDraggingMedia ? 'bg-muted/40' : 'bg-card'}`}
          onContextMenu={(e) => openMenu(e, null)}
          onDragEnter={(e) => { e.preventDefault(); setIsDraggingMedia(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { e.preventDefault(); setIsDraggingMedia(false); }}
          onDrop={handleDropMedia}
        >
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
              <div
                key={i}
                className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
                style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
              >
                <ImageIcon size={22} />
              </div>
            ))}
          </div>
          <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add media to CustomView</h2>
          <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
            Images and videos become a full-screen annotation surface.
          </p>
          <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
            Flags, boxes, areas, labels, and Element links are available from the right-click menu.
          </p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
            title="Upload media"
          >
            <Plus size={14} />
            Upload Media
          </button>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={stageRef}
            className="relative max-h-full max-w-full"
            onClick={handleStageClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={handleStageContextMenu}
            style={{ cursor: tool === 'select' ? 'default' : tool === 'box' ? 'crosshair' : 'copy' }}
          >
            {media.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.src} alt="" className="block h-full max-h-screen w-auto max-w-full object-contain pointer-events-none" draggable={false} />
            ) : (
              <video ref={videoRef} src={media.src} className="block h-full max-h-screen w-auto max-w-full object-contain" controls />
            )}

            <div className="absolute inset-0 pointer-events-none">
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {flags.map((flag) => {
                  const meta = TYPE_META[flag.type];
                  const selected = flag.id === selectedId;
                  if (flag.shape === 'box') {
                    return (
                      <rect
                        key={flag.id}
                        x={flag.x}
                        y={flag.y}
                        width={flag.w ?? 0}
                        height={flag.h ?? 0}
                        fill={meta.bg}
                        stroke={selected ? overlayColor : meta.color}
                        strokeWidth={selected ? 0.42 : 0.28}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  }
                  if (flag.shape === 'polygon' && flag.points?.length) {
                    return (
                      <polygon
                        key={flag.id}
                        points={flag.points.map((p) => `${p.x},${p.y}`).join(' ')}
                        fill={meta.bg}
                        stroke={selected ? overlayColor : meta.color}
                        strokeWidth={selected ? 0.42 : 0.28}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  }
                  return null;
                })}
                {draftBox && (
                  <rect
                    x={Math.min(draftBox.start.x, draftBox.current.x)}
                    y={Math.min(draftBox.start.y, draftBox.current.y)}
                    width={Math.abs(draftBox.start.x - draftBox.current.x)}
                    height={Math.abs(draftBox.start.y - draftBox.current.y)}
                    fill="var(--custom-draft-box-fill)"
                    stroke={overlayColor}
                    strokeWidth={0.3}
                    strokeDasharray="1.2 0.8"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {polygonPoints.length > 0 && (
                  <polyline
                    points={polygonPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={overlayColor}
                    strokeWidth={0.3}
                    strokeDasharray="1.2 0.8"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {polygonPoints.map((point, index) => (
                  <circle key={index} cx={point.x} cy={point.y} r={0.48} fill={overlayColor} />
                ))}
              </svg>

              {flags.map((flag) => {
                const meta = TYPE_META[flag.type];
                const selected = flag.id === selectedId;
                return (
                  <button
                    key={flag.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); jumpToFlag(flag); }}
                    onContextMenu={(e) => openMenu(e, { x: flag.x, y: flag.y }, flag.id)}
                    className="absolute pointer-events-auto -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${flag.x}%`, top: `${flag.y}%` }}
                    title={flag.label || meta.label}
                  >
                    <span
                      className={`h-6 w-6 rounded-full border flex items-center justify-center shadow-lg transition-transform ${selected ? 'scale-110' : 'group-hover:scale-105'}`}
                      style={{ borderColor: selected ? overlayColor : meta.color, background: 'var(--custom-pin-marker-bg)' }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                    </span>
                    {showLabels && (flag.label || flag.mediaTime != null) && (
                      <span className="absolute left-7 top-1/2 -translate-y-1/2 max-w-[160px] truncate rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white shadow">
                        {flag.label || timeLabel(flag.mediaTime)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-2.5 py-1.5 text-[11px] text-white/75 backdrop-blur pointer-events-none">
        {media?.kind === 'video' ? <Video size={12} /> : <ImageIcon size={12} />}
        <span>{media?.name ?? 'CustomView'}</span>
        {scopeLabel && <span className="text-white/40">{scopeLabel}</span>}
        <span className="text-white/40">{flags.length}</span>
      </div>

      {menu && (
        <div
          className="fixed z-50 w-[300px] rounded-lg border border-white/10 bg-zinc-950/95 p-2 text-zinc-100 shadow-2xl backdrop-blur"
          style={{ left: menuX, top: menuY }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between px-1.5 pb-2">
            <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold">
              <Flag size={13} />
              <span className="truncate">CustomView</span>
            </div>
            <button
              type="button"
              onClick={() => setMenu(null)}
              className="h-6 w-6 rounded text-zinc-400 hover:bg-white/10 hover:text-white inline-flex items-center justify-center"
              title="Close"
            >
              <X size={13} />
            </button>
          </div>

          <MenuButton icon={<Upload size={13} />} label="Media" onClick={() => fileInputRef.current?.click()} />

          {menu.point && (
            <MenuButton
              icon={<MapPin size={13} />}
              label="Add pin here"
              onClick={() => { addPinAt(menu.point!); setMenu(null); }}
            />
          )}

          <div className="my-2 h-px bg-white/10" />

          <div className="grid grid-cols-4 gap-1">
            {TOOL_META.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setTool(item.id); setPolygonPoints([]); setMenu(null); }}
                className={`h-8 rounded-md inline-flex items-center justify-center gap-1 text-[11px] transition-colors ${tool === item.id ? 'bg-white text-black' : 'bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'}`}
                title={item.label}
              >
                {item.icon}
              </button>
            ))}
          </div>

          {polygonPoints.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={finishPolygon}
                className="h-8 rounded-md bg-white text-black text-[11px] font-medium inline-flex items-center justify-center gap-1"
              >
                <Check size={13} />
                Area {polygonPoints.length}
              </button>
              <button
                type="button"
                onClick={() => { setPolygonPoints([]); setMenu(null); }}
                className="h-8 rounded-md bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white text-[11px] inline-flex items-center justify-center gap-1"
              >
                <X size={13} />
                Cancel
              </button>
            </div>
          )}

          <div className="my-2 h-px bg-white/10" />

          <div className="flex items-center gap-2 px-1.5 py-1">
            <Palette size={13} className="text-zinc-500" />
            {OVERLAY_COLOR_SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setOverlayColor(color)}
                className={`h-5 w-5 rounded border ${overlayColor === color ? 'border-white' : 'border-white/20'}`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>

          <label className="mt-1 flex h-8 items-center gap-2 rounded-md px-1.5 text-[12px] text-zinc-300 hover:bg-white/5">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            Labels
          </label>

          {menuFlag && (
            <>
              <div className="my-2 h-px bg-white/10" />
              <div className="mb-2 flex items-center gap-2 px-1.5 text-[11px] font-semibold text-zinc-400">
                <Tag size={12} />
                Flag settings
                {menuFlag.mediaTime != null && (
                  <span className="ml-auto inline-flex items-center gap-1 font-normal">
                    <Clock size={10} />
                    {timeLabel(menuFlag.mediaTime)}
                  </span>
                )}
              </div>

              <input
                value={menuFlag.label}
                onChange={(e) => updateFlag(menuFlag.id, { label: e.target.value })}
                placeholder="Label"
                className="mb-2 h-8 w-full rounded-md bg-white/5 px-2 text-[12px] text-white outline-none border-none"
              />

              <div className="mb-2 grid grid-cols-2 gap-2">
                <select
                  value={menuFlag.type}
                  onChange={(e) => updateFlag(menuFlag.id, { type: e.target.value as FlagType })}
                  className="h-8 rounded-md bg-white/5 px-2 text-[12px] text-white outline-none border-none"
                >
                  {Object.entries(TYPE_META).map(([value, meta]) => (
                    <option key={value} value={value}>{meta.label}</option>
                  ))}
                </select>
                <select
                  value={menuFlag.priority}
                  onChange={(e) => updateFlag(menuFlag.id, { priority: e.target.value as FlagPriority })}
                  className="h-8 rounded-md bg-white/5 px-2 text-[12px] text-white outline-none border-none"
                >
                  {Object.entries(PRIORITY_META).map(([value, meta]) => (
                    <option key={value} value={value}>{meta.label}</option>
                  ))}
                </select>
              </div>

              {elements.length > 0 && (
                <select
                  value={menuFlag.linkedElementId ?? ''}
                  onChange={(e) => updateFlag(menuFlag.id, { linkedElementId: e.target.value || null })}
                  className="mb-2 h-8 w-full rounded-md bg-white/5 px-2 text-[12px] text-white outline-none border-none"
                >
                  <option value="">No linked Element</option>
                  {elements.map((element) => (
                    <option key={element.id} value={element.id}>{element.title}</option>
                  ))}
                </select>
              )}

              <textarea
                value={menuFlag.notes}
                onChange={(e) => updateFlag(menuFlag.id, { notes: e.target.value })}
                placeholder="Notes"
                rows={3}
                className="mb-2 w-full resize-none rounded-md bg-white/5 px-2 py-1.5 text-[12px] text-white outline-none border-none"
              />

              <button
                type="button"
                onClick={() => deleteFlag(menuFlag.id)}
                className="h-8 w-full rounded-md text-[12px] text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 inline-flex items-center justify-center gap-1"
              >
                <Trash2 size={13} />
                Delete flag
              </button>
            </>
          )}

          {flags.length > 0 && (
            <>
              <div className="my-2 h-px bg-white/10" />
              <div className="max-h-32 overflow-auto space-y-1">
                {flags.map((flag, index) => {
                  const meta = TYPE_META[flag.type];
                  return (
                    <button
                      key={flag.id}
                      type="button"
                      onClick={() => { jumpToFlag(flag); setMenu(null); }}
                      className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/10 hover:text-white"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                      <span className="truncate">{flag.label || `Flag ${index + 1}`}</span>
                      <span className={`ml-auto ${PRIORITY_META[flag.priority].className}`}>{PRIORITY_META[flag.priority].label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12px] text-zinc-300 hover:bg-white/10 hover:text-white"
    >
      <span className="text-zinc-500">{icon}</span>
      {label}
    </button>
  );
}
