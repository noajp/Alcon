'use client';

import { Star } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useFollow, type FollowKind } from '@/hooks/followData';

/** The star beside an Object's or an Element's "…": follow it (it joins
 *  Follow in Execution's sidebar), or stop. Filled while followed. */
export function FollowButton({ kind, id }: { kind: FollowKind; id: string }) {
  const { t } = useI18n();
  const { following, toggle } = useFollow(kind, id);
  const label = following ? t('Unfollow') : t('Follow');
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-pressed={following} aria-label={label} title={label}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(undefined, { onError: (e) => void appDialog.alert(e instanceof Error ? e.message : String(e)) })}
      className={following ? 'text-[var(--status-warning)]' : 'text-muted-foreground'}>
      <Star size={14} fill={following ? 'currentColor' : 'none'} />
    </Button>
  );
}
