"use client";

import { useFocusTrap } from "@/ActivitySpace/sustainment/slides/kata/components/ui/useFocusTrap";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Plus, Trash2, X } from '@/ui/icons';
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { applyTerms } from "@/ActivitySpace/sustainment/slides/kata/model/skill";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

/** マイ・スキル：用語の統一・使わない言葉・タイトルの字数を自分で決める */
export function SkillsDialog({ onClose: close }: { onClose: () => void }) {
  // 閉じる前に入力中の欄から抜けて、書きかけを保存する
  const onClose = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    close();
  };
  const skills = useKata((s) => s.skills);
  const addSkill = useKata((s) => s.addSkill);
  const updateSkill = useKata((s) => s.updateSkill);
  const deleteSkill = useKata((s) => s.deleteSkill);
  const editDeck = useKata((s) => s.editDeck);
  const hasFile = useKata((s) => !!s.activeFileId);
  const [sel, setSel] = useState(skills[0]?.id ?? null);
  const [note, setNote] = useState("");
  const skill = skills.find((k) => k.id === sel) ?? skills[0];
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur?.();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/25 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={trapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tx("マイ・スキル", "My skills")} className="anim-in flex h-[560px] w-[820px] overflow-hidden rounded-lg bg-k-panel shadow-[var(--shadow-pop)]">
        <aside className="flex w-[230px] shrink-0 flex-col gap-1 border-r border-k-line bg-k-panel-2 p-3">
          <div className="px-2 pb-2 pt-1 font-mono text-[10px] tracking-[0.1em] text-k-ink-3">MY SKILLS</div>
          {skills.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-current={k.id === skill?.id ? "true" : undefined}
              onClick={() => setSel(k.id)}
              className={clsx("flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left", k.id === skill?.id ? "bg-k-selected" : "hover:bg-k-hover")}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold">
                <span className={clsx("h-1.5 w-1.5 rounded-full", k.enabled ? "bg-k-lime-deep" : "bg-k-line-strong")} />
                {k.name}
              </span>
              <span className="pl-3.5 text-[11px] text-k-ink-3">
                {tx("用語 {terms} ・ 禁止 {banned}", "{terms} terms · {banned} banned", { terms: k.terms.length, banned: k.banned.length })}
                {k.maxTitle ? tx(" ・ {n}字", " · {n} chars", { n: k.maxTitle }) : ""}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSel(addSkill())}
            className="mt-1 flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-k-line-strong text-[12px] text-k-ink-2 hover:border-k-ink-3 hover:text-k-ink"
          >
            <Plus size={13} /> {tx("新しいスキル", "New skill")}
          </button>
          <p className="mt-auto px-2 text-[11px] leading-relaxed text-k-ink-3">{tx("決めた規則は、赤入れとチャットでの組み立ての両方に効きます。", "Your rules apply to both reviews and chat-built slides.")}</p>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center justify-between border-b border-k-line px-5">
            <span className="text-[13px] font-semibold">{tx("マイ・スキル", "My skills")}</span>
            <button type="button" aria-label={tx("閉じる", "Close")} onClick={onClose} className="rounded-md p-1 text-k-ink-3 hover:bg-k-hover hover:text-k-ink">
              <X size={16} />
            </button>
          </div>
          {skill ? (
            <div key={skill.id} className="scroll-thin flex flex-1 flex-col gap-6 overflow-y-auto p-5">
              <div className="flex items-end gap-3">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[12px] font-semibold">{tx("名前", "Name")}</span>
                  <input defaultValue={skill.name} onBlur={(e) => updateSkill(skill.id, { name: e.target.value.trim() || skill.name })} className="h-9 rounded-lg border border-k-line-strong px-3 text-[13px]" />
                </label>
                <label className="flex h-9 items-center gap-2 text-[12px]">
                  <input type="checkbox" checked={skill.enabled} onChange={(e) => updateSkill(skill.id, { enabled: e.target.checked })} className="h-4 w-4 accent-k-ink" />
                  {tx("使う", "Enabled")}
                </label>
              </div>

              <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <h4 className="text-[12px] font-semibold">{tx("用語をそろえる", "Consistent terms")}</h4>
                  <span className="text-[11px] text-k-ink-3">{tx("左の言葉を見つけたら、右に直すよう指摘します", "Flags the left term and suggests the right one")}</span>
                </div>
                {skill.terms.map((t, i) => (
                  <div key={`${skill.id}-${i}-${t.from}-${t.to}`} className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_28px] items-center gap-2">
                    <input
                      aria-label={tx("使わない書き方", "Term to avoid")}
                      defaultValue={t.from}
                      placeholder={tx("例：法人向け", "e.g. B2B")}
                      onBlur={(e) => updateSkill(skill.id, { terms: skill.terms.map((x, j) => (j === i ? { ...x, from: e.target.value.trim() } : x)) })}
                      className="h-8 rounded-md border border-k-line-strong px-2 text-[13px]"
                    />
                    <span className="text-center text-k-ink-3">→</span>
                    <input
                      aria-label={tx("そろえる書き方", "Preferred term")}
                      defaultValue={t.to}
                      placeholder={tx("例：企業向け", "e.g. for businesses")}
                      onBlur={(e) => updateSkill(skill.id, { terms: skill.terms.map((x, j) => (j === i ? { ...x, to: e.target.value.trim() } : x)) })}
                      className="h-8 rounded-md border border-k-line-strong px-2 text-[13px] font-medium"
                    />
                    <button type="button" aria-label={tx("この用語を外す", "Remove term")} onClick={() => updateSkill(skill.id, { terms: skill.terms.filter((_, j) => j !== i) })} className="flex h-7 w-7 items-center justify-center rounded-md text-k-ink-3 hover:bg-k-hover hover:text-k-danger">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => updateSkill(skill.id, { terms: [...skill.terms, { from: "", to: "" }] })} className="flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-[12px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink">
                  <Plus size={13} /> {tx("用語を足す", "Add term")}
                </button>
              </section>

              <section className="flex flex-col gap-2">
                <h4 className="text-[12px] font-semibold">{tx("使わない言葉", "Banned words")}</h4>
                <textarea
                  defaultValue={skill.banned.join("、")}
                  placeholder={tx("読点か改行で区切る（例：御社、させていただく）", "Separate with commas or new lines (e.g. synergy, leverage)")}
                  rows={2}
                  onBlur={(e) => updateSkill(skill.id, { banned: e.target.value.split(/[、,\n]/).map((x) => x.trim()).filter(Boolean) })}
                  className="resize-none rounded-lg border border-k-line-strong px-3 py-2 text-[13px] leading-relaxed"
                />
              </section>

              <section className="flex items-center justify-between gap-3">
                <h4 className="text-[12px] font-semibold">{tx("タイトルの上限字数", "Max title length")}</h4>
                <input
                  key={`max-${skill.id}-${skill.maxTitle ?? "none"}`}
                  type="number"
                  min={10}
                  max={120}
                  defaultValue={skill.maxTitle ?? ""}
                  placeholder="60"
                  aria-label={tx("タイトルの上限字数", "Max title length")}
                  onBlur={(e) => updateSkill(skill.id, { maxTitle: e.target.value ? Math.max(10, Number(e.target.value)) : null })}
                  className="h-8 w-24 rounded-md border border-k-line-strong px-2 text-right text-[13px]"
                />
              </section>

              <div className="mt-auto flex items-center justify-between gap-3 border-t border-k-line pt-4">
                <button type="button" onClick={() => deleteSkill(skill.id)} className="flex items-center gap-1.5 text-[12px] text-k-ink-3 hover:text-k-danger">
                  <Trash2 size={13} /> {tx("このスキルを削除", "Delete skill")}
                </button>
                <span className="flex items-center gap-3">
                  {note ? <span className="text-[12px] text-k-ink-2">{note}</span> : null}
                  <button
                    type="button"
                    disabled={!hasFile}
                    onClick={() => {
                      let n = 0;
                      editDeck((d) => {
                        const r = applyTerms(d, useKata.getState().skills);
                        n = r.count;
                        return r.deck;
                      });
                      setNote(n ? (n === 1 ? tx("{n} か所そろえました（⌘Z で戻せます）", "Fixed {n} place (⌘Z to undo)", { n }) : tx("{n} か所そろえました（⌘Z で戻せます）", "Fixed {n} places (⌘Z to undo)", { n })) : tx("直すところはありません", "Nothing to fix"));
                    }}
                    className="h-9 rounded-lg bg-k-primary px-4 text-[12px] font-medium text-k-on-primary disabled:opacity-30"
                  >
                    {tx("開いている資料の用語をそろえる", "Apply terms to open deck")}
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[13px] text-k-ink-3">{tx("スキルがありません。左から作れます。", "No skills yet. Create one on the left.")}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
