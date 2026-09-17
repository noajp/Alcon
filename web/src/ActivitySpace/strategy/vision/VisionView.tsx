'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useActivitySpaces, updateActivitySpace } from '@/hooks/useSupabase';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useCurrentUserId } from '@/providers/authContext';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { NavVisionIcon } from '@/shell/sidebar/NavIcons';

// Strategy > Vision — what the Space aims for, in the Space's own words.
// One statement per Space (activity_spaces.vision). The Space owner writes
// it; every member reads it. Saves on blur; the text stays as typed.
export function VisionView() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const userId = useCurrentUserId();
  const { data: spaces, loading, refetch } = useActivitySpaces();
  const space = spaces.find((s) => s.id === spaceId) ?? null;

  // The viewer's seat in the Space: only an owner writes the Vision.
  const role = useQuery({
    queryKey: ['space-role', spaceId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_space_members')
        .select('role')
        .eq('activity_space_id', spaceId!)
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as 'owner' | 'member' | undefined) ?? null;
    },
    enabled: !!spaceId && !!userId,
  });
  const isOwner = role.data === 'owner';

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavVisionIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">{t('Vision')}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading || !space || role.isPending ? null : (
          <VisionEditor key={space.id} spaceId={space.id} spaceName={space.name}
            initial={space.vision ?? ''} canEdit={isOwner} onSaved={() => void refetch()} />
        )}
      </div>
    </div>
  );
}

function VisionEditor({ spaceId, spaceName, initial, canEdit, onSaved }: {
  spaceId: string; spaceName: string; initial: string; canEdit: boolean; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  // A refetch (another owner, another tab) brings a new `initial`; adopt it
  // unless the field holds an unsaved edit — the "adjust state from a prop"
  // pattern, during render, so nothing paints twice.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (text === seenInitial) setText(initial);
  }
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the text instead of scrolling inside the field.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const save = async () => {
    const next = text.trim();
    if (next === seenInitial.trim()) return;
    setState('saving');
    try {
      await updateActivitySpace(spaceId, { vision: next || null });
      setState('saved');
      onSaved();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : t("Couldn't save"));
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-10">
      <p className="text-[12px] text-muted-foreground">{t('What {space} aims for', { space: spaceName })}</p>
      {canEdit ? (
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); setState('idle'); }}
          onBlur={() => void save()}
          placeholder={t('Write the Vision — the future this Space works toward, and how it will know it got there.')}
          aria-label={t('Vision')}
          rows={3}
          className="mt-3 -mx-2 w-[calc(100%+1rem)] resize-none rounded-md bg-transparent px-2 py-1 text-[20px] leading-8 text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:bg-muted/30"
        />
      ) : initial ? (
        <p className="mt-4 whitespace-pre-wrap text-[20px] leading-8 text-foreground">{initial}</p>
      ) : (
        <p className="mt-4 text-[14px] text-muted-foreground">{t('No Vision yet. The Space owner writes it here.')}</p>
      )}
      <div className="mt-2 h-4 text-[11px] text-muted-foreground" role="status">
        {state === 'saving' ? t('Saving…') : state === 'saved' ? t('Saved') : state === 'error' ? `${t("Couldn't save")}: ${error}` : ''}
      </div>
    </div>
  );
}
