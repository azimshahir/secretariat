import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  COMMITTEE_SPEAKER_SELECT,
  type CommitteeSpeaker,
} from '@/lib/committee-speakers'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableCommitteeContext,
  serializeCommitteeGenerationApiError,
} from '../_lib/write-access'

export const runtime = 'nodejs'

const upsertSpeakerBodySchema = z.object({
  committeeId: z.string(),
  speakerName: z.string(),
  position: z.string().optional().default(''),
})

const deleteSpeakerBodySchema = z.object({
  committeeId: z.string(),
  speakerId: z.string(),
})

async function getNextSortOrder(
  adminSupabase: Awaited<ReturnType<typeof requireWritableCommitteeContext>>['adminSupabase'],
  committeeId: string,
) {
  const { data, error } = await adminSupabase
    .from('committee_speakers')
    .select('sort_order')
    .eq('committee_id', committeeId)
    .order('sort_order', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)
  return (data?.[0]?.sort_order ?? -1) + 1
}

export async function POST(request: Request) {
  try {
    const body = upsertSpeakerBodySchema.parse(await request.json())
    const committeeId = uuidSchema.parse(body.committeeId)
    const speakerName = body.speakerName.trim()
    const position = body.position.trim()

    if (!speakerName) {
      throw new Error('Speaker name is required')
    }

    const context = await requireWritableCommitteeContext(committeeId)

    const { data: existing, error: existingError } = await context.adminSupabase
      .from('committee_speakers')
      .select('id, sort_order')
      .eq('committee_id', committeeId)
      .eq('speaker_name', speakerName)
      .maybeSingle()
    if (existingError) {
      throw new Error(existingError.message)
    }

    const sortOrder = existing?.sort_order ?? await getNextSortOrder(context.adminSupabase, committeeId)

    const { data: speaker, error: upsertError } = await context.adminSupabase
      .from('committee_speakers')
      .upsert(
        {
          committee_id: committeeId,
          speaker_name: speakerName,
          position,
          sort_order: sortOrder,
        },
        { onConflict: 'committee_id,speaker_name' },
      )
      .select(COMMITTEE_SPEAKER_SELECT)
      .single()

    if (upsertError || !speaker) {
      throw new Error(upsertError?.message ?? 'Failed to save speaker')
    }

    return NextResponse.json({
      ok: true,
      speaker: speaker as CommitteeSpeaker,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save speaker')
    console.error('[api/committee-generation/speakers] POST failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = deleteSpeakerBodySchema.parse(await request.json())
    const committeeId = uuidSchema.parse(body.committeeId)
    const speakerId = uuidSchema.parse(body.speakerId)
    const context = await requireWritableCommitteeContext(committeeId)

    const { data: speaker, error: speakerError } = await context.adminSupabase
      .from('committee_speakers')
      .select('id')
      .eq('id', speakerId)
      .eq('committee_id', committeeId)
      .maybeSingle()
    if (speakerError) {
      throw new Error(speakerError.message)
    }
    if (!speaker) {
      throw new Error('Speaker not found')
    }

    const { error: deleteError } = await context.adminSupabase
      .from('committee_speakers')
      .delete()
      .eq('id', speakerId)
      .eq('committee_id', committeeId)
    if (deleteError) {
      throw new Error(deleteError.message)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to delete speaker')
    console.error('[api/committee-generation/speakers] DELETE failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
