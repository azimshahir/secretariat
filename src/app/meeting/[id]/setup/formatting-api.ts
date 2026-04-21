'use client'

import { deleteJson, getJson, postJson } from '@/lib/api/client'
import type { AgendaFormattingState, SavedAgendaFormatting } from './format-types'
import type { MinutePlaybookMode, MinutePlaybookVariantKey } from '@/lib/meeting-generation/minute-playbooks'

export async function getAgendaFormattingStateRequest(meetingId: string, agendaId: string) {
  const params = new URLSearchParams({ agendaId })
  const result = await getJson<{ ok: true; formatting: AgendaFormattingState }>(
    `/api/meeting/${meetingId}/formatting?${params.toString()}`,
  )
  return result.formatting
}

export async function saveAgendaFormattingRequest(
  meetingId: string,
  payload: {
    agendaId: string
    committeeId: string
    name: string
    playbookMode: MinutePlaybookMode
    resolutionPathsEnabled: boolean
    variants: Array<{
      variantKey: MinutePlaybookVariantKey
      promptText: string
    }>
    additionalInfo?: string
    saveAsCommitteePlaybook?: boolean
  },
) {
  const result = await postJson<{ ok: true; formatting: SavedAgendaFormatting }>(
    `/api/meeting/${meetingId}/formatting`,
    {
      action: 'save_agenda_format',
      ...payload,
    },
  )
  return result.formatting
}

export async function clearAgendaFormattingRequest(meetingId: string, agendaId: string) {
  await deleteJson<{ ok: true }>(`/api/meeting/${meetingId}/formatting`, { agendaId })
}

export async function applyFormatToSubItemsRequest(
  meetingId: string,
  payload: {
    sourceAgendaId: string
  },
  subItemIds: string[],
) {
  const result = await postJson<{ ok: true; autoSavedCommitteeDefault: boolean }>(`/api/meeting/${meetingId}/formatting`, {
    action: 'apply_to_subitems',
    ...payload,
    subItemIds,
  })
  return {
    autoSavedCommitteeDefault: result.autoSavedCommitteeDefault,
  }
}

export async function attachAgendaPlaybookRequest(
  meetingId: string,
  agendaId: string,
  playbookId: string,
) {
  const result = await postJson<{ ok: true; formatting: SavedAgendaFormatting }>(
    `/api/meeting/${meetingId}/formatting`,
    {
      action: 'attach_playbook',
      agendaId,
      playbookId,
    },
  )
  return result.formatting
}

export async function updateAgendaVariantOverrideRequest(
  meetingId: string,
  agendaId: string,
  variantOverrideId: string | null,
) {
  const result = await postJson<{ ok: true; formatting: SavedAgendaFormatting }>(
    `/api/meeting/${meetingId}/formatting`,
    {
      action: 'update_variant_override',
      agendaId,
      variantOverrideId,
    },
  )
  return result.formatting
}

export async function updateAgendaSkippedRequest(
  meetingId: string,
  agendaId: string,
  isSkipped: boolean,
) {
  await postJson<{ ok: true }>(`/api/meeting/${meetingId}/formatting`, {
    action: 'update_skipped',
    agendaId,
    isSkipped,
  })
}

export async function bulkSaveSkippedRequest(
  meetingId: string,
  skippedIds: string[],
) {
  await postJson<{ ok: true }>(`/api/meeting/${meetingId}/formatting`, {
    action: 'bulk_save_skipped',
    skippedIds,
  })
}

export async function saveCommitteeFormattingDefaultRequest(meetingId: string) {
  await postJson<{ ok: true }>(`/api/meeting/${meetingId}/formatting`, {
    action: 'save_committee_default',
  })
}

export async function clearMeetingFormattingRequest(meetingId: string) {
  await postJson<{ ok: true }>(`/api/meeting/${meetingId}/formatting`, {
    action: 'clear_meeting_formatting',
  })
}

export async function clearAllGeneratedMinutesRequest(meetingId: string) {
  await postJson<{ ok: true }>(`/api/meeting/${meetingId}/formatting`, {
    action: 'clear_all_generated_minutes',
  })
}
