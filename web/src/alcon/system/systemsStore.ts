'use client';

import { useState, useEffect } from 'react';

export interface SystemEntry {
  id: string;
  name: string;
  icon?: string | null;
  privacy?: 'workspace' | 'team' | 'members';
}

const STORAGE_KEY = 'alcon:systems';
const ACTIVE_KEY = 'alcon:active-system';
const CHANGE_EVENT = 'alcon:systems-change';
const ACTIVE_CHANGE_EVENT = 'alcon:active-system-change';

const DEFAULT_SYSTEMS: SystemEntry[] = [
  { id: 'alcon-dev', name: 'Alcon 開発', icon: '/logo.png' },
  { id: 'personal', name: 'Personal' },
];

function readSystems(): SystemEntry[] {
  if (typeof window === 'undefined') return DEFAULT_SYSTEMS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SYSTEMS;
    const parsed = JSON.parse(raw) as SystemEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SYSTEMS;
    return parsed;
  } catch {
    return DEFAULT_SYSTEMS;
  }
}

function writeSystems(systems: SystemEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(systems));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function getActiveSystemId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSystemId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
  window.dispatchEvent(new CustomEvent(ACTIVE_CHANGE_EVENT, { detail: id }));
}

export function addSystem(input: Omit<SystemEntry, 'id'>): SystemEntry {
  const id = `sys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: SystemEntry = { id, ...input };
  const next = [...readSystems(), entry];
  writeSystems(next);
  return entry;
}

export function useSystems() {
  const [systems, setSystems] = useState<SystemEntry[]>(DEFAULT_SYSTEMS);

  useEffect(() => {
    setSystems(readSystems());
    const sync = () => setSystems(readSystems());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) sync();
    });
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  return systems;
}
