export const NO_PDF_MARKER = '__no_pdf__'
export const USE_HEADER_PDF_MARKER = '__use_header_pdf__'

export interface AgendaPdfRecordLike {
  id: string
  agenda_no: string | null | undefined
  title: string
  slide_pages: string | null
  sort_order: number
}

export interface ResolvedAgendaPdfSource {
  path: string | null
  source: 'agenda' | 'header' | 'none'
  headerAgendaId: string | null
  headerAgendaNo: string | null
  headerAgendaTitle: string | null
}

export function isAgendaHeadingNo(agendaNo: string | null | undefined) {
  const normalized = typeof agendaNo === 'string' ? agendaNo.trim() : ''
  if (!normalized) return false
  return normalized.endsWith('.0') || /^\d+$/.test(normalized)
}

export function isExplicitNoAgendaPdf(value: string | null | undefined) {
  return (value?.trim() ?? '') === NO_PDF_MARKER
}

export function usesHeaderAgendaPdf(value: string | null | undefined) {
  return (value?.trim() ?? '') === USE_HEADER_PDF_MARKER
}

export function normalizeAgendaPdfPath(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || trimmed === NO_PDF_MARKER || trimmed === USE_HEADER_PDF_MARKER) {
    return null
  }
  return trimmed
}

export function hasRealAgendaPdf(value: string | null | undefined) {
  return Boolean(normalizeAgendaPdfPath(value))
}

export function resolveAgendaPdfPathWithHeader(
  value: string | null | undefined,
  headerValue: string | null | undefined,
) {
  if (usesHeaderAgendaPdf(value)) {
    return normalizeAgendaPdfPath(headerValue)
  }
  return normalizeAgendaPdfPath(value)
}

export function resolveAgendaPdfSource(
  agendas: AgendaPdfRecordLike[],
  agendaId: string,
): ResolvedAgendaPdfSource {
  const orderedAgendas = [...agendas].sort((left, right) => left.sort_order - right.sort_order)
  const currentIndex = orderedAgendas.findIndex(agenda => agenda.id === agendaId)
  if (currentIndex < 0) {
    return {
      path: null,
      source: 'none',
      headerAgendaId: null,
      headerAgendaNo: null,
      headerAgendaTitle: null,
    }
  }

  const currentAgenda = orderedAgendas[currentIndex]
  const directPath = normalizeAgendaPdfPath(currentAgenda.slide_pages)
  if (directPath) {
    return {
      path: directPath,
      source: 'agenda',
      headerAgendaId: null,
      headerAgendaNo: null,
      headerAgendaTitle: null,
    }
  }

  if (!usesHeaderAgendaPdf(currentAgenda.slide_pages)) {
    return {
      path: null,
      source: 'none',
      headerAgendaId: null,
      headerAgendaNo: null,
      headerAgendaTitle: null,
    }
  }

  let headerAgenda: AgendaPdfRecordLike | null = null
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = orderedAgendas[index]
    if (isAgendaHeadingNo(candidate.agenda_no)) {
      headerAgenda = candidate
      break
    }
  }

  const headerPath = normalizeAgendaPdfPath(headerAgenda?.slide_pages ?? null)

  return {
    path: headerPath,
    source: headerPath ? 'header' : 'none',
    headerAgendaId: headerAgenda?.id ?? null,
    headerAgendaNo: headerAgenda?.agenda_no ?? null,
    headerAgendaTitle: headerAgenda?.title ?? null,
  }
}
