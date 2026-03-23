'use server'

import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { resolveLanguageModelForOrganization } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import { extractDocxText, stripHtml } from '@/lib/docx-utils'
import { uuidSchema } from '@/lib/validation'

export interface MomDownloadResult {
  text: string
  templateUrl: string | null
  meetingTitle: string
  formattedDate: string
}

export async function formatMomForDownload(meetingId: string, extraInstruction?: string): Promise<MomDownloadResult> {
  uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: meeting } = await supabase
    .from('meetings')
    .select('id, title, meeting_date, organization_id, committee_id, committees(id, slug, persona_prompt)')
    .eq('id', meetingId)
    .single()
  if (!meeting) throw new Error('Meeting not found')

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
  const combinedMinutes = activeAgendas
    .filter(a => minuteMap.has(a.id))
    .map(a => `AGENDA ${a.agenda_no}: ${a.title}\nPresenter: ${a.presenter ?? 'N/A'}\n\n${minuteMap.get(a.id)}`)
    .join('\n\n---\n\n')

  if (!combinedMinutes.trim()) throw new Error('No minutes content to format')

  const committee = meeting.committees as unknown as {
    id: string; slug: string; persona_prompt: string | null
  } | null
  const persona = committee?.persona_prompt || getDefaultPersona(committee?.slug ?? 'board')

  let minuteInstruction = ''
  if (committee?.id) {
    const { data: settings } = await supabase
      .from('committee_generation_settings')
      .select('minute_instruction')
      .eq('committee_id', committee.id)
      .maybeSingle()
    minuteInstruction = settings?.minute_instruction ?? ''
  }

  // Check for uploaded MoM DOCX template — extract text + get signed URL
  let templateUrl: string | null = null
  let templateText = ''
  if (committee?.id) {
    const { data: momTemplate } = await supabase
      .from('itinerary_templates')
      .select('storage_path')
      .eq('committee_id', committee.id)
      .eq('section_key', 'minute-of-meeting')
      .maybeSingle()

    if (momTemplate?.storage_path) {
      // Download template and extract text for LLM reference
      const { data: fileData } = await supabase.storage
        .from('meeting-files')
        .download(momTemplate.storage_path)
      if (fileData) {
        const buffer = await fileData.arrayBuffer()
        templateText = await extractDocxText(buffer)
      }

      // Also get signed URL for client-side DOCX injection
      const { data: signedUrlData } = await supabase.storage
        .from('meeting-files')
        .createSignedUrl(momTemplate.storage_path, 3600)
      templateUrl = signedUrlData?.signedUrl ?? null
    }
  }

  const formattedDate = new Date(meeting.meeting_date).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  // Build LLM prompt — if template text exists, include it as reference
  const templateRefBlock = templateText
    ? `PREVIOUS MoM TEMPLATE (copy this format, structure, and writing style EXACTLY):
---
${templateText}
---

`
    : ''

  let formatPromptBlock = ''
  if (!templateText) {
    const templateIds = [...new Set(agendas.map(a => a.format_template_id).filter(Boolean))] as string[]
    if (templateIds.length > 0) {
      const { data: templates } = await supabase
        .from('format_templates').select('prompt_text').in('id', templateIds).limit(1)
      const prompt = templates?.[0]?.prompt_text ?? ''
      if (prompt) formatPromptBlock = `FORMAT INSTRUCTIONS:\n---\n${stripHtml(prompt)}\n---\n\n`
    }
  }

  const model = await resolveLanguageModelForOrganization(meeting.organization_id, 'generate_mom')

  const result = await generateText({
    model,
    system: persona,
    prompt: `You are producing the final Minute of Meeting document.

MEETING: ${meeting.title}
DATE: ${formattedDate}

${templateRefBlock}${formatPromptBlock}${minuteInstruction ? `SECRETARIAT INSTRUCTIONS:\n${minuteInstruction}\n\n` : ''}${extraInstruction?.trim() ? `ADDITIONAL USER INSTRUCTIONS:\n${extraInstruction.trim()}\n\n` : ''}NEW MINUTE CONTENT (from each agenda, already generated):
---
${combinedMinutes}
---

TASK:
${templateText
  ? `You have a PREVIOUS MoM TEMPLATE above. You MUST:
- Copy the EXACT same writing style, phrasing patterns, numbering style, and language
- Use the same section structure and formality level
- The output must read as if the same secretary wrote both documents
- Preserve ALL content from the new minutes — do not summarize or remove anything

CRITICAL: Output ONLY the minute content (agenda discussions, resolutions, action items).
Do NOT include ANY of these — they are already in the template and will be preserved automatically:
- Meeting title, date, time, venue
- "CONFIDENTIAL", bank/company name
- Attendee lists (PRESENT, IN ATTENDANCE, ABSENT)
- Opening remarks or closing remarks
- "Prepared by" or signature sections
Start directly with the first agenda item content.

FORMATTING: Wrap lines that should appear BOLD with **double asterisks**.
This includes section headings, sub-headings, agenda titles, resolutions, and any text that was bold in the template.
Regular body text (discussions, explanations) should have NO markers.
Example:
**Confirmation of Minutes**
**The Minutes of the ALCO 01/2026 were confirmed without amendment.**
Action By: ALCO Secretary.
**Matters Arising / Outstanding**
The Committee discussed the status of...`
  : `Combine all the individual agenda minutes into ONE cohesive Minute of Meeting document.
- Maintain the Noted/Discussed/Action Items structure for each agenda
- Use formal third-person corporate language
- Include all agenda numbers, titles, and presenters
- Preserve all decisions, action items, PICs, and due dates exactly as stated
- Do NOT remove, change, or summarize any content
- Add proper headers (meeting title, date, committee name) at the top`}

Return ONLY the formatted document text, ready for export.`,
  })

  return { text: result.text, templateUrl, meetingTitle: meeting.title, formattedDate }
}
