'use server'

import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { resolveLanguageModelForUserPlan } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import { extractDocxText } from '@/lib/docx-utils'
import { getUserEntitlementSnapshot } from '@/lib/subscription/entitlements'
import { uuidSchema } from '@/lib/validation'
import {
  hydrateTemplateGroups,
  isMatterArisingSectionTitle,
  type LegacyItineraryTemplate,
} from '@/app/meeting/[id]/setup/settings-template-model'

type SectionType = 'agenda' | 'presenter-list' | 'matter-arising'

export interface MatterArisingParagraph {
  text: string
  kind: 'title' | 'body' | 'value'
}

export interface MatterArisingStructuredRow {
  no: string
  meeting: string
  currentDevelopment: string
  mattersArising: MatterArisingParagraph[]
  actionBy: MatterArisingParagraph[]
}

export interface ItineraryResult {
  columns: string[]
  rows: string[][]
  templateUrl: string | null
  meetingTitle: string
  formattedDate: string
  matterArisingRows?: MatterArisingStructuredRow[]
}

function inferSectionType(title: string): SectionType {
  const t = title.trim().toLowerCase()
  if (t === 'presenter list') return 'presenter-list'
  if (isMatterArisingSectionTitle(t)) return 'matter-arising'
  return 'agenda'
}

function deriveMeetingLabel(meetingTitle: string) {
  const normalized = meetingTitle.trim()
  const match = normalized.match(/\b\d{1,2}\/\d{2,4}\b.*$/i)
  return match?.[0]?.trim() || normalized
}

