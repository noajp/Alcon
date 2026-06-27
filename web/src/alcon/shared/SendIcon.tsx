/**
 * Send glyph for composer buttons: a horizontal paper plane filled in the
 * button's foreground colour, with the centre fold knocked out in the button's
 * own fill (--rail-active) so it reads as a gap/crease — not a line. Use on a
 * button with bg-[var(--rail-active)].
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
      <path
        d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"
        fill="currentColor"
      />
      {/* Centre fold — painted in the button's fill so it cuts a gap through the body. */}
      <path d="M6 12h15" stroke="var(--rail-active)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
