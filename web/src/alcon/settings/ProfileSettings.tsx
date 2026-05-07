'use client';

import { useEffect, useState } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';
import { SettingsSection, SettingsField } from './SettingsSection';

function initialsFor(name: string | null | undefined, fallback: string): string {
  const source = (name && name.trim()) || fallback;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export function ProfileSettings() {
  const { user, profile, updateProfile } = useAuthContext();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setAvatarUrl(profile?.avatar_url ?? '');
  }, [profile?.display_name, profile?.avatar_url]);

  const dirty =
    displayName !== (profile?.display_name ?? '') ||
    avatarUrl !== (profile?.avatar_url ?? '');

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        display_name: displayName.trim() || null,
        avatar_url: avatarUrl.trim() || null,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const initials = initialsFor(displayName || profile?.display_name, user?.email ?? '');

  return (
    <div>
      <SettingsSection title="Profile" description="How your name and avatar appear across Alcon.">
        <div className="px-4 py-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-foreground/70 font-semibold text-[16px] overflow-hidden">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-foreground truncate">
              {displayName || profile?.display_name || user?.email?.split('@')[0] || 'You'}
            </div>
            <div className="text-[12px] text-muted-foreground truncate">{user?.email}</div>
          </div>
        </div>

        <SettingsField label="Display name" hint="Used in @-mentions, comments, and assignments.">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
          />
        </SettingsField>

        <SettingsField label="Avatar URL" hint="A square image works best. Leave empty to use initials.">
          <input
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
            className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
          />
        </SettingsField>
      </SettingsSection>

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-[12px] text-red-500">{error}</span>}
        {savedAt && !dirty && !error && (
          <span className="text-[12px] text-muted-foreground">Saved.</span>
        )}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-4 py-2 bg-foreground text-background rounded-md text-[13px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
