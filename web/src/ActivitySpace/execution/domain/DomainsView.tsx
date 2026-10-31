'use client';


import React, { useState, useEffect } from 'react';
import { useDomains } from '@/hooks/useSupabase';
import { getActiveDomainId, setActiveDomainId } from '@/Function/space/domainsStore';
import { ChevronRight } from 'lucide-react';

const DomainIconSvg = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5.5 4.5 9.25 12 13l7.5-3.75L12 5.5Z" />
    <path d="M4.5 12.25 12 16l7.5-3.75" />
    <path d="M4.5 15.25 12 19l7.5-3.75" />
  </svg>
);

export function DomainsView({
  onOpen,
}: {
  onOpen: (domainId: string) => void;
}) {
  const { data: domains } = useDomains();
  const [activeId, setActiveId] = useState<string>(() => getActiveDomainId() ?? '');

  useEffect(() => {
    const saved = getActiveDomainId();
    if (saved && domains.some((d) => d.id === saved)) setActiveId(saved);
    else if (domains[0]) { setActiveId(domains[0].id); setActiveDomainId(domains[0].id); }
  }, [domains]);

  const activeDomain = domains.find((d) => d.id === activeId) ?? domains[0];

  const drillIn = (domainId: string) => {
    setActiveDomainId(domainId);
    setActiveId(domainId);
    onOpen(domainId);
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div>
          <h1 className="text-lg font-semibold text-foreground tracking-tight">Domains</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Top-level containers for organizations, operations, or workspaces. Objects multi-home across Domains.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {domains.map((d) => {
            const isActive = d.id === activeDomain?.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => drillIn(d.id)}
                className="text-left rounded-lg bg-white dark:bg-card border border-border/60 shadow-[var(--shadow-island)] hover:border-border transition-all p-5 group"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground shrink-0"
                    style={{ backgroundColor: d.color ?? undefined }}
                  >
                    {d.color
                      ? <span className="text-[15px] font-semibold text-white">{d.name.charAt(0)}</span>
                      : <div className="bg-muted w-full h-full rounded-lg flex items-center justify-center"><DomainIconSvg size={20} /></div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-medium text-foreground tracking-tight truncate">{d.name}</h3>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      )}
                    </div>
                    {d.identifier && (
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono">{d.identifier}</p>
                    )}
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground/30 group-hover:text-foreground transition-colors mt-1.5" />
                </div>
              </button>
            );
          })}

        </div>


      </div>
    </div>
  );
}
