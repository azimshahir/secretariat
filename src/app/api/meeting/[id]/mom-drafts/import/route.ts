import { NextResponse } from 'next/server'
import { z } from 'zod'
import { importMomDraftBatchWithClient } from '@/lib/meeting-generation/mom-drafts'
import { uuidSchema } from '@/lib/validation'
import {
  requireWritableMeetingContext,
  serializeCommitteeGenerationApiError,
} from '../../../../committee-generation/_lib/write-access'

export const runtime = 'nodejs'

const bodySchema = z.object({
  batchId: uuidSchema,
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const meetingId = uuidSchema.parse(id)
    const { batchId } = bodySchema.parse(await request.json())
    const context = await requireWritableMeetingContext(meetingId)

    const result = await importMomDraftBatchWithClient({
      supabase: context.adminSupabase,
      meetingId,
      batchId,
      userId: context.userId,
      organizationId: context.organizationId,
    })

    return NextResponse.json({
      ok: true,
      importedCount: result.importedCount,
      importedAgendaIds: result.importedAgendaIds,
    })
  } catch (error) {
    const { status, message } = serializeCommitteeGenerationApiError(error, 'Failed to import MoM drafts')
    return NextResponse.json({ ok: false, message }, { status })
  }
}
