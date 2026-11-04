-- Where a sign-in returns: the origin of the app that started it (production,
-- a preview, or localhost in development), checked against the allowed ones
-- by integration-oauth (returnOrigin in _shared/googleOAuth.ts). Null returns
-- to APP_ORIGIN. Guarded for preview replay.

do $$
begin
  if to_regclass('public.integration_oauth_states') is null then
    raise notice 'oauth return origin skipped: integration_oauth_states not present'; return;
  end if;
  execute 'alter table public.integration_oauth_states add column if not exists return_origin text';
end $$;
