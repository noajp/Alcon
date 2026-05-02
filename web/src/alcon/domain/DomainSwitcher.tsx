'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, Plus } from 'lucide-react';
import { useDomains } from '@/hooks/useSupabase';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT, CREATE_DOMAIN_EVENT } from './domainsStore';
import type { Domain } from '@/hooks/useSupabase';

export function DomainSwitcher() {
  const { data: domains } = useDomains();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(() => getActiveDomainId() ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = getActiveDomainId();
    if (saved && domains.some((d) => d.id === saved)) {
      setActiveId(saved);
    } else if (domains[0]) {
      setActiveId(domains[0].id);
      setActiveDomainId(domains[0].id);
    }

    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail) setActiveId(ce.detail);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, [domains]);

  const activeDomain = domains.find((d) => d.id === activeId) ?? domains[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!activeDomain && domains.length === 0) {
    return (
      <button
        onClick={() => window.dispatchEvent(new CustomEvent(CREATE_DOMAIN_EVENT))}
        className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/50"
        title="Create Domain"
      >
        <Plus size={14} />
      </button>
    );
  }

  return (
    <div ref={ref} className="relative mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 flex items-center justify-center rounded-md cursor-pointer hover:bg-sidebar-accent/50"
        title={activeDomain?.name ?? 'Domain'}
      >
        <DomainInitial domain={activeDomain} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-full top-0 ml-2 w-56 bg-popover border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Domains
            </div>
            {domains.map((d) => (
              <button
                key={d.id}
                onClick={() => { setActiveId(d.id); setActiveDomainId(d.id); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                <DomainInitial domain={d} size={20} />
                <span className="flex-1 text-left truncate">{d.name}</span>
                {d.id === activeDomain?.id && <Check size={14} className="text-foreground shrink-0" />}
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent(CREATE_DOMAIN_EVENT)); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Plus size={12} />
                <span>New Domain</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DomainInitial({ domain, size = 24 }: { domain?: Domain | null; size?: number }) {
  if (!domain) return <div style={{ width: size, height: size }} className="rounded bg-sidebar-accent" />;
  const letter = domain.name.charAt(0).toUpperCase();
  const bg = domain.color ?? undefined;
  return (
    <div
      style={{ width: size, height: size, backgroundColor: bg }}
      className={`rounded flex items-center justify-center text-[10px] font-semibold ${bg ? 'text-white' : 'bg-sidebar-accent text-muted-foreground'}`}
    >
      {letter}
    </div>
  );
}
