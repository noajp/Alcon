'use client';

import { useState } from 'react';
import { Bot, Check, ChevronDown, Copy, SquareArrowOutUpRight, SquareTerminal } from 'lucide-react';
import { Button } from '@/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { openInApp } from '@/Function/shared/appNavigation';
import { claudeCodePrompt, claudeCodeUrl, type ClaudeCodeSubject } from '@/Function/shared/claudeCodeLink';
import { NavNoteIcon, NavSlidesIcon } from '@/shell/sidebar/NavIcons';
import { requestNewDeck } from '@/ActivitySpace/sustainment/slides/newDeckRequest';
import { DelegateToAiForm } from '@/ActivitySpace/execution/element/agent';
import type { AgentStartOutcome, Worker } from '@/hooks/useSupabase';

/** The in-app agent, when the page can hand its work to one (an Element). */
export interface OpenInAgent {
  aiWorkers: Worker[];
  defaultWorkerId: string | null;
  /** A run is already going. */
  busy: boolean;
  starting: boolean;
  error: string | null;
  onStart: (opts: { workerId: string | null; prompt: string }) => Promise<AgentStartOutcome>;
}

/**
 * "Open in" — the tools an Element or an Object can be taken to, at the top
 * right of its page, as Linear offers its coding tools:
 *   Claude Code   a new session in the Claude desktop app, primed with what to
 *                 work on (or the same prompt, copied)
 *   Claude        the in-app agent works it here (Elements)
 *   Notebook      its Note — linked to it, made empty first if there is none
 *   Slides        a new, empty deck named after it
 */
export function OpenInMenu({ subject, noteId, onCreateNote, agent }: {
  subject: ClaudeCodeSubject;
  /** The Note already linked, opened as is. */
  noteId: string | null;
  /** Makes an empty Note, links it, and returns its id. */
  onCreateNote: () => Promise<string>;
  agent?: OpenInAgent;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const prompt = () => claudeCodePrompt(subject);

  const openNote = async () => {
    try { openInApp('note', { noteId: noteId ?? await onCreateNote() }); }
    catch (e) { await appDialog.alert(e instanceof Error ? e.message : t('Could not create the Note')); }
  };
  const openDeck = () => {
    requestNewDeck(subject.title);
    openInApp('slides');
  };

  return (
    <Popover open={agentOpen} onOpenChange={setAgentOpen}>
      <DropdownMenu onOpenChange={(o) => { if (o) setCopied(false); }}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <SquareArrowOutUpRight size={13} />{t('Open in')}<ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Claude</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => { window.location.href = claudeCodeUrl(prompt()); }} className="text-[13px]">
            <SquareTerminal size={14} />{t('Claude Code')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); void navigator.clipboard.writeText(prompt()).then(() => setCopied(true)); }}
            className="text-[13px]">
            {copied ? <Check size={14} /> : <Copy size={14} />}{t(copied ? 'Copied' : 'Copy prompt for Claude Code')}
          </DropdownMenuItem>
          {agent && (
            <DropdownMenuItem disabled={agent.busy} onSelect={() => setTimeout(() => setAgentOpen(true), 0)} className="text-[13px]">
              <Bot size={14} />{t('Run with Claude here')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void openNote()} className="text-[13px]">
            <NavNoteIcon size={14} />{t(noteId ? 'Open its Note' : 'New Note')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openDeck} className="text-[13px]">
            <NavSlidesIcon size={14} />{t('New deck in Slides')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {agent && (
        <PopoverContent align="end" className="w-[380px] p-3">
          <DelegateToAiForm aiWorkers={agent.aiWorkers} defaultWorkerId={agent.defaultWorkerId}
            starting={agent.starting} error={agent.error} onStart={agent.onStart} onStarted={() => setAgentOpen(false)} />
        </PopoverContent>
      )}
    </Popover>
  );
}
