/**
 * Copy text to the clipboard without ever throwing.
 *
 * `navigator.clipboard.writeText` rejects with "Write permission denied"
 * inside sandboxed iframes that lack the `clipboard-write` permission
 * (e.g. the local dev preview frame). A bare `onClick={() => navigator.
 * clipboard.writeText(...)}` leaves that rejection unhandled, which Next's
 * dev overlay surfaces as a scary "Failed to fetch" TypeError. Route all
 * copies through here so the failure degrades quietly: try the async API,
 * fall back to a hidden-textarea + execCommand, and swallow anything left.
 *
 * Returns true on a confirmed copy, false if every path failed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred path — async Clipboard API (requires secure context + permission).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied / not allowed — fall through to the legacy path.
  }

  // Legacy fallback — works in more constrained contexts (older execCommand).
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
