-- Create the meeting-files bucket (idempotent)
insert into storage.buckets (id, name, public)
values ('meeting-files', 'meeting-files', false)
on conflict (id) do nothing;

-- Allow authenticated users to upload files to their meeting paths
create policy "Authenticated users upload meeting files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'meeting-files');

-- Allow authenticated users to read their meeting files (for signed URLs)
create policy "Authenticated users read meeting files"
on storage.objects for select
to authenticated
using (bucket_id = 'meeting-files');

-- Allow authenticated users to delete their meeting files
create policy "Authenticated users delete meeting files"
on storage.objects for delete
to authenticated
using (bucket_id = 'meeting-files');
