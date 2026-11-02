-- An integration may be an AI model provider: a Messages API in Anthropic's
-- format (DeepSeek, Kimi, GLM, or any compatible base URL). Its key is kept
-- in Vault like every other integration credential. An AI Worker points at
-- one through ai_config.provider and names the model in ai_model; run-agent
-- then calls that provider instead of Anthropic. A model connection is never
-- offered to an agent as a tool.
do $$
begin
  if to_regclass('public.integrations') is null then
    raise notice 'integrations model kind skipped: integrations not present';
    return;
  end if;
  execute 'alter table public.integrations drop constraint if exists integrations_kind_check';
  execute 'alter table public.integrations add constraint integrations_kind_check check (kind in (''mcp'', ''http'', ''model''))';
end
$$;
