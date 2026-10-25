"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { BookMarked, ChevronRight, Copy, FilePlus2, FileText, FileUp, Folder as FolderIcon, FolderOpen, FolderPlus, Palette, Pencil, Trash2 } from "lucide-react";
import { SkillsDialog } from "./SkillsDialog";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import type { Folder, KataFile } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { IconButton } from "@/ActivitySpace/sustainment/slides/kata/components/ui/IconButton";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { fromKataJson } from "@/ActivitySpace/sustainment/slides/kata/model/kataFile";

/** .kata.json を開いて、新しい資料として置く（今のフォルダか、最初のフォルダに） */
export async function openKataFile(f: File) {
  const st = useKata.getState();
  let r: ReturnType<typeof fromKataJson> = null;
  try {
    r = fromKataJson(await f.text());
  } catch {
    r = null;
  }
  if (!r) {
    st.notify(tx("資料ファイルとして読めませんでした", "That isn't a deck file Slides can read"));
    return;
  }
  const active = st.files.find((x) => x.id === st.activeFileId);
  const folderId = active?.folderId ?? st.folders[0]?.id ?? st.createFolder();
  st.createFile(folderId, r.name, r.deck, r.mix);
  st.notify(tx(`「${r.name}」を開きました（${r.deck.slides.length}枚）`, `Opened “${r.name}” (${r.deck.slides.length} slides)`));
}

function RenameInput({ value, onDone, label }: { value: string; onDone: (v: string | null) => void; label: string }) {
  const cancelled = useRef(false);
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={value}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => onDone(cancelled.current ? null : e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          onDone(null);
        }
      }}
      className="h-7 min-w-0 flex-1 rounded-md border border-k-line-strong bg-k-panel px-2 text-[13px]"
    />
  );
}

function ConfirmRow({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="anim-in mx-1 my-0.5 flex items-center justify-between gap-2 rounded-lg bg-k-danger-tint px-2.5 py-1.5 text-[12px] text-k-danger">
      <span className="truncate">{text}</span>
      <span className="flex shrink-0 gap-1">
        <button type="button" onClick={onYes} className="rounded-md bg-k-danger px-2 py-0.5 font-medium text-k-on-danger">
          {tx("削除", "Delete")}
        </button>
        <button type="button" onClick={onNo} className="rounded-md px-2 py-0.5 text-k-ink-2 hover:bg-k-panel">
          {tx("やめる", "Cancel")}
        </button>
      </span>
    </div>
  );
}

export function Sidebar() {
  const folders = useKata((s) => s.folders);
  const files = useKata((s) => s.files);
  const createFolder = useKata((s) => s.createFolder);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const setPanel = useKata((s) => s.setPanel);
  const skillCount = useKata((s) => s.skills.filter((k) => k.enabled).length);
  const openRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="flex w-[228px] shrink-0 flex-col overflow-hidden rounded-2xl border border-k-line bg-k-panel-2">
      <div className="flex h-11 items-center justify-between pl-4 pr-2">
        <span className="font-mono text-[11px] tracking-[0.08em] text-k-ink-3">FILES</span>
        <span className="flex items-center">
          <IconButton label={tx("Slides ファイルを開く（.kata.json）", "Open a Deck file (.kata.json)")} onClick={() => openRef.current?.click()}>
            <FileUp size={15} />
          </IconButton>
          <input
            ref={openRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await openKataFile(f);
            }}
          />
        <IconButton
          label={tx("フォルダを作る", "New folder")}
          onClick={() => {
            const id = createFolder();
            setRenamingFolder(id);
          }}
        >
          <FolderPlus size={15} />
        </IconButton>
        </span>
      </div>
      <nav aria-label={tx("ファイル", "Files")} className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        {folders.map((f) => (
          <FolderRow key={f.id} folder={f} files={files.filter((x) => x.folderId === f.id)} renaming={renamingFolder === f.id} setRenaming={setRenamingFolder} />
        ))}
        {folders.length === 0 ? <p className="px-3 py-6 text-[12px] leading-relaxed text-k-ink-3">{tx("右上の ＋ からフォルダを作ると、その中に資料を置けます。", "Create a folder with ＋ above, then add decks to it.")}</p> : null}
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-k-line p-2">
        <button type="button" onClick={() => setSkillsOpen(true)} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink">
          <BookMarked size={15} />
          {tx("マイ・スキル", "My skills")}
          <span className="ml-auto font-mono text-[10px] text-k-ink-3">{skillCount}</span>
        </button>
        <button type="button" onClick={() => setPanel("design")} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink">
          <Palette size={15} />
          {tx("世界観ライブラリ", "Look library")}
        </button>
      </div>
      {skillsOpen ? <SkillsDialog onClose={() => setSkillsOpen(false)} /> : null}
    </aside>
  );
}

