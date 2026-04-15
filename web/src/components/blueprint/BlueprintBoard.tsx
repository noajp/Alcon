'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card } from './types';
import { ThoughtCard, ActionCard } from './cards';

// ============================================
// Drag state
// ============================================
type DragState =
  | { type: 'none' }
  | { type: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { type: 'card'; cardId: string; startX: number; startY: number; originX: number; originY: number };

// ============================================
// Constants
// ============================================
const DOT_SIZE = 24;

// ============================================
// Utilities
// ============================================
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ============================================
// Sample cards (in-memory; persistence is next phase)
// Demonstrates the crystallization: thought → action.
// ============================================
const INITIAL_CARDS: Card[] = [
  {
    id: uid(),
    kind: 'thought',
    x: 80,
    y: 120,
    text: 'ERPと差別化できそう',
  },
  {
    id: uid(),
    kind: 'thought',
    x: 80,
    y: 260,
    text: 'WBSとObject、同じ構造',
  },
  {
    id: uid(),
    kind: 'thought',
    x: 80,
    y: 400,
    text: 'タイムシートも統合できる',
  },
  {
    id: uid(),
    kind: 'action',
    x: 420,
    y: 140,
    title: 'BluePrintデータモデルの設計',
    description: 'elements.kind と card_data JSONB の型を確定し、マイグレーションを書く。',
    priority: 'high',
    dueDate: '2026-04-20T21:00',
    tags: ['Design', 'Architecture'],
    assignee: { id: 'u1', name: 'Noa', kind: 'human' },
    progress: 30,
  },
  {
    id: uid(),
    kind: 'action',
    x: 420,
    y: 400,
    title: '競合他社の営業ツール比較',
    description: 'Notion / Asana / Linear / SAP PS を観点別に整理し、Alconのポジショニングを補強する。',
    priority: 'medium',
    dueDate: '2026-04-25T18:00',
    tags: ['Research', 'Strategy'],
    assignee: { id: 'ai1', name: 'Claude', kind: 'ai_agent' },
    progress: 60,
  },
];

// ============================================
// BlueprintBoard
// ============================================
export function BlueprintBoard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0 });
  const [cards, setCards] = useState<Card[]>(INITIAL_CARDS);
  const [drag, setDrag] = useState<DragState>({ type: 'none' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ============================================
  // Mouse handlers
  // ============================================
  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
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
    const canvasX = e.clientX - rect.left - viewport.x - 110;
    const canvasY = e.clientY - rect.top - viewport.y - 30;
    const newCard: Card = {
      id: uid(),
      kind: 'thought',
      x: canvasX,
      y: canvasY,
      text: '',
    };
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
  // Global mouse move / up
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
  // Card text update (thought cards)
  // ============================================
  const updateThoughtText = useCallback((id: string, text: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id && c.kind === 'thought' ? { ...c, text } : c))
    );
  }, []);

  // Partial update for any card (used by ActionCard edit flow)
  const updateCard = useCallback((id: string, patch: Partial<Card>) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? ({ ...c, ...patch } as Card) : c))
    );
  }, []);

  // ============================================
  // Styles
  // ============================================
  const bgStyle: React.CSSProperties = {
    backgroundColor: 'var(--content-bg)',
    backgroundImage:
      'radial-gradient(circle, rgba(0,0,0,0.12) 1px, transparent 1px)',
    backgroundSize: `${DOT_SIZE}px ${DOT_SIZE}px`,
    backgroundPosition: `${viewport.x}px ${viewport.y}px`,
    cursor: drag.type === 'pan' ? 'grabbing' : 'grab',
  };

  const thoughtCount = cards.filter((c) => c.kind === 'thought').length;
  const actionCount = cards.filter((c) => c.kind === 'action').length;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={bgStyle}
      onMouseDown={handleBackgroundMouseDown}
      onDoubleClick={handleBackgroundDoubleClick}
    >
      {/* ====== Floating header ====== */}
      <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-5 pointer-events-none z-10">
        <div className="flex items-center gap-3 pointer-events-auto">
          <span className="text-[13px] font-semibold text-foreground/80">BluePrint</span>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{thoughtCount} thoughts</span>
            <span className="opacity-40">·</span>
            <span>{actionCount} actions</span>
          </div>
        </div>
        <div className="pointer-events-auto text-[11px] text-muted-foreground">
          double-click to add · drag to pan
        </div>
      </div>

      {/* ====== Canvas layer ====== */}
      <div
        className="absolute inset-0"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px)` }}
      >
        {cards.map((card) => (
          <div
            key={card.id}
            className="absolute"
            style={{ left: card.x, top: card.y }}
          >
            {card.kind === 'thought' && (
              <ThoughtCard
                card={card}
                isSelected={selectedId === card.id}
                isDragging={drag.type === 'card' && drag.cardId === card.id}
                onMouseDown={(e) => handleCardMouseDown(e, card)}
                onChangeText={(t) => updateThoughtText(card.id, t)}
              />
            )}
            {card.kind === 'action' && (
              <ActionCard
                card={card}
                isSelected={selectedId === card.id}
                isDragging={drag.type === 'card' && drag.cardId === card.id}
                onMouseDown={(e) => handleCardMouseDown(e, card)}
                onUpdate={(patch) => updateCard(card.id, patch)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
