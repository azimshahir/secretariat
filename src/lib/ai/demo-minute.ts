import 'server-only'

import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

// Output shape rendered by interactive-demo.tsx. `sections` follows the attached
// template's structure/labels when a template is provided; otherwise the model
// uses sensible defaults (e.g. Noted / Discussed / Resolved).
export const demoMinuteSchema = z.object({
  title: z.string().describe('Short meeting title inferred from the transcript'),
  summary: z.string().describe('Concise executive summary (3-5 sentences) in formal language'),
  sections: z.array(z.object({
    label: z.string().describe('Section heading (follow the template labels when a template is given)'),
    items: z.array(z.string()).describe('Minute lines under this section, in formal minute language'),
  })).describe('Body sections following the template format when provided'),
  actionItems: z.array(z.object({
    assignee: z.string().describe('Person or role responsible (use a name/role from the transcript)'),
    task: z.string().describe('What needs to be done'),
    dueDate: z.string().describe('Deadline if mentioned, otherwise a sensible relative date'),
  })).describe('Action items extracted from the discussion'),
})

export type DemoMinuteOutput = z.infer<typeof demoMinuteSchema>

const DEMO_MODEL = 'gpt-4o-mini'
const TEMPLATE_SAMPLE_CHAR_LIMIT = 4000

export async function generateDemoMinute(
  transcript: string,
  templateSample?: string | null,
): Promise<DemoMinuteOutput> {
  const hasTemplate = Boolean(templateSample && templateSample.trim())

  const system = [
    'You are a professional meeting secretary.',
    'Given a meeting transcript, produce concise, accurate meeting minutes.',
    'Use formal minute language. Do not invent facts not present in the transcript.',
    'Return a title, an executive summary, body sections, and a list of action items.',
    hasTemplate
      ? 'A FORMAT TEMPLATE is provided. Mirror its section labels, ordering, and phrasing style as closely as possible in the "sections" output.'
      : 'No template is provided. Use sensible default sections such as "Noted", "Discussed", and "Resolved" where appropriate.',
  ].join(' ')

  const prompt = [
    hasTemplate
      ? `FORMAT TEMPLATE (follow this structure and section labels):\n---\n${templateSample!.trim().slice(0, TEMPLATE_SAMPLE_CHAR_LIMIT)}\n---\n`
      : '',
    `MEETING TRANSCRIPT:\n\n${transcript}`,
  ].join('\n')

  const { object } = await generateObject({
    model: openai(DEMO_MODEL),
    schema: demoMinuteSchema,
    system,
    prompt,
    temperature: 0.3,
  })
  return object
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

// Lightweight template text extraction for the demo (docx via mammoth, or plain text).
export async function extractTemplateSample(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default
    const result = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })
    return result.value.trim()
  }
  // .txt or anything readable as text
  return (await file.text()).trim()
}
