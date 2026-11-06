'use client';

import { useState } from 'react';
import { Check, Copy } from '@/ui/icons';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';

/** A read-only value with a copy button: an endpoint, a command, a token shown once. */
export function CopyField({ value, multiline = false, label }: { value: string; multiline?: boolean; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable; the text stays selectable */ }
  };
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2">
      <code aria-label={label} className={cn('min-w-0 flex-1 select-all font-mono text-[12px] text-foreground', multiline ? 'whitespace-pre-wrap break-all' : 'truncate')}>{value}</code>
      <Button variant="ghost" size="icon-xs" aria-label={copied ? t('Copied') : t('Copy')} onClick={copy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </div>
  );
}

/** A button that copies `value` without showing it — for an address, a
 *  setting or a command the person pastes elsewhere and never needs to read. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <Button variant="secondary" size="sm" onClick={copy} className="self-start">
      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? t('Copied') : label}
    </Button>
  );
}
