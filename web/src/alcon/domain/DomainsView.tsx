'use client';

import React, { useState, useEffect } from 'react';
import type { ExplorerData } from '@/hooks/useSupabase';
import { useDomains } from '@/hooks/useSupabase';
import type { Domain } from '@/hooks/useSupabase';
import { getActiveDomainId, setActiveDomainId, CREATE_DOMAIN_EVENT } from './domainsStore';
import { ChevronRight, ChevronLeft, ChevronDown, Plus } from 'lucide-react';
import { ObjectTreeItem } from '@/alcon/object/ObjectsView';
import { collectAllObjects, collectAllElements } from '@/alcon/object/ObjectsView';

const DomainIconSvg = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

export function DomainsView({
  explorerData,
  onOpen,
}: {
  explorerData: ExplorerData;
  onOpen: (domainId: string) => void;
}) {
  const { data: domains } = useDomains();
  const [activeId, setActiveId] = useState<string>(() => getActiveDomainId() ?? '');
  const [drillInId, setDrillInId] = useState<string | null>(null);

  useEffect(() => {
    const saved = getActiveDomainId();
    if (saved && domains.some((d) => d.id === saved)) setActiveId(saved);
    else if (domains[0]) { setActiveId(domains[0].id); setActiveDomainId(domains[0].id); }
  }, [domains]);

  const activeDomain = domains.find((d) => d.id === activeId) ?? domains[0];

  const drillIn = (domainId: string) => {
    setActiveDomainId(domainId);
    setActiveId(domainId);
    setDrillInId(domainId);
  };

  if (drillInId) {
    const domain = domains.find((d) => d.id === drillInId);
    if (!domain) return null;
    return (
      <DomainDetailView
        domain={domain}
        explorerData={explorerData}
        onBack={() => setDrillInId(null)}
        onOpenWorkspace={() => { setActiveDomainId(domain.id); onOpen(domain.id); }}
      />
    );
  }

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
                className="text-left rounded-2xl bg-white dark:bg-card border border-border/60 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-border transition-all p-5 group"
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

          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(CREATE_DOMAIN_EVENT))}
            className="rounded-2xl border border-dashed border-border/60 hover:border-foreground/30 hover:bg-muted/30 transition-colors p-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <Plus size={16} className="mr-2" />
            <span className="text-[13px] font-medium">New Domain</span>
          </button>
        </div>

        <div className="mt-8 text-[12px] text-muted-foreground">
          <p>
            <span className="font-medium">Coming soon:</span> Multi-tenant isolation, member management,
            cross-Domain views, and per-Domain permissions.
          </p>
        </div>
      </div>
    </div>
  );
}

function DomainDetailView({
  domain,
  explorerData,
  onBack,
  onOpenWorkspace,
}: {
  domain: Domain;
  explorerData: ExplorerData;
  onBack: () => void;
  onOpenWorkspace: () => void;
}) {
  const objectCount = collectAllObjects(explorerData).length;
  const elementCount = collectAllElements(explorerData.objects).length;

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft size={14} />
          <span>Domains</span>
        </button>

        <div className="flex items-start gap-4 mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: domain.color ?? undefined }}
          >
            {domain.color
              ? <span className="text-[18px] font-semibold text-white">{domain.name.charAt(0)}</span>
              : <div className="bg-muted w-full h-full rounded-xl flex items-center justify-center"><DomainIconSvg size={24} /></div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">{domain.name}</h1>
            {domain.identifier && (
              <p className="text-[11px] text-muted-foreground/70 font-mono mt-0.5">{domain.identifier}</p>
            )}
            <p className="text-[12px] text-muted-foreground mt-1">
              {objectCount} objects · {elementCount} elements
            </p>
          </div>
          <button
            onClick={onOpenWorkspace}
            className="shrink-0 px-3 py-1.5 bg-foreground text-background rounded-md text-[12px] font-medium hover:bg-foreground/90 transition-colors"
          >
            Open workspace
          </button>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Hierarchy</h2>
            <span className="text-[11px] text-muted-foreground/60">{explorerData.objects.length} top-level</span>
          </div>
          <div className="rounded-xl border border-border/60 bg-card py-2">
            {explorerData.objects.length > 0 ? (
              explorerData.objects.map((obj) => (
                <ObjectTreeItem key={obj.id} object={obj} selectedId={null} onSelect={(_id: string) => {}} depth={0} />
              ))
            ) : (
              <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                No Objects yet. Open the workspace to create one.
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Management</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {['Members', 'Permissions', 'Integrations', 'Billing & Usage'].map((title) => (
              <div key={title} className="rounded-xl border border-border/60 bg-card p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
                    <span className="text-[10px] text-muted-foreground/70 border border-border/60 rounded-full px-1.5 py-0.5">Soon</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
