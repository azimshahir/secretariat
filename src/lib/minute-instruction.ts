export interface AgendaIdentifier {
  id: string
  agenda_no: string
}

const IGNORE_KEYWORD_REGEX = /(\bignore\b|\bexclude\b|\bskip\b|tak\s+payah|jangan\s+masukkan)/i
const AGENDA_NO_REGEX = /\b\d+(?:\.\d+)?\b/g

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '').replace(/[,:;]+$/g, '')
}

function buildAgendaNoVariants(value: string) {
  const normalized = normalizeToken(value)
  if (!normalized) return []

  const variants = new Set<string>([normalized])
  if (/^\d+$/.test(normalized)) {
    variants.add(`${normalized}.0`)
  }
  if (/^\d+\.0$/.test(normalized)) {
    variants.add(normalized.replace(/\.0$/, ''))
  }
  return [...variants]
}

export function extractIgnoredAgendaTokensFromInstruction(instruction: string) {
  const clauses = instruction
    .split(/[\n\r.;]+/)
    .map(clause => clause.trim())
    .filter(Boolean)

  const tokens: string[] = []

  clauses.forEach(clause => {
    if (!IGNORE_KEYWORD_REGEX.test(clause)) return
    const matches = clause.match(AGENDA_NO_REGEX) ?? []
    matches.forEach(match => tokens.push(normalizeToken(match)))
  })

  return uniqueStrings(tokens.filter(Boolean))
}

export function matchIgnoredAgendasFromInstruction(
  instruction: string,
  agendas: AgendaIdentifier[],
) {
  const tokens = extractIgnoredAgendaTokensFromInstruction(instruction)
  if (tokens.length === 0) {
    return { ignoredAgendaIds: [] as string[], ignoredAgendaNos: [] as string[] }
  }

  const tokenSet = new Set(tokens)
  const ignoredAgendaIds: string[] = []
  const ignoredAgendaNos: string[] = []

  agendas.forEach(agenda => {
    const variants = buildAgendaNoVariants(agenda.agenda_no)
    const matched = variants.some(variant => tokenSet.has(variant))
    if (!matched) return
    ignoredAgendaIds.push(agenda.id)
    ignoredAgendaNos.push(agenda.agenda_no)
  })

  return {
    ignoredAgendaIds: uniqueStrings(ignoredAgendaIds),
    ignoredAgendaNos: uniqueStrings(ignoredAgendaNos),
  }
}
