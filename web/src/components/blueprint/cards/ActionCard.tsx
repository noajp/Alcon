'use client';

import { useEffect, useRef, useState } from 'react';
import { Flag, Calendar, Circle, X, Plus } from 'lucide-react';
import type { ActionCardData, Priority, Assignee } from '../types';

// ============================================
// Priority styling
// ============================================
const PRIORITY_ORDER: Priority[] = ['low', 'medium', 'high', 'urgent'];

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string; label: string }> = {
  urgent: { bg: 'bg-red-50',    text: 'text-red-600',    label: 'Urgent' },
  high:   { bg: 'bg-orange-50', text: 'text-orange-600', label: 'High' },
  medium: { bg: 'bg-amber-50',  text: 'text-amber-700',  label: 'Medium' },
  low:    { bg: 'bg-sky-50',    text: 'text-sky-700',    label: 'Low' },
};

// ============================================
// Demo assignee rotation (placeholder until we wire Workers)
// ============================================
const DEMO_ASSIGNEES: Assignee[] = [
  { id: 'u1', name: 'Noa',    kind: 'human' },
  { id: 'ai', name: 'Claude', kind: 'ai_agent' },
  { id: 'rb', name: 'R2D2',   kind: 'robot' },
];

// ============================================
// Utilities
// ============================================
function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const h12 = hours % 12 || 12;
  return `${day} ${month} at ${h12}:${minutes}${ampm}`;
}

function toDatetimeLocal(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
}

// ============================================
// ActionCard (editable)
// ============================================
interface ActionCardProps {
  card: ActionCardData;
  isSelected?: boolean;
  isDragging?: boolean;
  onMouseDown?: (e: React.MouseEvent) => void;
  onUpdate?: (patch: Partial<ActionCardData>) => void;
}

