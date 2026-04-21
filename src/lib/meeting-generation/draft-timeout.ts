const MOM_DRAFT_TIMEOUT_PATTERN = /Generation timed out after (\d+) seconds/i

export const MOM_DRAFT_ROUTE_MAX_DURATION_SECONDS = 300
export const MOM_DRAFT_CLIENT_TIMEOUT_SECONDS = 290
export const MOM_DRAFT_CLIENT_TIMEOUT_MS = MOM_DRAFT_CLIENT_TIMEOUT_SECONDS * 1000
export const MOM_DRAFT_RUNNING_STALE_AFTER_SECONDS = MOM_DRAFT_ROUTE_MAX_DURATION_SECONDS + 60

export function buildMomDraftTimeoutMessage(
  seconds = MOM_DRAFT_CLIENT_TIMEOUT_SECONDS,
) {
  return `Generation timed out after ${seconds} seconds`
}

export function parseMomDraftTimeoutSeconds(message?: string | null) {
  const normalized = (message ?? '').trim()
  const match = normalized.match(MOM_DRAFT_TIMEOUT_PATTERN)
  if (!match) return null

  const parsed = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function isMomDraftTimeoutMessage(message?: string | null) {
  return parseMomDraftTimeoutSeconds(message) !== null
}

export function isMomDraftRowStale(lastAttemptStartedAt?: string | null) {
  if (!lastAttemptStartedAt) return false

  const startedAtMs = new Date(lastAttemptStartedAt).getTime()
  if (Number.isNaN(startedAtMs)) return false

  return Date.now() - startedAtMs >= MOM_DRAFT_RUNNING_STALE_AFTER_SECONDS * 1000
}
