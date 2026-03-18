-- Add pre-generated summary columns to minutes table
ALTER TABLE minutes
  ADD COLUMN IF NOT EXISTS summary_paper text,
  ADD COLUMN IF NOT EXISTS summary_discussion text,
  ADD COLUMN IF NOT EXISTS summary_heated text;
