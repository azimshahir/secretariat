-- Remove 'google' from AI provider CHECK constraints and migrate existing rows to 'anthropic'.
-- This is safe: the application code already maps google → anthropic in toProvider().

-- 1. Migrate existing google rows to anthropic
update organization_ai_settings
  set provider = 'anthropic'
  where provider = 'google';

update organization_ai_settings
  set generate_mom_provider = 'anthropic'
  where generate_mom_provider = 'google';

update organization_ai_settings
  set go_deeper_ask_provider = 'anthropic'
  where go_deeper_ask_provider = 'google';

update organization_ai_settings
  set go_deeper_agent_provider = 'anthropic'
  where go_deeper_agent_provider = 'google';

update organization_ai_settings
  set generate_itineraries_provider = 'anthropic'
  where generate_itineraries_provider = 'google';

-- 2. Drop old CHECK constraints and recreate without 'google'

-- organization_ai_settings.provider
alter table organization_ai_settings
  drop constraint if exists organization_ai_settings_provider_check;
alter table organization_ai_settings
  add constraint organization_ai_settings_provider_check
  check (provider in ('anthropic', 'openai'));

-- organization_ai_settings task-level providers
alter table organization_ai_settings
  drop constraint if exists organization_ai_settings_generate_mom_provider_check;
alter table organization_ai_settings
  add constraint organization_ai_settings_generate_mom_provider_check
  check (generate_mom_provider in ('anthropic', 'openai'));

alter table organization_ai_settings
  drop constraint if exists organization_ai_settings_go_deeper_ask_provider_check;
alter table organization_ai_settings
  add constraint organization_ai_settings_go_deeper_ask_provider_check
  check (go_deeper_ask_provider in ('anthropic', 'openai'));

alter table organization_ai_settings
  drop constraint if exists organization_ai_settings_go_deeper_agent_provider_check;
alter table organization_ai_settings
  add constraint organization_ai_settings_go_deeper_agent_provider_check
  check (go_deeper_agent_provider in ('anthropic', 'openai'));

alter table organization_ai_settings
  drop constraint if exists organization_ai_settings_generate_itineraries_provider_check;
alter table organization_ai_settings
  add constraint organization_ai_settings_generate_itineraries_provider_check
  check (generate_itineraries_provider in ('anthropic', 'openai'));

-- 3. plan_ai_config table (if exists from subscription migration)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'plan_ai_config') then
    update plan_ai_config set generate_mom_provider = 'anthropic' where generate_mom_provider = 'google';
    update plan_ai_config set go_deeper_ask_provider = 'anthropic' where go_deeper_ask_provider = 'google';
    update plan_ai_config set go_deeper_agent_provider = 'anthropic' where go_deeper_agent_provider = 'google';
    update plan_ai_config set generate_itineraries_provider = 'anthropic' where generate_itineraries_provider = 'google';

    -- Drop and recreate CHECK constraints for plan_ai_config
    execute 'alter table plan_ai_config drop constraint if exists plan_ai_config_generate_mom_provider_check';
    execute 'alter table plan_ai_config add constraint plan_ai_config_generate_mom_provider_check check (generate_mom_provider in (''anthropic'', ''openai''))';

    execute 'alter table plan_ai_config drop constraint if exists plan_ai_config_go_deeper_ask_provider_check';
    execute 'alter table plan_ai_config add constraint plan_ai_config_go_deeper_ask_provider_check check (go_deeper_ask_provider in (''anthropic'', ''openai''))';

    execute 'alter table plan_ai_config drop constraint if exists plan_ai_config_go_deeper_agent_provider_check';
    execute 'alter table plan_ai_config add constraint plan_ai_config_go_deeper_agent_provider_check check (go_deeper_agent_provider in (''anthropic'', ''openai''))';

    execute 'alter table plan_ai_config drop constraint if exists plan_ai_config_generate_itineraries_provider_check';
    execute 'alter table plan_ai_config add constraint plan_ai_config_generate_itineraries_provider_check check (generate_itineraries_provider in (''anthropic'', ''openai''))';
  end if;
end $$;

-- 4. Update any google model IDs to claude equivalent
update organization_ai_settings
  set model = 'claude-sonnet-4-20250514'
  where model like 'gemini%';

update organization_ai_settings
  set generate_mom_model = 'claude-sonnet-4-20250514'
  where generate_mom_model like 'gemini%';

update organization_ai_settings
  set go_deeper_ask_model = 'claude-sonnet-4-20250514'
  where go_deeper_ask_model like 'gemini%';

update organization_ai_settings
  set go_deeper_agent_model = 'claude-sonnet-4-20250514'
  where go_deeper_agent_model like 'gemini%';

update organization_ai_settings
  set generate_itineraries_model = 'claude-sonnet-4-20250514'
  where generate_itineraries_model like 'gemini%';
