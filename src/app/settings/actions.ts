'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { buildStoredMinuteTemplateData } from '@/lib/meeting-generation/minute-template'
import { committeeSchema, formatTemplateSchema, glossarySchema, uuidSchema } from '@/lib/validation'

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

export async function saveCommittee(formData: FormData) {
  const { supabase, userId, organizationId } = await requireUserOrg()
  const parsed = committeeSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    personaPrompt: formData.get('personaPrompt') ? String(formData.get('personaPrompt')) : null,
  })
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid committee input')

  const id = formData.get('id') ? uuidSchema.parse(formData.get('id')) : null
  const payload = {
    organization_id: organizationId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    persona_prompt: parsed.data.personaPrompt || null,
  }
  if (id) {
    await supabase.from('committees').update(payload).eq('id', id)
  } else {
    const { data: createdCommittee, error: createError } = await supabase
      .from('committees')
      .insert({ ...payload, created_by: userId })
      .select('id')
      .single()

    if (createError) throw new Error(createError.message)

    await supabase.from('committee_memberships').upsert(
      {
        committee_id: createdCommittee.id,
        user_id: userId,
        role: 'operator',
        created_by: userId,
      },
      { onConflict: 'committee_id,user_id' }
    )
  }

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: id ? 'committee_updated' : 'committee_created',
    details: { committee_slug: parsed.data.slug },
  })

  revalidatePath('/settings')
  revalidatePath('/')
}

export async function saveFormatTemplate(formData: FormData) {
  const { supabase, userId, organizationId } = await requireUserOrg()
  const parsed = formatTemplateSchema.safeParse({
    committeeId: formData.get('committeeId'),
    name: formData.get('name'),
    promptText: formData.get('promptText'),
  })
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid format template')
  const compiledTemplate = buildStoredMinuteTemplateData(parsed.data.promptText)

  await supabase.from('format_templates').insert({
    committee_id: parsed.data.committeeId,
    name: parsed.data.name,
    prompt_text: parsed.data.promptText,
    compiled_template_json: compiledTemplate.compiledTemplateJson,
    compiled_template_version: compiledTemplate.compiledTemplateVersion,
    compiled_template_hash: compiledTemplate.compiledTemplateHash,
  })

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'format_template_created',
    details: { committee_id: parsed.data.committeeId, name: parsed.data.name },
  })

  revalidatePath('/settings')
}

export async function updateProfile(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const fullName = String(formData.get('fullName') ?? '').trim()
  if (fullName.length < 2 || fullName.length > 120) throw new Error('Name must be 2-120 characters')

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName })
    .eq('id', user.id)
  if (error) throw new Error('Failed to update profile')

  const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single()
  if (profile) {
    await supabase.from('audit_logs').insert({
      organization_id: profile.organization_id,
      user_id: user.id,
      action: 'profile_updated',
      details: { field: 'full_name' },
    })
  }

  revalidatePath('/settings')
}

export async function updateEmail(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const email = String(formData.get('email') ?? '').trim()
  if (!email || !email.includes('@')) throw new Error('Invalid email')

  const { error } = await supabase.auth.updateUser({ email })
  if (error) throw new Error(error.message)
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  if (password.length < 6) throw new Error('Password must be at least 6 characters')
  if (password !== confirm) throw new Error('Passwords do not match')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(error.message)
}

export async function saveGlossaryTerm(formData: FormData) {
  const { supabase, userId, organizationId } = await requireUserOrg()
  const parsed = glossarySchema.safeParse({
    committeeId: formData.get('committeeId'),
    acronym: formData.get('acronym'),
    fullMeaning: formData.get('fullMeaning'),
  })
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid glossary term')

  await supabase.from('glossary').upsert({
    committee_id: parsed.data.committeeId,
    acronym: parsed.data.acronym,
    full_meaning: parsed.data.fullMeaning,
  }, { onConflict: 'committee_id,acronym' })

  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'glossary_updated',
    details: { committee_id: parsed.data.committeeId, acronym: parsed.data.acronym },
  })

  revalidatePath('/settings')
}
