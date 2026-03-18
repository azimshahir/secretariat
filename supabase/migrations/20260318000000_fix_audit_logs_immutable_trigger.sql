-- Fix: allow FK cascade SET NULL on audit_logs (user/meeting deletion)
-- while still blocking manual content modifications and row deletions.

create or replace function public.prevent_audit_modification()
returns trigger as $$
begin
  -- Allow SET NULL updates from FK cascades (user_id or meeting_id becoming null)
  if TG_OP = 'UPDATE' then
    if (
      OLD.id = NEW.id
      and OLD.organization_id is not distinct from NEW.organization_id
      and OLD.action is not distinct from NEW.action
      and OLD.details is not distinct from NEW.details
      and OLD.ip_address is not distinct from NEW.ip_address
      and OLD.created_at is not distinct from NEW.created_at
    ) then
      return NEW;
    end if;
    raise exception 'Audit logs are immutable and cannot be modified';
  end if;

  -- DELETE is always blocked
  raise exception 'Audit logs are immutable and cannot be deleted';
end;
$$ language plpgsql;
