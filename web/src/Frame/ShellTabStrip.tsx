'use client';

import { ArrowLeft, ArrowRight, PanelLeft } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The strip across the top of the content column: the shell's history
// controls (‹ ›) and the sidebar's toggle, permanently installed — the
// buttons dim when there is nowhere to go rather than appearing and
// disappearing and shifting what sits beside them. Item tabs join this
// row in a later change; for now it is the cluster's home. Glyphs only:
// where the person came from is never written out as text here.

const clusterButton = (enabled: boolean) =>
  `flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
    enabled
      ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
      : 'pointer-events-none text-muted-foreground/40'
  }`;

export function ShellTabStrip({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  sidebarVisible,
  onToggleSidebar,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  /** Whether the sidebar is on screen (pinned, or peeked as a drawer). */
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onGoBack}
        disabled={!canGoBack}
        aria-disabled={!canGoBack}
        title={t('Back')}
        aria-label={t('Back')}
        className={clusterButton(canGoBack)}
      >
        <ArrowLeft size={15} />
      </button>
      <button
        type="button"
        onClick={onGoForward}
        disabled={!canGoForward}
        aria-disabled={!canGoForward}
        title={t('Forward')}
        aria-label={t('Forward')}
        className={clusterButton(canGoForward)}
      >
        <ArrowRight size={15} />
      </button>
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-pressed={sidebarVisible}
        title={t(sidebarVisible ? 'Hide sidebar' : 'Show sidebar')}
        aria-label={t(sidebarVisible ? 'Hide sidebar' : 'Show sidebar')}
        className={clusterButton(true)}
      >
        <PanelLeft size={15} />
      </button>
    </div>
  );
}
