'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Textarea } from '@/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';
import { SettingField, SettingRow, SettingsIsland } from './SettingsControls';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MyInvitations } from '@/Function/membership/MyInvitations';
import { Button } from '@/ui/button';

function initialsFor(name: string | null | undefined, fallback: string): string {
  const source = (name && name.trim()) || fallback;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

// ── Domains (read-only) ──────────────────────────────────────────────────
// Where the signed-in user's account actually reaches: every Domain they
// hold a domain_members row in, grouped by the Activity Space that owns it.
// No edit affordance here — joining/leaving a Domain and changing role stay
// on TeamSettings / MemberSettings; this is purely "where am I a member."

interface MyDomainRow {
  id: string;
  name: string;
  color: string | null;
  activity_space_id: string | null;
}

// A Domain glyph tinted the same way the Domain tree in AppSidebar tints it —
// bare 3-layer icon when uncolored, tucked into a color chip otherwise.
function DomainGlyph({ color, size = 14 }: { color: string | null; size?: number }) {
  if (!color) return <DomainIcon size={size} className="text-muted-foreground/70 shrink-0" />;
  return (
    <span
      className="rounded flex items-center justify-center text-white shrink-0"
      style={{ width: size + 4, height: size + 4, backgroundColor: color }}
    >
      <DomainIcon size={size - 2} />
    </span>
  );
}

interface MyDomainMemberships {
  domains: MyDomainRow[];
  spaceNames: Map<string, string>;
  role: string | null;
}

const EMPTY_MEMBERSHIPS: MyDomainMemberships = { domains: [], spaceNames: new Map(), role: null };

// Membership-scoped reads only — same shape as useDomains()/MemberSettings:
// domain_members (own rows) → domains (by id) → activity_spaces (by id), plus
// the account's own Worker role in parallel (it doesn't depend on either).
// RLS admits domain_members/domains without adjustment (every row read is the
// caller's own membership or a record it points to), but activity_spaces has
// its own membership check — a Domain you were invited to individually (a
// Guest, not a Space member) resolves fine, its Space's name does not; that
// case is a real "Guest access" state, not missing data, and is labelled as
// such below rather than left to read as an unexplained blank.
async function fetchMyDomainMemberships(userId: string): Promise<MyDomainMemberships> {
  const [{ data: memberRows, error: memberErr }, { data: workerRow, error: workerErr }] = await Promise.all([
    supabase.from('domain_members').select('domain_id').eq('user_id', userId),
    // At most one 'human' Worker row is linked to a given account — the same
    // field ensureSelfWorker()/updateProfile() key off of — and object_id is
    // null for it; a future object-scoped human Worker (see the partial
    // unique index's own comment) must not be picked up here instead.
    supabase.from('workers').select('role').eq('user_id', userId).eq('type', 'human').is('object_id', null).limit(1).maybeSingle(),
  ]);
  if (memberErr) throw memberErr;
  if (workerErr) throw workerErr;
  const domainIds = (memberRows ?? []).map((r) => r.domain_id as string);
  if (domainIds.length === 0) return { ...EMPTY_MEMBERSHIPS, role: workerRow?.role ?? null };

  const { data: dRows, error: domainsErr } = await supabase
    .from('domains')
    .select('id, name, color, activity_space_id')
    .in('id', domainIds);
  if (domainsErr) throw domainsErr;
  const domainRows = (dRows ?? []) as MyDomainRow[];

  const spaceIds = [...new Set(domainRows.map((d) => d.activity_space_id).filter((id): id is string => !!id))];
  let spaceMap = new Map<string, string>();
  if (spaceIds.length > 0) {
    const { data: sRows, error: spacesErr } = await supabase.from('activity_spaces').select('id, name').in('id', spaceIds);
    if (spacesErr) throw spacesErr;
    spaceMap = new Map((sRows ?? []).map((s) => [s.id as string, s.name as string]));
  }

  return {
    domains: [...domainRows].sort((a, b) => a.name.localeCompare(b.name)),
    spaceNames: spaceMap,
    role: workerRow?.role ?? null,
  };
}

function useMyDomainMemberships(userId: string | undefined) {
  const query = useQuery({
    queryKey: ['my-domain-memberships', userId],
    queryFn: () => fetchMyDomainMemberships(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
  const data = query.data ?? EMPTY_MEMBERSHIPS;
  return { ...data, loading: !!userId && query.isPending, error: (query.error as Error | null) ?? null };
}

// A Domain whose activity_space_id resolved to nothing is a Guest
// membership (invited to that one Domain, not the Space it lives in) —
// activity_spaces has its own RLS check the domain_members/domains reads
// don't need. That is a real, expected state, not missing data, so it gets
// its own label instead of collapsing into the same "Unassigned" bucket a
// Domain with no Space at all would.
const GUEST_GROUP_PREFIX = 'guest:';

function DomainMembershipsSection() {
  const { user } = useAuthContext();
  const { t } = useI18n();
  const { domains, spaceNames, role, loading, error } = useMyDomainMemberships(user?.id);

  const grouped = useMemo(() => {
    const map = new Map<string, MyDomainRow[]>();
    for (const d of domains) {
      const key = !d.activity_space_id
        ? ''
        : spaceNames.has(d.activity_space_id)
          ? d.activity_space_id
          : `${GUEST_GROUP_PREFIX}${d.activity_space_id}`;
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) =>
      (spaceNames.get(a) ?? '￿').localeCompare(spaceNames.get(b) ?? '￿'),
    );
  }, [domains, spaceNames]);

  return (
    <SettingsIsland title={t('Domains')} description={t('Domains you’re a member of, grouped by Space.')}>
      <div className="px-5 py-2">
        {loading ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('Loading…')}</div>
        ) : error ? (
          <div className="py-3 text-[13px] text-destructive">
            {t('Couldn’t load your Domains — {error}', { error: error.message })}
          </div>
        ) : domains.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">
            {t('You’re not a member of any Domain yet.')}
          </div>
        ) : (
          grouped.map(([spaceId, list]) => (
            <div key={spaceId || 'unassigned'} className="py-3">
              <div className="text-[12px] font-medium text-muted-foreground/80 mb-1.5">
                {spaceId.startsWith(GUEST_GROUP_PREFIX) ? t('Guest access') : spaceNames.get(spaceId) ?? t('Unassigned')}
              </div>
              <div className="space-y-1.5">
                {list.map((d) => (
                  <div key={d.id} className="flex items-center gap-2">
                    <DomainGlyph color={d.color} />
                    <span className="text-[13px] text-foreground truncate">{d.name}</span>
                    {role && (
                      <span className="text-[11px] text-muted-foreground ml-auto shrink-0 truncate">{role}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </SettingsIsland>
  );
}

// ── Invitations ──────────────────────────────────────────────────────────
// Spaces, Domains and Objects someone invited you to. You become a member
// only when you accept (ADR 0029); the same invitation is in your Inbox.
function InvitationsSection() {
  const { t } = useI18n();
  return (
    <SettingsIsland title={t('Invitations')} description={t('You join a Space, Domain or Object only when you accept its invitation.')}>
      <MyInvitations emptyText={t('No pending invitations.')} />
    </SettingsIsland>
  );
}

export function ProfileSettings() {
  const { user, profile, updateProfile } = useAuthContext();
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload picked image to the public `avatars` bucket under <uid>/<ts>.<ext>
  // and auto-persist to profile + worker rows immediately — an avatar has no
  // separate draft state, unlike display_name below. Save button remains
  // for display_name only.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t('Image must be smaller than 5MB'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      // Cache-bust so the new image shows immediately even if the path-by-
      // timestamp wasn't unique (e.g. double-click).
      const url = `${pub.publicUrl}?t=${Date.now()}`;
      setAvatarUrl(url);
      await updateProfile({ avatar_url: url });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Upload failed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;
    setUploading(true);
    setError(null);
    try {
      setAvatarUrl('');
      await updateProfile({ avatar_url: null });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to remove avatar'));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setAvatarUrl(profile?.avatar_url ?? '');
    setBio(profile?.bio ?? '');
  }, [profile?.display_name, profile?.avatar_url, profile?.bio]);

  const dirty =
    displayName !== (profile?.display_name ?? '') ||
    avatarUrl !== (profile?.avatar_url ?? '') ||
    bio !== (profile?.bio ?? '');

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        display_name: displayName.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        bio: bio.trim() || null,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const initials = initialsFor(displayName || profile?.display_name, user?.email ?? '');

  return (
    <div className="space-y-10">
      <SettingsIsland title={t('Profile')} description={t('How your name and avatar appear across Alcon.')}>
        <div className="px-5 py-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title={t('Click to upload a new photo')}
            aria-label={t('Click to upload a new photo')}
            className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-foreground/70 font-semibold text-[16px] overflow-hidden ring-1 ring-border/70 hover:ring-foreground/40 transition-shadow disabled:opacity-60 shrink-0"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-foreground truncate">
              {displayName || profile?.display_name || user?.email?.split('@')[0] || t('You')}
            </div>
            <div className="text-[12px] text-muted-foreground truncate">{user?.email}</div>
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? t('Uploading…') : t('Upload photo')}
              </Button>
              {avatarUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={handleRemoveAvatar} disabled={uploading}>
                  {t('Remove')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <SettingRow label={t('Display name')} desc={t('Used in @-mentions, comments, and assignments.')}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('Your name')}
            aria-label={t('Display name')}
            className="w-56 px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/40 transition-colors"
          />
        </SettingRow>
        <SettingField label={t('Bio')} hint={t('A short introduction shown on your Profile page.')}>
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t('What you work on, what you care about…')}
            rows={3}
            maxLength={280}
          />
        </SettingField>
        <div className="flex items-center justify-end gap-3 px-5 py-3.5">
          {error && <span className="text-[12px] text-[var(--status-danger)]">{error}</span>}
          {savedAt && !dirty && !error && (
            <span className="text-[12px] text-muted-foreground">{t('Saved.')}</span>
          )}
          <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? t('Saving…') : t('Save changes')}
          </Button>
        </div>
      </SettingsIsland>

      <InvitationsSection />

      <DomainMembershipsSection />
    </div>
  );
}
