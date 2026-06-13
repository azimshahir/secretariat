-- Migrate legacy 'basic' tier users to 'free' tier.
-- The new pricing has 3 tiers: free, pro, premium (Unlimited).
-- 'basic' is kept in CHECK constraints for backward compatibility but
-- new signups will never use it.

-- 1. Move all basic users to free
update profiles
  set plan = 'free'
  where plan = 'basic';

-- 2. Move any basic plan_ai_config rows to free (if table exists)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'plan_ai_config') then
    -- Delete basic rows if free rows already exist (avoid duplicates)
    execute 'delete from plan_ai_config where plan_tier = ''basic'' and exists (select 1 from plan_ai_config p2 where p2.plan_tier = ''free'')';
    -- Rename any remaining basic rows to free
    execute 'update plan_ai_config set plan_tier = ''free'' where plan_tier = ''basic''';
  end if;
end $$;

-- Note: CHECK constraints still allow 'basic' for safety.
-- Can be tightened in a future migration after confirming no basic references remain.
