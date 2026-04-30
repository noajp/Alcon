'use client';

import { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useSystems, getActiveSystemId, setActiveSystemId } from './systemsStore';

export function SystemSwitcher() {
  const SYSTEMS = useSystems();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(SYSTEMS[0]?.id ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = getActiveSystemId();
    if (saved && SYSTEMS.some((s) => s.id === saved)) setActiveId(saved);
    else if (SYSTEMS[0]) setActiveId(SYSTEMS[0].id);

    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail) setActiveId(ce.detail);
    };
    window.addEventListener('alcon:active-system-change', handler as EventListener);
    return () => window.removeEventListener('alcon:active-system-change', handler as EventListener);
  }, [SYSTEMS]);

  const activeSystem = SYSTEMS.find((s) => s.id === activeId) ?? SYSTEMS[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!activeSystem) return null;

  return (
    <div ref={ref} className="relative mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="group w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-all duration-150 hover:bg-sidebar-accent/50"
        title={activeSystem.name}
      >
        {activeSystem.icon ? (
          <img src={activeSystem.icon} alt={activeSystem.name} className="w-6 h-6 rounded object-cover" />
        ) : (
          <div className="w-6 h-6 rounded bg-sidebar-accent flex items-center justify-center text-[10px] font-semibold text-sidebar-accent-foreground">
            {activeSystem.name.charAt(0)}
          </div>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-full top-0 ml-2 w-52 bg-popover border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Systems
            </div>
            {SYSTEMS.map((sys) => (
              <button
                key={sys.id}
                onClick={() => { setActiveId(sys.id); setActiveSystemId(sys.id); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                {sys.icon ? (
                  <img src={sys.icon} alt={sys.name} className="w-5 h-5 rounded object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[9px] font-semibold text-muted-foreground">
                    {sys.name.charAt(0)}
                  </div>
                )}
                <span className="flex-1 text-left truncate">{sys.name}</span>
                {sys.id === activeSystem.id && (
                  <Check size={14} className="text-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
