'use client';

/**
 * RailRow — the right-rail property row used inside RailCard.
 *
 * Single source of truth so the Element detail's "Properties" island
 * and the Object overview's "Properties" island stay visually identical
 * (and so a tweak in one place doesn't drift the other). Layout:
 *
 *   [ name (w-24, semibold, muted) ][ icon ][ label (truncates) ]
 *
 * Used as a wrapper inside <RailCard>'s body, where each row is either
 * a plain display row or a `<button>` that opens an inline picker — the
 * caller decides; this component only renders the row chrome.
 */
export function RailRow({
  icon,
  name,
  label,
  placeholder = false,
}: {
  icon?: React.ReactNode;
  name?: string;
  label: React.ReactNode;
  /** Render the label in the muted "click to fill" colour. */
  placeholder?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-2 rounded-md hover:bg-muted/40 transition-colors text-[11px] font-normal leading-5 ${
        placeholder ? 'text-muted-foreground' : 'text-foreground/90'
      }`}
    >
      {name && (
        <span className="shrink-0 w-24 text-left text-[11px] font-semibold text-muted-foreground">
          {name}
        </span>
      )}
      {icon && (
        <span className="shrink-0 flex items-center justify-center min-w-4 opacity-90">
          {icon}
        </span>
      )}
      <span className="truncate text-left flex-1 min-w-0">{label}</span>
    </div>
  );
}
