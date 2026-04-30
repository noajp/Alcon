'use client';

import { useEffect, useState } from 'react';
import type { Brief } from './types';
import { BlockEditor } from '@/alcon/brief/editor/BlockEditor';
import { CommentsPanel } from './CommentsPanel';
import { useBriefComments } from '@/hooks/useNotesDb';

interface BriefViewDialogProps {
  brief: Brief;
  onClose: () => void;
  onOpenSource?: () => void;
  onDelete?: () => void;
  onObjectize?: () => void;
}

export function BriefViewDialog({ brief, onClose, onOpenSource, onDelete, onObjectize }: BriefViewDialogProps) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const { comments, loading: commentsLoading, addComment, deleteComment } = useBriefComments(brief.id);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const s = brief.structured;
  const hasStructured =
    !!s &&
    (s.overview ||
      s.decisions.length ||
      s.action_items.length ||
      s.questions.length ||
      s.participants.length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-4xl max-h-[88vh] bg-card border border-border rounded-2xl shadow-2xl flex overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0 flex flex-col">
        {/* Close (top-right) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="absolute right-3 top-3 w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent z-10"
        >
          <CloseIcon />
        </button>

        <div className="px-5 pt-5 pb-3 pr-14 border-b border-border flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Brief
          </span>
          <div className="text-[11px] text-muted-foreground shrink-0">
            <button
              type="button"
              onClick={onOpenSource}
              className="text-foreground/80 hover:text-foreground underline-offset-2 hover:underline"
            >
              {brief.sourceFileName}
            </button>
            <span className="opacity-40 mx-2">·</span>
            <span>{formatAbsolute(brief.createdAt)}</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-8 pt-6 pb-8">
          <h2 className="text-[22px] font-semibold text-foreground tracking-[-0.4px] leading-[1.2]">
            {brief.title}
          </h2>

          {hasStructured ? (
            <>
              {s!.overview && (
                <p className="mt-3 text-[13px] leading-[1.7] text-foreground/80 whitespace-pre-wrap">
                  {s!.overview}
                </p>
              )}

              {s!.decisions.length > 0 && (
                <Section label="Key Decisions">
                  <ul className="space-y-2">
                    {s!.decisions.map((d, i) => (
                      <BulletItem key={i} title={d.title} detail={d.detail} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.action_items.length > 0 && (
                <Section label="Action Items">
                  <ul className="space-y-1.5">
                    {s!.action_items.map((a, i) => (
                      <ActionItem key={i} title={a.title} owner={a.owner} due={a.due} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.questions.length > 0 && (
                <Section label="Open Questions">
                  <ul className="space-y-1.5">
                    {s!.questions.map((q, i) => (
                      <QuestionItem key={i} title={q.title} detail={q.detail} />
                    ))}
                  </ul>
                </Section>
              )}

              {s!.participants.length > 0 && (
                <Section label="Participants">
                  <ul className="flex flex-wrap gap-1.5">
                    {s!.participants.map((p, i) => (
                      <ParticipantChip key={i} name={p.name} role={p.role} />
                    ))}
                  </ul>
                </Section>
              )}
            </>
          ) : (
            <p className="mt-3 text-[13px] leading-[1.7] text-foreground/80 whitespace-pre-wrap">
              {brief.summary || <span className="text-muted-foreground/60">No summary</span>}
            </p>
          )}

          {brief.sourceSnapshot && (
            <section className="mt-8 pt-5 border-t border-border/60">
              <button
                type="button"
                onClick={() => setSourceOpen((v) => !v)}
                className="w-full flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 hover:text-foreground"
              >
                <span
                  className={[
                    'w-3 h-3 flex items-center justify-center transition-transform duration-100',
                    sourceOpen ? 'rotate-90' : '',
                  ].join(' ')}
                >
                  <ChevronIcon />
                </span>
                Source Note (at commit time)
              </button>
              {sourceOpen && (
                <div className="mt-3 px-3 py-3 border border-border/50 rounded-lg bg-background/40">
                  <BlockEditor
                    initialContent={brief.sourceSnapshot}
                    editable={false}
                    hideToolbar
                  />
                </div>
              )}
            </section>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="text-[12px] px-2 py-1.5 text-muted-foreground hover:text-destructive"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          {onObjectize && (
            <button
              type="button"
              onClick={onObjectize}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 bg-foreground text-background rounded-md"
              title="この Brief から Object を起草"
            >
              <ObjectIcon size={14} />
              Object化する
            </button>
          )}
        </div>
        </div>
        <CommentsPanel
          comments={comments}
          loading={commentsLoading}
          onSubmit={async (content) => { await addComment(content); }}
          onDelete={deleteComment}
        />
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 pt-5 border-t border-border/60">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 mb-2.5">
        {label}
      </div>
      {children}
    </section>
  );
}

function BulletItem({ title, detail }: { title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[7px] w-[5px] h-[5px] shrink-0 rounded-full bg-foreground/50" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
    </li>
  );
}

function ActionItem({
  title,
  owner,
  due,
}: {
  title: string;
  owner?: string;
  due?: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[3px] w-[14px] h-[14px] shrink-0 border border-foreground/40" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-foreground/90 leading-[1.55] break-words">{title}</div>
        {(owner || due) && (
          <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-2">
            {owner && <span>@{owner}</span>}
            {due && <span>⏰ {due}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function QuestionItem({ title, detail }: { title: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="text-[13px] leading-[1.55] text-foreground/50 shrink-0">?</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] italic text-foreground/85 leading-[1.55] break-words">
          {title}
        </div>
        {detail && (
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-[1.55] break-words">
            {detail}
          </div>
        )}
      </div>
    </li>
  );
}

function ParticipantChip({ name, role }: { name: string; role?: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 text-[12px] bg-accent/60 px-2 py-1">
      <span className="text-foreground/90">{name}</span>
      {role && <span className="text-muted-foreground/80">· {role}</span>}
    </li>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ObjectIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
