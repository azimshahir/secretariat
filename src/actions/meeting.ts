'use server'

import { redirect } from 'next/navigation'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { maybeApplyCommitteeFormattingDefaultToMeeting } from '@/lib/committee-formatting-defaults-server'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import { recordMeetingCreatedUsage } from '@/lib/subscription/entitlements'
import { createMeetingSchema } from '@/lib/validation'
import type { MeetingStatus } from '@/lib/supabase/types'

const DEDUPE_WINDOW_MINUTES = 10
const DEDUPE_WINDOW_MS = DEDUPE_WINDOW_MINUTES * 60 * 1000

function normalizeMeetingTitle(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function getMeetingRouteByStatus(meetingId: string, status: MeetingStatus) {
  switch (status) {
    case 'draft':
    case 'pending_setup':
      return `/meeting/${meetingId}/setup`
    case 'mapping':
      return `/meeting/${meetingId}/map`
    case 'generating':
    case 'in_progress':
      return `/meeting/${meetingId}/setup`
    case 'finalized':
      return `/meeting/${meetingId}/export`
  }
}

async function findRecentDuplicateMeeting(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    organizationId: string
    createdBy: string
    committeeId: string
    meetingDate: string
    normalizedTitle: string
  },
) {
  const windowStartIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
  let query = supabase
    .from('meetings')
    .select('id, status, title')
    .eq('organization_id', params.organizationId)
    .eq('created_by', params.createdBy)
    .eq('meeting_date', params.meetingDate)
    .gte('created_at', windowStartIso)
    .order('created_at', { ascending: false })
    .limit(20)

  query = query.eq('committee_id', params.committeeId)

  const { data: recentMeetings, error } = await query
  if (error) throw new Error(error.message)

  const duplicate = (recentMeetings ?? []).find(
    meeting => normalizeMeetingTitle(meeting.title) === params.normalizedTitle,
  )
  if (!duplicate) return null

  return {
    id: duplicate.id,
    status: duplicate.status as MeetingStatus,
  }
}

async function logMeetingCreateDeduped(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    organizationId: string
    userId: string
    existingMeetingId: string
    attemptedTitle: string
    meetingDate: string
    committeeId: string | null
    flow: 'normal' | 'ai_suggested'
  },
) {
  const { error } = await supabase.from('audit_logs').insert({
    organization_id: params.organizationId,
    meeting_id: params.existingMeetingId,
    user_id: params.userId,
    action: 'meeting_create_deduped',
    details: {
      attempted_title: params.attemptedTitle,
      meeting_date: params.meetingDate,
      committee_id: params.committeeId,
      existing_meeting_id: params.existingMeetingId,
      flow: params.flow,
    },
  })

  if (error && process.env.NODE_ENV !== 'production') {
    console.error('[Meeting Create Deduped] Failed to write audit log', error)
  }
}

export async function createMeeting(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const parsed = createMeetingSchema.safeParse({
    title: formData.get('title'),
    meetingDate: formData.get('meetingDate'),
    committeeId: formData.get('committeeId'),
  })
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid form input')

  const title = normalizeMeetingTitle(parsed.data.title)
  const meetingDate = parsed.data.meetingDate
  const committeeId = parsed.data.committeeId

  const duplicate = await findRecentDuplicateMeeting(supabase, {
    organizationId: profile.organization_id,
    createdBy: user.id,
    committeeId,
    meetingDate,
    normalizedTitle: title,
  })

  if (duplicate) {
    await logMeetingCreateDeduped(supabase, {
      organizationId: profile.organization_id,
      userId: user.id,
      existingMeetingId: duplicate.id,
      attemptedTitle: title,
      meetingDate,
      committeeId,
      flow: 'normal',
    })
    redirect(getMeetingRouteByStatus(duplicate.id, duplicate.status))
  }

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      organization_id: profile.organization_id,
      title,
      meeting_date: meetingDate,
      committee_id: committeeId,
      status: 'pending_setup',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Log to audit trail
  await supabase.from('audit_logs').insert({
    organization_id: profile.organization_id,
    meeting_id: meeting.id,
    user_id: user.id,
    action: 'meeting_created',
    details: { title, meeting_date: meetingDate, committee_id: committeeId },
  })

  try {
    await recordMeetingCreatedUsage({
      userId: user.id,
      organizationId: profile.organization_id,
    })
  } catch (error) {
    console.warn('[createMeeting] failed to record subscription usage', error)
  }

  redirect(`/meeting/${meeting.id}/setup`)
}

