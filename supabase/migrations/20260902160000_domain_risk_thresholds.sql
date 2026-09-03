-- Per-Domain risk thresholds for the Campaign cross-section (Settings >
-- Elements > SLAs, el_QLT-028). campaignRiskModel.ts judged every Domain by
-- the same constants — stalled after 25 minutes of silence, idle after 24
-- hours, due soon within 3 days. "Too quiet" is not the same number for a
-- ward that turns work over in hours and a quarterly plan that turns it over
-- in weeks, so each Domain can now say so.
--
-- Shape: {"due_soon_days": n, "stall_minutes": n, "idle_hours": n} — every
-- key optional, absent = the model's default. Same pattern as label_colors.
-- Guarded with to_regclass for preview/shadow-DB replay.
do $$
begin
  if to_regclass('public.domains') is null then
    raise notice 'risk_thresholds migration skipped: domains not present';
    return;
  end if;
  execute 'alter table public.domains add column if not exists risk_thresholds jsonb not null default ''{}''::jsonb';
end
$$;
