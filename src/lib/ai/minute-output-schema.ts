import { z } from 'zod'

// ── Free-form output (no compiled template) ──────────────────────────

export const freeFormMinuteSchema = z.object({
  noted: z.array(z.string())
    .describe('Key points noted/presented, each in formal minute language'),
  discussed: z.array(z.string())
    .describe('Discussion points raised by committee members'),
  resolved: z.array(z.string())
    .describe('Resolutions or decisions made by the committee'),
  actionItems: z.array(z.object({
    task: z.string().describe('What needs to be done'),
    pic: z.string().describe('Person in charge (role title preferred)'),
    deadline: z.string().optional().describe('Deadline if mentioned'),
  })).describe('Action items extracted from the discussion'),
  verifyFlags: z.array(z.object({
    text: z.string().describe('The uncertain text'),
    reason: z.string().describe('Why this needs verification'),
  })).optional().describe('Items that need human verification'),
})

export type FreeFormMinuteOutput = z.infer<typeof freeFormMinuteSchema>

// ── Template fill output (compiled template exists) ──────────────────

export const templateFillMinuteSchema = z.object({
  slots: z.array(z.object({
    id: z.string().describe('The slot ID from the template'),
    value: z.string().describe('Generated content for this slot'),
  })).describe('Filled template slots (paragraphs and fields)'),
  lists: z.array(z.object({
    id: z.string().describe('The list ID from the template'),
    items: z.array(z.string()).describe('Generated list items'),
  })).describe('Filled template lists (bullet/numbered items)'),
  actionItems: z.array(z.object({
    task: z.string().describe('What needs to be done'),
    pic: z.string().describe('Person in charge (role title preferred)'),
    deadline: z.string().optional().describe('Deadline if mentioned'),
  })).describe('Action items extracted from the discussion'),
  verifyFlags: z.array(z.object({
    text: z.string().describe('The uncertain text'),
    reason: z.string().describe('Why this needs verification'),
  })).optional().describe('Items that need human verification'),
})

export type TemplateFillMinuteOutput = z.infer<typeof templateFillMinuteSchema>

// ── Renderers: structured output → plain text ───────────────────────

export function renderFreeFormToText(output: FreeFormMinuteOutput): string {
  const sections: string[] = []

  if (output.noted.length > 0) {
    sections.push('The Committee noted the following:\n' +
      output.noted.map((n, i) => `${i + 1}. ${n}`).join('\n'))
  }
  if (output.discussed.length > 0) {
    sections.push('The Committee discussed the following:\n' +
      output.discussed.map((d, i) => `${i + 1}. ${d}`).join('\n'))
  }
  if (output.resolved.length > 0) {
    sections.push('It was resolved that:\n' +
      output.resolved.map((r, i) => `${i + 1}. ${r}`).join('\n'))
  }
  if (output.actionItems.length > 0) {
    sections.push('Action Items:\n' +
      output.actionItems.map((a, i) => {
        const deadline = a.deadline ? ` (by ${a.deadline})` : ''
        return `${i + 1}. ${a.task} — PIC: ${a.pic}${deadline}`
      }).join('\n'))
  }

  const verifySection = renderVerifyFlags(output.verifyFlags)
  if (verifySection) sections.push(verifySection)

  return sections.join('\n\n')
}

function renderVerifyFlags(
  flags: { text: string; reason: string }[] | undefined,
): string | null {
  if (!flags || flags.length === 0) return null
  return '⚠️ Items to verify:\n' +
    flags.map((f, i) => `${i + 1}. ${f.text} — ${f.reason}`).join('\n')
}

export function renderTemplateFillToText(output: TemplateFillMinuteOutput): string {
  const parts: string[] = []

  for (const slot of output.slots) {
    parts.push(slot.value)
  }
  for (const list of output.lists) {
    parts.push(list.items.map((item, i) => `${i + 1}. ${item}`).join('\n'))
  }
  if (output.actionItems.length > 0) {
    parts.push('Action Items:\n' +
      output.actionItems.map((a, i) => {
        const deadline = a.deadline ? ` (by ${a.deadline})` : ''
        return `${i + 1}. ${a.task} — PIC: ${a.pic}${deadline}`
      }).join('\n'))
  }

  const verifySection = renderVerifyFlags(output.verifyFlags)
  if (verifySection) parts.push(verifySection)

  return parts.join('\n\n')
}
