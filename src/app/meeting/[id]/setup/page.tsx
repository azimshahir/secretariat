import { redirect } from 'next/navigation'
import { isRedirectError } from 'next/dist/client/components/redirect-error'

import { getCommitteeSpeakers } from '@/actions/committee-speakers'
import { getItineraryTemplates } from '@/actions/itinerary-template'
import { AppShell } from '@/components/app-shell'
import { getEffectiveAiConfigForUserPlan } from '@/lib/ai/model-config'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'
import { listCanonicalCurrentMinutesForAgendaIds } from '@/lib/meeting-generation/current-minute'
import { getActiveMomDraftBatchForMeeting } from '@/lib/meeting-generation/mom-drafts'
import { inferResolvedOutcomeMode } from '@/lib/meeting-generation/resolved-outcome'
import { getAllowedAiModelOptionsForPlan } from '@/lib/subscription/catalog'
import { formatSecondsToTimecode } from '@/lib/timecode'
import { resolveEffectiveMeetingSpeakers } from '@/lib/meeting-settings-overrides'
import { getCommitteeGenerationSettings } from './committee-generation-actions'
import type { AgendaLinkedDataState } from './agenda-linked-data'
import { NO_TRANSCRIPTION_SEGMENT_MARKER, type AgendaTimelineRow } from './agenda-timeline-row'
import { MeetingDashboard } from './meeting-dashboard'
import { normalizeMeetingPackConfig } from './meeting-pack-model'
import type { MinuteEntry } from './minute-entry'
import { hydrateTemplateGroups } from './settings-template-model'

