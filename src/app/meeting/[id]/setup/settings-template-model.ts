import { z } from 'zod'
import type { MomTemplateValidation } from '@/lib/mom-template-types'

export interface TemplateSection {
  id: string
  title: string
  prompt: string
  templateFileName: string | null
  templateStoragePath: string | null
  momTemplateValidation: MomTemplateValidation | null
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

export interface LegacyItineraryTemplate {
  section_key: string
  storage_path: string
  file_name: string
}

interface InitialTemplateGroupOptions {
  minuteInstruction?: string | null
  minuteTemplateFileName?: string | null
}

interface HydrateTemplateGroupsOptions extends InitialTemplateGroupOptions {
  itineraryTemplates?: LegacyItineraryTemplate[]
  persistedGroups?: unknown
}

const DEFAULT_PROMPTS = {
  agenda:
    'Use the previous agenda as the baseline format. Update the new items, agenda numbering order, meeting title, date, and current metadata without changing the secretariat document style.',
  presenterList:
    'Refer to the previous Presenter List format and generate a new presenter list based on the current agenda. Keep the original structure/columns and mark incomplete items as TBC.',
  summaryOfDecision:
    'Prepare the Matter Arising based on the previous format. Replace the old meeting reference with the current meeting, update every agenda row to the current agenda list, populate Action By from the current follow-up state, and leave Current Development blank unless manually updated later.',
  minuteOfMeeting:
    'Use the previous Minute of Meeting format as the primary template. Keep the Noted/Discussed/Action Items structure consistent, maintain formal language, and ensure the output is easy to audit.',
  extractMinute:
    'Extract the final minutes from the current meeting content using the attached format. Focus on the accuracy of decisions, instructions, PIC, and due dates.',
  other:
    'Use the attached document as the format reference for this section and keep the secretariat writing standard consistent.',
}

export const TEMPLATE_GROUP_IDS = {
  minuteFormat: 'minute-format',
  itineraries: 'itineraries',
} as const

export const TEMPLATE_SECTION_IDS = {
  minuteOfMeeting: 'minute-of-meeting',
  extractMinute: 'extract-minute',
  agenda: 'agenda',
  presenterList: 'presenter-list',
  matterArisingForAll: 'matter-arising-for-all',
} as const

const MATTER_ARISING_TITLE = 'Matter Arising'
const EXTRACT_MINUTE_TITLE = 'Extract Minute'
const MINUTE_OF_MEETING_TITLE = 'Minute of Meeting'
const MATTER_ARISING_LEGACY_TITLES = new Set([
  'matter arising',
  'matter arising for all',
  'summary of decision',
])

const templateSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  templateFileName: z.string().nullable(),
  templateStoragePath: z.string().nullable(),
  momTemplateValidation: z.object({
    version: z.number().int().optional(),
    status: z.enum(['exact_supported', 'limited', 'unsupported']),
    reasons: z.array(z.string()),
    validatedAt: z.string(),
    fingerprint: z.string(),
    profileSummary: z.object({
      templateMode: z.enum(['paragraph', 'mixed', 'table']),
      contentZoneDetected: z.boolean(),
      contentParagraphCount: z.number().int().nonnegative(),
      numberingParagraphCount: z.number().int().nonnegative(),
      headerReplaceable: z.boolean(),
      footerReplaceable: z.boolean(),
      paragraphKinds: z.array(z.enum([
        'agenda-heading',
        'section-heading',
        'numbered-body',
        'body',
        'body-bold',
      ])),
      unsupportedConstructs: z.array(z.string()),
    }),
  }).nullable().optional(),
  noTemplateNeeded: z.boolean(),
  isCustom: z.boolean(),
})

const templateGroupSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sections: z.array(templateSectionSchema),
  isOpen: z.boolean(),
  isCustom: z.boolean(),
})

const templateGroupsSchema = z.array(templateGroupSchema)

export function toTemplateSectionKey(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, '-')
}

export function isMatterArisingSectionTitle(title: string) {
  return MATTER_ARISING_LEGACY_TITLES.has(title.trim().toLowerCase())
}

