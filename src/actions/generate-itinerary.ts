'use server'

import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { resolveLanguageModelForOrganization } from '@/lib/ai/model-config'
import { getDefaultPersona } from '@/lib/ai/personas'
import { extractDocxText } from '@/lib/docx-utils'
import { uuidSchema } from '@/lib/validation'

type SectionType = 'agenda' | 'presenter-list' | 'summary-of-decision'

export interface ItineraryResult {
  columns: string[]
  rows: string[][]
  templateUrl: string | null
  meetingTitle: string
  formattedDate: string
}

function inferSectionType(title: string): SectionType {
  const t = title.trim().toLowerCase()
  if (t === 'presenter list') return 'presenter-list'
  if (t.includes('matter arising') || t.includes('summary of decision')) return 'summary-of-decision'
  return 'agenda'
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
    .select('id, title, meeting_date, organization_id, committee_id, committees(id, slug, persona_prompt)')
    .eq('id', meetingId)
    .single()
  if (!meeting) throw new Error('Meeting not found')

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

  // For Matter Arising: also fetch generated minutes
  let minuteBlock = ''
  if (sectionType === 'summary-of-decision') {
    const { data: minutes } = await supabase
      .from('minutes')
      .select('agenda_id, content')
      .in('agenda_id', active.map(a => a.id))
      .eq('is_current', true)
    console.log('[Matter Arising] Minutes fetched:', minutes?.length ?? 0, 'rows')
    if (minutes?.length) {
      const map = new Map(minutes.map(m => [m.agenda_id, m.content]))
      minuteBlock = active
        .filter(a => map.has(a.id))
        .map(a => `AGENDA ${a.agenda_no}: ${a.title}\n${map.get(a.id)}`)
        .join('\n\n---\n\n')
      console.log('[Matter Arising] minuteBlock length:', minuteBlock.length, 'chars')
    } else {
      console.log('[Matter Arising] NO minutes found for agenda IDs:', active.map(a => a.id))
    }
  }

  // Check for uploaded template DOCX
  let templateUrl: string | null = null
  let templateRef = ''
  const sectionKey = sectionTitle.trim().toLowerCase().replace(/\s+/g, '-')
  if (committee?.id) {
    const { data: tmpl } = await supabase
      .from('itinerary_templates')
      .select('storage_path')
      .eq('committee_id', committee.id)
      .eq('section_key', sectionKey)
      .maybeSingle()
    if (tmpl?.storage_path) {
      const { data: fileData } = await supabase.storage
        .from('meeting-files').download(tmpl.storage_path)
      if (fileData) {
        const text = await extractDocxText(await fileData.arrayBuffer())
        if (text) templateRef = `PREVIOUS TEMPLATE (match this format, column structure, and style EXACTLY):\n---\n${text}\n---\n\n`
      }
      const { data: signed } = await supabase.storage
        .from('meeting-files').createSignedUrl(tmpl.storage_path, 3600)
      templateUrl = signed?.signedUrl ?? null
    }
  }

  const formattedDate = new Date(meeting.meeting_date).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const agendaJson = JSON.stringify(active.map(a => ({
    no: a.agenda_no, title: a.title, presenter: a.presenter ?? '',
  })))

  const prompt = buildPrompt(sectionType, templateRef, meeting.title, formattedDate, agendaJson, minuteBlock, sectionPrompt)
  const sectionPersona = ITINERARY_PERSONAS[sectionType]
  const committeePersona = committee?.persona_prompt || getDefaultPersona(committee?.slug ?? 'board')
  const model = await resolveLanguageModelForOrganization(meeting.organization_id)
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

  'summary-of-decision': `You are a Senior Company Secretariat officer preparing the Matter Arising / Summary of Decision document.
You have deep expertise in extracting actionable decisions from meeting minutes.

UNDERSTANDING MINUTE STRUCTURE:
You must recognise these sections within each agenda's minutes:
- NOTED: Information acknowledged — no action required, skip these.
- DISCUSSED: Points debated — may or may not have follow-up, check carefully.
- RESOLVED / DECIDED: Formal decisions made — these MUST be captured as decisions.
- ACTION ITEMS: Specific tasks with PIC (Person In Charge) and due dates — these are CRITICAL and must be extracted exactly.

TEMPLATE AWARENESS:
When a previous template is provided, you must carefully analyse its structure:
- Identify where the previous meeting date, meeting title, and paper titles were placed — replace them with the CURRENT meeting's date, title, and paper titles.
- Identify where action items and decisions were recorded in the previous template — place the NEW actions and decisions in the exact same columns/positions.
- Preserve the template's column structure, row layout, and formatting style exactly.
- Do NOT compress multiple lines into a single cell — keep each action item, decision, and remark on its own line within the cell, matching how the previous template spaced them.

EXTRACTION PROCESS:
For each agenda item, read the generated minutes and:
1. Look for RESOLVED/DECIDED sections — extract the resolution text verbatim.
2. Look for ACTION ITEMS sections — extract the task, PIC, and due date verbatim.
3. Match each extracted action/decision to its correct agenda number.
4. If an agenda has no resolution or action item, still include it as a row but leave the action/decision columns empty or marked "-".

Your output must read as if a human secretary carefully went through every agenda's minutes, pulled out the relevant decisions and actions, and placed them into the correct cells of a structured table.`,
}

function buildPrompt(
  type: SectionType, templateRef: string, title: string,
  date: string, agendaJson: string, minuteBlock: string, instruction: string,
) {
  const base = `MEETING: ${title}\nDATE: ${date}\n\n${templateRef}${instruction ? `SECRETARIAT INSTRUCTIONS:\n${instruction}\n\n` : ''}CURRENT AGENDA DATA:\n${agendaJson}\n\n`

  if (type === 'summary-of-decision') {
    return `${base}${minuteBlock ? `GENERATED MEETING MINUTES (read these carefully — this is the actual content from "Generate MoM"):\n---\n${minuteBlock}\n---\n\n` : ''}You are generating the Matter Arising / Summary of Decision table.

STEP 1: List ALL agenda items from the CURRENT AGENDA DATA above. Every single agenda MUST appear as a row.

STEP 2: For each agenda, read its minute content above. Look specifically for:
- **RESOLVED** or **DECIDED** sections — these are formal decisions
- **ACTION ITEMS** sections — these are tasks with PIC/due dates
- Any text containing "Action By:", "PIC:", "Person In Charge:", deadlines, or follow-up requirements

STEP 3: For each agenda row:
- If the agenda has RESOLVED/DECIDED content → copy the resolution text into the Decision/Action column
- If the agenda has ACTION ITEMS → copy the action text, PIC, and due date into the respective columns
- If the agenda has BOTH resolved + action items → include both
- If the agenda has NEITHER (just Noted/Discussed with no action) → put "-" in the action columns but STILL include the agenda row

IMPORTANT:
- ALL agendas must appear in the table, even those with no actions (leave action columns blank/"-")
- Copy the EXACT text from RESOLVED and ACTION ITEMS sections — do not paraphrase or summarize
- If a template is provided above, match its column structure and style EXACTLY
- If no template, use columns: ["Agenda No.","Agenda Item","Decision/Action","PIC","Due Date","Status"]
- For Status column, use "New" for all items from this meeting

Return ONLY valid JSON: {"columns":[...],"rows":[[...],...]}`
  }
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
  'summary-of-decision': ['Agenda No.', 'Agenda Item', 'Decision/Action', 'PIC', 'Due Date', 'Status'],
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
