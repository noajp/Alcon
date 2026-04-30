'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, Plus } from 'lucide-react';

const SystemIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

const SYSTEMS = [
  { id: 'alcon-dev', name: 'Alcon', icon: '/logo.png' },
  { id: 'personal', name: 'Personal', icon: null },
];

export function SystemSwitcher() {
  const [open, setOpen] = useState(false);
  const [activeSystem, setActiveSystem] = useState(SYSTEMS[0]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

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
            {SYSTEMS.map(sys => (
              <button
                key={sys.id}
                onClick={() => { setActiveSystem(sys); setOpen(false); }}
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
            <div className="border-t border-border mt-1 pt-1">
              <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <Plus size={14} />
                <span>Create System</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
