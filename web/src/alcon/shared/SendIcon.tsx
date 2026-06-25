/**
 * Send glyph for composer buttons: a horizontal paper plane, filled with the
 * button's foreground colour, with the centre fold drawn in the accent so it
 * reads as a crease cutting through the body. Use on an accent-filled button
 * (bg-primary / text-primary-foreground), where the crease lands on the plane.
 */
export function SendIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Plane body — filled. */}
      <path
        d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"
        fill="currentColor"
      />
      {/* Centre crease — in the accent (the button's fill) so it shows as a fold. */}
      <path d="M6 12h15" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