function FolderRow({ folder, files, renaming, setRenaming }: { folder: Folder; files: KataFile[]; renaming: boolean; setRenaming: (id: string | null) => void }) {
  const toggleFolder = useKata((s) => s.toggleFolder);
  const renameFolder = useKata((s) => s.renameFolder);
  const deleteFolder = useKata((s) => s.deleteFolder);
  const createFile = useKata((s) => s.createFile);
  const moveFile = useKata((s) => s.moveFile);
  const [confirm, setConfirm] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      className={clsx("mb-0.5 rounded-lg", over && "bg-k-drop ring-1 ring-k-lime-deep")}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("text/kata-file")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/kata-file");
        setOver(false);
        if (id) moveFile(id, folder.id);
      }}
    >
      {confirm ? (
        <ConfirmRow text={tx(`「${folder.name}」と中の ${files.length} 件`, `“${folder.name}” and ${files.length} ${files.length === 1 ? "deck" : "decks"}`)} onYes={() => deleteFolder(folder.id)} onNo={() => setConfirm(false)} />
      ) : (
        <div className="group relative flex h-8 items-center gap-1 rounded-lg pr-1 hover:bg-k-hover">
          {renaming ? (
            <div className="flex flex-1 items-center gap-1.5 pl-2">
              <FolderOpen size={15} className="shrink-0 text-k-ink-2" />
              <RenameInput
                label={tx("フォルダ名", "Folder name")}
                value={folder.name}
                onDone={(v) => {
                  if (v !== null) renameFolder(folder.id, v);
                  setRenaming(null);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              aria-expanded={folder.open}
              onClick={() => toggleFolder(folder.id)}
              onDoubleClick={() => setRenaming(folder.id)}
              className="flex h-8 min-w-0 flex-1 items-center gap-1.5 pl-1.5 text-left"
            >
              <ChevronRight size={13} className={clsx("shrink-0 text-k-ink-3 transition-transform", folder.open && "rotate-90")} />
              {folder.open ? <FolderOpen size={15} className="shrink-0 text-k-ink-2" /> : <FolderIcon size={15} className="shrink-0 text-k-ink-2" />}
              <span className="truncate text-[13px] font-semibold">{folder.name}</span>
              <span className="ml-auto pr-1 text-[11px] text-k-ink-3">{files.length || ""}</span>
            </button>
          )}
          {!renaming ? (
            <span className={clsx("absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded-md opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100", "bg-[inherit]")}>
              <IconButton label={tx("この中に資料を作る", "New deck here")} onClick={() => {
                const id = createFile(folder.id);
                setRenamingFile(id);
              }}>
                <FilePlus2 size={14} />
              </IconButton>
              <IconButton label={tx("名前を変える", "Rename")} onClick={() => setRenaming(folder.id)}>
                <Pencil size={13} />
              </IconButton>
              <IconButton label={tx("フォルダを削除", "Delete folder")} onClick={() => setConfirm(true)}>
                <Trash2 size={13} />
              </IconButton>
            </span>
          ) : null}
        </div>
      )}
      {folder.open ? (
        <div className="ml-[18px] border-l border-k-line pl-1.5">
          {files.map((file) => (
            <FileRow key={file.id} file={file} renaming={renamingFile === file.id} setRenaming={setRenamingFile} />
          ))}
          {files.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                const id = createFile(folder.id);
                setRenamingFile(id);
              }}
              className="my-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12px] text-k-ink-3 hover:bg-k-hover hover:text-k-ink-2"
            >
              <FilePlus2 size={14} /> {tx("資料を作る", "New deck")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({ file, renaming, setRenaming }: { file: KataFile; renaming: boolean; setRenaming: (id: string | null) => void }) {
  const active = useKata((s) => s.activeFileId === file.id);
  const selectFile = useKata((s) => s.selectFile);
  const renameFile = useKata((s) => s.renameFile);
  const deleteFile = useKata((s) => s.deleteFile);
  const duplicateFile = useKata((s) => s.duplicateFile);
  const [confirm, setConfirm] = useState(false);

  if (confirm) return <ConfirmRow text={tx(`「${file.name}」`, `“${file.name}”`)} onYes={() => deleteFile(file.id)} onNo={() => setConfirm(false)} />;

  return (
    <div className={clsx("group relative my-0.5 flex h-8 items-center rounded-lg pr-1", active ? "bg-k-selected" : "hover:bg-k-hover")}>
      {renaming ? (
        <div className="flex flex-1 items-center gap-2 pl-2">
          <FileText size={14} className="shrink-0 text-k-ink-2" />
          <RenameInput
            label={tx("ファイル名", "File name")}
            value={file.name}
            onDone={(v) => {
              if (v !== null) renameFile(file.id, v);
              setRenaming(null);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/kata-file", file.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          title={tx("ドラッグで別のフォルダへ移せます", "Drag to move to another folder")}
          aria-current={active ? "page" : undefined}
          onClick={() => selectFile(file.id)}
          onDoubleClick={() => setRenaming(file.id)}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 pl-2 text-left"
        >
          <FileText size={14} className={clsx("shrink-0", active ? "text-k-ink" : "text-k-ink-3")} />
          <span className={clsx("truncate text-[13px]", active ? "font-semibold text-k-ink" : "text-k-ink-2")}>{file.name}</span>
          <span className="ml-auto pr-1 font-mono text-[10px] text-k-ink-3">{file.deck.slides.length}</span>
        </button>
      )}
      {!renaming ? (
        <span className={clsx("absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded-md opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100", "bg-[inherit]")}>
          <IconButton label={tx("名前を変える", "Rename")} onClick={() => setRenaming(file.id)}>
            <Pencil size={13} />
          </IconButton>
          <IconButton label={tx("複製する", "Duplicate")} onClick={() => duplicateFile(file.id)}>
            <Copy size={13} />
          </IconButton>
          <IconButton label={tx("資料を削除", "Delete deck")} onClick={() => setConfirm(true)}>
            <Trash2 size={13} />
          </IconButton>
        </span>
      ) : null}
    </div>
  );
}
