'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================
// Types
// ============================================
type Card = {
  id: string;
  x: number;
  y: number;
  text: string;
};

type Viewport = {
  x: number;
  y: number;
};

type DragState =
  | { type: 'none' }
  | { type: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { type: 'card'; cardId: string; startX: number; startY: number; originX: number; originY: number };

// ============================================
// Constants
// ============================================
const DOT_SIZE = 24; // ドット間隔(px)
const CARD_W = 240;
const CARD_H_MIN = 120;

// ============================================
// Utilities
// ============================================
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ============================================
// BlueprintBoard
// ============================================
export function BlueprintBoard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0 });
  const [cards, setCards] = useState<Card[]>([
    { id: uid(), x: 120, y: 140, text: 'ERPと差別化できそう' },
    { id: uid(), x: 420, y: 220, text: 'WBSとObject、同じ構造' },
    { id: uid(), x: 260, y: 420, text: 'タイムシートも統合できる' },
  ]);
  const [drag, setDrag] = useState<DragState>({ type: 'none' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ============================================
  // Mouse handlers
  // ============================================
  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Start pan
    setDrag({
      type: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      originX: viewport.x,
      originY: viewport.y,
    });
    setSelectedId(null);
  }, [viewport]);

  const handleBackgroundDoubleClick = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert screen coords to canvas coords
    const canvasX = e.clientX - rect.left - viewport.x - CARD_W / 2;
    const canvasY = e.clientY - rect.top - viewport.y - 40;
    const newCard: Card = { id: uid(), x: canvasX, y: canvasY, text: '' };
    setCards((prev) => [...prev, newCard]);
    setSelectedId(newCard.id);
  }, [viewport]);

  const handleCardMouseDown = useCallback((e: React.MouseEvent, card: Card) => {
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

  // ============================================
  // Global mouse move/up
  // ============================================
  useEffect(() => {
    if (drag.type === 'none') return;

    const handleMove = (e: MouseEvent) => {
      if (drag.type === 'pan') {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        setViewport({ x: drag.originX + dx, y: drag.originY + dy });
      } else if (drag.type === 'card') {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        setCards((prev) =>
          prev.map((c) =>
            c.id === drag.cardId ? { ...c, x: drag.originX + dx, y: drag.originY + dy } : c
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
  }, [drag]);

  // ============================================
  // Card edit
  // ============================================
  const updateCardText = useCallback((id: string, text: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  // Background position follows viewport so dots feel infinite
  const bgStyle: React.CSSProperties = {
    backgroundColor: 'var(--content-bg)',
    backgroundImage:
      'radial-gradient(circle, var(--blueprint-dot, rgba(0,0,0,0.12)) 1px, transparent 1px)',
    backgroundSize: `${DOT_SIZE}px ${DOT_SIZE}px`,
    backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    cursor: drag.type === 'pan' ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={bgStyle}
      onMouseDown={handleBackgroundMouseDown}
      onDoubleClick={handleBackgroundDoubleClick}
    >
      {/* Header overlay - minimal, floating */}
      <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-5 pointer-events-none z-10">
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="text-[13px] font-medium text-foreground/70">BluePrint</span>
          <span className="text-[11px] text-muted-foreground">
            {cards.length} cards
          </span>
        </div>
        <div className="pointer-events-auto text-[11px] text-muted-foreground">
          dblclick to add · drag to pan
        </div>
      </div>

      {/* Canvas layer - cards are positioned here */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px)`,
        }}
      >
        {cards.map((card) => (
          <BlueprintCard
            key={card.id}
            card={card}
            isSelected={selectedId === card.id}
            onMouseDown={(e) => handleCardMouseDown(e, card)}
            onChangeText={(t) => updateCardText(card.id, t)}
            isDragging={drag.type === 'card' && drag.cardId === card.id}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================
// BlueprintCard
// ============================================
interface BlueprintCardProps {
  card: Card;
  isSelected: boolean;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onChangeText: (text: string) => void;
}

function BlueprintCard({ card, isSelected, isDragging, onMouseDown, onChangeText }: BlueprintCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [card.text]);

  return (
    <div
      className={`absolute bg-card rounded-lg transition-shadow ${
        isSelected
          ? 'shadow-[0_4px_16px_rgba(0,0,0,0.12)] ring-1 ring-foreground/20'
          : 'shadow-[var(--shadow-island)] hover:shadow-[var(--shadow-island-hover)]'
      } ${isDragging ? 'opacity-90' : ''}`}
      style={{
        left: card.x,
        top: card.y,
        width: CARD_W,
        minHeight: CARD_H_MIN,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={onMouseDown}
    >
      <textarea
        ref={textareaRef}
        value={card.text}
        onChange={(e) => onChangeText(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        placeholder="思考を書く…"
        className="w-full h-full min-h-[96px] bg-transparent resize-none outline-none p-4 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60"
        style={{ cursor: 'text' }}
      />
    </div>
  );
}
