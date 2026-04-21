import { NextResponse } from 'next/server'
import { z } from 'zod'
import { saveCommitteeFormattingDefaultForMeeting } from '@/lib/committee-formatting-defaults-server'
import {
  applyFormatToSubItems,
  attachCommitteePlaybookToAgenda,
  bulkSaveSkipped,
  clearAgendaFormatting,
  clearAllGeneratedMinutes,
  clearMeetingFormatting,
  getAgendaFormattingState,
  updateAgendaPlaybookVariantOverride,
  updateAgendaSkipped,
  upsertFormatFromPaste,
} from '@/app/meeting/[id]/setup/mom-actions'
import {
  minutePlaybookModeSchema,
  minutePlaybookVariantKeySchema,
  uuidSchema,
} from '@/lib/validation'
import { isMinuteTemplateCompileError } from '@/lib/meeting-generation/minute-template'
import {
  CommitteeGenerationApiError,
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save_agenda_format'),
    agendaId: uuidSchema,
    committeeId: uuidSchema,
    name: z.string(),
    playbookMode: minutePlaybookModeSchema.optional(),
    resolutionPathsEnabled: z.boolean().optional(),
    variants: z.array(z.object({
      variantKey: minutePlaybookVariantKeySchema,
      promptText: z.string(),
    })).min(1),
    additionalInfo: z.string().optional(),
    saveAsCommitteePlaybook: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('apply_to_subitems'),
    sourceAgendaId: uuidSchema,
    subItemIds: z.array(uuidSchema),
  }),
  z.object({
    action: z.literal('attach_playbook'),
    agendaId: uuidSchema,
    playbookId: uuidSchema,
  }),
  z.object({
    action: z.literal('update_variant_override'),
    agendaId: uuidSchema,
    variantOverrideId: uuidSchema.nullable(),
  }),
  z.object({
    action: z.literal('update_skipped'),
    agendaId: uuidSchema,
    isSkipped: z.boolean(),
  }),
  z.object({
    action: z.literal('bulk_save_skipped'),
    skippedIds: z.array(uuidSchema),
  }),
  z.object({
    action: z.literal('save_committee_default'),
  }),
  z.object({
    action: z.literal('clear_meeting_formatting'),
  }),
  z.object({
    action: z.literal('clear_all_generated_minutes'),
  }),
])

const deleteSchema = z.object({
  agendaId: uuidSchema,
})

async function assertAgendaBelongsToMeeting(
  adminSupabase: Awaited<ReturnType<typeof requireWritableMeetingContext>>['adminSupabase'],
  meetingId: string,
  agendaId: string,
) {
  const { data, error } = await adminSupabase
    .from('agendas')
    .select('id')
    .eq('id', agendaId)
    .eq('meeting_id', meetingId)
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Agenda not found in this meeting')
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const agendaId = uuidSchema.parse(new URL(request.url).searchParams.get('agendaId'))
    const context = await requireWritableMeetingContext(meetingId)
    await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, agendaId)

    const formatting = await getAgendaFormattingState(agendaId)
    return NextResponse.json({ ok: true, formatting })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to load agenda formatting')
    return NextResponse.json({ ok: false, message }, { status })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const body = postSchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    if (body.action === 'save_agenda_format') {
      await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, body.agendaId)
      const formatting = await upsertFormatFromPaste(
        body.agendaId,
        body.committeeId,
        body.name,
        body.playbookMode ?? 'resolution_paths',
        body.resolutionPathsEnabled ?? false,
        body.variants,
        body.additionalInfo,
        body.saveAsCommitteePlaybook,
      )
      return NextResponse.json({ ok: true, formatting })
    }

    if (body.action === 'apply_to_subitems') {
      await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, body.sourceAgendaId)
      for (const agendaId of body.subItemIds) {
        await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, agendaId)
      }
      const { shouldAutoSaveCommitteeDefault } = await applyFormatToSubItems({
        sourceAgendaId: body.sourceAgendaId,
      }, body.subItemIds)
      if (shouldAutoSaveCommitteeDefault) {
        await saveCommitteeFormattingDefaultForMeeting(context.adminSupabase, meetingId)
      }
      return NextResponse.json({
        ok: true,
        autoSavedCommitteeDefault: shouldAutoSaveCommitteeDefault,
      })
    }

    if (body.action === 'attach_playbook') {
      await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, body.agendaId)
      const formatting = await attachCommitteePlaybookToAgenda(body.agendaId, body.playbookId)
      return NextResponse.json({ ok: true, formatting })
    }

    if (body.action === 'update_variant_override') {
      await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, body.agendaId)
      const formatting = await updateAgendaPlaybookVariantOverride(body.agendaId, body.variantOverrideId)
      return NextResponse.json({ ok: true, formatting })
    }

    if (body.action === 'update_skipped') {
      await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, body.agendaId)
      await updateAgendaSkipped(body.agendaId, body.isSkipped)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'bulk_save_skipped') {
      for (const agendaId of body.skippedIds) {
        await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, agendaId)
      }
      await bulkSaveSkipped(meetingId, body.skippedIds)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'save_committee_default') {
      await saveCommitteeFormattingDefaultForMeeting(context.adminSupabase, meetingId)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'clear_meeting_formatting') {
      await clearMeetingFormatting(meetingId)
      return NextResponse.json({ ok: true })
    }

    await clearAllGeneratedMinutes(meetingId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const normalizedError = error instanceof Error ? error : null
    if (isMinuteTemplateCompileError(error)) {
      return NextResponse.json(
        {
          ok: false,
          message: error.message,
          code: 'minute_template_compile_error',
          details: { issues: error.issues },
        },
        { status: 400 },
      )
    }
    if (
      normalizedError
      && (
        normalizedError.message === 'Previous minute format is required'
        || normalizedError.message === 'Default exact template is required'
        || normalizedError.message === 'Base format is required'
        || normalizedError.message.includes('Base format must include')
        || normalizedError.message.includes('Remove [RESOLUTION_PATH]')
        || normalizedError.message.includes('Remove {{RESOLUTION_PATH}}')
        || normalizedError.message.includes('can only contain one [RESOLUTION_PATH]')
        || normalizedError.message.includes('can only contain one {{RESOLUTION_PATH}}')
        || normalizedError.message.includes('Resolution Paths branch')
        || normalizedError.message.includes('Resolution branch templates')
        || normalizedError.message.includes('Manual RESOLVED variant override is disabled')
        || normalizedError.message === 'Invalid formatting input'
        || normalizedError.message === 'Formatting content too large. Please reduce size.'
        || normalizedError.message.includes('could not be compiled into a stable exact template')
      )
    ) {
      error = new CommitteeGenerationApiError(400, normalizedError.message)
    }
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to update meeting formatting')
    return NextResponse.json({ ok: false, message }, { status })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { agendaId } = deleteSchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)
    await assertAgendaBelongsToMeeting(context.adminSupabase, meetingId, agendaId)
    await clearAgendaFormatting(agendaId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to clear agenda formatting')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