export default async function MeetingSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab: tabParam } = await searchParams
  const initialTab = tabParam === 'dashboard'
    || tabParam === 'agenda'
    || tabParam === 'generate'
    || tabParam === 'itineraries'
    || tabParam === 'settings'
    ? tabParam
    : 'dashboard'

  let authedContext: Awaited<ReturnType<typeof requireAuthedAppContext>>
  try {
    authedContext = await requireAuthedAppContext()
  } catch (error) {
    if (isRedirectError(error)) throw error
    console.error('[setup/page] requireAuthedAppContext failed:', error)
    redirect('/')
  }

  const { supabase, profile, committees, activeSecretariats } = authedContext

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*, committees(name, slug), organizations(name)')
    .eq('id', id)
    .single()

  if (meetingError) {
    console.error('[setup/page] Meeting query error:', meetingError)
  }
  if (!meeting) redirect('/')

  const { data: agendas, error: agendasError } = await supabase
    .from('agendas')
    .select('*')
    .eq('meeting_id', id)
    .order('sort_order')

  if (agendasError) {
    console.error('[setup/page] Agendas query error:', agendasError)
  }

  const agendaRows = agendas ?? []
  const agendaIds = agendaRows.map(agenda => agenda.id)
  const agendaRevisionById = new Map(
    agendaRows.map(agenda => [agenda.id, agenda.content_revision ?? 1]),
  )
  const currentMinutesByAgenda: Record<string, MinuteEntry> = {}
  const linkedDataByAgendaId: Record<string, AgendaLinkedDataState> = Object.fromEntries(
    agendaRows.map(agenda => [agenda.id, {
      hasMinute: false,
      hasDraft: false,
      hasActionItems: false,
      resolvedOutcomeMode: null,
    }]),
  )

  if (agendaIds.length > 0) {
    try {
      const minutes = await listCanonicalCurrentMinutesForAgendaIds<{
        id: string
        agenda_id: string
        content: string
        resolved_outcome_mode: 'closed' | 'follow_up' | null
        source_agenda_revision: number | null
        updated_at: string
      }>({
        supabase,
        agendaIds,
        extraColumns: 'content, updated_at, source_agenda_revision, resolved_outcome_mode',
      })

      minutes.forEach(minute => {
        const agendaContentRevision = agendaRevisionById.get(minute.agenda_id) ?? 1
        const isStale = Boolean(minute.content.trim())
          && (
            minute.source_agenda_revision == null
            || minute.source_agenda_revision < agendaContentRevision
          )

        currentMinutesByAgenda[minute.agenda_id] = {
          content: minute.content,
          updatedAt: minute.updated_at,
          minuteId: minute.id,
          sourceAgendaRevision: minute.source_agenda_revision ?? null,
          agendaContentRevision,
          isStale,
          resolvedOutcomeMode: inferResolvedOutcomeMode({
            resolvedOutcomeMode: minute.resolved_outcome_mode,
            content: minute.content,
          }),
        }
        linkedDataByAgendaId[minute.agenda_id] = {
          ...(linkedDataByAgendaId[minute.agenda_id] ?? {
            hasMinute: false,
            hasDraft: false,
            hasActionItems: false,
            resolvedOutcomeMode: null,
          }),
          hasMinute: Boolean(minute.content.trim()),
          resolvedOutcomeMode: inferResolvedOutcomeMode({
            resolvedOutcomeMode: minute.resolved_outcome_mode,
            content: minute.content,
          }),
        }
      })
    } catch (error) {
      console.error('[setup/page] Minutes query error:', error)
    }
  }

  if (agendaIds.length > 0) {
    const [{ data: draftRows, error: draftError }, { data: actionRows, error: actionError }] = await Promise.all([
      supabase
        .from('mom_generation_drafts')
        .select('agenda_id')
        .eq('meeting_id', id)
        .in('agenda_id', agendaIds),
      supabase
        .from('action_items')
        .select('agenda_id')
        .eq('meeting_id', id)
        .in('agenda_id', agendaIds),
    ])

    if (draftError) {
      console.error('[setup/page] Draft linkage query error:', draftError)
    } else {
      for (const row of draftRows ?? []) {
        linkedDataByAgendaId[row.agenda_id] = {
          ...(linkedDataByAgendaId[row.agenda_id] ?? {
            hasMinute: false,
            hasDraft: false,
            hasActionItems: false,
            resolvedOutcomeMode: null,
          }),
          hasDraft: true,
        }
      }
    }

    if (actionError) {
      console.error('[setup/page] Action item linkage query error:', actionError)
    } else {
      for (const row of actionRows ?? []) {
        const existingLink = linkedDataByAgendaId[row.agenda_id] ?? {
          hasMinute: false,
          hasDraft: false,
          hasActionItems: false,
          resolvedOutcomeMode: null,
        }
        linkedDataByAgendaId[row.agenda_id] = {
          ...existingLink,
          hasActionItems: true,
          resolvedOutcomeMode: existingLink.resolvedOutcomeMode ?? inferResolvedOutcomeMode({
            hasActionItems: true,
            content: currentMinutesByAgenda[row.agenda_id]?.content ?? null,
          }),
        }
      }
    }
  }

  const templateIds = [
    ...new Set(
      agendaRows
        .map(agenda => agenda.format_template_id)
        .filter((value): value is string => Boolean(value))
    ),
  ]
  const templatePromptById = new Map<string, string>()
  if (templateIds.length > 0) {
    const { data: templates, error: templatesError } = await supabase
      .from('format_templates')
      .select('id, prompt_text')
      .in('id', templateIds)

    if (templatesError) {
      console.error('[setup/page] Templates query error:', templatesError)
    }

    ;(templates ?? []).forEach(template => {
      templatePromptById.set(template.id, template.prompt_text)
    })
  }

  const agendaFormatPrompts = Object.fromEntries(
    agendaRows
      .map(agenda => {
        const templateId = agenda.format_template_id
        if (!templateId) return null
        const promptText = templatePromptById.get(templateId)
        if (!promptText) return null
        return [agenda.id, promptText] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  )

  const { data: transcripts, error: transcriptsError } = await supabase
    .from('transcripts')
    .select('id')
    .eq('meeting_id', id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (transcriptsError) {
    console.error('[setup/page] Transcripts query error:', transcriptsError)
  }

  const latestTranscriptId = transcripts?.[0]?.id ?? null
  const initialTimelineRows: AgendaTimelineRow[] = []
  let initialMomDraftBatch = null

  if (latestTranscriptId && agendaIds.length > 0) {
    const { data: segmentRows, error: segmentsError } = await supabase
      .from('transcript_segments')
      .select('agenda_id, start_offset, end_offset, content')
      .eq('transcript_id', latestTranscriptId)
      .order('start_offset')

    if (segmentsError) {
      console.error('[setup/page] Segments query error:', segmentsError)
    }

    const groupedByAgenda = new Map<string, { startSec: number; endSec: number }>()
    const closureOnlyByAgenda = new Map<string, { startSec: number; endSec: number }>()

    for (const segment of segmentRows ?? []) {
      if (
        !segment.agenda_id ||
        segment.start_offset == null ||
        segment.end_offset == null
      ) {
        continue
      }

      if (segment.content === NO_TRANSCRIPTION_SEGMENT_MARKER) {
        const current = closureOnlyByAgenda.get(segment.agenda_id)
        if (!current) {
          closureOnlyByAgenda.set(segment.agenda_id, {
            startSec: segment.start_offset,
            endSec: segment.end_offset,
          })
        } else {
          current.startSec = Math.min(current.startSec, segment.start_offset)
          current.endSec = Math.max(current.endSec, segment.end_offset)
        }
        continue
      }

      const current = groupedByAgenda.get(segment.agenda_id)
      if (!current) {
        groupedByAgenda.set(segment.agenda_id, {
          startSec: segment.start_offset,
          endSec: segment.end_offset,
        })
        continue
      }

      current.startSec = Math.min(current.startSec, segment.start_offset)
      current.endSec = Math.max(current.endSec, segment.end_offset)
    }

    for (const agenda of agendaRows) {
      const closureOnlyRow = closureOnlyByAgenda.get(agenda.id)
      if (closureOnlyRow) {
        initialTimelineRows.push({
          agendaId: agenda.id,
          agendaNo: agenda.agenda_no,
          agendaTitle: agenda.title,
          startTime: formatSecondsToTimecode(closureOnlyRow.startSec),
          endTime: formatSecondsToTimecode(closureOnlyRow.endSec),
          forcedResolvedOutcomeMode: 'closed',
        })
        continue
      }

      const row = groupedByAgenda.get(agenda.id)
      if (!row) continue
      initialTimelineRows.push({
        agendaId: agenda.id,
        agendaNo: agenda.agenda_no,
        agendaTitle: agenda.title,
        startTime: formatSecondsToTimecode(row.startSec),
        endTime: formatSecondsToTimecode(row.endSec),
      })
    }
  }

  try {
    initialMomDraftBatch = await getActiveMomDraftBatchForMeeting(supabase, id)
  } catch (error) {
    console.error('[setup/page] MoM draft batch query failed:', error)
    initialMomDraftBatch = null
  }

  const committeeName =
    (meeting.committees as unknown as { name: string; slug: string } | null)?.name ?? null
  const committeeSlug =
    (meeting.committees as unknown as { name: string; slug: string } | null)?.slug ?? null
  const orgName =
    (meeting.organizations as unknown as { name: string } | null)?.name ?? ''
  const askModelOptions = getAllowedAiModelOptionsForPlan(profile.plan)
  const defaultAskModelConfig = await getEffectiveAiConfigForUserPlan(
    meeting.organization_id,
    profile.plan,
    'go_deeper_ask',
  )

  let committeeGenerationSettings: Awaited<ReturnType<typeof getCommitteeGenerationSettings>> | null = null
  if (meeting.committee_id) {
    try {
      committeeGenerationSettings = await getCommitteeGenerationSettings(meeting.committee_id)
    } catch (error) {
      console.error('[setup/page] getCommitteeGenerationSettings failed:', error)
    }
  }

  let itineraryTemplates: Array<{
    section_key: string
    storage_path: string
    file_name: string
  }> = []

  if (meeting.committee_id) {
    try {
      itineraryTemplates = await getItineraryTemplates(meeting.committee_id)
    } catch (error) {
      console.error('[setup/page] getItineraryTemplates failed:', error)
      itineraryTemplates = []
    }
  }

  const committeeSpeakers = meeting.committee_id
    ? await getCommitteeSpeakers(meeting.committee_id).catch((error) => {
        console.error('[setup/page] getCommitteeSpeakers failed:', error)
        return []
      })
    : []
  const effectiveSpeakers = resolveEffectiveMeetingSpeakers({
    committeeSpeakers,
    meetingSpeakerOverrides: meeting.speaker_overrides ?? [],
  })

  const initialMeetingPackConfig = normalizeMeetingPackConfig(
    meeting.meeting_pack_config,
    agendaRows,
  )

  const initialTemplateGroups = hydrateTemplateGroups({
    minuteInstruction: committeeGenerationSettings?.minuteInstruction ?? null,
    minuteTemplateFileName: committeeGenerationSettings?.defaultFormatSourceName ?? null,
    itineraryTemplates,
    persistedGroups: Array.isArray(meeting.template_section_overrides) && meeting.template_section_overrides.length > 0
      ? meeting.template_section_overrides
      : committeeGenerationSettings?.templateSections ?? [],
  })

  let initialRagDocuments: Array<{
    id: string; category: string; documentName: string; fileName: string; createdAt: string
  }> = []
  if (meeting.committee_id) {
    try {
      const { data: ragDocs } = await supabase
        .from('committee_rag_documents')
        .select('id, category, document_name, file_name, created_at')
        .eq('committee_id', meeting.committee_id)
        .order('created_at', { ascending: false })

      initialRagDocuments = (ragDocs ?? []).map(row => ({
        id: row.id,
        category: row.category,
        documentName: row.document_name,
        fileName: row.file_name,
        createdAt: row.created_at,
      }))
    } catch (error) {
      console.error('[setup/page] RAG documents query failed:', error)
    }
  }

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      activeCommitteeId={meeting.committee_id ?? undefined}
      containerClassName="max-w-[1600px]"
      initialBuildId={getActiveBuildId()}
    >
      <MeetingDashboard
        meetingId={id}
        meetingTitle={meeting.title}
        meetingDate={meeting.meeting_date}
        committeeName={committeeName}
        committeeId={meeting.committee_id ?? null}
        committeeSlug={committeeSlug}
        organizationName={orgName}
        existingAgendas={agendaRows}
        agendaFormatPrompts={agendaFormatPrompts}
        hasExistingTranscript={(transcripts ?? []).length > 0}
        initialMeetingRules={
          typeof meeting.meeting_rules === 'string' && meeting.meeting_rules.trim().length > 0
            ? meeting.meeting_rules
            : (committeeGenerationSettings?.minuteInstruction ?? '')
        }
        initialTemplateGroups={initialTemplateGroups}
        committeeSpeakers={effectiveSpeakers}
        currentMinutesByAgenda={currentMinutesByAgenda}
        linkedDataByAgendaId={linkedDataByAgendaId}
        initialMomDraftBatch={initialMomDraftBatch}
        initialTimelineRows={initialTimelineRows}
        meetingStatus={meeting.status}
        agendaColumnConfig={meeting.agenda_column_config ?? []}
        agendaLockedAt={meeting.agenda_locked_at ?? null}
        initialMeetingPackConfig={initialMeetingPackConfig}
        initialRagDocuments={initialRagDocuments}
        askModelOptions={askModelOptions}
        defaultAskModelId={defaultAskModelConfig.model}
        initialBuildId={getActiveBuildId()}
        initialTab={initialTab}
      />
    </AppShell>
  )
}
