'use server'

import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { uuidSchema } from '@/lib/validation'

export interface CommitteeSpeaker {
  id: string
  committee_id: string
  speaker_name: string
  position: string
  sort_order: number
}

export async function getCommitteeSpeakers(committeeId: string): Promise<CommitteeSpeaker[]> {
  uuidSchema.parse(committeeId)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('committee_speakers')
    .select('id, committee_id, speaker_name, position, sort_order')
    .eq('committee_id', committeeId)
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function upsertCommitteeSpeaker(
  committeeId: string,
  speakerName: string,
  position: string,
) {
  uuidSchema.parse(committeeId)
  if (!speakerName.trim()) throw new Error('Speaker name is required')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Get next sort_order for new entries
  const { data: existing } = await supabase
    .from('committee_speakers')
    .select('id, sort_order')
    .eq('committee_id', committeeId)
    .eq('speaker_name', speakerName.trim())
    .maybeSingle()

  const sortOrder = existing?.sort_order ?? await getNextSortOrder(supabase, committeeId)

  const { data, error } = await supabase
    .from('committee_speakers')
    .upsert(
      {
        committee_id: committeeId,
        speaker_name: speakerName.trim(),
        position: position.trim(),
        sort_order: sortOrder,
      },
      { onConflict: 'committee_id,speaker_name' },
    )
    .select('id, committee_id, speaker_name, position, sort_order')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function deleteCommitteeSpeaker(speakerId: string) {
  uuidSchema.parse(speakerId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { error } = await supabase
    .from('committee_speakers')
    .delete()
    .eq('id', speakerId)
  if (error) throw new Error(error.message)
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export async function importSpeakersFromExcel(committeeId: string, file: File) {
  uuidSchema.parse(committeeId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  let importedCount = 0
  let nextSort = await getNextSortOrder(supabase, committeeId)

  for (const row of rows) {
    const entries = Object.entries(row)
    const findValue = (...keywords: string[]) => {
      for (const [key, value] of entries) {
        const k = normalizeHeader(key)
        if (keywords.some(kw => k.includes(kw))) return String(value ?? '').trim()
      }
      return ''
    }

    const name = findValue('speaker', 'name', 'nama')
    const pos = findValue('position', 'role', 'jawatan', 'title')
    if (!name) continue

    const { error } = await supabase
      .from('committee_speakers')
      .upsert(
        { committee_id: committeeId, speaker_name: name, position: pos, sort_order: nextSort },
        { onConflict: 'committee_id,speaker_name' },
      )
    if (error) throw new Error(error.message)
    importedCount++
    nextSort++
  }

  if (importedCount === 0) throw new Error('No speaker rows found. Ensure columns include Speaker/Name and Position/Role.')
  return { importedCount }
}

async function getNextSortOrder(supabase: Awaited<ReturnType<typeof createClient>>, committeeId: string) {
  const { data } = await supabase
    .from('committee_speakers')
    .select('sort_order')
    .eq('committee_id', committeeId)
    .order('sort_order', { ascending: false })
    .limit(1)
  return (data?.[0]?.sort_order ?? -1) + 1
}
