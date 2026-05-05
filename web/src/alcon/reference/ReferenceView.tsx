'use client';

import { Library } from 'lucide-react';

/**
 * Reference — placeholder.
 * Future home for browsing completed Elements / archived Objects /
 * historical Domains. Wired into the sidebar (under Execution) and
 * MainContent so the route exists; the actual reference surface is TBD.
 */
export function ReferenceView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center mb-6">
        <Library size={22} className="text-muted-foreground" />
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Reference</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Browse completed tasks and archived Domains here.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs">
        Coming soon.
      </p>
    </div>
  );
}
