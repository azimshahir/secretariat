import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminSB } from '@supabase/supabase-js'
import { formatSecondsToTimecode } from '@/lib/timecode'
import { normalizeMeetingPackConfig } from '@/app/meeting/[id]/setup/meeting-pack-model'
import { getCommitteeGenerationSettings } from '@/app/meeting/[id]/setup/committee-generation-actions'
import { getItineraryTemplates } from '@/actions/itinerary-template'
import { getCommitteeSpeakers } from '@/actions/committee-speakers'

const TEST_MEETING_ID = 'd6e98559-d7c6-4514-81b5-e2faa1ae0e50'

export async function GET() {
  const errors: string[] = []
  const steps: string[] = []

  try {
    steps.push('1. supabase client')
    const supabase = await createClient()

    steps.push('2. auth')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ steps, errors, result: 'no user' })
    steps.push(`2b. user=${user.id}`)

    steps.push('3. meeting query')
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('*, committees(name), organizations(name)')
      .eq('id', TEST_MEETING_ID)
      .single()
    if (meetingError) errors.push(`meeting: ${meetingError.message} (${meetingError.code})`)
    if (!meeting) return NextResponse.json({ steps, errors, result: 'meeting not found' })
    steps.push(`3b. meeting OK: ${meeting.title}`)

    steps.push('4. agendas')
    const { data: agendas, error: agendasError } = await supabase
      .from('agendas')
      .select('*')
      .eq('meeting_id', TEST_MEETING_ID)
      .order('sort_order')
    if (agendasError) errors.push(`agendas: ${agendasError.message} (${agendasError.code})`)
    const agendaRows = agendas ?? []
    steps.push(`4b. agendas OK: ${agendaRows.length} rows`)

    steps.push('5. minutes')
    const agendaIds = agendaRows.map(a => a.id)
    if (agendaIds.length > 0) {
      const { data: minutes, error: minutesError } = await supabase
        .from('minutes')
        .select('id, agenda_id, content, updated_at')
        .eq('is_current', true)
        .in('agenda_id', agendaIds)
      if (minutesError) errors.push(`minutes: ${minutesError.message} (${minutesError.code})`)
      else steps.push(`5b. minutes OK: ${(minutes ?? []).length} rows`)
    }

    steps.push('6. format_templates')
    const templateIds = [...new Set(agendaRows.map(a => a.format_template_id).filter(Boolean))]
    if (templateIds.length > 0) {
      const { data: templates, error: tplError } = await supabase
        .from('format_templates')
        .select('id, prompt_text')
        .in('id', templateIds)
      if (tplError) errors.push(`format_templates: ${tplError.message} (${tplError.code})`)
      else steps.push(`6b. format_templates OK: ${(templates ?? []).length}`)
    }

    steps.push('7. transcripts')
    const { data: transcripts, error: trError } = await supabase
      .from('transcripts')
      .select('id')
      .eq('meeting_id', TEST_MEETING_ID)
      .order('created_at', { ascending: false })
      .limit(1)
    if (trError) errors.push(`transcripts: ${trError.message} (${trError.code})`)
    else steps.push(`7b. transcripts OK: ${(transcripts ?? []).length}`)

    const latestTranscriptId = transcripts?.[0]?.id ?? null
    if (latestTranscriptId && agendaIds.length > 0) {
      steps.push('8. transcript_segments')
      const { data: segs, error: segError } = await supabase
        .from('transcript_segments')
        .select('agenda_id, start_offset, end_offset')
        .eq('transcript_id', latestTranscriptId)
        .order('start_offset')
      if (segError) errors.push(`transcript_segments: ${segError.message} (${segError.code})`)
      else steps.push(`8b. transcript_segments OK: ${(segs ?? []).length}`)
    }

    steps.push('9. committeeGenerationSettings')
    if (meeting.committee_id) {
      try {
        const cgs = await getCommitteeGenerationSettings(meeting.committee_id)
        steps.push(`9b. OK: ${JSON.stringify(cgs).slice(0, 80)}`)
      } catch (e) {
        errors.push(`getCommitteeGenerationSettings: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    steps.push('10. itineraryTemplates')
    if (meeting.committee_id) {
      try {
        const its = await getItineraryTemplates(meeting.committee_id)
        steps.push(`10b. OK: ${its.length} templates`)
      } catch (e) {
        errors.push(`getItineraryTemplates: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    steps.push('11. committeeSpeakers')
    if (meeting.committee_id) {
      try {
        const speakers = await getCommitteeSpeakers(meeting.committee_id)
        steps.push(`11b. OK: ${speakers.length} speakers`)
      } catch (e) {
        errors.push(`getCommitteeSpeakers: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    steps.push('12. committee_rag_documents')
    if (meeting.committee_id) {
      const { data: ragDocs, error: ragError } = await supabase
        .from('committee_rag_documents')
        .select('id, category, document_name, file_name, created_at')
        .eq('committee_id', meeting.committee_id)
        .order('created_at', { ascending: false })
      if (ragError) errors.push(`committee_rag_documents: ${ragError.message} (${ragError.code})`)
      else steps.push(`12b. OK: ${(ragDocs ?? []).length} docs`)
    }

    steps.push('13. normalizeMeetingPackConfig')
    const config = normalizeMeetingPackConfig(meeting.meeting_pack_config, agendaRows)
    steps.push(`13b. OK: ${JSON.stringify(config).slice(0, 80)}`)

    steps.push('14. formatSecondsToTimecode')
    steps.push(`14b. OK: ${formatSecondsToTimecode(90)}`)

    steps.push('15. serialization test')
    const testPayload = {
      meetingId: TEST_MEETING_ID,
      meetingTitle: meeting.title,
      meetingDate: meeting.meeting_date,
      committeeName: (meeting.committees as unknown as { name: string } | null)?.name ?? null,
      committeeId: meeting.committee_id ?? null,
      organizationName: (meeting.organizations as unknown as { name: string } | null)?.name ?? '',
      existingAgendas: agendaRows,
      meetingStatus: meeting.status,
      initialMeetingRules: typeof meeting.meeting_rules === 'string' ? meeting.meeting_rules : '',
    }
    const serialized = JSON.stringify(testPayload)
    steps.push(`15b. serialization OK: ${serialized.length} chars`)

    // Also read captured RSC errors from audit_logs
    let rscErrors: unknown[] = []
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (url && key) {
        const adminSB = createAdminSB(url, key)
        const { data } = await adminSB
          .from('audit_logs')
          .select('details, created_at')
          .eq('action', 'rsc_render_error')
          .order('created_at', { ascending: false })
          .limit(10)
        rscErrors = data ?? []
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      steps,
      errors,
      rscErrors,
      result: errors.length === 0 ? 'ALL OK' : 'ERRORS FOUND',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    return NextResponse.json({ steps, errors, crash: { message, stack } }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // Read RSC render errors from audit_logs
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return NextResponse.json({ error: 'no admin creds' })

    const sb = createAdminSB(url, key)
    const { data, error } = await sb
      .from('audit_logs')
      .select('action, details, created_at')
      .eq('action', 'rsc_render_error')
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) return NextResponse.json({ error: error.message })
    return NextResponse.json({ rscErrors: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) })
  }
}
