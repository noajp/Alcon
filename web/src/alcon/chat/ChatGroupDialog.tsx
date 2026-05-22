'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, LogOut, UserPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { supabase } from '@/lib/supabase';
import type { ConversationListItem } from '@/types/database';
import { initialOf } from './chatUtils';

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface ChatGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationListItem;
  myId: string | null;
  onRename: (title: string) => Promise<void>;
  onAddMembers: (memberIds: string[]) => Promise<void>;
  onLeave: () => Promise<void>;
}

// Group conversation settings: rename, add people, leave.
export function ChatGroupDialog({
  open,
  onOpenChange,
  conversation,
  myId,
  onRename,
  onAddMembers,
  onLeave,
}: ChatGroupDialogProps) {
  const [title, setTitle] = useState(conversation.title ?? '');
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberIds = useMemo(
    () => new Set(conversation.members.map((m) => m.user_id)),
    [conversation.members]
  );

  useEffect(() => {
    if (!open) return;
    (async () => {
      setTitle(conversation.title ?? '');
      setToAdd(new Set());
      setError(null);
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .order('display_name', { nullsFirst: false });
      setProfiles((data ?? []) as ProfileRow[]);
    })();
  }, [open, conversation.title]);

  const candidates = useMemo(
    () => profiles.filter((p) => !memberIds.has(p.id)),
    [profiles, memberIds]
  );

  const titleChanged = title.trim() !== (conversation.title ?? '').trim();

  const run = async (fn: () => Promise<void>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (close) onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Group settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-foreground">Group name</label>
            <div className="flex gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Group name"
                maxLength={64}
              />
              <Button
                type="button"
                size="sm"
                disabled={!titleChanged || busy}
                onClick={() => run(() => onRename(title))}
              >
                Save
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-foreground">
              Members ({conversation.members.length})
            </label>
            <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
              {conversation.members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2 h-9 px-1.5">
                  <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-foreground/70 overflow-hidden flex-shrink-0">
                    {m.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      initialOf(m.display_name)
                    )}
                  </span>
                  <span className="text-[12px] text-foreground truncate">
                    {m.display_name ?? 'Unknown'}
                    {m.user_id === myId && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {candidates.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-foreground">Add people</label>
              <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                {candidates.map((p) => {
                  const sel = toAdd.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setToAdd((prev) => {
                          const n = new Set(prev);
                          if (n.has(p.id)) n.delete(p.id);
                          else n.add(p.id);
                          return n;
                        })
                      }
                      className={`flex items-center gap-2 h-9 px-1.5 rounded-md transition-colors ${
                        sel ? 'bg-accent' : 'hover:bg-muted/50'
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-foreground/70 overflow-hidden flex-shrink-0">
                        {p.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          initialOf(p.display_name)
                        )}
                      </span>
                      <span className="flex-1 text-left text-[12px] text-foreground truncate">
                        {p.display_name ?? 'Unknown'}
                      </span>
                      {sel && <Check size={14} className="text-foreground flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={toAdd.size === 0 || busy}
                onClick={() =>
                  run(async () => {
                    await onAddMembers(Array.from(toAdd));
                    setToAdd(new Set());
                  })
                }
              >
                <UserPlus size={13} />
                Add{toAdd.size > 0 ? ` (${toAdd.size})` : ''}
              </Button>
            </div>
          )}

          {error && <div className="text-[11px] text-destructive">{error}</div>}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => run(onLeave, true)}
              className="text-destructive hover:text-destructive"
            >
              <LogOut size={13} />
              Leave group
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
