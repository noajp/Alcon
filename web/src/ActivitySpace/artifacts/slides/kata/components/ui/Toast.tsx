"use client";

import { Check } from '@/ui/icons';
import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";

/** 終わった操作を、画面の下で短く知らせる */
export function Toast() {
  const toast = useKata((s) => s.toast);
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[110] -translate-x-1/2">
      <div key={toast.id} className="anim-in flex items-center gap-2 rounded-full bg-k-ink px-4 py-2 text-[12px] font-medium text-k-paper shadow-[var(--shadow-pop)] ring-1 ring-white/10">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-k-lime text-k-on-primary">
          <Check size={10} strokeWidth={3} />
        </span>
        {toast.text}
      </div>
    </div>
  );
}
