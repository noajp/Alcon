-- A CRM pipeline's figure reaches its Initiative's success condition from the
-- database, not from whoever has the CRM open (ELE_OBJ2-006).
--
-- The figure was written by the browser of the person viewing the CRM, and
-- only when that person could edit the Initiative. A deal won by someone else
-- left the success condition stale until its owner happened to open the CRM.
-- Now the database recomputes it whenever something it depends on changes:
--
--   crm_deals      any insert / update / delete (once per statement, per pipeline)
--   crm_pipelines  the binding (intent, metric, field), currency, stages or Domain
--   crm_fields     a number field a pipeline adds up appearing, changing or going
--   intents        the success condition's unit (money / count / scale)
--   daily          00:05 UTC, so "this quarter / this year" roll over unattended
--
-- The rules are the ones in web/src/Function/crm/crmModel.ts — metricValue,
-- measureValue, readUnit, normalizeCrmStages, resolveStage — restated in SQL
-- and checked against the same cases as web/tests/crmModel.test.ts. When a
-- rule changes there, it changes here too. Two deliberate differences:
--   * every deal of the pipeline counts, not only those the viewer can see;
--   * "today" is current_date (UTC), as closed_on's own default is.
-- A unit that does not match the metric (money vs count, another currency, a
-- rate, a unit Alcon cannot read) writes nothing; CRM settings says why.
--
-- The write goes through intents like any other reading, labelled 'crm'
-- (alcon.reading_source), so the reading history and the measure_missed
-- notification see it. An unchanged figure writes nothing, and 0 is not
-- written into a condition that has no reading yet.
--
-- Guarded for preview replay: intents and alcon_internal are created outside
-- this folder.
do $migration$
begin
  if to_regclass('public.crm_pipelines') is null or to_regclass('public.crm_deals') is null
     or to_regclass('public.crm_fields') is null or to_regclass('public.intents') is null
     or to_regnamespace('alcon_internal') is null then
    raise notice 'crm measure server refresh skipped: base tables or alcon_internal not present';
    return;
  end if;

  -- stageKey: trimmed, lower case.
  execute $f$
    create or replace function alcon_internal.crm_stage_key(p_value text)
    returns text language plpgsql immutable set search_path = '' as $b$
    begin
      return lower(regexp_replace(coalesce(p_value, ''), '^\s+|\s+$', '', 'g'));
    end $b$
  $f$;

  -- normalizeCrmStages: the stored stages, malformed ones dropped, defaults
  -- when nothing usable is left.
  execute $f$
    create or replace function alcon_internal.crm_normalize_stages(p_raw jsonb)
    returns jsonb language plpgsql immutable set search_path = '' as $b$
    declare
      v_item jsonb;
      v_key text;
      v_label text;
      v_probability numeric;
      v_seen text[] := array['won', 'lost'];
      v_out jsonb := '[]'::jsonb;
    begin
      if jsonb_typeof(p_raw) = 'array' then
        for v_item in select value from jsonb_array_elements(p_raw) loop
          if jsonb_typeof(v_item) is distinct from 'object' then continue; end if;
          v_key := case when jsonb_typeof(v_item -> 'id') = 'string' then alcon_internal.crm_stage_key(v_item ->> 'id') else '' end;
          if v_key = '' or v_key = any(v_seen) or char_length(v_key) > 40 then continue; end if;
          v_seen := v_seen || v_key;
          v_label := case when jsonb_typeof(v_item -> 'label') = 'string'
                          then left(regexp_replace(v_item ->> 'label', '^\s+|\s+$', '', 'g'), 40) else '' end;
          if v_label = '' then v_label := v_key; end if;
          v_probability := case when jsonb_typeof(v_item -> 'probability') = 'number'
                                then least(100, greatest(0, floor((v_item ->> 'probability')::numeric + 0.5))) else 50 end;
          v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_key, 'label', v_label, 'probability', v_probability));
          exit when jsonb_array_length(v_out) >= 12;
        end loop;
      end if;
      if jsonb_array_length(v_out) = 0 then
        v_out := '[{"id":"lead","label":"Lead","probability":10},{"id":"qualified","label":"Qualified","probability":25},{"id":"proposal","label":"Proposal","probability":50},{"id":"negotiation","label":"Negotiation","probability":75}]'::jsonb;
      end if;
      return v_out;
    end $b$
  $f$;

  -- resolveStage's probability for an open deal's stage key: the first stage
  -- whose id or label matches, else 50.
  execute $f$
    create or replace function alcon_internal.crm_stage_probability(p_stages jsonb, p_key text)
    returns numeric language plpgsql immutable set search_path = '' as $b$
    declare
      v_stage jsonb;
    begin
      for v_stage in select value from jsonb_array_elements(p_stages) loop
        if v_stage ->> 'id' = p_key or alcon_internal.crm_stage_key(v_stage ->> 'label') = p_key then
          return (v_stage ->> 'probability')::numeric;
        end if;
      end loop;
      return 50;
    end $b$
  $f$;

  -- readUnit: money (currency, scale), count, rate, unknown, or any (empty).
  -- The ISO list is Intl.supportedValuesOf('currency') as Node reports it.
  execute $f$
    create or replace function alcon_internal.crm_read_unit(p_unit text, out kind text, out currency text, out scale numeric)
    language plpgsql immutable set search_path = '' as $b$
    declare
      v text := regexp_replace(normalize(coalesce(p_unit, ''), nfkc), '^\s+|\s+$', '', 'g');
      v_rest text;
      v_prefix text;
      v_factor numeric;
      v_money boolean;
      v_scaled boolean;
    begin
      scale := 1;
      if v = '' then kind := 'any'; return; end if;
      if v ~* '[%‰/]|毎|per([^A-Za-z0-9_]|$)|率' then kind := 'rate'; return; end if;
      v_rest := v;
      foreach v_prefix in array array['百万', '千', '万', '億'] loop
        if starts_with(v_rest, v_prefix) and char_length(v_rest) > char_length(v_prefix) then
          v_factor := case v_prefix when '百万' then 1e6 when '千' then 1e3 when '万' then 1e4 else 1e8 end;
          scale := v_factor;
          v_rest := substr(v_rest, char_length(v_prefix) + 1);
          exit;
        end if;
      end loop;
      currency := case
        when v_rest ~ '^(円|¥|JPY)$' or upper(v_rest) ~ '^(円|¥|JPY)$' then 'JPY'
        when v_rest ~ '^(\$|US\$|ドル|USD)$' or upper(v_rest) ~ '^(\$|US\$|ドル|USD)$' then 'USD'
        when v_rest ~ '^(€|ユーロ|EUR)$' or upper(v_rest) ~ '^(€|ユーロ|EUR)$' then 'EUR'
        when v_rest ~ '^(£|ポンド|GBP)$' or upper(v_rest) ~ '^(£|ポンド|GBP)$' then 'GBP'
        when v_rest ~ '^(元|CNY|RMB)$' or upper(v_rest) ~ '^(元|CNY|RMB)$' then 'CNY'
        when v_rest ~ '^(₩|ウォン|KRW)$' or upper(v_rest) ~ '^(₩|ウォン|KRW)$' then 'KRW'
      end;
      if currency is not null then kind := 'money'; return; end if;
      -- ISO codes only as written in capitals: "cup" is a word, "CUP" a currency.
      if v_rest ~ '^[A-Z]{3}$' and v_rest = any(array[
        'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL',
        'BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUC','CUP','CVE','CZK','DJF','DKK','DOP','DZD',
        'EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR',
        'ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR',
        'LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO',
        'NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG',
        'SEK','SGD','SHP','SLE','SLL','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD',
        'TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XCG','XDR','XOF','XPF','XSU','YER','ZAR','ZMW',
        'ZWG','ZWL']) then
        kind := 'money'; currency := v_rest; return;
      end if;
      v_money := v ~* '円|¥|\$|€|£|₩|ドル|ユーロ|ポンド|ウォン|元|yen|dollar|euro|pound'
                 or v ~ '(^|[^A-Za-z0-9_])[A-Z]{3}([^A-Za-z0-9_]|$)';
      v_scaled := v ~* '[十百千万億兆]|[0-9]|^[kmb]$';
      kind := case when v_money or v_scaled or scale <> 1 then 'unknown' else 'count' end;
    end $b$
  $f$;

  -- measureValue: the value written into the success condition, or null when
  -- the metric and the unit do not match.
  execute $f$
    create or replace function alcon_internal.crm_measure_value(p_unit text, p_metric text, p_currency text, p_value numeric)
    returns numeric language plpgsql immutable set search_path = '' as $b$
    declare
      r record;
    begin
      select * into r from alcon_internal.crm_read_unit(p_unit);
      if r.kind = 'any' then return p_value; end if;
      if p_metric like 'won\_count%' then return case when r.kind = 'count' then p_value end; end if;
      if p_metric like 'won\_field%' and r.kind = 'count' then return p_value; end if;
      if r.kind <> 'money' or r.currency <> upper(p_currency) then return null; end if;
      return trim_scale(floor(p_value / r.scale * 100 + 0.5) / 100);
    end $b$
  $f$;

  -- A deal's number field as a number: written numbers, or numeric text such
  -- as "1,200"; anything else is 0.
  execute $f$
    create or replace function alcon_internal.crm_field_number(p_custom jsonb, p_field text)
    returns numeric language plpgsql immutable set search_path = '' as $b$
    declare
      v_raw jsonb := case when p_field is null then null else p_custom -> p_field end;
      v_text text;
    begin
      if v_raw is null then return 0; end if;
      if jsonb_typeof(v_raw) = 'number' then return (v_raw #>> '{}')::numeric; end if;
      if jsonb_typeof(v_raw) <> 'string' then return 0; end if;
      v_text := v_raw #>> '{}';
      if regexp_replace(v_text, '^\s+|\s+$', '', 'g') = '' then return 0; end if;
      v_text := regexp_replace(v_text, '[,\s]', '', 'g');
      if v_text = '' then return 0; end if;
      if v_text ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then return v_text::numeric; end if;
      return 0;
    end $b$
  $f$;

  -- metricValue: the figure a pipeline reports, over every deal it holds.
  execute $f$
    create or replace function alcon_internal.crm_metric_value(p_pipeline uuid, p_today date, p_unit text)
    returns numeric language plpgsql stable set search_path = '' as $b$
    declare
      p record;
      v_stages jsonb;
      v_year int := extract(year from p_today)::int;
      v_quarter int := (extract(month from p_today)::int - 1) / 3;
      v_money_field boolean := (select kind from alcon_internal.crm_read_unit(p_unit)) = 'money';
      v_result numeric;
    begin
      select * into p from public.crm_pipelines where id = p_pipeline;
      if not found or p.measure_metric is null then return null; end if;
      v_stages := alcon_internal.crm_normalize_stages(p.stages);
      with d as (
        select x.*,
               case x.key when 'won' then 'won' when 'lost' then 'lost' else 'open' end as outcome,
               coalesce(x.closed_on, x.close_date) as closed
        from (select dl.*, alcon_internal.crm_stage_key(dl.stage) as key
              from public.crm_deals dl where dl.pipeline_id = p_pipeline) x
      ), m as (
        select d.*,
               d.currency = p.currency and d.amount is not null as scoped,
               d.closed is not null and extract(year from d.closed)::int = v_year as in_year,
               d.closed is not null and extract(year from d.closed)::int = v_year
                 and (extract(month from d.closed)::int - 1) / 3 = v_quarter as in_quarter,
               case when d.outcome = 'open' and d.amount is not null
                    then d.amount * coalesce(d.probability::numeric, alcon_internal.crm_stage_probability(v_stages, d.key)) / 100 end as weighted,
               alcon_internal.crm_field_number(d.custom, p.measure_field) as field_value,
               d.outcome = 'won' and (not v_money_field or d.currency = p.currency) as won_field
        from d
      )
      select case p.measure_metric
          when 'won_count_total' then count(*) filter (where outcome = 'won')
          when 'won_count_year' then count(*) filter (where outcome = 'won' and in_year)
          when 'won_count_quarter' then count(*) filter (where outcome = 'won' and in_quarter)
          when 'won_field_total' then coalesce(sum(field_value) filter (where won_field), 0)
          when 'won_field_year' then coalesce(sum(field_value) filter (where won_field and in_year), 0)
          when 'won_field_quarter' then coalesce(sum(field_value) filter (where won_field and in_quarter), 0)
          when 'won_total' then coalesce(sum(amount) filter (where scoped and outcome = 'won'), 0)
          when 'won_year' then coalesce(sum(amount) filter (where scoped and outcome = 'won' and in_year), 0)
          when 'won_quarter' then coalesce(sum(amount) filter (where scoped and outcome = 'won' and in_quarter), 0)
          when 'weighted' then coalesce(sum(coalesce(weighted, 0)) filter (where scoped and outcome = 'open'), 0)
          when 'open' then coalesce(sum(amount) filter (where scoped and outcome = 'open'), 0)
        end
        into v_result
      from m;
      -- Sums are kept to two decimals, as metricValue does; counts are whole.
      return trim_scale(floor(v_result * 100 + 0.5) / 100);
    end $b$
  $f$;

  -- Recomputes one pipeline's figure and writes it into its success condition
  -- when it is writable and has changed. Runs as the owner: whoever moved the
  -- deal, the figure is the pipeline's, not theirs.
  execute $f$
    create or replace function alcon_internal.crm_refresh_measure(p_pipeline uuid)
    returns void language plpgsql security definer set search_path = '' as $b$
    declare
      p record;
      i record;
      v_value numeric;
      v_written numeric;
      v_previous_source text;
    begin
      select * into p from public.crm_pipelines where id = p_pipeline;
      if not found or p.measure_intent_id is null or p.measure_metric is null then return; end if;
      select id, unit, actual_value into i from public.intents where id = p.measure_intent_id and kind = 'measure';
      if not found then return; end if;
      -- A field metric reports only while its field is one of this pipeline's number fields.
      if p.measure_metric like 'won\_field%' and not exists (
        select 1 from public.crm_fields f
        where f.activity_space_id = p.activity_space_id and f.entity = 'deal' and f.type = 'number'
          and f.key = p.measure_field and (f.domain_id is null or f.domain_id = p.domain_id)
      ) then return; end if;
      v_value := alcon_internal.crm_metric_value(p.id, current_date, i.unit);
      v_written := alcon_internal.crm_measure_value(i.unit, p.measure_metric, p.currency, v_value);
      -- An empty condition reads as 0, as the CRM settings show it: a pipeline
      -- with nothing won yet does not stamp a first reading of 0.
      if v_written is null or coalesce(i.actual_value, 0) = v_written then return; end if;
      v_previous_source := current_setting('alcon.reading_source', true);
      perform set_config('alcon.reading_source', 'crm', true);
      update public.intents set actual_value = v_written, measured_at = now()
        where id = i.id and actual_value is distinct from v_written;
      perform set_config('alcon.reading_source', coalesce(v_previous_source, ''), true);
    end $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.crm_refresh_all_measures()
    returns void language plpgsql security definer set search_path = '' as $b$
    declare
      v_id uuid;
    begin
      for v_id in select id from public.crm_pipelines where measure_intent_id is not null and measure_metric is not null loop
        perform alcon_internal.crm_refresh_measure(v_id);
      end loop;
    end $b$
  $f$;

  -- Deals: once per statement, for each bound pipeline the statement touched.
  execute $f$
    create or replace function alcon_internal.crm_deals_refresh_measures()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    declare
      v_id uuid;
    begin
      if tg_op = 'INSERT' then
        for v_id in select distinct n.pipeline_id from new_rows n
                    join public.crm_pipelines p on p.id = n.pipeline_id and p.measure_intent_id is not null loop
          perform alcon_internal.crm_refresh_measure(v_id);
        end loop;
      elsif tg_op = 'UPDATE' then
        for v_id in select distinct x.pipeline_id from (select pipeline_id from new_rows union select pipeline_id from old_rows) x
                    join public.crm_pipelines p on p.id = x.pipeline_id and p.measure_intent_id is not null loop
          perform alcon_internal.crm_refresh_measure(v_id);
        end loop;
      else
        for v_id in select distinct o.pipeline_id from old_rows o
                    join public.crm_pipelines p on p.id = o.pipeline_id and p.measure_intent_id is not null loop
          perform alcon_internal.crm_refresh_measure(v_id);
        end loop;
      end if;
      return null;
    end $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.crm_pipelines_refresh_measure()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    begin
      if new.measure_intent_id is not null then perform alcon_internal.crm_refresh_measure(new.id); end if;
      return null;
    end $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.crm_fields_refresh_measures()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    declare
      v_id uuid;
      v_space uuid := case when tg_op = 'DELETE' then old.activity_space_id else new.activity_space_id end;
      v_keys text[] := array[case when tg_op <> 'INSERT' then old.key end, case when tg_op <> 'DELETE' then new.key end];
    begin
      for v_id in select id from public.crm_pipelines
                  where activity_space_id = v_space and measure_intent_id is not null
                    and measure_metric like 'won\_field%' and measure_field = any(v_keys) loop
        perform alcon_internal.crm_refresh_measure(v_id);
      end loop;
      return null;
    end $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.intents_refresh_crm_measures()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    declare
      v_id uuid;
    begin
      if new.unit is not distinct from old.unit then return null; end if;
      for v_id in select id from public.crm_pipelines where measure_intent_id = new.id loop
        perform alcon_internal.crm_refresh_measure(v_id);
      end loop;
      return null;
    end $b$
  $f$;

  execute 'revoke execute on function
      alcon_internal.crm_refresh_measure(uuid), alcon_internal.crm_refresh_all_measures(),
      alcon_internal.crm_deals_refresh_measures(), alcon_internal.crm_pipelines_refresh_measure(),
      alcon_internal.crm_fields_refresh_measures(), alcon_internal.intents_refresh_crm_measures(),
      alcon_internal.crm_metric_value(uuid, date, text)
    from public, anon, authenticated';

  execute 'drop trigger if exists crm_deals_refresh_measures_ins on public.crm_deals';
  execute 'create trigger crm_deals_refresh_measures_ins after insert on public.crm_deals
             referencing new table as new_rows
             for each statement execute function alcon_internal.crm_deals_refresh_measures()';
  execute 'drop trigger if exists crm_deals_refresh_measures_upd on public.crm_deals';
  execute 'create trigger crm_deals_refresh_measures_upd after update on public.crm_deals
             referencing old table as old_rows new table as new_rows
             for each statement execute function alcon_internal.crm_deals_refresh_measures()';
  execute 'drop trigger if exists crm_deals_refresh_measures_del on public.crm_deals';
  execute 'create trigger crm_deals_refresh_measures_del after delete on public.crm_deals
             referencing old table as old_rows
             for each statement execute function alcon_internal.crm_deals_refresh_measures()';

  execute 'drop trigger if exists crm_pipelines_refresh_measure on public.crm_pipelines';
  execute 'create trigger crm_pipelines_refresh_measure
             after insert or update of measure_intent_id, measure_metric, measure_field, currency, stages, domain_id
             on public.crm_pipelines
             for each row execute function alcon_internal.crm_pipelines_refresh_measure()';

  execute 'drop trigger if exists crm_fields_refresh_measures on public.crm_fields';
  execute 'create trigger crm_fields_refresh_measures
             after insert or delete or update of key, type, entity, domain_id on public.crm_fields
             for each row execute function alcon_internal.crm_fields_refresh_measures()';

  execute 'drop trigger if exists intents_refresh_crm_measures on public.intents';
  execute 'create trigger intents_refresh_crm_measures after update of unit on public.intents
             for each row execute function alcon_internal.intents_refresh_crm_measures()';

  -- "This quarter" and "this year" move with the calendar, not with the deals.
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    if exists (select 1 from cron.job where jobname = 'crm-measures-daily') then
      perform cron.unschedule('crm-measures-daily');
    end if;
    perform cron.schedule('crm-measures-daily', '5 0 * * *', $cron$select alcon_internal.crm_refresh_all_measures()$cron$);
  end if;

  -- The figures already bound catch up now, rather than at the next deal change.
  perform alcon_internal.crm_refresh_all_measures();
end $migration$;
