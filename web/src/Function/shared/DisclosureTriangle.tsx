// The one mark for "this opens and closes": a small filled triangle, ▶ when
// closed and ▼ when open. Used wherever a row or a heading folds what is under
// it — sidebar trees, the Properties islands, list groups — so folding reads
// the same everywhere. A menu that drops down keeps its chevron; this is only
// for disclosure.
export function DisclosureTriangle({ open, size = 8, className = '' }: { open: boolean; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      aria-hidden="true"
      className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''} ${className}`}
    >
      <path d="M2.25 1.1 6.6 4 2.25 6.9Z" fill="currentColor" />
    </svg>
  );
}