const suggestionSchema = z.object({
  title: z.string(),
  committeeId: z.string().nullable(),
  committeeName: z.string().nullable(),
  agendaItems: z.array(z.string()),
  reasoning: z.string(),
})

export async function suggestMeeting(
  description: string,
  committees: { id: string; name: string }[],
) {
  const committeeList = committees.length > 0
    ? `Available committees:\n${committees.map(c => `- ${c.name} (id: ${c.id})`).join('\n')}`
    : 'No committees available.'

  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-5-20250514'),
    schema: suggestionSchema,
    prompt: `You are an assistant for a Company Secretary platform. Based on this meeting description, suggest a meeting title, matching committee (if any), and agenda items.

${committeeList}

Meeting description: "${description}"

Rules:
- Title should be formal corporate style
- Prefer one of the provided committees when there is a reasonable match; otherwise return null and let the user choose
- Suggest 3-7 agenda items in logical order
- Keep reasoning to 1 sentence`,
  })

  return object
}

export async function createMeetingWithAgendas(params: {
  title: string
  meetingDate: string
  committeeId: string
  agendaItems: string[]
}): Promise<{ meetingId: string; redirectPath: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const parsed = createMeetingSchema.safeParse({
    title: params.title,
    meetingDate: params.meetingDate,
    committeeId: params.committeeId,
  })
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid input')

  const normalizedTitle = normalizeMeetingTitle(parsed.data.title)
  const committeeId = parsed.data.committeeId
  const duplicate = await findRecentDuplicateMeeting(supabase, {
    organizationId: profile.organization_id,
    createdBy: user.id,
    committeeId,
    meetingDate: parsed.data.meetingDate,
    normalizedTitle,
  })

  if (duplicate) {
    await logMeetingCreateDeduped(supabase, {
      organizationId: profile.organization_id,
      userId: user.id,
      existingMeetingId: duplicate.id,
      attemptedTitle: normalizedTitle,
      meetingDate: parsed.data.meetingDate,
      committeeId,
      flow: 'ai_suggested',
    })
    return {
      meetingId: duplicate.id,
      redirectPath: getMeetingRouteByStatus(duplicate.id, duplicate.status),
    }
  }

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      organization_id: profile.organization_id,
      title: normalizedTitle,
      meeting_date: parsed.data.meetingDate,
      committee_id: committeeId,
      status: 'pending_setup',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Seed agenda items from AI suggestions
  if (params.agendaItems.length > 0) {
    await supabase.from('agendas').insert(
      params.agendaItems.map((title, i) => ({
        meeting_id: meeting.id,
        agenda_no: `${i + 1}`,
        title,
        sort_order: i,
      })),
    )

    try {
      await maybeApplyCommitteeFormattingDefaultToMeeting(
        supabase as unknown as DatabaseClient,
        meeting.id,
      )
    } catch (error) {
      console.error('[createMeetingWithAgendas] committee formatting default apply failed:', error)
    }
  }

  await supabase.from('audit_logs').insert({
    organization_id: profile.organization_id,
    meeting_id: meeting.id,
    user_id: user.id,
    action: 'meeting_created',
    details: {
      title: normalizedTitle,
      meeting_date: parsed.data.meetingDate,
      committee_id: committeeId,
      ai_suggested: true,
    },
  })

  try {
    await recordMeetingCreatedUsage({
      userId: user.id,
      organizationId: profile.organization_id,
    })
  } catch (error) {
    console.warn('[createMeetingWithAgendas] failed to record subscription usage', error)
  }

  return {
    meetingId: meeting.id,
    redirectPath: getMeetingRouteByStatus(meeting.id, 'pending_setup'),
  }
}

export async function addAgenda(meetingId: string, title: string, agendaNo: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: maxOrder } = await supabase
    .from('agendas')
    .select('sort_order')
    .eq('meeting_id', meetingId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const { error } = await supabase.from('agendas').insert({
    meeting_id: meetingId,
    agenda_no: agendaNo,
    title,
    sort_order: (maxOrder?.sort_order ?? -1) + 1,
  })

  if (error) throw new Error(error.message)
}

export async function deleteAgenda(agendaId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.from('agendas').delete().eq('id', agendaId)
  if (error) throw new Error(error.message)
}

export async function updateAgenda(agendaId: string, fields: {
  title?: string; presenter?: string | null; agenda_no?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.from('agendas').update(fields).eq('id', agendaId)
  if (error) throw new Error(error.message)
}
