'use server'

import type { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { analyzeAgendaSegmentationWithClient, confirmAgendaSegmentationWithClient } from '@/lib/meeting-generation/agenda-segmentation'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import type {
  ConfirmSegmentationResult,
  SegmentationPreviewResult,
  SegmentationPreviewRow,
} from '@/lib/meeting-generation/types'
import {
  analyzeAgendaSegmentationOptionsSchema,
  confirmAgendaSegmentationInputSchema,
} from '@/lib/validation'

export type { SegmentationPreviewRow, SegmentationPreviewResult, ConfirmSegmentationResult }

async function requireOrganizationContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profile not found')

  return {
    supabase: supabase as unknown as DatabaseClient,
    organizationId: profile.organization_id,
  }
}

export async function analyzeAgendaSegmentation(
  meetingId: string,
  options: z.infer<typeof analyzeAgendaSegmentationOptionsSchema>,
): Promise<SegmentationPreviewResult> {
  const { supabase, organizationId } = await requireOrganizationContext()
  return await analyzeAgendaSegmentationWithClient({
    supabase,
    meetingId,
    organizationId,
    options,
  })
}

export async function confirmAgendaSegmentation(
  input: z.infer<typeof confirmAgendaSegmentationInputSchema>,
): Promise<ConfirmSegmentationResult> {
  const { supabase, organizationId } = await requireOrganizationContext()
  return await confirmAgendaSegmentationWithClient({
    supabase,
    meetingId: input.meetingId,
    organizationId,
    input,
  })
}
