-- Add industry category to committees
alter table public.committees
  add column category text not null default 'Others'
  check (category in ('Banking', 'Construction & Property', 'Oil & Gas', 'NGOs & Foundations', 'Others'));
