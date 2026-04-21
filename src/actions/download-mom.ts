'use server'

import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { resolveLanguageModelForUserPlan } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import { extractDocxText, stripHtml } from '@/lib/docx-utils'
import {
  SubscriptionLimitError,
  consumeFeatureCredits,
  getUserEntitlementSnapshot,
} from '@/lib/subscription/entitlements'
import { getSubscriptionPlan } from '@/lib/subscription/catalog'
import {
  type MomExactDocument,
  type MomTemplateValidation,
} from '@/lib/mom-template-types'
import { uuidSchema } from '@/lib/validation'
import {
  hydrateTemplateGroups,
  isMinuteOfMeetingSectionTitle,
  TEMPLATE_SECTION_IDS,
  type LegacyItineraryTemplate,
} from '@/app/meeting/[id]/setup/settings-template-model'

export interface MomDownloadResult {
  text: string
  templateUrl: string | null
  meetingTitle: string
  formattedDate: string
  exactDocument: MomExactDocument | null
  standardAgendaItems: Array<{
    agendaNo: string
    title: string
    content: string | null
  }> | null
}

export type MomDownloadMode = 'standard' | 'best-fit'

interface FormatMomForDownloadOptions {
  extraInstruction?: string
  format?: 'docx' | 'pdf'
  mode?: MomDownloadMode
}

const exactRunSchema = z.object({
  text: z.string().trim().min(1),
  bold: z.boolean(),
})

const exactBlockSchema = z.object({
  kind: z.enum(['agenda-heading', 'section-heading', 'numbered-body', 'body', 'body-bold']),
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  runs: z.array(exactRunSchema).min(1),
})

const exactDocumentSchema = z.object({
  blocks: z.array(exactBlockSchema).min(1),
})

function deriveMeetingReference(meetingTitle: string) {
  return meetingTitle.match(/\b\d{1,2}\/\d{4}\b/)?.[0] ?? meetingTitle
}

function flattenExactDocument(document: MomExactDocument) {
  return document.blocks
    .map(block => block.runs.map(run => run.text).join(''))
    .join('\n')
    .trim()
}

function formatValidationSummary(validation: MomTemplateValidation) {
  const kinds = validation.profileSummary.paragraphKinds.join(', ') || 'none detected'
  return [
    `Status: ${validation.status}`,
    `Template mode: ${validation.profileSummary.templateMode}`,
    `Content zone detected: ${validation.profileSummary.contentZoneDetected ? 'yes' : 'no'}`,
    `Content paragraphs: ${validation.profileSummary.contentParagraphCount}`,
    `Numbered paragraphs: ${validation.profileSummary.numberingParagraphCount}`,
    `Header replaceable: ${validation.profileSummary.headerReplaceable ? 'yes' : 'no'}`,
    `Footer replaceable: ${validation.profileSummary.footerReplaceable ? 'yes' : 'no'}`,
    `Detected paragraph kinds: ${kinds}`,
    `Notes: ${validation.reasons.join(' | ')}`,
  ].join('\n')
}

