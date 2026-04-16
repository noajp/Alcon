'use client';

import { useState, useCallback, useEffect } from 'react';
import type { WidgetConfig, WidgetSpan } from './types';
import { WIDGET_REGISTRY } from './registry';

const STORAGE_PREFIX = 'alcon:widget-layout:';

function genId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Persists widget layout in localStorage per scope key.
 */
export function useWidgetLayout(layoutKey: string, defaults: WidgetConfig[]) {
  const storageKey = `${STORAGE_PREFIX}${layoutKey}`;
  const [widgets, setWidgets] = useState<WidgetConfig[]>(defaults);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount (client-only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as WidgetConfig[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWidgets(parsed);
        }
      }
    } catch {
      // ignore corrupted state
    }
    setHydrated(true);
  }, [storageKey]);

  // Persist on change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(widgets));
    } catch {
      // quota exceeded etc — ignore
    }
  }, [widgets, storageKey, hydrated]);

  const addWidget = useCallback((type: string, span?: WidgetSpan) => {
    const def = WIDGET_REGISTRY[type];
    if (!def) return;
    const newWidget: WidgetConfig = {
      id: genId(type),
      type,
      span: span ?? def.defaultSpan,
    };
    setWidgets((prev) => [...prev, newWidget]);
  }, []);

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const reorderWidgets = useCallback((fromId: string, toId: string) => {
    setWidgets((prev) => {
      const fromIdx = prev.findIndex((w) => w.id === fromId);
      const toIdx = prev.findIndex((w) => w.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const setSpan = useCallback((id: string, span: WidgetSpan) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, span } : w)));
  }, []);

  const reset = useCallback(() => {
    setWidgets(defaults);
  }, [defaults]);

  return { widgets, addWidget, removeWidget, reorderWidgets, setSpan, reset, hydrated };
}
