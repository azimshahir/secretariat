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
    'Gunakan agenda terdahulu sebagai baseline format. Kemas kini item baharu, susunan nombor agenda, tajuk mesyuarat, tarikh, dan metadata semasa tanpa menukar gaya dokumen sekretariat.',
  presenterList:
    'Rujuk format Presenter List lama dan hasilkan senarai presenter baharu mengikut agenda semasa. Kekalkan struktur/lajur asal dan tandakan item belum lengkap sebagai TBC.',
  summaryOfDecision:
    'Sediakan Matter Arising for all berdasarkan format terdahulu. Setiap agenda perlu ada keputusan utama, action item, PIC, due date, dan status dalam gaya formal sekretariat.',
  minuteOfMeeting:
    'Gunakan format Minute of Meeting terdahulu sebagai template utama. Pastikan struktur Noted/Discussed/Action Items konsisten, bahasa formal, dan mudah diaudit.',
  extractMinute:
    'Ekstrak minit akhir daripada kandungan mesyuarat semasa mengikut format yang dilampirkan. Fokus pada ketepatan keputusan, arahan, PIC, dan due date.',
  other:
    'Gunakan dokumen lampiran sebagai rujukan format untuk seksyen ini dan kekalkan standard penulisan sekretariat.',
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
