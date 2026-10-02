import { translate } from '@/Function/i18n/I18nProvider';

// The database keeps at least one owner on every Space, Domain and Object
// (guard_activity_space_last_owner / guard_last_scope_owner, ADR 0029) and
// refuses with check_violation. Those refusals, in the viewer's language;
// anything else keeps its own message or the caller's fallback.
export function membershipErrorMessage(error: unknown, fallback: string): string {
  const e = error as { code?: string; message?: string } | null;
  const message = e?.message ?? '';
  if (/must keep at least one owner/i.test(message)) {
    // Domain and Object roles cannot be changed, so the way out is deleting
    // it, or having the Object's Domain owner take it over.
    if (/\bObject\b/.test(message)) return translate("An Object needs at least one owner. Delete the Object instead, or ask an owner of its Domain to take it over.");
    if (/\bDomain\b/.test(message)) return translate('A Domain needs at least one owner. Delete the Domain instead if no one else should own it.');
    return translate('A Space needs at least one owner. Make someone else an owner first.');
  }
  return message || fallback;
}
