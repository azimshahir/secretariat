alter table public.organization_ai_settings
  add column if not exists generate_mom_provider text check (generate_mom_provider in ('anthropic', 'openai', 'google')),
  add column if not exists generate_mom_model text,
  add column if not exists go_deeper_ask_provider text check (go_deeper_ask_provider in ('anthropic', 'openai', 'google')),
  add column if not exists go_deeper_ask_model text,
  add column if not exists go_deeper_agent_provider text check (go_deeper_agent_provider in ('anthropic', 'openai', 'google')),
  add column if not exists go_deeper_agent_model text,
  add column if not exists generate_itineraries_provider text check (generate_itineraries_provider in ('anthropic', 'openai', 'google')),
  add column if not exists generate_itineraries_model text;

update public.organization_ai_settings
set
  generate_mom_provider = coalesce(generate_mom_provider, provider),
  generate_mom_model = coalesce(generate_mom_model, model),
  go_deeper_ask_provider = coalesce(go_deeper_ask_provider, provider),
  go_deeper_ask_model = coalesce(go_deeper_ask_model, model),
  go_deeper_agent_provider = coalesce(go_deeper_agent_provider, provider),
  go_deeper_agent_model = coalesce(go_deeper_agent_model, model),
  generate_itineraries_provider = coalesce(generate_itineraries_provider, provider),
  generate_itineraries_model = coalesce(generate_itineraries_model, model)
where
  generate_mom_provider is null
  or generate_mom_model is null
  or go_deeper_ask_provider is null
  or go_deeper_ask_model is null
  or go_deeper_agent_provider is null
  or go_deeper_agent_model is null
  or generate_itineraries_provider is null
  or generate_itineraries_model is null;
