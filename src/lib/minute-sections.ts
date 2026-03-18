export interface MinuteSection {
  title: string
  body: string
}

export const MINUTE_SECTION_TITLES = [
  'NOTED',
  'DISCUSSED',
  'RESOLVED/DECIDED',
  'ACTION ITEMS',
] as const

function normalizeHeading(input: string) {
  return input
    .replace(/\*/g, '')
    .replace(/:+$/, '')
    .trim()
    .toUpperCase()
}

export function parseMinuteSections(content: string): MinuteSection[] {
  const normalized = content.replace(/\r\n/g, '\n')
  const sections = MINUTE_SECTION_TITLES.map(title => ({ title, body: '' }))
  const titleToIndex = new Map(MINUTE_SECTION_TITLES.map((title, i) => [title, i]))
  const lines = normalized.split('\n')
  let currentIndex = 0
  let foundKnownHeading = false

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = normalizeHeading(trimmed)
    if (titleToIndex.has(heading as (typeof MINUTE_SECTION_TITLES)[number])) {
      currentIndex = titleToIndex.get(heading as (typeof MINUTE_SECTION_TITLES)[number]) ?? 0
      foundKnownHeading = true
      continue
    }

    if (trimmed.startsWith('**') && trimmed.endsWith('**')) continue

    const previous = sections[currentIndex].body
    sections[currentIndex].body = previous ? `${previous}\n${line}` : line
  }

  if (!foundKnownHeading && normalized.trim()) {
    sections[0].body = normalized.trim()
  }

  return sections.map(section => ({
    ...section,
    body: section.body.trim(),
  }))
}

export function buildMinuteContent(sections: MinuteSection[]) {
  return sections
    .map(section => {
      const heading = `**${section.title}**`
      return section.body ? `${heading}\n${section.body.trim()}` : heading
    })
    .join('\n\n')
    .trim()
}

export function getSectionRanges(sections: MinuteSection[]) {
  const ranges: { title: string; start: number; end: number }[] = []
  let offset = 0

  sections.forEach((section, i) => {
    const heading = `**${section.title}**`
    const text = section.body ? `${heading}\n${section.body}` : heading
    const start = offset
    const end = start + text.length
    ranges.push({ title: section.title, start, end })
    offset = end + (i === sections.length - 1 ? 0 : 2)
  })

  return ranges
}
