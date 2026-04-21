import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  normalizeAgendaColumnConfig,
  type AgendaColumnDefinition,
  type AgendaSyncPayload,
} from '@/lib/agenda-columns'
import { maybeApplyCommitteeFormattingDefaultToMeeting } from '@/lib/committee-formatting-defaults-server'
import { uuidSchema } from '@/lib/validation'
import {
  CommitteeGenerationApiError,
  requireSetupMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const agendaColumnSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['fixed', 'built_in', 'custom']),
  fieldKey: z.enum(['agendaNo', 'title', 'plannedTime', 'presenter']).optional(),
  order: z.number().int().nonnegative(),
})

const agendaSyncRowSchema = z.object({
  id: uuidSchema.nullable().optional(),
  agendaNo: z.string(),
  title: z.string(),
  plannedTime: z.string(),
  presenter: z.string(),
  attachedPdf: z.string().nullable(),
  customCells: z.record(z.string(), z.string()),
})

const agendaSyncBodySchema = z.union([
  z.object({
    columnConfig: z.array(agendaColumnSchema),
    rows: z.array(agendaSyncRowSchema),
  }),
  z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
])

function normalizeSyncPayload(payload: z.infer<typeof agendaSyncBodySchema>): AgendaSyncPayload {
  if ('columnConfig' in payload) {
    return {
      columnConfig: normalizeAgendaColumnConfig(payload.columnConfig as AgendaColumnDefinition[]),
      rows: payload.rows,
    }
  }

  throw new CommitteeGenerationApiError(
    409,
    'This agenda import format is no longer supported in the editor. Refresh and try again.',
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const rawBody = await request.json()
    const body = agendaSyncBodySchema.parse(rawBody)
    const context = await requireSetupMeetingContext(meetingId)
    const payload = normalizeSyncPayload(body)

    if (
      'columnConfig' in body
      && Array.isArray((rawBody as { rows?: unknown[] }).rows)
      && (rawBody as { rows: unknown[] }).rows.some(row =>
        typeof row === 'object'
        && row !== null
        && !Array.isArray(row)
        && !Object.prototype.hasOwnProperty.call(row, 'id'),
      )
    ) {
      throw new CommitteeGenerationApiError(
        409,
        'Agenda editor is out of date. Refresh the page and try again.',
      )
    }

    const { error: syncError } = await context.adminSupabase.rpc(
      'reconcile_meeting_agendas_for_org',
      {
        p_meeting_id: meetingId,
        p_organization_id: context.organizationId,
        p_column_config: payload.columnConfig,
        p_rows: payload.rows,
      },
    )
    if (syncError) {
      throw new Error(syncError.message)
    }

    try {
      await maybeApplyCommitteeFormattingDefaultToMeeting(
        context.adminSupabase,
        meetingId,
      )
    } catch (error) {
      console.error('[api/meeting/[id]/agenda-sync] committee formatting default apply failed:', error)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to save agenda')
    console.error('[api/meeting/[id]/agenda-sync] failed:', message)
    return NextResponse.json({ ok: false, message }, { status })
  }
}
