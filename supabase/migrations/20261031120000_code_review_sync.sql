-- Code review, round two: the guided walk-through of a pull request, and the
-- reviews and line comments written in Alcon carried back to GitHub.
--
--   code_changes.guide                  the AI's walk-through: the change split
--                                       into a few meaningful sections, each with
--                                       what it changes and why, and its files —
--                                       against one head commit
--   code_change_reviews.github_*        the review posted to the pull request, or
--   code_change_comments.github_*       why it could not be
--
-- Only the code-changes Edge Function (service role) writes these columns;
-- clients keep the grants they had.
-- Guarded for preview replay: the base schema may be absent.
do $$
begin
  if to_regclass('public.code_changes') is null
     or to_regclass('public.code_change_reviews') is null
     or to_regclass('public.code_change_comments') is null then
    raise notice 'code review sync skipped: code_changes tables not present';
    return;
  end if;

  execute $ddl$
    alter table public.code_changes
      add column if not exists guide jsonb check (guide is null or jsonb_typeof(guide) = 'object')
  $ddl$;
  execute $ddl$
    alter table public.code_change_reviews
      add column if not exists github_review_id bigint,
      add column if not exists github_error text check (char_length(github_error) <= 500)
  $ddl$;
  execute $ddl$
    alter table public.code_change_comments
      add column if not exists github_comment_id bigint,
      add column if not exists github_error text check (char_length(github_error) <= 500)
  $ddl$;
end
$$;
