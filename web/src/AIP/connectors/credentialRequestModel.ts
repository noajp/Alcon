import type { CredentialRequest, Integration } from '@/types/database';
import { presetById } from './catalog';

// Credential capture (secure-login PR2): the pure half of the capture
// card and dialog — what the ask is about, where the credential would
// go, and how the dialog starts. The server derives every one of
// these facts on the request row; this mirror only reads the row (and
// the connection it names) so the surfaces render without a round
// trip. It holds display data only — a value exists in none of it.

/** The host an endpoint names, for the locked destination line. An
 *  endpoint without a scheme shows as typed (it is display, not a
 *  destination decision — the row's id is). */
function endpointHostLabel(endpoint: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec((endpoint ?? '').trim());
  return m ? m[1].toLowerCase() : (endpoint ?? '');
}

export interface CaptureDialogModel {
  kind: CredentialRequest['kind'];
  /** The header's subject: the connection's name, or the site origin. */
  subject: string;
  /** The locked destination text: the connection endpoint's host, or the origin itself. */
  destination: string;
  /** The work waiting on this capture, from the need — the dialog's why line. */
  waitingFor: string | null;
  /** The username field's prefill (site class): what the request carries. */
  usernameHint: string | null;
  /** A username field exists only for a site login: the token class
   *  stores one opaque value and has no name to file it under. */
  hasUsername: boolean;
  /** The masked field's label: the preset's own word for its credential
   *  ('Linear API key'), or 'Password' for a site login. */
  secretLabel: string;
  /** D2: the save checkbox's default — standing storage for the token
   *  class (connections are standing infrastructure), use-once for a
   *  site password (the larger blast radius asks for less trust). */
  saveByDefault: boolean;
  /** The request can still be answered. */
  pending: boolean;
}

/** Pure. The dialog's shape for one request. `integration` is the
 *  connection row the request names (token class); a site request
 *  needs none — its row carries the origin. */
export function captureDialogModel(
  request: CredentialRequest,
  integration: Pick<Integration, 'name' | 'endpoint' | 'preset'> | null,
): CaptureDialogModel {
  const waitingFor = request.need?.waiting_for?.trim() ? request.need.waiting_for : null;
  if (request.kind === 'site_login') {
    return {
      kind: request.kind,
      subject: request.origin ?? '',
      destination: request.origin ?? '',
      waitingFor,
      usernameHint: request.username_hint,
      hasUsername: true,
      secretLabel: 'Password',
      saveByDefault: false,
      pending: request.status === 'pending',
    };
  }
  const preset = presetById(integration?.preset);
  return {
    kind: request.kind,
    subject: integration?.name ?? '',
    destination: integration ? endpointHostLabel(integration.endpoint) : '',
    waitingFor,
    usernameHint: null,
    hasUsername: false,
    secretLabel: preset?.credentialLabel ?? 'Credential',
    saveByDefault: true,
    pending: request.status === 'pending',
  };
}

/** The card's terminal word for a resolved request, as an i18n source
 *  string; null while the ask is still pending. */
export function credentialRequestStateLabel(status: CredentialRequest['status']): string | null {
  switch (status) {
    case 'saved': return 'Credential saved';
    case 'used_once': return 'One-time credential received';
    case 'declined': return 'Credential entry was declined';
    case 'expired': return 'This request has expired';
    case 'superseded': return 'This request was replaced by a newer one';
    default: return null;
  }
}
