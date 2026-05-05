/**
 * Atom-style icon used to represent an Element across the UI (rows in
 * lists, breadcrumb / detail title, quick-add chip). The Element concept
 * is "the smallest executable unit" — the orbital pattern is a visual
 * nod to that. One source of truth so size/stroke stay in sync.
 */
export function AtomIcon({
  size = 14,
  className = '',
}: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
      <circle cx="21.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="6.8" cy="4.4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="6.8" cy="19.6" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
