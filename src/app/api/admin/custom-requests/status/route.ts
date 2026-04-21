import { NextResponse } from 'next/server'
import type { CustomIndustryRequestStatus } from '@/lib/supabase/types'
import { requireAdminOrgContext, serializeAdminApiError } from '../../_lib/write-access'

const VALID_STATUSES: CustomIndustryRequestStatus[] = [
  'pending',
  'reviewed',
  'template_created',
  'dismissed',
]

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string
      status?: CustomIndustryRequestStatus
      notes?: string
    }
    const context = await requireAdminOrgContext()

    const id = String(body.id ?? '').trim()
    const notes = String(body.notes ?? '').trim()
    if (!id) {
      return NextResponse.json(
        { ok: false, message: 'Request id is required' },
        { status: 400 },
      )
    }
    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { ok: false, message: 'Invalid request status' },
        { status: 400 },
      )
    }

    const { error } = await context.adminSupabase
      .from('custom_industry_requests')
      .update({
        status: body.status,
        admin_notes: notes || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('organization_id', context.organizationId)

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, message, code } = serializeAdminApiError(
      error,
      'Failed to update custom request',
    )
    return NextResponse.json({ ok: false, message, code }, { status })
  }
}
