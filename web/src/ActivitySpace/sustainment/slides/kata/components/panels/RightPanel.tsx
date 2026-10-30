"use client";

import clsx from "clsx";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { DesignPanel } from "./DesignPanel";
import { LogicPanel } from "./LogicPanel";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

// The inspector beside the canvas, as in a design tool: two views of the open
// deck — its look and its structure — on one surface divided from the canvas
// by a hairline. Talking to the deck happens in Alcon's AI panel, which is the
// deck's assistant while Slides is open.
export function RightPanel() {
  const panel = useKata((s) => s.panel);
  const setPanel = useKata((s) => s.setPanel);
  // An old saved preference may still say "chat"; the chat now lives in the AI panel.
  const shown = panel === "logic" ? "logic" : "design";
  const tabs: { id: "design" | "logic"; label: string }[] = [
    { id: "design", label: tx("デザイン", "Design") },
    { id: "logic", label: tx("論理構成", "Structure") },
  ];
  return (
    <aside className="flex w-[320px] shrink-0 flex-col overflow-hidden border-l border-k-line bg-k-panel">
      <div role="tablist" aria-label={tx("インスペクタ", "Inspector")} className="flex h-10 shrink-0 items-center gap-1 border-b border-k-line px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={shown === tab.id}
            onClick={() => setPanel(tab.id)}
            className={clsx(
              "h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors",
              shown === tab.id ? "bg-k-hover text-k-ink" : "text-k-ink-3 hover:text-k-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {shown === "design" ? <DesignPanel /> : <LogicPanel />}
      </div>
    </aside>
  );
}
