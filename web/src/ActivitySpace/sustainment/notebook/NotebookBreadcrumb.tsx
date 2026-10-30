'use client';

import { ChevronRight, Plus } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button, ButtonAppearanceProvider } from '@/ui/button';

// Breadcrumb strip along the top of the Notebook surface — the open
// Notebook's name (click to go back to the notebook browser) plus a "+" to
// add a page (file) to the active Section. Sections are listed in the
// FilesPane, and new Notebooks are created from the notebook browser's "+",
// not here.
export function NotebookBreadcrumb({
  folderName,
  onBack,
  onAddFile,
}: {
  folderName: string | null;
  onBack: () => void;
  /** Create a new page in the active Section — the header "+". Hidden when
   *  omitted. */
  onAddFile?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-0.5 px-2 h-[50px] border-b border-border/60 bg-card flex-shrink-0">
      <button
        type="button"
        onClick={onBack}
        className="px-1.5 py-0.5 rounded text-[13px] font-medium text-foreground hover:bg-muted/40 transition-colors shrink-0 truncate max-w-[240px]"
      >
        {folderName ?? t('Notebook')}
      </button>
      <ChevronRight size={12} className="text-muted-foreground/40 shrink-0" />
      <div className="flex-1" />
      {onAddFile && (
        <ButtonAppearanceProvider appearance="navigation">
          <Button variant="ghost" size="icon-xs" onClick={onAddFile} title={t('New page')} aria-label={t('New page')}>
            <Plus size={14} />
          </Button>
        </ButtonAppearanceProvider>
      )}
    </div>
  );
}
