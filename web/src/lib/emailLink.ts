import type { EmailLinkType } from '@/hooks/useAuth';

const LINK_TYPES: readonly EmailLinkType[] = ['email', 'signup', 'invite', 'magiclink', 'recovery', 'email_change'];

export interface EmailLink {
  tokenHash: string;
  type: EmailLinkType;
  /** Same-origin path to open once confirmed. */
  next: string;
}

/** Reads the link an auth email points at:
 *  `/auth/confirm?token_hash=…&type=…&redirect_to={{ .RedirectTo }}`.
 *  The template puts RedirectTo last and unencoded, so it may carry its own
 *  `?` and `&` — everything after `redirect_to=` is the address. Only an
 *  address on this site is followed; anything else opens the app. */
export function parseEmailLink(search: string, origin: string): EmailLink | null {
  const params = new URLSearchParams(search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailLinkType | null;
  if (!tokenHash || !type || !LINK_TYPES.includes(type)) return null;
  return { tokenHash, type, next: safeNext(search, origin) };
}

function safeNext(search: string, origin: string): string {
  const at = search.indexOf('redirect_to=');
  if (at < 0) return '/';
  let raw = search.slice(at + 'redirect_to='.length);
  if (/^https?%3A/i.test(raw)) {
    try { raw = decodeURIComponent(raw); } catch { return '/'; }
  }
  if (!raw) return '/';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
