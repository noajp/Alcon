'use client';

import { useEffect, useState, useRef } from 'react';
import { Smile, Image as ImageIcon } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { useActivitySpaces, updateActivitySpace, deleteActivitySpace } from '@/hooks/useSupabase';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { getActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { SettingsSection, SettingsRow } from './SettingsSection';

const EMOJI_PICKS = [
  '🏢', '🏠', '🏗️', '🚀', '⭐', '💡', '🎯', '🔥',
  '💎', '🌍', '🌸', '🎨', '📦', '🛠️', '📊', '🧩',
  '🤖', '🧪', '📚', '🎵', '🍀', '🌊', '⚡', '🏆',
];

const LOGO_BUCKET = 'avatars';

function isEmoji(s: string) {
  return /^\p{Emoji}/u.test(s) && s.length <= 4;
}

export function ActivitySpaceSettings() {
  const { user } = useAuthContext();
  const { data: spaces, refetch } = useActivitySpaces();
  const [activeId] = useState(() => getActiveSpaceId() ?? '');
  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [memberCount, setMemberCount] = useState(0);

  const [logoValue, setLogoValue] = useState<string | null>(null);
  const [logoOpen, setLogoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    setName(active.name);
    setLogoValue(active.logo ?? null);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    supabase
      .from('activity_space_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('activity_space_id', active.id)
      .then(({ count }) => setMemberCount(count ?? 0));
  }, [active]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || !active || trimmed === active.name) return;
    setSaving(true);
    try {
      await updateActivitySpace(active.id, { name: trimmed });
      await refetch();
    } catch (e) {
      console.error('Rename failed', e);
    } finally {
      setSaving(false);
    }
  };

  const saveLogo = async (value: string | null) => {
    if (!active) return;
    setLogoValue(value);
    setLogoOpen(false);
    try {
      await updateActivitySpace(active.id, { logo: value });
      await refetch();
    } catch (e) {
      console.error('Logo save failed', e);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    void saveLogo(emoji);
  };

  const handleReset = () => {
    void saveLogo(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !active || !user) return;
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/space-${active.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      const url = `${pub.publicUrl}?t=${Date.now()}`;
      void saveLogo(url);
    } catch (err) {
      console.error('Logo upload failed', err);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!active) return;
    const { count } = await supabase
      .from('domains')
      .select('id', { count: 'exact', head: true })
      .eq('activity_space_id', active.id);
    if ((count ?? 0) > 0) {
      window.alert(`"${active.name}" still has Domains. Move or delete them before deleting the Space.`);
      return;
    }
    if (!window.confirm(`Delete "${active.name}"? This can't be undone.`)) return;
    try {
      await deleteActivitySpace(active.id);
      window.location.reload();
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const initial = (active?.name ?? '?').charAt(0).toUpperCase();

  if (!active) return null;

  const logoPreview = logoValue && isEmoji(logoValue) ? (
    <span className="w-10 h-10 rounded-lg bg-muted/60 text-[22px] flex items-center justify-center">
      {logoValue}
    </span>
  ) : logoValue ? (
    <img src={logoValue} alt="" className="block w-10 h-10 rounded-lg object-cover" />
  ) : (
    <span className="w-10 h-10 rounded-lg bg-primary/15 text-primary text-[16px] font-bold flex items-center justify-center">
      {initial}
    </span>
  );

  return (
    <>
      <SettingsSection title="General">
        <SettingsRow label="Logo" className="flex items-center justify-between gap-4 px-4 py-1.5">
          <Popover open={logoOpen} onOpenChange={setLogoOpen}>
            <PopoverTrigger asChild>
              <button type="button" className="block w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity">
                {logoPreview}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="flex items-center gap-1 mb-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
                >
                  <ImageIcon size={13} /> Upload image
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
                >
                  Reset
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <div className="border-t border-border/60 pt-2">
                <div className="flex items-center gap-1 mb-1.5 px-1">
                  <Smile size={12} className="text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">Emoji</span>
                </div>
                <div className="grid grid-cols-8 gap-0.5">
                  {EMOJI_PICKS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => handleEmojiSelect(e)}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted/40 text-[16px] transition-colors"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </SettingsRow>
        <SettingsRow label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveName(); } }}
            className="w-56 px-3 py-1.5 text-[13px] rounded-md bg-muted/40 text-foreground"
            disabled={saving}
          />
        </SettingsRow>
        <SettingsRow label="Members">
          <span className="text-[13px] text-muted-foreground">{memberCount}</span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Danger zone">
        <SettingsRow label="Delete Activity space" hint="Schedule this space to be permanently deleted">
          <button
            type="button"
            onClick={handleDelete}
            className="px-3 py-1.5 text-[12px] font-medium text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10 transition-colors"
          >
            Delete
          </button>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
