'use client';

import { useState, useEffect } from 'react';
import { Pencil, Check } from 'lucide-react';
import { updateObject } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/types/database';

interface Props {
  object?: AlconObjectWithChildren;
  onRefresh?: () => void;
}

export function ProjectBriefWidget({ object, onRefresh }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(object?.description || '');
  }, [object?.description, object?.id]);

  if (!object) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        Select an Object to see its brief
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateObject(object.id, { description: draft });
      onRefresh?.();
      setEditing(false);
    } catch (err) {
      console.error('Failed to save description:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight">{object.name}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wider font-medium">
            Project Brief
          </p>
        </div>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-[12px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted/40 transition-colors"
          >
            <Pencil size={12} />
            Edit
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[12px] font-medium text-background bg-foreground hover:bg-foreground/90 inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors disabled:opacity-50"
          >
            <Check size={12} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          autoFocus
          className="w-full text-[13px] text-foreground bg-muted/30 border border-border/60 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-foreground/10"
          placeholder="What is this project about? Describe the goal, scope, and any important context for the team..."
        />
      ) : (
        <div className="text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap min-h-[40px]">
          {object.description || (
            <span className="text-muted-foreground italic">
              No description yet. Click Edit to add a brief about this project.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
