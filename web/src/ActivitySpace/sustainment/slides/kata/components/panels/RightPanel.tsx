"use client";

import clsx from "clsx";
import { ListTree, Palette } from "lucide-react";
import { useKata, type Panel } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { ChatPanel, ChatComposer } from "./ChatPanel";
import { DesignPanel } from "./DesignPanel";
import { LogicPanel } from "./LogicPanel";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

const titles = (): Record<Panel, string> => ({ chat: tx("チャット", "Chat"), design: tx("デザイン", "Design"), logic: tx("論理構成", "Structure") });

function ToggleButton({ target, icon, label }: { target: Panel; icon: React.ReactNode; label: string }) {
  const panel = useKata((s) => s.panel);
  const setPanel = useKata((s) => s.setPanel);
  const on = panel === target;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setPanel(on ? "chat" : target)}
      className={clsx(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
        on ? "border-k-primary bg-k-primary text-k-on-primary" : "border-k-line-strong bg-k-panel text-k-ink-2 hover:border-k-ink-3 hover:text-k-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function RightPanel() {
  const panel = useKata((s) => s.panel);
  return (
    <aside className="flex w-[364px] shrink-0 flex-col overflow-hidden rounded-2xl border border-k-line bg-k-panel">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-k-line pl-4 pr-2.5">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          {panel === "chat" ? <span className="h-2 w-2 rounded-full bg-k-lime ring-1 ring-k-ink/20" /> : null}
          {titles()[panel]}
        </span>
        <div className="flex gap-1">
          <ToggleButton target="design" icon={<Palette size={13} />} label={tx("デザイン", "Design")} />
          <ToggleButton target="logic" icon={<ListTree size={13} />} label={tx("論理構成", "Structure")} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {panel === "chat" ? <ChatPanel /> : panel === "design" ? <DesignPanel /> : <LogicPanel />}
      </div>
      <ChatComposer />
    </aside>
  );
}
