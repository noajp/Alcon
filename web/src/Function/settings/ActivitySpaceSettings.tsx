'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Smile, Image as ImageIcon, UserPlus, Trash2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { useActivitySpaces, updateActivitySpace, deleteActivitySpace } from '@/hooks/useSupabase';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { SettingsSection, SettingsRow } from './SettingsSection';
import { InviteUserDialog } from './InviteUserDialog';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';

interface SpaceMember {
  user_id: string;
  role: string;
  display_name: string | null;
  avatar_url: string | null;
}

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
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [showInvite, setShowInvite] = useState(false);

  const [logoValue, setLogoValue] = useState<string | null>(null);
  const [logoOpen, setLogoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    setName(active.name);
    setLogoValue(active.logo ?? null);
  }, [active]);

  const reloadMembers = useCallback(async () => {
    if (!active) return;
    const { data: rows } = await supabase
      .from('activity_space_members')
      .select('user_id, role')
      .eq('activity_space_id', active.id);
    const memberRows = (rows ?? []) as { user_id: string; role: string }[];
    const ids = memberRows.map((r) => r.user_id);
    const { data: profs } = ids.length
      ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', ids)
      : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    setMembers(
      memberRows
        .map((r) => ({
          user_id: r.user_id,
          role: r.role,
          display_name: byId.get(r.user_id)?.display_name ?? null,
          avatar_url: byId.get(r.user_id)?.avatar_url ?? null,
        }))
        // owners first, then by name
        .sort((a, b) =>
          a.role === b.role
            ? (a.display_name ?? '').localeCompare(b.display_name ?? '')
            : a.role === 'owner' ? -1 : 1,
        ),
    );
  }, [active]);

  useEffect(() => {
    void reloadMembers();
  }, [reloadMembers]);

  const myRole = members.find((m) => m.user_id === user?.id)?.role ?? null;
  const isOwner = myRole === 'owner';

  const handleRemoveMember = async (member: SpaceMember) => {
    if (!active) return;
    if (!window.confirm(`Remove ${member.display_name || 'this member'} from "${active.name}"?`)) return;
    try {
      const { error } = await supabase
        .from('activity_space_members')
        .delete()
        .eq('activity_space_id', active.id)
        .eq('user_id', member.user_id);
      if (error) throw error;
      await reloadMembers();
    } catch (e) {
      console.error('Failed to remove member', e);
    }
  };

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
            className="w-56 px-3 py-1.5 text-[13px] rounded-md bg-muted/40 text-foreground border-none"
            disabled={saving}
          />
        </SettingsRow>
      </SettingsSection>

      <div className="mb-2 mt-6 flex items-end justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Members ({members.length})</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Space members can see every Workspace Domain. Invite people to a single Domain instead to add them as a Guest.
          </p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-foreground rounded-md text-[12px] font-medium hover:bg-muted/40 transition-colors shrink-0 whitespace-nowrap"
          >
            <UserPlus size={12} />
            Invite to Space
          </button>
        )}
      </div>

      <SettingsSection title="">
        {members.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">No members yet.</div>
        ) : (
          members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
              <WorkerAvatar
                worker={{ name: m.display_name, avatar_url: m.avatar_url }}
                size={32}
                className="ring-border/70"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">
                  {m.display_name || 'Unnamed'}
                  {m.user_id === user?.id && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">(you)</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground capitalize">{m.role}</div>
              </div>
              {isOwner && m.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => handleRemoveMember(m)}
                  className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded transition-colors"
                  title="Remove from Space"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))
        )}
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

      {showInvite && (
        <InviteUserDialog
          target={{ kind: 'space', spaceId: active.id }}
          existingMemberIds={new Set(members.map((m) => m.user_id))}
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            void reloadMembers();
          }}
        />
      )}
    </>
  );
}
