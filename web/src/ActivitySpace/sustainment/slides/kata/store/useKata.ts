"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { LOOK_BY_ID } from "@/ActivitySpace/sustainment/slides/kata/theme/looks";
import { createJSONStorage, persist } from "zustand/middleware";
import { newId } from "@/ActivitySpace/sustainment/slides/kata/model/id";
import type { ChatMessage, Deck, Folder, KataFile, LayoutId, Look, LookTokens, MixElement, MixState, StorylineId } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import * as D from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { DEFAULT_SKILL, type Skill } from "@/ActivitySpace/sustainment/slides/kata/model/skill";
import { setUiLocale, tx, type Lang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import type { Locale } from "@/Function/i18n/locales";
import { MESSAGES } from "@/Function/i18n/messages";
import { toggleLook } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";

export type Panel = "chat" | "design" | "logic";
export type LogicTab = "deck" | "page";

interface KataState {
  folders: Folder[];
  files: KataFile[];
  activeFileId: string | null;
  current: number;
  panel: Panel;
  logicTab: LogicTab;
  busy: boolean;
  theme: "light" | "dark";
  /** The language decks, AI replies and exports are made in — from the app's. */
  lang: Lang;
  /** The app's language, which the editor's screen follows. */
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toast: { id: number; text: string } | null;
  notify: (text: string) => void;
  /** 中央の左にあるページ一覧 */
  filmstrip: boolean;
  setFilmstrip: (b: boolean) => void;
  presenting: boolean;
  setPresenting: (b: boolean) => void;
  palette: boolean;
  setPalette: (b: boolean) => void;
  titleRead: boolean;
  setTitleRead: (b: boolean) => void;
  shortcuts: boolean;
  setShortcuts: (b: boolean) => void;
  /** 印刷用の全ページを描いてから印刷する */
  printDeck: () => void;
  printing: boolean;
  setTheme: (t: "light" | "dark") => void;
  /** マイ・スキル（書き方の決まり） */
  skills: Skill[];
  addSkill: () => string;
  updateSkill: (id: string, patch: Partial<Omit<Skill, "id">>) => void;
  deleteSkill: (id: string) => void;
  /** 自分でつくった世界観 */
  customLooks: Look[];
  saveLook: (name: string, tokens: LookTokens, source?: Look["source"]) => string;
  updateLook: (id: string, patch: { name?: string; tokens?: LookTokens }) => void;
  deleteLook: (id: string) => void;
  /** 取り消し用の履歴（保存しない） */
  history: Record<string, { past: Deck[]; future: Deck[] }>;
  undo: () => boolean;
  redo: () => boolean;

  // ファイル
  selectFile: (id: string) => void;
  createFolder: (name?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleFolder: (id: string) => void;
  createFile: (folderId: string, name?: string, deck?: Deck, mix?: MixState) => string;
  renameFile: (id: string, name: string) => void;
  moveFile: (id: string, folderId: string) => void;
  duplicateFile: (id: string) => void;
  deleteFile: (id: string) => void;

  // 画面
  setCurrent: (i: number) => void;
  setPanel: (p: Panel) => void;
  setLogicTab: (t: LogicTab) => void;
  setBusy: (b: boolean) => void;

  // デッキ
  replaceDeck: (deck: Deck) => void;
  /** merge：同じ鍵の続けての編集（矢印キーで動かすなど）は、取り消しの1回にまとめる */
  editDeck: (fn: (d: Deck) => Deck, merge?: string) => void;
  /** 開いていない資料にも同じ扱い（取り消しの履歴つき）で手を入れる。ボードのウィジェットから使う */
  editFile: (fileId: string, fn: (d: Deck) => Deck, merge?: string) => void;
  /** 選んでいる置きもの（保存しない） */
  selected: string | null;
  select: (id: string | null) => void;
  /** 文字を打ち込んでいる置きもの（保存しない） */
  editing: string | null;
  setEditing: (id: string | null) => void;
  /** 書式を変えようとしている型の文字（保存しない） */
  textFocus: { slideId: string; key: string; size?: number } | null;
  setTextFocus: (f: { slideId: string; key: string; size?: number } | null) => void;
  setSlidePath: (slideId: string, path: (string | number)[], value: unknown) => void;
  setLayout: (slideId: string, layout: LayoutId) => void;
  setStoryline: (s: StorylineId) => void;
  moveSlide: (from: number, to: number) => void;
  deleteSlide: (i: number) => void;

  // 世界観
  toggleLook: (id: string) => void;
  pinElement: (el: MixElement, lookId: string | null) => void;
  remix: () => void;

  // チャット
  pushMessage: (m: Omit<ChatMessage, "id" | "at">) => void;
  /** 返事が届いたときに、送ったファイルへだけ書く（その間に開いているファイルが変わっていてもよい） */
  applyReply: (fileId: string, r: { deck?: Deck; text: string }) => void;
}

/** 既定のファイル名（今の言語）。どちらの言語の既定名も「まだ名付けていない」とみなす */
const defaultFileName = () => tx("無題の資料", "Untitled deck");
// A deck still wearing the name it was made with, in whichever language that was.
const DEFAULT_FILE_NAMES = new Set(["無題の資料", "Untitled deck", ...(["ko", "fr", "es"] as const).map((l) => MESSAGES[l]["Untitled deck"]).filter(Boolean)]);
const isDefaultFileName = (n: string) => DEFAULT_FILE_NAMES.has(n);

// 保存先がいっぱいでも画面は止めない。保存できなかったことだけを一度知らせる
let warned = false;
const safeStorage: Storage = {
  get length() {
    return typeof localStorage === "undefined" ? 0 : localStorage.length;
  },
  clear: () => localStorage.clear(),
  key: (i) => localStorage.key(i),
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
      warned = false;
    } catch {
      if (!warned) {
        warned = true;
        setTimeout(() => useKata.getState().notify(tx("保存できませんでした。使っていない資料を消すと、また保存できます", "Couldn't save. Delete decks you no longer use to free up space.")), 0);
      }
    }
  },
};

