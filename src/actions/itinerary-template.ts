'use server'

import { createClient } from '@/lib/supabase/server'
import { TEMPLATE_SECTION_IDS } from '@/app/meeting/[id]/setup/settings-template-model'

const MISSING_ITINERARY_TABLE_HINT = 'Database migration missing: public.itinerary_templates'

function isMissingItineraryTemplatesTableError(
  error: { code?: string | null; message?: string | null } | null | undefined,
) {
  if (!error) return false
  if (error.code === 'PGRST205') return true
  const message = (error.message ?? '').toLowerCase()
  return message.includes('itinerary_templates') && message.includes('schema cache')
}

function toSectionKey(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, '-')
}

export async function uploadItineraryTemplate(
  committeeId: string,
  sectionTitle: string,
  file: File,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Fail fast before storage writes when migration is missing.
  const { error: preflightError } = await supabase
    .from('itinerary_templates')
    .select('id')
    .limit(1)
  if (preflightError) {
    if (isMissingItineraryTemplatesTableError(preflightError)) {
      throw new Error(MISSING_ITINERARY_TABLE_HINT)
    }
    throw new Error(preflightError.message)
  }

  const sectionKey = toSectionKey(sectionTitle)
  const ext = file.name.split('.').pop()?.trim().toLowerCase() ?? 'docx'
  if (sectionKey === TEMPLATE_SECTION_IDS.extractMinute && ext !== 'docx') {
    throw new Error('Extract Minute requires a DOCX template')
  }
  const path = `committee-templates/${committeeId}/${sectionKey}.${ext}`

  // Upload (upsert) to storage
  const { error: uploadError } = await supabase.storage
    .from('meeting-files')
    .upload(path, file, { upsert: true })
  if (uploadError) throw new Error(uploadError.message)

  // Upsert DB row
  const { error: dbError } = await supabase
    .from('itinerary_templates')
    .upsert(
      {
        committee_id: committeeId,
        section_key: sectionKey,
        storage_path: path,
        file_name: file.name,
      },
      { onConflict: 'committee_id,section_key' },
    )
  if (dbError) {
    if (isMissingItineraryTemplatesTableError(dbError)) {
      throw new Error(MISSING_ITINERARY_TABLE_HINT)
    }
    throw new Error(dbError.message)
  }

  return { storagePath: path }
}

export async function getItineraryTemplates(committeeId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('itinerary_templates')
    .select('section_key, storage_path, file_name')
    .eq('committee_id', committeeId)
  if (error) {
    if (isMissingItineraryTemplatesTableError(error)) {
      return []
    }
    throw new Error(error.message)
  }
  return data ?? []
}

export async function getTemplateSignedUrl(storagePath: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('meeting-files')
    .createSignedUrl(storagePath, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}
