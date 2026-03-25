export interface TemplateSection {
  id: string
  title: string
  prompt: string
  templateFileName: string | null
  templateFile: File | null
  templateStoragePath: string | null
  noTemplateNeeded: boolean
  isCustom: boolean
}

export interface TemplateGroup {
  id: string
  title: string
  sections: TemplateSection[]
  isOpen: boolean
  isCustom: boolean
}

interface InitialTemplateGroupOptions {
  minuteInstruction?: string | null
  minuteTemplateFileName?: string | null
}

const DEFAULT_PROMPTS = {
  agenda:
    'Use the previous agenda as the baseline format. Update the new items, agenda numbering order, meeting title, date, and current metadata without changing the secretariat document style.',
  presenterList:
    'Refer to the previous Presenter List format and generate a new presenter list based on the current agenda. Keep the original structure/columns and mark incomplete items as TBC.',
  summaryOfDecision:
    'Prepare the Matter Arising for all items based on the previous format. Each agenda should include the key decision, action item, PIC, due date, and status in a formal secretariat style.',
  minuteOfMeeting:
    'Use the previous Minute of Meeting format as the primary template. Keep the Noted/Discussed/Action Items structure consistent, maintain formal language, and ensure the output is easy to audit.',
  extractMinute:
    'Extract the final minutes from the current meeting content using the attached format. Focus on the accuracy of decisions, instructions, PIC, and due dates.',
  other:
    'Use the attached document as the format reference for this section and keep the secretariat writing standard consistent.',
}

export function createTemplateSection(title: string, prompt: string, isCustom = false): TemplateSection {
  return {
    id: `${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    prompt,
    templateFileName: null,
    templateFile: null,
    templateStoragePath: null,
    noTemplateNeeded: false,
    isCustom,
  }
}

export function createInitialTemplateGroups(options?: InitialTemplateGroupOptions): TemplateGroup[] {
  const minuteInstruction = options?.minuteInstruction?.trim()
  const minutePrompt = minuteInstruction && minuteInstruction.length > 0
    ? minuteInstruction
    : DEFAULT_PROMPTS.minuteOfMeeting

  return [
    {
      id: 'minute-format',
      title: 'Minute format',
      isOpen: true,
      isCustom: false,
      sections: [
        {
          ...createTemplateSection('Minute of Meeting', minutePrompt),
          templateFileName: options?.minuteTemplateFileName ?? null,
        },
        createTemplateSection('Extract Minute', DEFAULT_PROMPTS.extractMinute),
      ],
    },
    {
      id: 'itineraries',
      title: 'Itineraries',
      isOpen: true,
      isCustom: false,
      sections: [
        createTemplateSection('Agenda', DEFAULT_PROMPTS.agenda),
        createTemplateSection('Presenter List', DEFAULT_PROMPTS.presenterList),
        createTemplateSection('Matter Arising for all', DEFAULT_PROMPTS.summaryOfDecision),
      ],
    },
  ]
}

export function createOtherSection(index: number) {
  return createTemplateSection(`Others ${index}`, DEFAULT_PROMPTS.other, true)
}
