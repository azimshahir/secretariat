alter table public.format_templates
  add column if not exists compiled_template_json jsonb,
  add column if not exists compiled_template_version integer not null default 1,
  add column if not exists compiled_template_hash text;

update public.format_templates
set
  compiled_template_json = coalesce(
    compiled_template_json,
    jsonb_build_object(
      'kind', 'legacy_raw_text',
      'version', 1,
      'normalizedText', coalesce(prompt_text, '')
    )
  ),
  compiled_template_version = coalesce(compiled_template_version, 1),
  compiled_template_hash = coalesce(compiled_template_hash, md5(coalesce(prompt_text, '')))
where compiled_template_json is null
   or compiled_template_hash is null;

alter table public.format_templates
  alter column compiled_template_json set not null;

alter table public.format_templates
  alter column compiled_template_hash set not null;
