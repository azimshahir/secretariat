'use server'

import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { maybeApplyCommitteeFormattingDefaultToMeeting } from '@/lib/committee-formatting-defaults-server'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import { uuidSchema } from '@/lib/validation'
import { uploadFileToStorage } from './shared'
import { assertFileSize } from './validation'

export async function parseAgendaExcel(meetingId: string, file: File) {
  uuidSchema.parse(meetingId)
  assertFileSize(file)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const workbook = XLSX.read(await file.arrayBuffer())
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet)
  const agendas = rows.map((row, i) => ({
    meeting_id: meetingId,
    agenda_no: String(row['Agenda No'] || row['No'] || row['no'] || i + 1),
    title: String(row['Title'] || row['Agenda Title'] || row['title'] || row['Agenda'] || ''),
    presenter: row['Presenter'] || row['presenter'] || row['Presenter Name'] || null,
    sort_order: i,
  })).filter(a => a.title.trim() !== '')

  if (agendas.length === 0) throw new Error('No valid agendas found in Excel file')
  await supabase.from('agendas').delete().eq('meeting_id', meetingId)
  const { error } = await supabase.from('agendas').insert(agendas)
  if (error) throw new Error(error.message)

  try {
    await maybeApplyCommitteeFormattingDefaultToMeeting(
      supabase as unknown as DatabaseClient,
      meetingId,
    )
  } catch (error) {
    console.error('[parseAgendaExcel] committee formatting default apply failed:', error)
  }

  await uploadFileToStorage(meetingId, file, 'agenda_excel')
  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  if (profile) {
    await supabase.from('audit_logs').insert({
      organization_id: profile.organization_id,
      meeting_id: meetingId,
      user_id: user.id,
      action: 'agenda_uploaded',
      details: { agenda_count: agendas.length, file_name: file.name },
    })
  }
  return agendas.length
}
