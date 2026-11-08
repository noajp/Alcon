'use client';

import { KeyRound } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAnyCredentialRequestPending } from './credentialRequestData';

// The chat-side hint (secure-login PR4, the design's T2 residual):
// while a capture ask stands in this conversation, a line by the
// composer says where the password belongs — in the card, not in
// the chat. Model-authored text can imitate a dialog in prose; the
// real ask is a card, and this hint exists so a person who cannot
// find it does not hand the value to the transcript instead. It
// renders nothing when no ask is pending, and it never names the
// credential: that is the card's job.
export function CredentialChatHint({ requestIds }: { requestIds: readonly string[] }) {
  const { t } = useI18n();
  const pending = useAnyCredentialRequestPending(requestIds);
  if (!pending) return null;
  return (
    <p className="flex items-center gap-1.5 px-1 pb-1.5 text-[11.5px] text-muted-foreground">
      <KeyRound size={12} className="shrink-0" />
      {t('Enter passwords through the card — not in this chat.')}
    </p>
  );
}
