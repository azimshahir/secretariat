-- Add finalized_content column to store the user-edited MoM text
alter table public.meetings
  add column if not exists finalized_content text;