function extractResolvedBlock(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const match = normalized.match(/(?:^|\n)RESOLVED\s*\n([\s\S]*?)(?=\n[A-Z][A-Z &/()'-]{2,}\n|$)/i)
  return match?.[1]?.trim() ?? ''
}

const EXPLICIT_OWNER_LINE_PATTERN = /^(?:action by|pic|owner|person in charge)\s*:\s*(.+)$/i

function stripMatterArisingLeadParagraph(paragraphs: string[]) {
  if (paragraphs.length === 0) return paragraphs

  const first = paragraphs[0]?.replace(/\s+/g, ' ').trim() ?? ''
  if (!first) return paragraphs

  const inlineLeadMatch = first.match(/^(.*?\bresolved)\s*:\s*(.+)$/i)
  if (inlineLeadMatch && /\b(?:committee|board|members?|meeting|paper|proposal|item)\b/i.test(inlineLeadMatch[1] ?? '')) {
    const remainder = inlineLeadMatch[2]?.trim() ?? ''
    if (remainder) {
      paragraphs[0] = remainder
    } else {
      paragraphs.shift()
    }
    return paragraphs
  }

  if (
    /resolved\s*:?\s*$/i.test(first)
    && /\b(?:committee|board|members?|meeting|paper|proposal|item)\b/i.test(first)
  ) {
    paragraphs.shift()
  }

  return paragraphs
}

function parseMatterArisingResolved(params: {
  resolvedSection: string
  actionItems: Array<{ description: string; pic: string | null }>
}) {
  const bodyParagraphs: string[] = []
  const actionByLines: string[] = []
  let currentParagraphLines: string[] = []

  const flushParagraph = () => {
    if (currentParagraphLines.length === 0) return
    const paragraph = currentParagraphLines.join(' ').replace(/\s+/g, ' ').trim()
    if (paragraph) bodyParagraphs.push(paragraph)
    currentParagraphLines = []
  }

  params.resolvedSection
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach(rawLine => {
      const line = rawLine.trim()
      if (!line) {
        flushParagraph()
        return
      }

      if (/^resolved\s*:?$/i.test(line)) {
        flushParagraph()
        return
      }

      const ownerMatch = line.match(EXPLICIT_OWNER_LINE_PATTERN)
      if (ownerMatch) {
        flushParagraph()
        const ownerValue = ownerMatch[1]?.trim() ?? ''
        if (ownerValue) actionByLines.push(ownerValue)
        return
      }

      currentParagraphLines.push(line)
    })

  flushParagraph()
  stripMatterArisingLeadParagraph(bodyParagraphs)

  const fallbackBodyParagraphs = params.actionItems
    .map(item => item.description.trim())
    .filter(Boolean)
  const fallbackActionByLines = params.actionItems
    .map(item => item.pic?.trim() ?? '')
    .filter(Boolean)

  return {
    bodyParagraphs: bodyParagraphs.length > 0 ? bodyParagraphs : fallbackBodyParagraphs,
    actionByLines: actionByLines.length > 0 ? actionByLines : fallbackActionByLines,
  }
}

function buildMatterArisingRows(params: {
  agendas: Array<{ id: string; agenda_no: string; title: string }>
  meetingLabel: string
  actionItems: Array<{ agenda_id: string; description: string; pic: string | null }>
  minuteByAgendaId: Map<string, string>
}) {
  const actionItemsByAgendaId = new Map<string, Array<{ description: string; pic: string | null }>>()
  params.actionItems.forEach(item => {
    const current = actionItemsByAgendaId.get(item.agenda_id) ?? []
    current.push(item)
    actionItemsByAgendaId.set(item.agenda_id, current)
  })

  return params.agendas.map((agenda, index) => {
    const actionItems = actionItemsByAgendaId.get(agenda.id) ?? []
    const parsedResolved = parseMatterArisingResolved({
      resolvedSection: extractResolvedBlock(params.minuteByAgendaId.get(agenda.id) ?? ''),
      actionItems,
    })

    return {
      no: String(index + 1),
      meeting: params.meetingLabel,
      currentDevelopment: '',
      mattersArising: [
        { text: agenda.title, kind: 'title' as const },
        ...parsedResolved.bodyParagraphs.map(text => ({ text, kind: 'body' as const })),
      ],
      actionBy: parsedResolved.actionByLines.map(text => ({ text, kind: 'value' as const })),
    }
  })
}

export async function generateItineraryContent(
  meetingId: string,
  sectionTitle: string,
  sectionPrompt: string,
): Promise<ItineraryResult> {
  uuidSchema.parse(meetingId)
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

  const { data: agendas } = await supabase
    .from('agendas')
    .select('id, agenda_no, title, presenter, is_skipped')
    .eq('meeting_id', meetingId)
    .order('sort_order')
  if (!agendas?.length) throw new Error('No agendas found')

  const active = agendas.filter(a => !a.is_skipped)
  const sectionType = inferSectionType(sectionTitle)
  const committee = meeting.committees as unknown as {
    id: string; slug: string; persona_prompt: string | null
  } | null

  let effectiveGroups = hydrateTemplateGroups({
    minuteInstruction: typeof meeting.meeting_rules === 'string' ? meeting.meeting_rules : '',
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

    effectiveGroups = hydrateTemplateGroups({
      minuteInstruction: typeof meeting.meeting_rules === 'string' && meeting.meeting_rules.trim().length > 0
        ? meeting.meeting_rules
        : settings?.minute_instruction ?? '',
      itineraryTemplates: (itineraryTemplates ?? []) as LegacyItineraryTemplate[],
      persistedGroups: Array.isArray(meeting.template_section_overrides) && meeting.template_section_overrides.length > 0
        ? meeting.template_section_overrides
        : settings?.template_sections ?? [],
    })
  }

  const resolvedSection = effectiveGroups
    .flatMap(group => group.sections)
    .find(section => section.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase())

  const [{ data: minutes }, { data: actionItems }] = await Promise.all([
    sectionType === 'matter-arising'
      ? supabase
        .from('minutes')
        .select('agenda_id, content')
        .in('agenda_id', active.map(a => a.id))
        .eq('is_current', true)
      : Promise.resolve({ data: [] as Array<{ agenda_id: string; content: string }> }),
    sectionType === 'matter-arising'
      ? supabase
        .from('action_items')
        .select('agenda_id, description, pic, sort_order')
        .eq('meeting_id', meetingId)
        .order('sort_order')
      : Promise.resolve({ data: [] as Array<{ agenda_id: string; description: string; pic: string | null; sort_order: number }> }),
  ])

  // Check for uploaded template DOCX
  let templateUrl: string | null = null
  let templateRef = ''
  if (resolvedSection?.templateStoragePath) {
    if (sectionType !== 'matter-arising') {
      const { data: fileData } = await supabase.storage
        .from('meeting-files').download(resolvedSection.templateStoragePath)
      if (fileData) {
        const text = await extractDocxText(await fileData.arrayBuffer())
        if (text) templateRef = `PREVIOUS TEMPLATE (match this format, column structure, and style EXACTLY):\n---\n${text}\n---\n\n`
      }
    }
    const { data: signed } = await supabase.storage
      .from('meeting-files').createSignedUrl(resolvedSection.templateStoragePath, 3600)
    templateUrl = signed?.signedUrl ?? null
  }

  const formattedDate = new Date(meeting.meeting_date).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const meetingLabel = deriveMeetingLabel(meeting.title)
  const agendaJson = JSON.stringify(active.map(a => ({
    no: a.agenda_no, title: a.title, presenter: a.presenter ?? '',
  })))

  if (sectionType === 'matter-arising') {
    const minuteByAgendaId = new Map((minutes ?? []).map(minute => [minute.agenda_id, minute.content]))
    const matterArisingRows = buildMatterArisingRows({
      agendas: active.map(agenda => ({
        id: agenda.id,
        agenda_no: agenda.agenda_no,
        title: agenda.title,
      })),
      meetingLabel,
      actionItems: (actionItems ?? []).map(item => ({
        agenda_id: item.agenda_id,
        description: item.description,
        pic: item.pic,
      })),
      minuteByAgendaId,
    })

    return {
      columns: ['No.', 'Meeting', 'Matters Arising', 'Action By', 'Current Development'],
      rows: matterArisingRows.map(row => [
        row.no,
        row.meeting,
        row.mattersArising.map(paragraph => paragraph.text).join('\n'),
        row.actionBy.map(paragraph => paragraph.text).join('\n'),
        row.currentDevelopment,
      ]),
      templateUrl,
      meetingTitle: meeting.title,
      formattedDate,
      matterArisingRows,
    }
  }

  const effectivePrompt = sectionPrompt.trim() || resolvedSection?.prompt || ''
  const prompt = buildPrompt(sectionType, templateRef, meeting.title, formattedDate, agendaJson, effectivePrompt)
  const sectionPersona = ITINERARY_PERSONAS[sectionType]
  const committeePersona = committee?.persona_prompt || getDefaultPersona(committee?.slug ?? 'board')
  const model = await resolveLanguageModelForUserPlan(
    meeting.organization_id,
    entitlement.planTier,
    'generate_itineraries',
  )
  const result = await generateText({ model, system: `${sectionPersona}\n\n${committeePersona}`, prompt })

  return { ...parseJson(result.text, sectionType), templateUrl, meetingTitle: meeting.title, formattedDate }
}

// ── Section-specific system personas ──────────────────────────────────

const ITINERARY_PERSONAS: Record<SectionType, string> = {
  'agenda': `You are a Senior Company Secretariat officer preparing formal meeting agenda documents.
You understand corporate meeting protocols, agenda numbering conventions, and the hierarchical structure of committee meetings (Opening Remarks, Confirmation of Minutes, Matters Arising, substantive agenda items, Closing).
You produce precise, audit-ready agenda tables that match the organization's established format.`,

  'presenter-list': `You are a Senior Company Secretariat officer preparing presenter lists for committee meetings.
You understand corporate titles, department structures, and meeting presentation protocols.
You ensure every agenda item has the correct presenter/owner attributed, using proper honorifics and designations as per organizational convention.`,

  'matter-arising': `You are a Senior Company Secretariat officer preparing formal Matter Arising documents.`,
}

function buildPrompt(
  type: SectionType, templateRef: string, title: string,
  date: string, agendaJson: string, instruction: string,
) {
  const base = `MEETING: ${title}\nDATE: ${date}\n\n${templateRef}${instruction ? `SECRETARIAT INSTRUCTIONS:\n${instruction}\n\n` : ''}CURRENT AGENDA DATA:\n${agendaJson}\n\n`

  if (type === 'presenter-list') {
    return `${base}You are generating the Presenter List table for this meeting.

RULES:
- Include ALL agenda items from CURRENT AGENDA DATA
- Each row: agenda number, agenda item title, and presenter/owner name
- Use the presenter names exactly as provided in the data
- If a presenter is empty, put "TBC"
- If a template is provided above, match its column structure exactly (may include Department, Designation, or other columns)
- If no template, use columns: ["Agenda No.","Agenda Item","Presenter"]
- Maintain the exact ordering from the agenda data

Return ONLY valid JSON: {"columns":[...],"rows":[[...],...]}`
  }
  return `${base}You are generating the Meeting Agenda table.

RULES:
- Include ALL agenda items from CURRENT AGENDA DATA — do not add, remove, or reorder any
- Each row: agenda number, agenda item title, and owner/presenter
- Use the exact titles and names as provided
- If a template is provided above, match its naming conventions, numbering format, grouping style, and column structure EXACTLY
- If no template, use columns: ["Agenda No.","Agenda Item","Owner"]
- Standard meeting structure: Opening Remarks → Confirmation of Minutes → Matters Arising → Substantive Items → Any Other Business → Closing

Return ONLY valid JSON: {"columns":[...],"rows":[[...],...]}`
}

const DEFAULTS: Record<SectionType, string[]> = {
  'agenda': ['Agenda No.', 'Agenda Item', 'Owner'],
  'presenter-list': ['Agenda No.', 'Agenda Item', 'Presenter'],
  'matter-arising': ['No.', 'Meeting', 'Matters Arising', 'Action By', 'Current Development'],
}

function parseJson(text: string, type: SectionType): { columns: string[]; rows: string[][] } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
        return {
          columns: Array.isArray(parsed.columns) ? parsed.columns : DEFAULTS[type],
          rows: parsed.rows.map((r: unknown) => Array.isArray(r) ? r.map(String) : []),
        }
      }
    }
  } catch { /* try array fallback */ }
  try {
    const arrMatch = text.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      const arr = JSON.parse(arrMatch[0])
      if (Array.isArray(arr) && arr.length > 0) {
        return { columns: DEFAULTS[type], rows: arr.map((r: unknown) => Array.isArray(r) ? r.map(String) : []) }
      }
    }
  } catch { /* ignore */ }
  return { columns: DEFAULTS[type], rows: [] }
}
