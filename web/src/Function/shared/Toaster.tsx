'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { AlertCircle, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { clearToasts, dismissToast, getServerToasts, getToasts, subscribeToasts } from './toastStore';

/** The one place failures reported by `notifyError` appear. Mounted once in the root layout. */
export function Toaster() {
  const { t } = useI18n();
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  useEffect(() => () => clearToasts(), []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-4 left-4 z-[100] flex flex-col items-end gap-2 sm:left-auto"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-fade-in pointer-events-auto flex w-full max-w-[380px] items-start gap-2 gloss-overlay rounded-lg px-3 py-2.5 text-popover-foreground"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-[var(--status-danger)]" />
          <div className="min-w-0 flex-1">
            <p className={`${FONT.base} font-medium`}>{toast.message}</p>
            {toast.detail && <p className={`${FONT.sm} mt-0.5 break-words text-muted-foreground`}>{toast.detail}</p>}
          </div>
          <Button variant="ghost" size="icon-xs" aria-label={t('Dismiss')} onClick={() => dismissToast(toast.id)}>
            <X size={14} />
          </Button>
        </div>
      ))}
    </div>
  );
}
