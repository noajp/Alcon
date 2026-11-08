import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Memory arrives in one migration (20261129090000): the two-layer
// store with its structural guarantees — one active durable per topic
// (partial unique indexes), an episode distilled twice from the same
// work (the fingerprint index), the trigram search index (Japanese
// text is never tsvector's), provenance and supersede columns, RLS
// that keeps a personal memory its person's alone, the invoker
// search RPC (RLS is the scope), and the capture toggles defaulting
// on. These tests pin that shape.
const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = read('20261129090000_memories.sql');

describe('memory migration', () => {
  it('is guarded for preview replay', () => {
    expect(migration).toContain("to_regclass('public.activity_spaces') is not null");
    expect(migration).toContain("to_regclass('public.agent_runs') is not null");
    expect(migration).toContain("to_regclass('public.profiles') is not null");
    expect(migration).toContain('raise notice');
  });

  it('creates the two-layer store with provenance and a supersede chain', () => {
    expect(migration).toContain('create table if not exists public.memories');
    expect(migration).toContain("check (layer in ('episode', 'durable'))");
    expect(migration).toContain("check (kind in ('event', 'procedure', 'fact'))");
    expect(migration).toContain("check (status in ('active', 'superseded', 'archived', 'expired'))");
    expect(migration).toContain("check (scope in ('space', 'personal'))");
    expect(migration).toContain('supersedes_id uuid references public.memories(id) on delete set null');
    expect(migration).toContain('source_run_id uuid');
    expect(migration).toContain('source_session_id uuid');
    expect(migration).toContain("check (origin in ('athena', 'person'))");
    // A target may vanish while its memory stays.
    expect(migration).toContain('references public.elements(id) on delete set null');
  });

  it('makes one fact one memory, structurally', () => {
    expect(migration).toContain('memories_one_active_durable_space');
    expect(migration).toContain("where layer = ''durable'' and status = ''active'' and scope = ''space'' and topic_key is not null");
    expect(migration).toContain('memories_one_active_durable_personal');
    expect(migration).toContain('memories_episode_fingerprint');
  });

  it('searches Japanese text by trigram over a generated derivative', () => {
    expect(migration).toContain("search_text text generated always as (title || ' ' || gist || ' ' || body) stored");
    expect(migration).toContain('create extension if not exists pg_trgm with schema extensions');
    expect(migration).toContain('memories_search_trgm');
    expect(migration).toContain('extensions.gin_trgm_ops');
    expect(migration).not.toContain('to_tsvector');
  });

  it('records uses once per run, and reads them where the memory reads', () => {
    expect(migration).toContain('create table if not exists public.memory_uses');
    expect(migration).toContain('memory_uses_once_per_run');
    expect(migration).toContain('create policy memory_uses_select');
  });

  it('keeps a personal memory its person’s alone, and a Space’s with its members', () => {
    expect(migration).toContain('create policy memories_select');
    expect(migration).toContain("(scope = 'personal' and user_id = (select auth.uid()))");
    expect(migration).toContain('public.is_activity_space_member(activity_space_id)');
    // App writes are a person's own acts; Athena's are the service role's.
    expect(migration).toContain('create policy memories_insert');
    expect(migration).toContain("origin = 'person' and created_by = (select auth.uid())");
    // Correction belongs to the owner, the memory's own writer, or the person.
    expect(migration).toContain('create policy memories_update');
    expect(migration).toContain('create policy memories_delete');
    expect(migration).toContain('public.is_activity_space_owner(activity_space_id)');
  });

  it('searches through an invoker RPC: RLS is the scope, similarity the rank', () => {
    expect(migration).toContain('create or replace function public.search_memories(');
    expect(migration).toContain('security invoker');
    expect(migration).toContain('extensions.similarity(m.search_text');
    expect(migration).toContain("grant execute on function public.search_memories(text, uuid, uuid, integer) to authenticated");
  });

  it('lands the capture toggles on, for Spaces and for people', () => {
    expect(migration).toContain("alter table public.activity_spaces add column if not exists memory_auto_capture boolean not null default true");
    expect(migration).toContain("alter table public.profiles add column if not exists memory_auto_capture boolean not null default true");
  });
});
