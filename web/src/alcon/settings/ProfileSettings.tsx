'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';
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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload picked image to the public `avatars` bucket under <uid>/<ts>.<ext>
  // and auto-persist to profile + worker rows. Save button remains for
  // display_name + manual URL edits.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be smaller than 5MB');
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
      setError(err instanceof Error ? err.message : 'Upload failed');
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
      setError(err instanceof Error ? err.message : 'Failed to remove avatar');
    } finally {
      setUploading(false);
    }
  };

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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Click to upload a new photo"
            className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-foreground/70 font-semibold text-[16px] overflow-hidden ring-1 ring-border/70 hover:ring-foreground/40 transition-shadow disabled:opacity-60 shrink-0"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
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
              {displayName || profile?.display_name || user?.email?.split('@')[0] || 'You'}
            </div>
            <div className="text-[12px] text-muted-foreground truncate">{user?.email}</div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-2.5 py-1 bg-muted hover:bg-accent rounded text-[12px] text-foreground disabled:opacity-50 transition-colors"
              >
                {uploading ? 'Uploading…' : 'Upload photo'}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={uploading}
                  className="px-2.5 py-1 hover:bg-muted rounded text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
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
