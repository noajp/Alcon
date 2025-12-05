'use client';

import { useState } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const sampleMessages: Message[] = [
  {
    id: '1',
    role: 'user',
    content: 'Analyze this task and suggest how to break it down',
  },
  {
    id: '2',
    role: 'assistant',
    content: 'I analyzed the "API Design" task. Based on similar tasks in your history, I recommend breaking it into 3 subtasks:\n\n1. **Endpoint definition** (3h)\n   - Define CRUD operations\n   - Document URL patterns\n\n2. **Schema design** (3h)\n   - Request/response formats\n   - Validation rules\n\n3. **Auth method decision** (2h)\n   - JWT vs OAuth comparison\n   - Implementation plan\n\nWould you like me to create these subtasks?',
  },
];

interface AIPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function AIPanel({ isOpen, onToggle }: AIPanelProps) {
  const [messages, setMessages] = useState<Message[]>(sampleMessages);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages([...messages, newMessage]);
    setInput('');

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I understand. Let me analyze that for you...',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiResponse]);
    }, 1000);
  };

  if (!isOpen) return null;

  return (
    <div className="w-[350px] h-full bg-[var(--bg-secondary)] border-l border-[var(--border-color)] flex flex-col">
      {/* Header */}
      <div className="h-9 flex items-center justify-between px-4 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <span>&#129302;</span>
          <span className="text-sm font-medium">Alcon AI</span>
          <span className="w-2 h-2 rounded-full bg-green-500" />
        </div>
        <button
          onClick={onToggle}
          className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          &times;
        </button>
      </div>

      {/* Context */}
      <div className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]">
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Context</div>
        <div className="flex flex-wrap gap-1">
          <span className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] text-[var(--text-secondary)]">
            &#128203; API Design
          </span>
          <span className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] text-[var(--text-secondary)]">
            &#128194; Website Redesign
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg p-3 ${
                message.role === 'user'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              }`}
            >
              <div className="text-sm whitespace-pre-wrap">{message.content}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="px-4 py-2 border-t border-[var(--border-color)]">
        <div className="flex flex-wrap gap-1">
          {['Analyze task', 'Suggest estimate', 'Find similar'].map((action) => (
            <button
              key={action}
              className="px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              onClick={() => setInput(action)}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[var(--border-color)]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask Alcon AI..."
            className="flex-1 px-3 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded focus:outline-none focus:border-[var(--accent-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />
          <button
            onClick={handleSend}
            className="px-3 py-2 bg-[var(--accent-primary)] text-white rounded hover:bg-[var(--accent-secondary)]"
          >
            &#10148;
          </button>
        </div>
      </div>
    </div>
  );
}
