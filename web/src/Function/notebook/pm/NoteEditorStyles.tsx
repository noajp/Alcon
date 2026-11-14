'use client';

// How a Note reads and looks while it is edited. Global because ProseMirror
// draws the content itself.

export function NoteEditorStyles() {
  return (
    <style jsx global>{`
        /* ProseMirror's own needs: text keeps its spaces, a node picked
           whole is outlined, the gap cursor blinks. */
        .note-editor { word-wrap: break-word; white-space: pre-wrap; white-space: break-spaces; font-variant-ligatures: none; }
        .note-editor pre { white-space: pre-wrap; }
        .note-editor li { position: relative; }
        .note-editor.ProseMirror-hideselection *::selection { background: transparent; }
        .note-editor.ProseMirror-hideselection { caret-color: transparent; }
        .note-editor .ProseMirror-selectednode { outline: 2px solid color-mix(in srgb, var(--accent-default) 55%, transparent); border-radius: 4px; }
        .note-editor img.ProseMirror-separator { display: inline !important; border: none !important; margin: 0 !important; }
        .note-editor .ProseMirror-gapcursor { display: none; pointer-events: none; position: absolute; }
        .note-editor .ProseMirror-gapcursor::after { content: ""; display: block; position: absolute; top: -2px; width: 20px; border-top: 1px solid var(--foreground); animation: note-gap-blink 1.1s steps(2, start) infinite; }
        @keyframes note-gap-blink { to { visibility: hidden; } }
        .note-editor.ProseMirror-focused .ProseMirror-gapcursor { display: block; }
        /* Tables: a wrapper scrolls a wide one; a column's edge drags its width. */
        .note-editor .tableWrapper { overflow-x: auto; margin: 0.5rem 0; }
        .note-editor .tableWrapper > table { margin: 0; }
        .note-editor td, .note-editor th { position: relative; box-sizing: border-box; }
        .note-editor .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; z-index: 20; background: var(--primary); pointer-events: none; }
        .note-editor.resize-cursor { cursor: col-resize; }
        /* A drawn block (diagram, live view, file): its source shows only
           while the caret is in it. */
        .note-editor .note-drawn { margin: 0.5rem 0; }
        .note-editor .note-drawn > pre { margin: 0; }
        .note-editor .note-drawn:not(.is-editing) > pre {
          height: 0; min-height: 0; padding: 0; overflow: hidden; opacity: 0; margin: 0;
        }
        .note-editor .note-drawn.is-editing > .note-drawn-view { display: none; }
        /* Where the others editing this Note are. */
        .note-editor .ProseMirror-yjs-cursor {
          position: relative; margin-left: -1px; margin-right: -1px;
          border-left: 1.5px solid; border-right: 0; word-break: normal; pointer-events: none;
        }
        .note-editor .ProseMirror-yjs-cursor > div {
          position: absolute; top: -1.15em; left: -1.5px; padding: 0 4px; border-radius: 3px 3px 3px 0;
          font-size: 11px; font-weight: 500; line-height: 1.4; white-space: nowrap; user-select: none;
          color: var(--background); font-family: inherit; font-style: normal;
        }
        .note-editor { position: relative; }
        /* Placeholder. Driven by data-empty (set in JS) rather than :empty,
           because after typing-then-deleting the DOM keeps a <p><br></p> and
           never becomes truly :empty. Absolutely positioned so it overlays
           the empty first line without nudging the caret. */
        .note-editor[data-empty="true"]::before {
          content: attr(data-placeholder);
          position: absolute;
          top: 0;
          left: 0;
          color: color-mix(in srgb, var(--muted-foreground) 70%, transparent);
          pointer-events: none;
        }
        .note-editor h1 {
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.25;
          margin: 1.2rem 0 0.4rem;
        }
        .note-editor h2 {
          font-size: 1.3rem;
          font-weight: 600;
          line-height: 1.3;
          margin: 1rem 0 0.3rem;
        }
        .note-editor h3 {
          font-size: 1.05rem;
          font-weight: 600;
          line-height: 1.35;
          margin: 0.85rem 0 0.25rem;
        }
        .note-editor p { margin: 0.25rem 0; min-height: 1em; }
        .note-compact h1 { font-size: 1.15rem; margin: 0.9rem 0 0.3rem; }
        .note-compact h2 { font-size: 1rem; margin: 0.8rem 0 0.25rem; }
        .note-compact h3 { font-size: 0.95rem; margin: 0.7rem 0 0.2rem; }
        .note-compact > :first-child { margin-top: 0; }
        .note-editor blockquote {
          border-left: 3px solid var(--border);
          padding-left: 0.8rem;
          margin: 0.5rem 0;
          color: var(--muted-foreground);
        }
        /* A break in the text, not a frame: a faint rule with room around it. */
        .note-editor hr {
          border: 0;
          border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
          margin: 1.25rem 0;
        }
        .note-editor pre {
          background: color-mix(in srgb, var(--muted) 60%, transparent);
          padding: 0.6rem 0.8rem;
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 13px;
          overflow-x: auto;
          margin: 0.5rem 0;
        }
        .note-editor code {
          background: color-mix(in srgb, var(--muted) 50%, transparent);
          padding: 0.1em 0.35em;
          border-radius: 4px;
          font-size: 0.92em;
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .note-editor pre code {
          background: transparent;
          padding: 0;
        }
        .note-editor a {
          color: var(--primary);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .note-editor ul, .note-editor ol {
          padding-left: 1.6rem;
          margin: 0.3rem 0;
        }
        /* Restore markers — Tailwind's preflight resets ul/ol to
           list-style: none, which would hide bullets/numbers. The dashed and
           checklist variants below re-override these with higher specificity. */
        .note-editor ul { list-style: disc; }
        .note-editor ol { list-style: decimal; }
        .note-editor ul ul { list-style: circle; }
        .note-editor ul ul ul { list-style: square; }
        .note-editor li { margin: 0.15rem 0; }
        .note-editor li > p { margin: 0; }
        /* Bold/italic — preflight can flatten these inside the editor, so set
           them explicitly. (font-weight: bolder resolves to 400 here.) */
        .note-editor b, .note-editor strong { font-weight: 700; }
        .note-editor i, .note-editor em { font-style: italic; }

        /* Dashed list: replace the default disc with an em-dash to match
           Note' "— Dashed List" option in the style picker. */
        .note-editor ul[data-style="dashed"] { list-style: none; padding-left: 1.2rem; }
        .note-editor ul[data-style="dashed"] > li { position: relative; padding-left: 0.6rem; }
        .note-editor ul[data-style="dashed"] > li::before {
          content: "—";
          position: absolute;
          left: -0.8rem;
          top: 0;
          color: var(--muted-foreground);
        }

        /* Tables — minimal Note-style ruled table. Editable cells.
           table-layout: fixed keeps columns evenly sized so typing into a
           cell doesn't widen its column and shift the grid; long content
           wraps inside the fixed width instead. */
        .note-editor table {
          border-collapse: collapse;
          table-layout: fixed;
          margin: 0.5rem 0;
          width: 100%;
          max-width: 100%;
        }
        .note-editor table th,
        .note-editor table td {
          /* Ruled so a table reads as one: --border alone is too faint to
             see on the dark ground. */
          border: 1px solid color-mix(in oklab, var(--foreground) 20%, transparent);
          padding: 0.4rem 0.6rem;
          text-align: left;
          vertical-align: top;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        .note-editor table th {
          font-weight: 600;
        }
        /* Merged cells (rowspan) center their text vertically; the toolbar's
           align buttons set data-align on the cell for horizontal alignment. */
        .note-editor table td[rowspan],
        .note-editor table th[rowspan] {
          vertical-align: middle;
        }
        .note-editor table td[data-align="center"],
        .note-editor table th[data-align="center"] { text-align: center; }
        .note-editor table td[data-align="right"],
        .note-editor table th[data-align="right"] { text-align: right; }
        /* Cells selected together (drag across them): what merging takes. */
        .note-editor .selectedCell::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background: color-mix(in srgb, var(--accent-default) 28%, transparent);
        }

        /* Alignment via data-align attribute (style="text-align" is normalized away) */
        .note-editor [data-align="center"] { text-align: center; }
        .note-editor [data-align="right"]  { text-align: right;  }

        /* Checklist row: [status ○] [text], the mark a pure CSS
           pseudo-element. Every item is a task: un-linked items show the
           Backlog dashed ring; → Element 化 links one to an Element and the
           ○ then mirrors that Element's live status. */
        .note-editor ul[data-checklist="true"] {
          list-style: none;
          padding-left: 0.25rem;
        }
        .note-editor ul[data-checklist="true"] > li {
          position: relative;
          padding-left: 1.5rem; /* 16px mark + 8px gap */
          cursor: text;
        }
        /* ::before = the status ○. Default (un-linked) = Backlog dashed
           ring; the linked-bullet rules below override it per status. */
        .note-editor ul[data-checklist="true"] > li::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0.5lh; /* center on the line — uses CSS lh unit so it tracks line-height */
          transform: translateY(-50%);
          width: 1rem;
          height: 1rem;
          cursor: default;
          background-repeat: no-repeat;
          background-position: center;
          background-size: contain;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5' stroke-dasharray='2 2'/></svg>");
        }
        /* An un-linked item's box is clicked to check it; checked, it fills
           with a tick and the text recedes. */
        .note-editor[contenteditable="true"] ul[data-checklist="true"] > li:not([data-element-id])::before {
          cursor: pointer;
        }
        .note-editor ul[data-checklist="true"] > li[data-checked="true"]:not([data-element-id]) {
          color: var(--muted-foreground);
        }
        .note-editor ul[data-checklist="true"] > li[data-checked="true"]:not([data-element-id])::before {
          background-image: none;
          background-color: var(--status-success);
          -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><mask id='m'><rect width='16' height='16' fill='white'/><path d='M4.5 8.3 L7 10.8 L11.5 5.5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></mask><circle cx='8' cy='8' r='7.4' mask='url(%23m)'/></svg>") center / contain no-repeat;
          mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><mask id='m'><rect width='16' height='16' fill='white'/><path d='M4.5 8.3 L7 10.8 L11.5 5.5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></mask><circle cx='8' cy='8' r='7.4' mask='url(%23m)'/></svg>") center / contain no-repeat;
        }
        /* Linked bullet — set by → Element 化. The checkbox ::before is
           replaced by a read-only ○ mirroring the linked Element's status
           (data-element-status, applied from live data; never persisted).
           A linked bullet is never struck through even if data-checked
           lingers from before it was linked. */
        .note-editor ul[data-checklist="true"] > li[data-element-id] {
          color: inherit;
          text-decoration: none;
          /* An Element made from this line stands out as a card, the way the
             chat shows the Elements it made: a framed band. The mark at its
             left and the arrow at its right open the Element. */
          margin: 4px 0;
          padding: 6px 2rem 6px 2.1rem;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--card);
          box-shadow: var(--shadow-card);
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id]::before {
          left: 0.6rem;
          top: calc(6px + 0.5lh);
          cursor: pointer;
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id]::after {
          content: "";
          position: absolute;
          right: 0.6rem;
          top: calc(6px + 0.5lh);
          transform: translateY(-50%);
          width: 14px;
          height: 14px;
          cursor: pointer;
          opacity: 0.55;
          background-color: var(--muted-foreground);
          -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 17 17 7M8 7h9v9'/></svg>") center / contain no-repeat;
          mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 17 17 7M8 7h9v9'/></svg>") center / contain no-repeat;
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id]:hover::after { opacity: 1; }
        .note-editor ul[data-checklist="true"] > li[data-element-id]:hover::before {
          cursor: pointer;
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id]::before,
        .note-editor ul[data-checklist="true"] > li[data-element-id]:hover::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5' stroke-dasharray='2 2'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="todo"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="in_progress"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23d49a1a' stroke-width='1.5'/><path d='M8 8 L8 3.1 A4.9 4.9 0 0 1 8 12.9 Z' fill='%23d49a1a'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="review"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%233b82f6' stroke-width='1.5'/><circle cx='8' cy='8' r='2.6' fill='%233b82f6'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="done"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7.4' fill='%233d7a4a'/><path d='M4.5 8.3 L7 10.8 L11.5 5.5' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="blocked"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7.4' fill='%23f43f5e'/><path d='M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5' stroke='white' stroke-width='1.8' stroke-linecap='round'/></svg>");
        }
        .note-editor ul[data-checklist="true"] > li[data-element-id][data-element-status="cancelled"]::before {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6.4' fill='none' stroke='%23999' stroke-width='1.5'/><path d='M4.5 11.5 L11.5 4.5' stroke='%23999' stroke-width='1.5' stroke-linecap='round'/></svg>");
        }
    `}</style>
  );
}
