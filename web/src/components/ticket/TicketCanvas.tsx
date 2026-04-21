'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ticket as TicketType, TicketActivity, TicketColor } from './types';
import { Ticket } from './Ticket';
import { TicketDetailView } from './TicketDetailView';

type DragState =
  | { type: 'none' }
  | { type: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { type: 'card'; cardId: string; startX: number; startY: number; originX: number; originY: number };

interface TicketCanvasProps {
  tickets: TicketType[];
  onTicketsChange: (next: TicketType[]) => void;
  onOpenTicket?: (id: string) => void;
  fileName?: string;
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const NEW_TICKET_COLORS: TicketColor[] = ['neutral', 'amber', 'emerald', 'blue', 'violet', 'rose'];

export function TicketCanvas({ tickets, onTicketsChange, onOpenTicket, fileName }: TicketCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [drag, setDrag] = useState<DragState>({ type: 'none' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  const openTicket = useMemo(
    () => tickets.find((t) => t.id === openTicketId) ?? null,
    [tickets, openTicketId]
  );

  const handleOpenTicket = useCallback(
    (id: string) => {
      setOpenTicketId(id);
      onOpenTicket?.(id);
    },
    [onOpenTicket]
  );

  const updateTicket = useCallback(
    (id: string, patch: Partial<TicketType>) => {
      onTicketsChange(tickets.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    [tickets, onTicketsChange]
  );

  const appendActivity = useCallback(
    (id: string, activity: Omit<TicketActivity, 'id' | 'createdAt'>) => {
      const entry: TicketActivity = {
        ...activity,
        id: uid(),
        createdAt: new Date().toISOString(),
      };
      onTicketsChange(
        tickets.map((t) =>
          t.id === id ? { ...t, activity: [...t.activity, entry], updatedAt: entry.createdAt } : t
        )
      );
    },
    [tickets, onTicketsChange]
  );

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (screenX - rect.left - viewport.x) / viewport.zoom,
        y: (screenY - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport]
  );

  const handleBackgroundMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setDrag({
        type: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        originX: viewport.x,
        originY: viewport.y,
      });
      setSelectedId(null);
    },
    [viewport]
  );

  const handleBackgroundDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      const color = NEW_TICKET_COLORS[tickets.length % NEW_TICKET_COLORS.length];
      const now = new Date().toISOString();
      const newTicket: TicketType = {
        id: uid(),
        fileId: tickets[0]?.fileId ?? 'file-local',
        title: 'Untitled Ticket',
        content: '',
        color,
        x: x - 140,
        y: y - 70,
        width: 280,
        height: 160,
        createdBy: 'Noa',
        createdAt: now,
        updatedAt: now,
        activity: [
          {
            id: uid(),
            kind: 'created',
            actor: 'Noa',
            actorKind: 'human',
            message: 'Ticket created',
            createdAt: now,
          },
        ],
      };
      onTicketsChange([...tickets, newTicket]);
      setSelectedId(newTicket.id);
    },
    [tickets, onTicketsChange, screenToCanvas]
  );

  const handleCardMouseDown = useCallback((e: React.MouseEvent, card: TicketType) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDrag({
      type: 'card',
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      originX: card.x,
      originY: card.y,
    });
    setSelectedId(card.id);
  }, []);

  useEffect(() => {
    if (drag.type === 'none') return;

    const handleMove = (e: MouseEvent) => {
      if (drag.type === 'pan') {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        setViewport((v) => ({ ...v, x: drag.originX + dx, y: drag.originY + dy }));
      } else if (drag.type === 'card') {
        const dx = (e.clientX - drag.startX) / viewport.zoom;
        const dy = (e.clientY - drag.startY) / viewport.zoom;
        onTicketsChange(
          tickets.map((t) =>
            t.id === drag.cardId ? { ...t, x: drag.originX + dx, y: drag.originY + dy } : t
          )
        );
      }
    };

    const handleUp = () => setDrag({ type: 'none' });

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [drag, viewport.zoom, tickets, onTicketsChange]);

  // Wheel zoom (cmd/ctrl + wheel = zoom, plain wheel = pan)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        setViewport((v) => {
          const delta = -e.deltaY * 0.002;
          const nextZoom = clamp(v.zoom * (1 + delta), ZOOM_MIN, ZOOM_MAX);
          const ratio = nextZoom / v.zoom;
          return {
            zoom: nextZoom,
            x: mouseX - (mouseX - v.x) * ratio,
            y: mouseY - (mouseY - v.y) * ratio,
          };
        });
      } else {
        e.preventDefault();
        setViewport((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const zoomIn = useCallback(() => {
    setViewport((v) => ({ ...v, zoom: clamp(v.zoom + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) }));
  }, []);
  const zoomOut = useCallback(() => {
    setViewport((v) => ({ ...v, zoom: clamp(v.zoom - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) }));
  }, []);
  const zoomReset = useCallback(() => {
    setViewport({ x: 0, y: 0, zoom: 1 });
  }, []);

  const bgStyle: React.CSSProperties = {
    backgroundColor: 'var(--card)',
    backgroundImage:
      'radial-gradient(circle, rgba(127,127,127,0.14) 1px, transparent 1px)',
    backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
    backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    cursor: drag.type === 'pan' ? 'grabbing' : 'default',
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={bgStyle}
      onMouseDown={handleBackgroundMouseDown}
      onDoubleClick={handleBackgroundDoubleClick}
    >
      {/* Floating header */}
      <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-5 pointer-events-none z-10">
        <div className="flex items-center gap-3 pointer-events-auto">
          <span className="text-[13px] font-semibold text-foreground/80">
            {fileName ?? 'Untitled File'}
          </span>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{tickets.length} tickets</span>
          </div>
        </div>
        <div className="pointer-events-auto text-[11px] text-muted-foreground">
          double-click to add · drag to pan · ⌘+scroll to zoom
        </div>
      </div>

      {/* Zoom controls (bottom-right) */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 bg-background/90 backdrop-blur border border-border shadow-sm p-1">
        <ZoomBtn onClick={zoomOut} ariaLabel="Zoom out">
          <MinusIcon />
        </ZoomBtn>
        <button
          type="button"
          onClick={zoomReset}
          className="px-2 text-[11px] text-muted-foreground hover:text-foreground tabular-nums w-12"
          aria-label="Reset zoom"
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <ZoomBtn onClick={zoomIn} ariaLabel="Zoom in">
          <PlusIcon />
        </ZoomBtn>
      </div>

      {/* Canvas layer (pan + zoom transform) */}
      <div
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {tickets.map((ticket) => (
          <Ticket
            key={ticket.id}
            ticket={ticket}
            zoom={viewport.zoom}
            isSelected={selectedId === ticket.id}
            isDragging={drag.type === 'card' && drag.cardId === ticket.id}
            onMouseDown={(e) => handleCardMouseDown(e, ticket)}
            onOpen={() => handleOpenTicket(ticket.id)}
          />
        ))}
      </div>

      {openTicket && (
        <TicketDetailView
          key={openTicket.id}
          ticket={openTicket}
          onClose={() => setOpenTicketId(null)}
          onUpdate={(patch) => updateTicket(openTicket.id, patch)}
          onAddActivity={(a) => appendActivity(openTicket.id, a)}
        />
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function ZoomBtn({
  onClick,
  children,
  ariaLabel,
}: {
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-7 h-7 flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
