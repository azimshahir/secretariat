'use server'

import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function detectIndustry(customName: string) {
  const { text } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    prompt: `Classify this organization/industry into exactly one of these categories: Banking, Construction & Property, Oil & Gas, NGOs & Foundations, Others.

Input: "${customName.trim()}"

Reply with ONLY the category name, nothing else.`,
  })

  const result = text.trim()
  const valid = [
    'Banking',
    'Construction & Property',
    'Oil & Gas',
    'NGOs & Foundations',
    'Others',
  ]
  return valid.includes(result) ? result : 'Others'
}

export async function suggestMeetingTypes(industry: string) {
  const { text } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    prompt: `For the "${industry}" industry, suggest 5-8 common corporate committee/meeting types that would need a company secretary.

Return a JSON array of objects with "name" and "description" fields. Example:
[{"name": "Board of Directors", "description": "Main board governance meetings"}]

Return ONLY the JSON array.`,
  })

  try {
    return JSON.parse(text.trim()) as { name: string; description: string }[]
  } catch {
    return []
  }
}

export async function logCustomIndustryRequest(params: {
  customIndustry?: string
  detectedIndustry?: string
  customMeetingType?: string
  suggestedMeetingTypes?: string[]
  selectedIndustry?: string
  selectedMeetingType?: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  await admin.from('custom_industry_requests').insert({
    organization_id: profile.organization_id,
    user_id: user.id,
    custom_industry: params.customIndustry ?? null,
    detected_industry: params.detectedIndustry ?? null,
    custom_meeting_type: params.customMeetingType ?? null,
    suggested_meeting_types: params.suggestedMeetingTypes ?? null,
    selected_industry: params.selectedIndustry ?? null,
    selected_meeting_type: params.selectedMeetingType ?? null,
    status: 'pending',
  })
}
