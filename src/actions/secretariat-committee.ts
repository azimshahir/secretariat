import { createAdminClient } from '@/lib/supabase/admin'
import { getPersonaTemplate } from '@/lib/ai/persona-templates'
import {
  buildPersonalizedCommitteePrompt,
  slugifySecretariatName,
} from '@/lib/secretariat-access'
import {
  getSecretariatCategoryForFamily,
  getSecretariatTemplate,
} from '@/lib/secretariat-templates'
import type { IndustryCategory } from '@/lib/supabase/types'

function normalizeValue(value: string) {
  return value.trim().toLowerCase()
}

export async function findOrCreateCustomCommittee(params: {
  admin: ReturnType<typeof createAdminClient>
  organizationId: string
  userId: string
  category: IndustryCategory
  committeeName: string
  promptNote: string | null
  personaPrompt?: string
  glossary?: { acronym: string; full_meaning: string }[]
}) {
  const { data: committees, error: committeesError } = await params.admin
    .from('committees')
    .select('id, slug, name')
    .eq('organization_id', params.organizationId)
  if (committeesError) throw new Error(committeesError.message)

  const normalizedName = normalizeValue(params.committeeName)
  const baseSlug = slugifySecretariatName(params.committeeName) || 'secretariat'
  const existing = (committees ?? []).find(r => normalizeValue(r.name) === normalizedName)

  if (existing) {
    return { committeeId: existing.id, committeeName: existing.name, created: false, slug: existing.slug }
  }

  const RESERVED_SLUGS = ['new']
  const existingSlugs = new Set([...RESERVED_SLUGS, ...(committees ?? []).map(r => r.slug)])
  let slug = baseSlug
  let suffix = 2
  while (existingSlugs.has(slug)) { slug = `${baseSlug}-${suffix++}`.slice(0, 64) }

  const personaPrompt = params.personaPrompt ?? buildPersonalizedCommitteePrompt({
    category: params.category, committeeName: params.committeeName.trim(), note: params.promptNote,
  })

  const { data: created, error: createError } = await params.admin.from('committees').insert({
    organization_id: params.organizationId, name: params.committeeName.trim(),
    slug, category: params.category, persona_prompt: personaPrompt, created_by: params.userId,
  }).select('id, name, slug').single()
  if (createError) throw new Error(createError.message)

  if (params.glossary && params.glossary.length > 0) {
    await params.admin.from('glossary').upsert(
      params.glossary.map(g => ({ committee_id: created.id, acronym: g.acronym, full_meaning: g.full_meaning })),
      { onConflict: 'committee_id,acronym' }
    )
  }

  return { committeeId: created.id, committeeName: created.name, created: true, slug: created.slug }
}

export async function findOrCreateCommitteeFromTemplate(params: {
  admin: ReturnType<typeof createAdminClient>
  organizationId: string
  userId: string
  templateId: string
  personaSlug?: string
}) {
  if (params.personaSlug) {
    const persona = getPersonaTemplate(params.personaSlug)
    if (!persona) throw new Error('Invalid persona template')
    return findOrCreateCustomCommittee({
      admin: params.admin, organizationId: params.organizationId, userId: params.userId,
      category: persona.category, committeeName: persona.name, promptNote: null,
      personaPrompt: persona.persona_prompt, glossary: persona.glossary,
    })
  }

  const template = getSecretariatTemplate(params.templateId)
  if (!template) throw new Error('Invalid secretariat template')

  const { data: committees, error } = await params.admin
    .from('committees').select('id, slug, name').eq('organization_id', params.organizationId)
  if (error) throw new Error(error.message)

  const slugMatches = new Set(template.matchSlugs.map(normalizeValue))
  const nameMatches = new Set(template.matchNames.map(normalizeValue))

  let committee = (committees ?? []).find(r =>
    slugMatches.has(normalizeValue(r.slug)) || nameMatches.has(normalizeValue(r.name))
  ) ?? null
  let created = false

  if (!committee) {
    const { data: c, error: e } = await params.admin.from('committees').insert({
      organization_id: params.organizationId, name: template.name, slug: template.slug,
      category: getSecretariatCategoryForFamily(template.familyId),
      persona_prompt: template.personaPrompt, created_by: params.userId,
    }).select('id, name, slug').single()
    if (e) throw new Error(e.message)
    committee = c
    created = true

    if (template.glossary.length > 0) {
      const { error: ge } = await params.admin.from('glossary').upsert(
        template.glossary.map(g => ({ committee_id: c.id, acronym: g.acronym, full_meaning: g.full_meaning })),
        { onConflict: 'committee_id,acronym' }
      )
      if (ge) throw new Error(ge.message)
    }
  }

  return { committeeId: committee.id, committeeName: committee.name, created, templateId: template.id, slug: committee.slug }
}