export function ActionCard({ card, isSelected, isDragging, onMouseDown, onUpdate }: ActionCardProps) {
  const [editing, setEditing] = useState<'title' | 'description' | 'date' | 'progress' | null>(null);
  const [newTag, setNewTag] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const patch = (p: Partial<ActionCardData>) => onUpdate?.(p);

  const stopDrag = (e: React.MouseEvent | React.FocusEvent) => e.stopPropagation();

  // Priority cycle (low → medium → high → urgent → low)
  const cyclePriority = () => {
    const current = card.priority ?? 'low';
    const idx = PRIORITY_ORDER.indexOf(current);
    patch({ priority: PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length] });
  };

  // Assignee cycle through demo list
  const cycleAssignee = () => {
    const idx = card.assignee ? DEMO_ASSIGNEES.findIndex((a) => a.id === card.assignee!.id) : -1;
    patch({ assignee: DEMO_ASSIGNEES[(idx + 1) % DEMO_ASSIGNEES.length] });
  };

  const missing = {
    priority: card.priority === undefined,
    dueDate: !card.dueDate,
    tags: !card.tags || card.tags.length === 0,
    assignee: !card.assignee,
    progress: card.progress === undefined,
  };
  const hasMissing = Object.values(missing).some(Boolean);

  const tags = card.tags ?? [];

  return (
    <div
      className={`
        relative w-[280px] rounded-2xl bg-white border border-border/60
        transition-all duration-150 select-none
        ${isSelected
          ? 'shadow-[0_6px_20px_rgba(0,0,0,0.08)]'
          : 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]'}
        ${isDragging ? 'opacity-95' : ''}
      `}
      onMouseDown={onMouseDown}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {/* ====== Top row: Priority + Due date ====== */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2 gap-2">
        {/* Priority */}
        {card.priority !== undefined ? (
          <div
            className="group/priority relative inline-flex items-center"
            onMouseDown={stopDrag}
          >
            <button
              type="button"
              onClick={cyclePriority}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${PRIORITY_STYLES[card.priority].bg} ${PRIORITY_STYLES[card.priority].text} hover:brightness-95`}
              title="クリックで優先度切替"
            >
              <Flag size={10} className="fill-current" strokeWidth={2.5} />
              <span>{PRIORITY_STYLES[card.priority].label}</span>
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); patch({ priority: undefined }); }}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover/priority:opacity-100 transition-opacity shadow-sm"
              title="削除"
            >
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <div />
        )}

        {/* Due date */}
        <div className="flex items-center gap-2">
          {editing === 'date' ? (
            <input
              autoFocus
              type="datetime-local"
              value={toDatetimeLocal(card.dueDate)}
              onMouseDown={stopDrag}
              onChange={(e) => patch({ dueDate: e.target.value || undefined })}
              onBlur={() => setEditing(null)}
              className="text-[11px] no-focus-ring bg-transparent border-0"
            />
          ) : card.dueDate ? (
            <div className="group/date relative inline-flex items-center" onMouseDown={stopDrag}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditing('date'); }}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Calendar size={11} strokeWidth={2} />
                <span>{formatDate(card.dueDate)}</span>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); patch({ dueDate: undefined }); }}
                className="ml-1 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover/date:opacity-100 transition-opacity shadow-sm"
                title="削除"
              >
                <X size={9} strokeWidth={2.5} />
              </button>
            </div>
          ) : null}

          {/* + menu for missing metadata */}
          {hasMissing && (
            <div className="relative" onMouseDown={stopDrag}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowAddMenu((v) => !v); }}
                className="w-5 h-5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center transition-colors"
                title="メタデータ追加"
              >
                <Plus size={11} strokeWidth={2.5} />
              </button>
              {showAddMenu && (
                <div
                  className="absolute right-0 top-6 z-20 min-w-[140px] bg-popover border border-border rounded-lg shadow-lg py-1"
                  onMouseDown={stopDrag}
                >
                  {missing.priority && (
                    <MenuItem label="Priority" icon={<Flag size={12} />} onClick={() => { patch({ priority: 'medium' }); setShowAddMenu(false); }} />
                  )}
                  {missing.dueDate && (
                    <MenuItem label="Due date" icon={<Calendar size={12} />} onClick={() => { patch({ dueDate: new Date().toISOString() }); setEditing('date'); setShowAddMenu(false); }} />
                  )}
                  {missing.tags && (
                    <MenuItem label="Tag" icon={<span className="text-[11px]">#</span>} onClick={() => { patch({ tags: [] }); setNewTag(''); setShowAddMenu(false); }} />
                  )}
                  {missing.assignee && (
                    <MenuItem label="Assignee" icon={<span className="w-3 h-3 rounded-full bg-foreground/40" />} onClick={() => { patch({ assignee: DEMO_ASSIGNEES[0] }); setShowAddMenu(false); }} />
                  )}
                  {missing.progress && (
                    <MenuItem label="Progress" icon={<Circle size={11} />} onClick={() => { patch({ progress: 0 }); setShowAddMenu(false); }} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ====== Title ====== */}
      <div className="px-4" onMouseDown={stopDrag}>
        {editing === 'title' ? (
          <input
            autoFocus
            value={card.title}
            onChange={(e) => patch({ title: e.target.value })}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(null); }}
            className="w-full text-[15px] font-semibold text-foreground leading-tight mb-1.5 no-focus-ring bg-transparent border-0"
          />
        ) : (
          <h3
            onClick={(e) => { e.stopPropagation(); setEditing('title'); }}
            className="text-[15px] font-semibold text-foreground leading-tight mb-1.5 cursor-text hover:bg-muted/30 rounded -mx-1 px-1 py-0.5"
          >
            {card.title || <span className="text-muted-foreground/50 font-normal">タイトルを書く…</span>}
          </h3>
        )}
      </div>

      {/* ====== Description ====== */}
      <div className="px-4 pb-3" onMouseDown={stopDrag}>
        {editing === 'description' ? (
          <AutoTextarea
            value={card.description}
            onChange={(v) => patch({ description: v })}
            onBlur={() => setEditing(null)}
            autoFocus
          />
        ) : (
          <p
            onClick={(e) => { e.stopPropagation(); setEditing('description'); }}
            className="text-[13px] text-muted-foreground leading-relaxed cursor-text hover:bg-muted/30 rounded -mx-1 px-1 py-0.5 whitespace-pre-wrap min-h-[1.5em]"
          >
            {card.description || <span className="text-muted-foreground/40">説明を書く…</span>}
          </p>
        )}
      </div>

      {/* ====== Tags ====== */}
      {(tags.length > 0 || newTag !== null) && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5" onMouseDown={stopDrag}>
          {tags.map((tag, i) => (
            <TagChip
              key={`${tag}-${i}`}
              tag={tag}
              onChange={(v) => {
                const next = [...tags];
                next[i] = v;
                patch({ tags: next });
              }}
              onRemove={() => patch({ tags: tags.filter((_, idx) => idx !== i) })}
            />
          ))}
          {newTag !== null && (
            <input
              autoFocus
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onBlur={() => {
                if (newTag.trim()) patch({ tags: [...tags, newTag.trim()] });
                setNewTag(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (newTag.trim()) patch({ tags: [...tags, newTag.trim()] });
                  setNewTag('');
                }
                if (e.key === 'Escape') setNewTag(null);
              }}
              placeholder="tag"
              className="w-16 text-[11px] no-focus-ring bg-muted/40 rounded-md px-2 py-0.5 border-0"
            />
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setNewTag(''); }}
            className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-dashed border-border/60 text-[11px] text-muted-foreground/60 hover:text-foreground hover:border-foreground/40 transition-colors"
            title="タグ追加"
          >
            <Plus size={10} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* ====== Dashed divider ====== */}
      {(card.assignee || card.progress !== undefined) && (
        <div className="mx-4 border-t border-dashed border-border/80" />
      )}

      {/* ====== Footer: Assignee + Progress ====== */}
      {(card.assignee || card.progress !== undefined) && (
        <div className="flex items-center justify-between px-4 py-3" onMouseDown={stopDrag}>
          {/* Assignee */}
          {card.assignee ? (
            <div className="group/assignee relative inline-flex items-center">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); cycleAssignee(); }}
                className="flex items-center gap-2 hover:bg-muted/30 rounded px-1 py-0.5 -mx-1"
                title="クリックで担当者切替"
              >
                <Avatar assignee={card.assignee} />
                <span className="text-[12px] font-medium text-foreground/80">
                  {card.assignee.name}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); patch({ assignee: undefined }); }}
                className="ml-1 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover/assignee:opacity-100 transition-opacity shadow-sm"
                title="削除"
              >
                <X size={9} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <div />
          )}

          {/* Progress */}
          {card.progress !== undefined && (
            <div className="group/progress relative inline-flex items-center">
              {editing === 'progress' ? (
                <input
                  autoFocus
                  type="number"
                  min={0}
                  max={100}
                  value={card.progress}
                  onMouseDown={stopDrag}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!isNaN(v)) patch({ progress: Math.min(100, Math.max(0, v)) });
                  }}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(null); }}
                  className="w-12 text-[11px] text-right no-focus-ring bg-transparent border-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setEditing('progress'); }}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Circle size={11} strokeWidth={2} />
                  <span className="tabular-nums">{card.progress}%</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); patch({ progress: undefined }); }}
                className="ml-1 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-sm"
                title="削除"
              >
                <X size={9} strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Sub-components
// ============================================
function Avatar({ assignee }: { assignee: Assignee }) {
  if (assignee.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={assignee.avatarUrl} alt={assignee.name} className="w-5 h-5 rounded-full object-cover" />;
  }
  const bg =
    assignee.kind === 'ai_agent'
      ? 'bg-gradient-to-br from-purple-500 to-indigo-600'
      : assignee.kind === 'robot'
        ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
        : 'bg-gradient-to-br from-neutral-700 to-neutral-900';
  return (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold text-white ${bg}`}>
      {initials(assignee.name)}
    </div>
  );
}

function TagChip({
  tag,
  onChange,
  onRemove,
}: {
  tag: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        value={tag}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(false); }}
        className="w-20 text-[11px] no-focus-ring bg-muted/40 rounded-md px-2 py-0.5 border-0"
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="group/tag inline-flex items-center pl-2 pr-1 py-0.5 rounded-md border border-border/60 text-[11px] text-muted-foreground/90 cursor-pointer hover:border-foreground/40"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      <span className="opacity-60 mr-0.5">#</span>
      <span>{tag}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="ml-1 w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-0 group-hover/tag:opacity-100 text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
      >
        <X size={9} strokeWidth={2.5} />
      </button>
    </span>
  );
}

function MenuItem({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-foreground hover:bg-accent transition-colors"
    >
      <span className="w-3 h-3 flex items-center justify-center text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ============================================
// Auto-resizing textarea
// ============================================
function AutoTextarea({
  value,
  onChange,
  onBlur,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onMouseDown={(e) => e.stopPropagation()}
      rows={1}
      className="w-full text-[13px] text-foreground leading-relaxed no-focus-ring bg-transparent border-0 resize-none"
    />
  );
}
