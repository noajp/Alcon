-- ============================================================
-- Chat feature: direct (1:1) and group conversations
--
-- Kept separate from the Room/channels infrastructure so the
-- existing message RLS (scoped to rooms.created_by) is untouched.
-- Person-to-person messaging, membership-scoped RLS, not tied to
-- a Domain. Supports reactions and file attachments.
-- ============================================================

-- ---- Tables ----
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('direct','group')),
  title text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);

CREATE TABLE public.dm_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE TABLE public.dm_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  name text NOT NULL,
  mime text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_members_user ON public.conversation_members(user_id);
CREATE INDEX idx_direct_messages_conversation ON public.direct_messages(conversation_id, created_at);
CREATE INDEX idx_dm_reactions_message ON public.dm_reactions(message_id);
CREATE INDEX idx_dm_attachments_message ON public.dm_attachments(message_id);

-- ---- Membership helper (SECURITY DEFINER avoids RLS recursion on
--      conversation_members referencing itself) ----
CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = p_conversation_id AND m.user_id = p_user_id
  );
$$;

-- ---- RLS ----
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select ON public.conversations
  FOR SELECT USING (public.is_conversation_member(id, auth.uid()));
CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY conversations_update ON public.conversations
  FOR UPDATE USING (public.is_conversation_member(id, auth.uid()))
  WITH CHECK (public.is_conversation_member(id, auth.uid()));
CREATE POLICY conversations_delete ON public.conversations
  FOR DELETE USING (created_by = auth.uid());

CREATE POLICY conversation_members_select ON public.conversation_members
  FOR SELECT USING (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY conversation_members_insert ON public.conversation_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.created_by = auth.uid())
    OR public.is_conversation_member(conversation_id, auth.uid())
  );
CREATE POLICY conversation_members_update ON public.conversation_members
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY conversation_members_delete ON public.conversation_members
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY direct_messages_select ON public.direct_messages
  FOR SELECT USING (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY direct_messages_insert ON public.direct_messages
  FOR INSERT WITH CHECK (
    author_id = auth.uid() AND public.is_conversation_member(conversation_id, auth.uid())
  );
CREATE POLICY direct_messages_update ON public.direct_messages
  FOR UPDATE USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY direct_messages_delete ON public.direct_messages
  FOR DELETE USING (author_id = auth.uid());

CREATE POLICY dm_reactions_select ON public.dm_reactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.direct_messages dm
            WHERE dm.id = message_id AND public.is_conversation_member(dm.conversation_id, auth.uid()))
  );
CREATE POLICY dm_reactions_insert ON public.dm_reactions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.direct_messages dm
                WHERE dm.id = message_id AND public.is_conversation_member(dm.conversation_id, auth.uid()))
  );
CREATE POLICY dm_reactions_delete ON public.dm_reactions
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY dm_attachments_select ON public.dm_attachments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.direct_messages dm
            WHERE dm.id = message_id AND public.is_conversation_member(dm.conversation_id, auth.uid()))
  );
CREATE POLICY dm_attachments_insert ON public.dm_attachments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.direct_messages dm
            WHERE dm.id = message_id AND dm.author_id = auth.uid())
  );
CREATE POLICY dm_attachments_delete ON public.dm_attachments
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.direct_messages dm
            WHERE dm.id = message_id AND dm.author_id = auth.uid())
  );

-- ---- last_message_at trigger ----
CREATE OR REPLACE FUNCTION public.bump_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_conversation_last_message
AFTER INSERT ON public.direct_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_last_message();

-- ---- find_or_create_direct_conversation RPC (atomic 1:1 dedup) ----
CREATE OR REPLACE FUNCTION public.find_or_create_direct_conversation(p_other_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_conv uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_other_user IS NULL OR p_other_user = v_me THEN
    RAISE EXCEPTION 'Invalid conversation partner';
  END IF;

  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.kind = 'direct'
    AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = v_me)
    AND EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = c.id AND m.user_id = p_other_user)
    AND (SELECT count(*) FROM public.conversation_members m WHERE m.conversation_id = c.id) = 2
  LIMIT 1;

  IF v_conv IS NOT NULL THEN
    RETURN v_conv;
  END IF;

  INSERT INTO public.conversations (kind, created_by)
  VALUES ('direct', v_me)
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (v_conv, v_me), (v_conv, p_other_user);

  RETURN v_conv;
END;
$$;

-- ---- create_group_conversation RPC ----
-- Atomic + RLS-safe: a client-side INSERT ... RETURNING on conversations
-- would be blocked by the SELECT policy (the creator is not a member yet
-- at the moment the row is returned).
CREATE OR REPLACE FUNCTION public.create_group_conversation(p_title text, p_member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_conv uuid;
  v_member uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.conversations (kind, title, created_by)
  VALUES ('group', NULLIF(btrim(coalesce(p_title, '')), ''), v_me)
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (v_conv, v_me);

  IF p_member_ids IS NOT NULL THEN
    FOREACH v_member IN ARRAY p_member_ids LOOP
      IF v_member IS NOT NULL AND v_member <> v_me THEN
        INSERT INTO public.conversation_members (conversation_id, user_id)
        VALUES (v_conv, v_member)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_conv;
END;
$$;

-- ---- get_my_conversations RPC ----
-- One round-trip for the chat list: each conversation enriched with its
-- last-message preview, unread count, and member profiles.
CREATE OR REPLACE FUNCTION public.get_my_conversations()
RETURNS TABLE (
  id uuid,
  kind text,
  title text,
  created_by uuid,
  created_at timestamptz,
  last_message_at timestamptz,
  last_message_body text,
  last_message_author uuid,
  unread_count bigint,
  members jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH my_convs AS (
    SELECT cm.conversation_id, cm.last_read_at
    FROM public.conversation_members cm
    WHERE cm.user_id = auth.uid()
  )
  SELECT
    c.id, c.kind, c.title, c.created_by, c.created_at, c.last_message_at,
    lm.body, lm.author_id, COALESCE(uc.cnt, 0), COALESCE(mem.members, '[]'::jsonb)
  FROM public.conversations c
  JOIN my_convs mc ON mc.conversation_id = c.id
  LEFT JOIN LATERAL (
    SELECT dm.body, dm.author_id
    FROM public.direct_messages dm
    WHERE dm.conversation_id = c.id
    ORDER BY dm.created_at DESC
    LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM public.direct_messages dm
    WHERE dm.conversation_id = c.id
      AND dm.created_at > mc.last_read_at
      AND dm.author_id IS DISTINCT FROM auth.uid()
  ) uc ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', cm.user_id,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url
    )) AS members
    FROM public.conversation_members cm
    LEFT JOIN public.profiles p ON p.id = cm.user_id
    WHERE cm.conversation_id = c.id
  ) mem ON true
  ORDER BY c.last_message_at DESC;
$$;

-- ---- grants — signed-in users only; the trigger fn is never an endpoint ----
REVOKE EXECUTE ON FUNCTION public.bump_conversation_last_message() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_or_create_direct_conversation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_conversations() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_direct_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_conversations() TO authenticated;

-- ---- realtime — REPLICA IDENTITY FULL so DELETE payloads carry the
--      columns needed to route reaction / attachment removals ----
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;
ALTER TABLE public.dm_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.dm_attachments REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_members REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_attachments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
