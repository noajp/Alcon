"use client";

import { useKata } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

export function EmptyWorkspace() {
  const folders = useKata((s) => s.folders);
  const createFolder = useKata((s) => s.createFolder);
  const createFile = useKata((s) => s.createFile);
  return (
    <main className="flex flex-1 items-center justify-center bg-k-panel">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="font-mono text-[11px] tracking-[0.1em] text-k-ink-3">NO FILE</div>
        <h2 className="text-[22px] font-bold tracking-[-0.01em]">{tx("資料を1つ作りましょう", "Create your first deck")}</h2>
        <p className="text-[13px] leading-relaxed text-k-ink-2">{tx("作ったら、右下の AI に議事録や文章を流すだけで、論点と順番の通ったスライドに組みます。", "Then paste meeting notes or any text into the AI at the bottom right, and Slides builds slides with clear points in a logical order.")}</p>
        <button
          type="button"
          onClick={() => createFile(folders[0]?.id ?? createFolder(tx("マイ資料", "My decks")))}
          className="mt-2 h-10 rounded-md bg-k-primary px-5 text-[13px] font-medium text-k-on-primary hover:opacity-90"
        >
          {tx("新しい資料を作る", "New deck")}
        </button>
      </div>
    </main>
  );
}