export function isExtractMinuteSectionTitle(title: string) {
  return normalizeLabel(title) === normalizeLabel(EXTRACT_MINUTE_TITLE)
}

export function isMinuteOfMeetingSectionTitle(title: string) {
  return normalizeLabel(title) === normalizeLabel(MINUTE_OF_MEETING_TITLE)
}

export function toVisibleTemplateSectionTitle(title: string) {
  return isMatterArisingSectionTitle(title) ? MATTER_ARISING_TITLE : title
}

export function getTemplateStorageSectionKeys(title: string) {
  const normalized = title.trim().toLowerCase()
  if (MATTER_ARISING_LEGACY_TITLES.has(normalized)) {
    return ['matter-arising', 'matter-arising-for-all', 'summary-of-decision']
  }
  return [toTemplateSectionKey(title)]
}

export function getCanonicalTemplateStorageSectionKey(title: string) {
  return getTemplateStorageSectionKeys(title)[0]
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function createTemplateSectionId(title: string, fallbackIndex?: number) {
  const key = toTemplateSectionKey(title)
  return fallbackIndex == null ? key : `${key}-${fallbackIndex + 1}`
}

function createTemplateGroupId(title: string, fallbackIndex?: number) {
  const key = toTemplateSectionKey(title)
  return fallbackIndex == null ? key : `${key}-${fallbackIndex + 1}`
}

function cloneSection(section: TemplateSection): TemplateSection {
  return {
    ...section,
    momTemplateValidation: section.momTemplateValidation
      ? {
          ...section.momTemplateValidation,
          reasons: [...section.momTemplateValidation.reasons],
          profileSummary: {
            ...section.momTemplateValidation.profileSummary,
            paragraphKinds: [...section.momTemplateValidation.profileSummary.paragraphKinds],
            unsupportedConstructs: [...section.momTemplateValidation.profileSummary.unsupportedConstructs],
          },
        }
      : null,
  }
}

function cloneGroup(group: TemplateGroup): TemplateGroup {
  return {
    ...group,
    sections: group.sections.map(cloneSection),
  }
}

export function cloneTemplateGroups(groups: TemplateGroup[]) {
  return groups.map(cloneGroup)
}

export function createTemplateSection(
  title: string,
  prompt: string,
  isCustom = false,
  id?: string,
): TemplateSection {
  const normalizedTitle = toVisibleTemplateSectionTitle(title)
  return {
    id: id ?? createTemplateSectionId(title),
    title: normalizedTitle,
    prompt,
    templateFileName: null,
    templateStoragePath: null,
    momTemplateValidation: null,
    noTemplateNeeded: false,
    isCustom,
  }
}

function createBuiltInTemplateGroups(options?: InitialTemplateGroupOptions): TemplateGroup[] {
  const minuteInstruction = options?.minuteInstruction?.trim()
  const minutePrompt = minuteInstruction && minuteInstruction.length > 0
    ? minuteInstruction
    : DEFAULT_PROMPTS.minuteOfMeeting

  return [
    {
      id: TEMPLATE_GROUP_IDS.minuteFormat,
      title: 'Minute format',
      isOpen: false,
      isCustom: false,
      sections: [
        {
          ...createTemplateSection(
            'Minute of Meeting',
            minutePrompt,
            false,
            TEMPLATE_SECTION_IDS.minuteOfMeeting,
          ),
          templateFileName: options?.minuteTemplateFileName ?? null,
        },
      ],
    },
    {
      id: TEMPLATE_GROUP_IDS.itineraries,
      title: 'Itineraries',
      isOpen: false,
      isCustom: false,
      sections: [
        createTemplateSection(
          'Agenda',
          DEFAULT_PROMPTS.agenda,
          false,
          TEMPLATE_SECTION_IDS.agenda,
        ),
        createTemplateSection(
          'Presenter List',
          DEFAULT_PROMPTS.presenterList,
          false,
          TEMPLATE_SECTION_IDS.presenterList,
        ),
        createTemplateSection(
          MATTER_ARISING_TITLE,
          DEFAULT_PROMPTS.summaryOfDecision,
          false,
          TEMPLATE_SECTION_IDS.matterArisingForAll,
        ),
        createTemplateSection(
          EXTRACT_MINUTE_TITLE,
          DEFAULT_PROMPTS.extractMinute,
          false,
          TEMPLATE_SECTION_IDS.extractMinute,
        ),
      ],
    },
  ]
}

function applyLegacyTemplateAssets(
  groups: TemplateGroup[],
  itineraryTemplates: LegacyItineraryTemplate[] | undefined,
) {
  if (!itineraryTemplates || itineraryTemplates.length === 0) {
    return groups
  }

  const templateByKey = new Map(
    itineraryTemplates.map(template => [template.section_key, template]),
  )

  return groups.map(group => ({
    ...group,
    sections: group.sections.map(section => {
      const template = getTemplateStorageSectionKeys(section.title)
        .map(key => templateByKey.get(key))
        .find((value): value is LegacyItineraryTemplate => Boolean(value))
      if (!template) return section
      return {
        ...section,
        templateFileName: template.file_name,
        templateStoragePath: template.storage_path,
      }
    }),
  }))
}

function normalizePersistedSection(section: z.infer<typeof templateSectionSchema>, index: number): TemplateSection {
  return {
    id: section.id || createTemplateSectionId(section.title, index),
    title: toVisibleTemplateSectionTitle(section.title),
    prompt: section.prompt,
    templateFileName: section.templateFileName ?? null,
    templateStoragePath: section.templateStoragePath ?? null,
    momTemplateValidation: section.momTemplateValidation ?? null,
    noTemplateNeeded: Boolean(section.noTemplateNeeded),
    isCustom: Boolean(section.isCustom),
  }
}

function isExtractMinuteSection(section: Pick<TemplateSection, 'id' | 'title'>) {
  return section.id === TEMPLATE_SECTION_IDS.extractMinute
    || isExtractMinuteSectionTitle(section.title)
}

function scoreExtractMinuteSection(section: TemplateSection) {
  let score = 0
  if (section.templateStoragePath) score += 4
  if (section.templateFileName) score += 3
  if (section.prompt.trim()) score += 2
  if (section.noTemplateNeeded) score += 1
  return score
}

function normalizeExtractMinutePlacement(groups: TemplateGroup[]) {
  const extractSections: TemplateSection[] = []

  const groupsWithoutExtract = groups.map(group => ({
    ...group,
    sections: group.sections.filter(section => {
      if (!isExtractMinuteSection(section)) return true
      extractSections.push({
        ...cloneSection(section),
        id: TEMPLATE_SECTION_IDS.extractMinute,
        title: EXTRACT_MINUTE_TITLE,
        isCustom: false,
      })
      return false
    }),
  }))

  if (extractSections.length === 0) {
    return groupsWithoutExtract
  }

  const preferredExtractSection = extractSections
    .sort((left, right) => scoreExtractMinuteSection(right) - scoreExtractMinuteSection(left))[0]

  let itineraryGroupFound = false
  const nextGroups = groupsWithoutExtract.map(group => {
    if (group.id !== TEMPLATE_GROUP_IDS.itineraries && normalizeLabel(group.title) !== normalizeLabel('Itineraries')) {
      return group
    }

    itineraryGroupFound = true
    return {
      ...group,
      sections: [...group.sections, preferredExtractSection],
    }
  })

  if (itineraryGroupFound) {
    return nextGroups
  }

  return [
    ...nextGroups,
    {
      id: TEMPLATE_GROUP_IDS.itineraries,
      title: 'Itineraries',
      sections: [preferredExtractSection],
      isOpen: false,
      isCustom: false,
    },
  ]
}

function normalizePersistedGroup(group: z.infer<typeof templateGroupSchema>, index: number): TemplateGroup {
  return {
    id: group.id || createTemplateGroupId(group.title, index),
    title: group.title,
    isOpen: group.isOpen ?? true,
    isCustom: Boolean(group.isCustom),
    sections: group.sections.map((section, sectionIndex) => normalizePersistedSection(section, sectionIndex)),
  }
}

function mergeSections(baseSections: TemplateSection[], incomingSections: TemplateSection[]) {
  const usedIncomingIds = new Set<string>()
  const usedIncomingLabels = new Set<string>()

  const mergedBuiltIns = baseSections.map(baseSection => {
    const match = incomingSections.find(section => (
      section.id === baseSection.id
      || normalizeLabel(section.title) === normalizeLabel(baseSection.title)
    ))

    if (!match) return cloneSection(baseSection)

    usedIncomingIds.add(match.id)
    usedIncomingLabels.add(normalizeLabel(match.title))

    return {
      ...cloneSection(baseSection),
      title: match.title || baseSection.title,
      prompt: match.prompt,
      templateFileName: match.templateFileName,
      templateStoragePath: match.templateStoragePath,
      momTemplateValidation: match.momTemplateValidation,
      noTemplateNeeded: match.noTemplateNeeded,
    }
  })

  const customIncoming = incomingSections
    .filter(section => (
      section.isCustom
      || (!usedIncomingIds.has(section.id) && !usedIncomingLabels.has(normalizeLabel(section.title)))
    ))
    .map(cloneSection)

  return [...mergedBuiltIns, ...customIncoming]
}

function mergeTemplateGroups(baseGroups: TemplateGroup[], incomingGroups: TemplateGroup[]) {
  const usedIncomingIds = new Set<string>()
  const usedIncomingLabels = new Set<string>()

  const merged = baseGroups.map(baseGroup => {
    const match = incomingGroups.find(group => (
      group.id === baseGroup.id
      || normalizeLabel(group.title) === normalizeLabel(baseGroup.title)
    ))

    if (!match) return cloneGroup(baseGroup)

    usedIncomingIds.add(match.id)
    usedIncomingLabels.add(normalizeLabel(match.title))

    return {
      ...cloneGroup(baseGroup),
      title: match.title || baseGroup.title,
      isOpen: match.isOpen,
      sections: mergeSections(baseGroup.sections, match.sections),
    }
  })

  const extraGroups = incomingGroups
    .filter(group => (
      group.isCustom
      || (!usedIncomingIds.has(group.id) && !usedIncomingLabels.has(normalizeLabel(group.title)))
    ))
    .map(cloneGroup)

  return [...merged, ...extraGroups]
}

export function parseStoredTemplateGroups(value: unknown): TemplateGroup[] {
  const parsed = templateGroupsSchema.safeParse(value)
  if (!parsed.success) return []
  return normalizeExtractMinutePlacement(
    parsed.data.map((group, index) => normalizePersistedGroup(group, index)),
  )
}

export function serializeTemplateGroupsForStorage(groups: TemplateGroup[]) {
  return cloneTemplateGroups(groups)
}

export function createInitialTemplateGroups(options?: InitialTemplateGroupOptions): TemplateGroup[] {
  return createBuiltInTemplateGroups(options)
}

export function hydrateTemplateGroups(options?: HydrateTemplateGroupsOptions): TemplateGroup[] {
  const baseGroups = applyLegacyTemplateAssets(
    createBuiltInTemplateGroups(options),
    options?.itineraryTemplates,
  )
  const persistedGroups = parseStoredTemplateGroups(options?.persistedGroups)

  if (persistedGroups.length === 0) {
    return baseGroups
  }

  return mergeTemplateGroups(baseGroups, persistedGroups)
}

export function createOtherSection(index: number) {
  return createTemplateSection(
    `Others ${index}`,
    DEFAULT_PROMPTS.other,
    true,
    createTemplateSectionId('others', index - 1),
  )
}

export function createOtherGroup(index: number): TemplateGroup {
  return {
    id: createTemplateGroupId('other-group', index - 1),
    title: `Others ${index}`,
    sections: [createOtherSection(1)],
    isOpen: true,
    isCustom: true,
  }
}
