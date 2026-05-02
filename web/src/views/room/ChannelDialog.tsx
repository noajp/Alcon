'use client';

import React, { useEffect, useState } from 'react';
import { Hash, Volume2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import type { Channel, ChannelKind } from '@/types/database';

interface CreateInput {
  mode: 'create';
  kind: ChannelKind;
}
interface EditInput {
  mode: 'edit';
  channel: Channel;
}
type Mode = CreateInput | EditInput;

interface ChannelDialogProps {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate?: (input: { kind: ChannelKind; name: string; topic?: string }) => Promise<void>;
  onUpdate?: (id: string, patch: { name: string; topic: string | null }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function ChannelDialog({ mode, open, onOpenChange, onCreate, onUpdate, onDelete }: ChannelDialogProps) {
  const isEdit = mode.mode === 'edit';
  const kind: ChannelKind = isEdit ? mode.channel.kind : mode.kind;
  const KindIcon = kind === 'text' ? Hash : Volume2;

  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setName(mode.channel.name);
      setTopic(mode.channel.topic ?? '');
    } else {
      setName('');
      setTopic('');
    }
    setConfirmingDelete(false);
  }, [open, isEdit, mode]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (isEdit) {
        await onUpdate?.(mode.channel.id, { name: trimmedName, topic: topic.trim() || null });
      } else {
        await onCreate?.({ kind, name: trimmedName, topic: topic.trim() || undefined });
      }
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save channel:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    setSubmitting(true);
    try {
      await onDelete?.(mode.channel.id);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to delete channel:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KindIcon size={16} className="text-muted-foreground" />
            {isEdit ? `Edit ${kind} channel` : `Create ${kind} channel`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-foreground">Channel name</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === 'text' ? 'general' : 'Voice'}
              maxLength={64}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-foreground">Topic (optional)</label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What is this channel about?"
              maxLength={200}
            />
          </div>

          <DialogFooter className="flex sm:justify-between gap-2">
            {isEdit ? (
              confirmingDelete ? (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDelete(false)} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={submitting}>
                    Confirm delete
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)} disabled={submitting} className="text-destructive hover:text-destructive">
                  <Trash2 size={14} />
                  Delete
                </Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!canSubmit}>
                {isEdit ? 'Save' : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
