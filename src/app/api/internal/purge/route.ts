import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const secret = req.headers.get('x-purge-secret')
  if (!process.env.PURGE_CRON_SECRET || secret !== process.env.PURGE_CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createAdminClient()
  const { data: meetings } = await supabase
    .from('meetings')
    .select('id, organization_id')
    .eq('status', 'finalized')
    .lte('purge_at', new Date().toISOString())

  let purgedMeetings = 0

  for (const meeting of meetings ?? []) {
    const { data: files } = await supabase
      .from('media_files')
      .select('id, storage_path')
      .eq('meeting_id', meeting.id)
      .eq('is_purged', false)

    const paths = (files ?? []).map(file => file.storage_path)

    // Also purge processed text files
    const { data: processedFiles } = await supabase.storage.from('meeting-files').list(`${meeting.id}/processed`)
    if (processedFiles?.length) {
      paths.push(...processedFiles.map(f => `${meeting.id}/processed/${f.name}`))
    }

    if (paths.length > 0) {
      await supabase.storage.from('meeting-files').remove(paths)
    }

    await supabase
      .from('media_files')
      .update({ is_purged: true, purged_at: new Date().toISOString() })
      .eq('meeting_id', meeting.id)
      .eq('is_purged', false)

    await supabase.from('transcript_segments').delete().in(
      'transcript_id',
      (await supabase.from('transcripts').select('id').eq('meeting_id', meeting.id)).data?.map(t => t.id) ?? ['']
    )
    await supabase.from('transcripts').delete().eq('meeting_id', meeting.id)

    await supabase.from('audit_logs').insert({
      organization_id: meeting.organization_id,
      meeting_id: meeting.id,
      action: 'storage_purge_completed',
      details: { via: 'internal_purge_api', purged_paths: paths.length },
    })

    purgedMeetings += 1
  }

  return Response.json({ purgedMeetings })
}