export async function formatMomForDownload(
  meetingId: string,
  options?: FormatMomForDownloadOptions,
): Promise<MomDownloadResult> {
  uuidSchema.parse(meetingId)
  const format = options?.format ?? 'docx'
  const mode = options?.mode ?? 'best-fit'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, organization_id, committee_id, meeting_rules, template_section_overrides, committees(id, slug, persona_prompt)')
    .eq('id', meetingId)
    .single()
  if (!meeting) throw new Error('Meeting not found')

  const entitlement = await getUserEntitlementSnapshot({
    userId: user.id,
    organizationId: meeting.organization_id,
  })
  const plan = getSubscriptionPlan(entitlement.planTier)

  const { data: agendas } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, presenter, is_skipped, format_template_id')
    .eq('meeting_id', meetingId)
    .order('sort_order')
  if (!agendas || agendas.length === 0) throw new Error('No agendas found')

  const activeAgendas = agendas.filter(a => !a.is_skipped)
  const { data: minutes } = await supabase
    .from('minutes')
    .select('agenda_id, content')
    .in('agenda_id', activeAgendas.map(a => a.id))
    .eq('is_current', true)

  const minuteMap = new Map((minutes ?? []).map(m => [m.agenda_id, m.content]))
  const standardAgendaItems = agendas.map(agenda => ({
    agendaNo: agenda.agenda_no,
    title: agenda.title,
    content: minuteMap.get(agenda.id) ?? null,
  }))
  const combinedMinutes = activeAgendas
    .filter(a => minuteMap.has(a.id))
    .map(a => `AGENDA ${a.agenda_no}: ${a.title}\nPresenter: ${a.presenter ?? 'N/A'}\n\n${minuteMap.get(a.id)}`)
    .join('\n\n---\n\n')

  const committee = meeting.committees as unknown as {
    id: string
    slug: string
    persona_prompt: string | null
  } | null
  const persona = committee?.persona_prompt || getDefaultPersona(committee?.slug ?? 'board')

  let minuteInstruction = typeof meeting.meeting_rules === 'string' ? meeting.meeting_rules : ''
  let effectiveGroups = hydrateTemplateGroups({
    minuteInstruction,
    persistedGroups: Array.isArray(meeting.template_section_overrides) ? meeting.template_section_overrides : [],
  })

  if (committee?.id) {
    const [{ data: settings }, { data: itineraryTemplates }] = await Promise.all([
      supabase
        .from('committee_generation_settings')
        .select('minute_instruction, template_sections')
        .eq('committee_id', committee.id)
        .maybeSingle(),
      supabase
        .from('itinerary_templates')
        .select('section_key, storage_path, file_name')
        .eq('committee_id', committee.id),
    ])

    minuteInstruction = minuteInstruction.trim() || (settings?.minute_instruction ?? '')
    effectiveGroups = hydrateTemplateGroups({
      minuteInstruction,
      itineraryTemplates: (itineraryTemplates ?? []) as LegacyItineraryTemplate[],
      persistedGroups: Array.isArray(meeting.template_section_overrides) && meeting.template_section_overrides.length > 0
        ? meeting.template_section_overrides
        : settings?.template_sections ?? [],
    })
  }

  const minuteSection = effectiveGroups
    .flatMap(group => group.sections)
    .find(section => section.id === TEMPLATE_SECTION_IDS.minuteOfMeeting || isMinuteOfMeetingSectionTitle(section.title))

  minuteInstruction = minuteInstruction.trim() || (minuteSection?.prompt ?? '')

  let templateUrl: string | null = null
  let templateText = ''
  const hasDocxMomTemplate = Boolean(
    minuteSection?.templateStoragePath && minuteSection.templateStoragePath.toLowerCase().endsWith('.docx'),
  )
  const currentValidation = minuteSection?.momTemplateValidation ?? null
  if (minuteSection?.templateStoragePath) {
    const { data: fileData } = await supabase.storage
      .from('meeting-files')
      .download(minuteSection.templateStoragePath)
    if (fileData && hasDocxMomTemplate) {
      const buffer = await fileData.arrayBuffer()
      templateText = await extractDocxText(buffer)
    }

    const { data: signedUrlData } = await supabase.storage
      .from('meeting-files')
      .createSignedUrl(minuteSection.templateStoragePath, 3600)
    templateUrl = signedUrlData?.signedUrl ?? null
  }

  const formattedDate = new Date(meeting.meeting_date).toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  if (format === 'docx' && mode === 'standard') {
    return {
      text: '',
      templateUrl: null,
      meetingTitle: meeting.title,
      formattedDate,
      exactDocument: null,
      standardAgendaItems,
    }
  }

  if (!combinedMinutes.trim()) throw new Error('No minutes content to format')

  const model = await resolveLanguageModelForUserPlan(
    meeting.organization_id,
    entitlement.planTier,
    'generate_mom',
  )
  const extraInstruction = options?.extraInstruction?.trim()
  const useBestFitTemplate = mode === 'best-fit'
  const templateRefBlock = useBestFitTemplate && templateText
    ? `PREVIOUS MoM TEMPLATE (copy this format and structure very closely):
---
${templateText}
---

`
    : ''

  if (useBestFitTemplate && !hasDocxMomTemplate) {
    throw new Error('Best fit to attached MoM requires a DOCX Minute of Meeting template in Settings > Itineraries')
  }

  const bestFitCreditCost = useBestFitTemplate ? plan.bestFitCreditsPerRun : null
  if (useBestFitTemplate && !entitlement.subscriptionSetupPending) {
    if (bestFitCreditCost == null) {
      throw new SubscriptionLimitError(
        'Best fit to attached MoM is not available on your current plan.',
        'best_fit_not_allowed',
      )
    }
    if (bestFitCreditCost > entitlement.totalCreditsRemaining) {
      throw new SubscriptionLimitError(
        'You do not have enough credits left for Best fit to attached MoM. Ask your admin to top up credits or change your plan.',
        'best_fit_insufficient_credits',
      )
    }
  }

  if (
    format === 'docx'
    && useBestFitTemplate
    && hasDocxMomTemplate
  ) {
    try {
      const validationSummary = currentValidation
        ? `TEMPLATE VALIDATION SUMMARY:
${formatValidationSummary(currentValidation)}

`
        : ''
      const exactDocument = await generateObject({
        model,
        system: persona,
        schema: exactDocumentSchema,
        prompt: `You are producing the final Minute of Meeting content for an EXACT DOCX template renderer.

MEETING: ${meeting.title}
DATE: ${formattedDate}
MEETING REFERENCE: ${deriveMeetingReference(meeting.title)}

${validationSummary}${templateRefBlock}${minuteInstruction ? `SECRETARIAT INSTRUCTIONS:\n${minuteInstruction}\n\n` : ''}${extraInstruction ? `ADDITIONAL USER INSTRUCTIONS:\n${extraInstruction}\n\n` : ''}NEW MINUTE CONTENT:
---
${combinedMinutes}
---

Return structured JSON only via the schema.

RENDERING RULES:
- Recreate the template's paragraph sequence as closely as possible.
- Use kind="agenda-heading" for agenda titles like "4.1 Root Cause Analysis..."
- Use kind="section-heading" for short bold labels such as "NOTED & DISCUSSED", "RESOLVED", or equivalent section titles.
- Use kind="numbered-body" for numbered list items that should continue Word numbering.
- Use kind="body" for normal discussion paragraphs.
- Use kind="body-bold" for standalone bold paragraphs that are not section labels.
- Use level 0 for main numbered items, 1 for sub-items, 2 for deeper sub-items.
- Use runs[] to preserve inline bold phrases where needed.
- Never collapse or summarize the minute content.
        - Preserve decisions, action items, PICs, and due dates exactly.
        - Do not include attendee lists, signatures, prepared-by blocks, or cover-page metadata.
        - Start directly from the first agenda content block.`,
      })

      if (!entitlement.subscriptionSetupPending && bestFitCreditCost != null) {
        await consumeFeatureCredits({
          userId: user.id,
          organizationId: meeting.organization_id,
          meetingId: meeting.id,
          entryKind: 'best_fit_mom',
          creditCost: bestFitCreditCost,
          usageField: 'best_fit_mom_runs',
          reason: 'Best fit to attached MoM run consumed credits',
          metadata: {
            format,
          },
        })
      }

      return {
        text: flattenExactDocument(exactDocument.object),
        templateUrl,
        meetingTitle: meeting.title,
        formattedDate,
        exactDocument: exactDocument.object,
        standardAgendaItems,
      }
    } catch (error) {
      console.error('[download-mom] exact structured generation failed, falling back to text mode:', error)
    }
  }

  let formatPromptBlock = ''
  if (!templateText && mode !== 'standard') {
    const templateIds = [...new Set(agendas.map(a => a.format_template_id).filter(Boolean))] as string[]
    if (templateIds.length > 0) {
      const { data: templates } = await supabase
        .from('format_templates').select('prompt_text').in('id', templateIds).limit(1)
      const prompt = templates?.[0]?.prompt_text ?? ''
      if (prompt) formatPromptBlock = `FORMAT INSTRUCTIONS:\n---\n${stripHtml(prompt)}\n---\n\n`
    }
  }

  const textPrompt = mode === 'best-fit'
    ? `You are producing the final Minute of Meeting document.

MEETING: ${meeting.title}
DATE: ${formattedDate}

${templateRefBlock}${formatPromptBlock}${minuteInstruction ? `SECRETARIAT INSTRUCTIONS:\n${minuteInstruction}\n\n` : ''}${extraInstruction ? `ADDITIONAL USER INSTRUCTIONS:\n${extraInstruction}\n\n` : ''}NEW MINUTE CONTENT (from each agenda, already generated):
---
${combinedMinutes}
---

TASK:
You have a PREVIOUS MoM TEMPLATE above. You MUST:
- Copy the same writing style, phrasing patterns, numbering style, and language
- Use the same section structure and formality level
- Preserve ALL content from the new minutes — do not summarize or remove anything

CRITICAL: Output ONLY the minute content (agenda discussions, resolutions, action items).
Do NOT include meeting title, date, attendee lists, signatures, or prepared-by sections.
Start directly with the first agenda item content.

FORMATTING: Wrap lines that should appear BOLD with **double asterisks**.

Return ONLY the formatted document text, ready for export.`
    : `You are producing the final Minute of Meeting document for a STANDARD exporter.

MEETING: ${meeting.title}
DATE: ${formattedDate}

${minuteInstruction ? `SECRETARIAT INSTRUCTIONS:\n${minuteInstruction}\n\n` : ''}${extraInstruction ? `ADDITIONAL USER INSTRUCTIONS:\n${extraInstruction}\n\n` : ''}NEW MINUTE CONTENT (from each agenda, already generated):
---
${combinedMinutes}
---

TASK:
- Combine all the individual agenda minutes into ONE cohesive Minute of Meeting document.
- Maintain the Noted/Discussed/Action Items structure for each agenda
- Use formal third-person corporate language
- Include all agenda numbers, titles, and presenters
- Preserve all decisions, action items, PICs, and due dates exactly as stated
- Do NOT remove, change, or summarize any content
- Start directly with the first agenda item. Do NOT add meeting title, date, attendee lists, signatures, or prepared-by sections because the exporter handles the document header.
- Use clear textual numbering for follow-up points when useful, such as "1.", "a)", and "i.".
- Wrap lines that should appear BOLD with **double asterisks**.

Return ONLY the formatted document text, ready for export.`

  const result = await generateText({
    model,
    system: persona,
    prompt: textPrompt,
  })

  if (!entitlement.subscriptionSetupPending && useBestFitTemplate && bestFitCreditCost != null) {
    await consumeFeatureCredits({
      userId: user.id,
      organizationId: meeting.organization_id,
      meetingId: meeting.id,
      entryKind: 'best_fit_mom',
      creditCost: bestFitCreditCost,
      usageField: 'best_fit_mom_runs',
      reason: 'Best fit to attached MoM run consumed credits',
      metadata: {
        format,
      },
    })
  }

  return {
    text: result.text,
    templateUrl: mode === 'best-fit' ? templateUrl : null,
    meetingTitle: meeting.title,
    formattedDate,
    exactDocument: null,
    standardAgendaItems,
  }
}
