import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** One thing a Space's canvases can draw with (see generated/skills.ts). */
export interface CanvasSkill { id: string; kind: 'guide' | 'library'; name: string; body: string; url: string | null; created_at: string }
type Draft = Pick<CanvasSkill, 'kind' | 'name' | 'body' | 'url'>;

const COLUMNS = 'id, kind, name, body, url, created_at';
const EMPTY: CanvasSkill[] = [];

/** The Space's imported skills, oldest first, and adding or removing one. */
export function useCanvasSkills(spaceId: string | null) {
  const qc = useQueryClient();
  const key = ['canvas-skills', spaceId];
  const query = useQuery({
    queryKey: key,
    enabled: !!spaceId,
    queryFn: async (): Promise<CanvasSkill[]> => {
      const { data, error } = await supabase.from('canvas_skills').select(COLUMNS).eq('activity_space_id', spaceId!).order('created_at');
      if (error) throw error;
      return (data ?? []) as CanvasSkill[];
    },
  });
  const add = useMutation({
    mutationFn: async (drafts: Draft[]) => {
      if (!spaceId || !drafts.length) return;
      const { error } = await supabase.from('canvas_skills').insert(drafts.map((d) => ({ ...d, name: d.name.trim().slice(0, 80) || 'Skill', activity_space_id: spaceId })));
      if (error) throw error;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('canvas_skills').delete().eq('id', id);
      if (error) throw error;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); },
  });
  return { skills: query.data ?? EMPTY, loading: !!spaceId && query.isPending, add, remove };
}