const touch = (f: KataFile, patch: Partial<KataFile>): KataFile => ({ ...f, ...patch, updatedAt: Date.now() });

const blankDeck = (name: string): Deck => ({
  title: name,
  storyline: "scr",
  slides: [{ id: newId("s"), title: name, layout: "cover", content: { cover: { subtitle: "", meta: "" } } }],
});

export const useKata = create<KataState>()(
  persist(
    (set, get) => {
      const mapActive = (fn: (f: KataFile) => KataFile) =>
        set((s) => ({ files: s.files.map((f) => (f.id === s.activeFileId ? fn(f) : f)) }));
      let lastMerge: { key: string; at: number; fileId: string } | null = null;
      const editFile = (fileId: string | null, fn: (d: Deck) => Deck, merge?: string) => {
        const st = get();
        const f = st.files.find((x) => x.id === fileId);
        if (!f) return;
        const next = fn(f.deck);
        if (next === f.deck) return;
        const h = st.history[f.id] ?? { past: [], future: [] };
        const now = Date.now();
        // "g:" で始まる鍵は1回の操作（ドラッグ）なので、時間に関わらずまとめる
        const merged = !!merge && lastMerge?.key === merge && lastMerge.fileId === f.id && (merge.startsWith("g:") || now - lastMerge.at < 1200) && h.past.length > 0;
        lastMerge = merge ? { key: merge, at: now, fileId: f.id } : null;
        if (!merged) set({ history: { ...st.history, [f.id]: { past: [...h.past, f.deck].slice(-60), future: [] } } });
        else set({ history: { ...st.history, [f.id]: { past: h.past, future: [] } } });
        set((s) => ({ files: s.files.map((x) => (x.id === f.id ? touch(x, { deck: next }) : x)) }));
      };
      const editDeck = (fn: (d: Deck) => Deck, merge?: string) => editFile(get().activeFileId, fn, merge);
      const step = (dir: "undo" | "redo") => {
        const st = get();
        const f = st.files.find((x) => x.id === st.activeFileId);
        if (!f) return false;
        const h = st.history[f.id];
        if (!h) return false;
        const from = dir === "undo" ? h.past : h.future;
        if (!from.length) return false;
        const target = from[from.length - 1];
        const rest = from.slice(0, -1);
        const nextH = dir === "undo" ? { past: rest, future: [...h.future, f.deck] } : { past: [...h.past, f.deck], future: rest };
        lastMerge = null;
        // 取り消しで消えた図形を選んだままにしない
        set({ history: { ...st.history, [f.id]: nextH }, current: Math.min(st.current, target.slides.length - 1), selected: null, editing: null, textFocus: null });
        mapActive((x) => touch(x, { deck: target }));
        return true;
      };
      return {
        // Decks and folders are the Space's and load from Supabase (see slides/sync.ts).
        folders: [],
        files: [],
        activeFileId: null,
        current: 7,
        panel: "chat",
        logicTab: "deck",
        busy: false,
        theme: "light",
        lang: "ja",
        locale: "ja",
        setLocale: (locale) => {
          setUiLocale(locale);
          set({ locale, lang: locale === "ja" ? "ja" : "en" });
        },
        toast: null,
        notify: (text) => {
          const id = Date.now();
          set({ toast: { id, text } });
          setTimeout(() => {
            if (get().toast?.id === id) set({ toast: null });
          }, 2600);
        },
        filmstrip: true,
        setFilmstrip: (b) => set({ filmstrip: b }),
        presenting: false,
        setPresenting: (b) => set({ presenting: b }),
        palette: false,
        setPalette: (b) => set({ palette: b }),
        titleRead: false,
        setTitleRead: (b) => set({ titleRead: b }),
        shortcuts: false,
        setShortcuts: (b) => set({ shortcuts: b }),
        printing: false,
        printDeck: () => {
          if (get().printing) return;
          set({ printing: true });
          const done = () => {
            set({ printing: false });
            window.removeEventListener("afterprint", done);
          };
          window.addEventListener("afterprint", done);
          // 全ページを描いて、本文の縮小まで済ませてから印刷を開く
          setTimeout(() => {
            window.print();
            // afterprint が来ない環境でも、印刷画面を閉じたら戻す
            setTimeout(done, 0);
          }, 350);
        },
        setTheme: (t) => set({ theme: t }),
        skills: [DEFAULT_SKILL],
        addSkill: () => {
          const id = newId("skill");
          set((s) => ({ skills: [...s.skills, { id, name: tx("新しいスキル", "New skill"), enabled: true, terms: [], banned: [], maxTitle: null }] }));
          return id;
        },
        updateSkill: (id, patch) => set((s) => ({ skills: s.skills.map((k) => (k.id === id ? { ...k, ...patch } : k)) })),
        deleteSkill: (id) => set((s) => ({ skills: s.skills.filter((k) => k.id !== id) })),
        customLooks: [],
        saveLook: (name, tokens, source = "mine") => {
          const id = newId("look");
          set((s) => ({ customLooks: [...s.customLooks, { id, name: name.trim() || tx("マイ世界観", "My look"), source, tags: [source === "import" ? tx("取り込み", "Imported") : tx("マイ", "Mine")], tokens }] }));
          return id;
        },
        updateLook: (id, patch) =>
          set((s) => ({ customLooks: s.customLooks.map((l) => (l.id === id ? { ...l, ...(patch.name !== undefined ? { name: patch.name.trim() || l.name } : {}), ...(patch.tokens ? { tokens: patch.tokens } : {}) } : l)) })),
        deleteLook: (id) =>
          set((s) => ({
            customLooks: s.customLooks.filter((l) => l.id !== id),
            // 使っていた資料からは外す（最後の1つなら既定の世界観に戻す）
            files: s.files.map((f) => {
              if (!f.mix.selected.includes(id)) return f;
              const selected = f.mix.selected.filter((x) => x !== id);
              const pins = Object.fromEntries(Object.entries(f.mix.pins).filter(([, v]) => v !== id));
              return { ...f, mix: { ...f.mix, selected: selected.length ? selected : ["forest"], pins } };
            }),
          })),
        history: {},
        undo: () => step("undo"),
        redo: () => step("redo"),

        selectFile: (id) => set({ activeFileId: id, current: 0, selected: null, textFocus: null, editing: null }),
        createFolder: (name = tx("新しいフォルダ", "New folder")) => {
          const id = newId("f");
          set((s) => ({ folders: [...s.folders, { id, name, open: true }] }));
          return id;
        },
        renameFolder: (id, name) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)) })),
        deleteFolder: (id) =>
          set((s) => {
            const files = s.files.filter((f) => f.folderId !== id);
            const active = files.find((f) => f.id === s.activeFileId) ? s.activeFileId : (files[0]?.id ?? null);
            return { folders: s.folders.filter((f) => f.id !== id), files, activeFileId: active, current: active === s.activeFileId ? s.current : 0 };
          }),
        toggleFolder: (id) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, open: !f.open } : f)) })),
        createFile: (folderId, name = defaultFileName(), deck, mix) => {
          const id = newId("d");
          const file: KataFile = {
            id,
            name,
            folderId,
            deck: deck ?? blankDeck(name),
            mix: mix ?? { selected: ["forest"], pins: {}, offset: 0 },
            chat: [],
            updatedAt: Date.now(),
          };
          set((s) => ({
            files: [...s.files, file],
            activeFileId: id,
            current: 0,
            panel: "chat",
            folders: s.folders.map((f) => (f.id === folderId ? { ...f, open: true } : f)),
          }));
          return id;
        },
        renameFile: (id, name) =>
          set((s) => ({
            files: s.files.map((f) => {
              if (f.id !== id) return f;
              const next = name.trim() || f.name;
              // 表紙のタイトルがまだファイル名のままなら、一緒に変える
              const cover = f.deck.slides[0];
              const deck =
                cover?.layout === "cover" && (cover.title === f.name || !cover.title) && f.deck.title === f.name
                  ? { ...f.deck, title: next, slides: [{ ...cover, title: next }, ...f.deck.slides.slice(1)] }
                  : f.deck;
              return { ...f, name: next, deck };
            }),
          })),
        moveFile: (id, folderId) =>
          set((s) => ({
            files: s.files.map((f) => (f.id === id ? { ...f, folderId } : f)),
            folders: s.folders.map((f) => (f.id === folderId ? { ...f, open: true } : f)),
          })),
        duplicateFile: (id) => {
          const src = get().files.find((f) => f.id === id);
          if (!src) return;
          // ページの id を付け直し、サマリー・目次が指す先も付け直す
          const map = new Map(src.deck.slides.map((s) => [s.id, newId("s")]));
          const slides = D.remapRefs(src.deck.slides.map((s) => ({ ...s, id: map.get(s.id)! })), map);
          const copy: KataFile = { ...src, id: newId("d"), name: tx("{name} のコピー", "{name} (copy)", { name: src.name }), chat: [], updatedAt: Date.now(), deck: { ...src.deck, slides } };
          set((s) => {
            const at = s.files.findIndex((f) => f.id === id);
            const files = s.files.slice();
            files.splice(at + 1, 0, copy);
            return { files, activeFileId: copy.id, current: 0 };
          });
        },
        deleteFile: (id) =>
          set((s) => {
            const files = s.files.filter((f) => f.id !== id);
            const active = s.activeFileId === id ? (files[0]?.id ?? null) : s.activeFileId;
            return { files, activeFileId: active, current: s.activeFileId === id ? 0 : s.current };
          }),

        setCurrent: (i) => {
          const f = get().files.find((x) => x.id === get().activeFileId);
          const n = f?.deck.slides.length ?? 1;
          const next = Math.max(0, Math.min(n - 1, i));
          set(next === get().current ? { current: next } : { current: next, selected: null, textFocus: null, editing: null });
        },
        selected: null,
        select: (id) => set({ selected: id, ...(id ? { textFocus: null } : {}), ...(id !== get().editing ? { editing: null } : {}) }),
        editing: null,
        setEditing: (id) => set({ editing: id, ...(id ? { selected: id, textFocus: null } : {}) }),
        textFocus: null,
        setTextFocus: (f) => set({ textFocus: f, ...(f ? { selected: null } : {}) }),
        setPanel: (p) => set({ panel: p }),
        setLogicTab: (t) => set({ logicTab: t }),
        setBusy: (b) => set({ busy: b }),

        replaceDeck: (deck) => {
          lastMerge = null;
          editDeck(() => deck);
          set({ current: 0 });
        },
        editDeck,
        editFile,
        setSlidePath: (slideId, path, value) => editDeck((d) => D.updateSlide(d, slideId, (sl) => D.setSlidePath(sl, path, value))),
        setLayout: (slideId, layout) => editDeck((d) => D.setLayout(d, slideId, layout)),
        setStoryline: (st) => editDeck((d) => ({ ...d, storyline: st })),
        moveSlide: (from, to) => {
          const n = get().files.find((x) => x.id === get().activeFileId)?.deck.slides.length ?? 0;
          if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
          editDeck((d) => D.moveSlide(d, from, to));
          const c = get().current;
          if (c === from) set({ current: to });
          else if (from < c && to >= c) set({ current: c - 1 });
          else if (from > c && to <= c) set({ current: c + 1 });
        },
        deleteSlide: (i) => {
          editDeck((d) => D.deleteSlide(d, i));
          const c = get().current;
          if (c > i || c >= (get().files.find((x) => x.id === get().activeFileId)?.deck.slides.length ?? 1)) set({ current: Math.max(0, c - 1) });
        },

        toggleLook: (id) => mapActive((f) => touch(f, { mix: toggleLook(f.mix, id) })),
        pinElement: (el, lookId) =>
          mapActive((f) => {
            const pins = { ...f.mix.pins };
            if (lookId) pins[el] = lookId;
            else delete pins[el];
            return touch(f, { mix: { ...f.mix, pins } });
          }),
        remix: () => mapActive((f) => touch(f, { mix: { ...f.mix, pins: {}, offset: f.mix.offset + 1 } })),

        pushMessage: (m) => mapActive((f) => touch(f, { chat: [...f.chat, { ...m, id: newId("m"), at: Date.now() }] })),
        applyReply: (fileId, r) =>
          set((s) => {
            lastMerge = null;
            const f = s.files.find((x) => x.id === fileId);
            if (!f) return {};
            const history = r.deck ? { ...s.history, [fileId]: { past: [...(s.history[fileId]?.past ?? []), f.deck].slice(-60), future: [] } } : s.history;
            const chat = [...f.chat, { id: newId("m"), from: "kata" as const, text: r.text, at: Date.now() }];
            // 名前がまだ既定のままなら、組み上がった資料のタイトルを名前にする
            const name = r.deck && isDefaultFileName(f.name) && r.deck.title ? r.deck.title.slice(0, 24) : f.name;
            return { history, files: s.files.map((x) => (x.id === fileId ? touch(x, { chat, name, ...(r.deck ? { deck: r.deck } : {}) }) : x)) };
          }),
      };
    },
    {
      name: "alcon-slides-prefs-v1",
      storage: createJSONStorage(() => safeStorage),
      // The language is the app's, never a saved preference: an old save's
      // `lang` is dropped so it cannot override the app.
      merge: (persisted, current) => {
        const p = { ...(persisted as Partial<KataState> | undefined) };
        delete p.lang;
        return { ...current, ...p };
      },
      // Only this person's preferences stay in the browser; the decks are the Space's.
      partialize: (s) => ({ filmstrip: s.filmstrip, customLooks: s.customLooks, skills: s.skills, panel: s.panel, logicTab: s.logicTab }),
    },
  ),
);

export function useActiveFile(): KataFile | null {
  return useKata((s) => s.files.find((f) => f.id === s.activeFileId) ?? null);
}

/** 公式の世界観と自分の世界観を合わせた一覧 */
export function useLookMap(): Record<string, Look> {
  const custom = useKata((s) => s.customLooks);
  return useMemo(() => ({ ...LOOK_BY_ID, ...Object.fromEntries(custom.map((l) => [l.id, l])) }), [custom]);
}
