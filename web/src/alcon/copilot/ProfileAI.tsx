'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Sparkles, Square } from 'lucide-react';
import { Button } from '@/ui/button';
import { useAlconCopilot } from './useAlconCopilot';

export function ProfileAI({ activeDomainId }: { activeDomainId?: string | null }) {
  const { messages, streaming, error, send, cancel, reset } = useAlconCopilot();
  const [input, setInput] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages]);
  useEffect(() => cancel, [cancel]);
  const submit = () => {
    if (!input.trim() || streaming) return;
    void send(input, { context: { domainId: activeDomainId ?? undefined, viewLabel: 'Profile' } });
    setInput('');
  };
  return (
    <section aria-label="AI conversation" className="flex flex-1 min-w-0 min-h-0 flex-col px-6 pb-4">
      <div className="flex justify-end"><Button size="xs" variant="ghost" onClick={reset} disabled={!messages.length}>New conversation</Button></div>
      <div ref={list} className="flex-1 min-h-0 overflow-y-auto py-4 space-y-4" aria-live="polite">
        {!messages.length && <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground"><Sparkles size={24} /><p className="text-sm">Ask about your Elements or plan your next step.</p></div>}
        {messages.map((message, index) => <article key={index} className={`text-sm ${message.role === 'user' ? 'ml-auto max-w-xl rounded-md bg-muted p-3' : 'max-w-3xl'}`}>
          <p className="text-xs text-muted-foreground mb-1">{message.role === 'user' ? 'You' : 'AI'}</p>
          {message.toolEvents?.map((event, i) => <p key={i} className="text-xs text-muted-foreground">{event.name}{event.result ? event.result.ok ? ' · Complete' : ' · Failed' : '…'}</p>)}
          <p className="whitespace-pre-wrap break-words">{message.content || (streaming && index === messages.length - 1 ? 'Thinking…' : '')}</p>
        </article>)}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <form onSubmit={event => { event.preventDefault(); submit(); }} className="flex items-end gap-2 rounded-lg bg-muted p-3">
        <textarea aria-label="Message AI" placeholder="Ask Alcon…" value={input} onChange={event => setInput(event.target.value)} rows={2} className="flex-1 min-w-0 resize-none bg-transparent text-sm focus:bg-[var(--surface-raised)]" onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        }} />
        {streaming ? <Button type="button" size="icon-sm" aria-label="Stop response" onClick={cancel}><Square size={16} /></Button> : <Button type="submit" size="icon-sm" aria-label="Send message" disabled={!input.trim()}><ArrowUp size={16} /></Button>}
      </form>
    </section>
  );
}
