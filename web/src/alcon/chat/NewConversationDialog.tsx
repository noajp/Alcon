'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Users, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { initialOf } from './chatUtils';

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateDirect: (otherUserId: string) => Promise<void>;
  onCreateGroup: (title: string, memberIds: string[]) => Promise<void>;
}

// Dialog to start a conversation: pick one person (direct) or several
// people + an optional name (group). The partner directory is every
// profile other than the current user.
export function NewConversationDialog({
  open,
  onOpenChange,
  onCreateDirect,
  onCreateGroup,
}: NewConversationDialogProps) {
  const { user } = useAuthContext();
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setTab('direct');
      setQuery('');
      setSelected(new Set());
      setTitle('');
      setError(null);
      setLoadingProfiles(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .order('display_name', { nullsFirst: false });
      setProfiles(((data ?? []) as ProfileRow[]).filter((p) => p.id !== user?.id));
      setLoadingProfiles(false);
    })();
  }, [open, user?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => (p.display_name ?? '').toLowerCase().includes(q));
  }, [profiles, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (tab === 'direct') {
        next.clear();
        if (!prev.has(id)) next.add(id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const canSubmit =
    !submitting && (tab === 'direct' ? selected.size === 1 : selected.size >= 1);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (tab === 'direct') {
        await onCreateDirect(Array.from(selected)[0]);
      } else {
        await onCreateGroup(title, Array.from(selected));
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start conversation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-1 p-0.5 rounded-lg bg-muted/50">
            {([
              ['direct', 'Direct', MessageSquare],
              ['group', 'Group', Users],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setSelected(new Set());
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[12px] font-medium transition-colors ${
                  tab === id
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          {tab === 'group' && (
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Group name (optional)"
              maxLength={64}
            />
          )}

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
          />

          <div className="h-56 overflow-y-auto -mx-1 px-1">
            {loadingProfiles && (
              <div className="py-8 text-center text-[12px] text-muted-foreground">Loading…</div>
            )}
            {!loadingProfiles && filtered.length === 0 && (
              <div className="py-8 text-center text-[12px] text-muted-foreground">
                {profiles.length === 0 ? '他のユーザーがいません' : '見つかりませんでした'}
              </div>
            )}
            {filtered.map((p) => {
              const isSel = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`w-full flex items-center gap-2.5 h-11 px-2 rounded-md transition-colors ${
                    isSel ? 'bg-accent' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-foreground/70 overflow-hidden flex-shrink-0">
                    {p.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      initialOf(p.display_name)
                    )}
                  </span>
                  <span className="flex-1 text-left text-[13px] text-foreground truncate">
                    {p.display_name ?? 'Unknown'}
                  </span>
                  {isSel && <Check size={15} className="text-foreground flex-shrink-0" />}
                </button>
              );
            })}
          </div>

          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {tab === 'direct' ? 'Start chat' : 'Create group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
