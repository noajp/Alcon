'use client';

import { useEffect, useRef, useState } from 'react';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { ArrowUp, Square } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useAlconCopilot } from './useAlconCopilot';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function ProfileAI({ activeDomainId }: { activeDomainId?: string | null }) {
  const { t } = useI18n();
  const { messages, streaming, error, send, cancel, detach, reset } = useAlconCopilot();
  const [input, setInput] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages]);
  // Leaving the screen stops following the turn, not the turn itself:
  // it finishes on its run and lands in the kept conversation.
  useEffect(() => detach, [detach]);
  const submit = () => {
    if (!input.trim() || streaming) return;
    void send(input, { context: { domainId: activeDomainId ?? undefined, viewLabel: 'Profile' } });
    setInput('');
  };
  return (
    <section aria-label={t('AI conversation')} className="flex flex-1 min-w-0 min-h-0 flex-col px-6 pb-4">
      <div className="flex justify-end"><Button size="xs" variant="ghost" onClick={reset} disabled={!messages.length}>{t('New conversation')}</Button></div>
      <div ref={list} className="flex-1 min-h-0 overflow-y-auto py-4 space-y-4" aria-live="polite">
        {!messages.length && <div className="flex h-full items-center justify-center"><p className="text-[13px] text-muted-foreground">{t('Ask about your Elements or plan your next step.')}</p></div>}
        {messages.map((message, index) => <article key={index} className={`text-sm ${message.role === 'user' ? 'ml-auto max-w-xl rounded-md bg-muted p-3' : 'max-w-3xl'}`}>
          <p className="text-xs text-muted-foreground mb-1">{message.role === 'user' ? t('You') : t('AI')}</p>
          {message.toolEvents?.map((event, i) => <p key={i} className="text-xs text-muted-foreground">{event.result ? t(event.result.ok ? '{name} · Complete' : '{name} · Failed', { name: event.name }) : `${event.name}…`}</p>)}
          {message.role === 'assistant' && message.content
            ? <MarkdownLite text={message.content} className="break-words" />
            : <p className="whitespace-pre-wrap break-words">{message.content || (streaming && index === messages.length - 1 ? t('Thinking…') : '')}</p>}
        </article>)}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <form onSubmit={event => { event.preventDefault(); submit(); }} className="flex items-end gap-2 rounded-lg bg-muted p-3">
        <textarea aria-label={t('Message AI')} placeholder={t('Ask Alcon…')} value={input} onChange={event => setInput(event.target.value)} rows={2} className="flex-1 min-w-0 resize-none bg-transparent text-sm focus:bg-[var(--surface-raised)]" onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        }} />
        {streaming ? <Button type="button" size="icon-sm" aria-label={t('Stop')} onClick={cancel}><Square size={16} /></Button> : <Button type="submit" size="icon-sm" aria-label={t('Send message')} disabled={!input.trim()}><ArrowUp size={16} /></Button>}
      </form>
    </section>
  );
}
