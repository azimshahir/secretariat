import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  createMinuteMindEntry,
  deleteMinuteMindEntry,
  listMinuteMindEntriesForScope,
  updateMinuteMindEntry,
} from '@/lib/meeting-generation/minute-mind'
import { minuteMindEntrySchema, uuidSchema } from '@/lib/validation'

const updateSchema = minuteMindEntrySchema.extend({
  entryId: uuidSchema,
})

const deleteSchema = z.object({
  entryId: uuidSchema,
})

async function requireUserOrg() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profile not found')
  return { supabase, userId: user.id, organizationId: profile.organization_id }
}

export async function GET(request: Request) {
  try {
    const { supabase, organizationId } = await requireUserOrg()
    const committeeId = uuidSchema.parse(new URL(request.url).searchParams.get('committeeId'))
    const entries = await listMinuteMindEntriesForScope({
      supabase: supabase as never,
      organizationId,
      committeeId,
    })

    return NextResponse.json({
      ok: true,
      entries: entries.filter(entry => entry.scopeType === 'committee'),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to load backend memory entries',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId, organizationId } = await requireUserOrg()
    const committeeId = uuidSchema.parse(new URL(request.url).searchParams.get('committeeId'))
    const parsed = minuteMindEntrySchema.parse(await request.json())
    const entry = await createMinuteMindEntry({
      supabase: supabase as never,
      organizationId,
      committeeId,
      scopeType: 'committee',
      source: 'settings',
      entryType: parsed.entryType,
      title: parsed.title,
      content: parsed.content,
      appliesToGeneration: parsed.appliesToGeneration,
      appliesToChat: parsed.appliesToChat,
      isActive: parsed.isActive,
      createdBy: userId,
    })

    return NextResponse.json({ ok: true, entry })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to save backend memory entry',
      },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase } = await requireUserOrg()
    const parsed = updateSchema.parse(await request.json())
    const entry = await updateMinuteMindEntry({
      supabase: supabase as never,
      entryId: parsed.entryId,
      title: parsed.title,
      content: parsed.content,
      entryType: parsed.entryType,
      appliesToGeneration: parsed.appliesToGeneration,
      appliesToChat: parsed.appliesToChat,
      isActive: parsed.isActive,
    })

    return NextResponse.json({ ok: true, entry })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to update backend memory entry',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase } = await requireUserOrg()
    const { entryId } = deleteSchema.parse(await request.json())
    await deleteMinuteMindEntry({
      supabase: supabase as never,
      entryId,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to delete backend memory entry',
      },
      { status: 500 },
    )
  }
}
