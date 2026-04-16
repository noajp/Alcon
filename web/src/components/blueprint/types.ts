// Card types for the BluePrint board.
// Cards crystallize through kinds: thought → card → action → node

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type Assignee = {
  id: string;
  name: string;
  avatarUrl?: string;
  kind?: 'human' | 'ai_agent' | 'robot';
};

export type BaseCard = {
  id: string;
  x: number;
  y: number;
};

export type ThoughtCardData = BaseCard & {
  kind: 'thought';
  text: string;
};

export type TaggedCardData = BaseCard & {
  kind: 'card';
  text: string;
  tags: string[];
  color?: 'default' | 'yellow' | 'orange' | 'blue' | 'green';
};

export type ActionCardData = BaseCard & {
  kind: 'action';
  title: string;
  description: string;
  // Metadata below is all optional — can be added or removed freely.
  priority?: Priority;
  dueDate?: string;            // ISO string
  tags?: string[];
  assignee?: Assignee;
  progress?: number;           // 0..100
};

export type NodeCardData = BaseCard & {
  kind: 'node';
  nodeType: 'trigger' | 'http' | 'conditional' | 'ai' | 'action';
  title: string;
  config?: Record<string, unknown>;
  lastRunAt?: string;
  nextRunAt?: string;
  durationMs?: number;
};

export type Card = ThoughtCardData | TaggedCardData | ActionCardData | NodeCardData;
