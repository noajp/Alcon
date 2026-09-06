-- A stale user draft is an HTTP conflict, not a retryable database serialization failure.
-- PostgREST versions that retry SQLSTATE 40001 must return control to the editor.
do $migration$
declare
  v_function regprocedure := to_regprocedure('public.check_in_element(uuid,timestamp with time zone,uuid,jsonb,text)');
  v_definition text;
  v_before text := $before$errcode='40001', message='This Element changed while you were writing. Refresh and review the latest status before saving.'$before$;
  v_after text := $after$errcode='PT409', message='This Element changed while you were writing. Refresh and review the latest status before saving.'$after$;
begin
  if to_regclass('public.elements') is null or v_function is null then return; end if;
  v_definition := pg_get_functiondef(v_function);
  if strpos(v_definition, v_after)>0 then return; end if;
  if strpos(v_definition, v_before)=0 then
    raise exception 'The check-in conflict guard was not found; inspect the function before changing it.';
  end if;
  execute replace(v_definition, v_before, v_after);
end $migration$;
