export function formatSecondsToTimecode(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

export function parseTimecodeToSeconds(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  return hours * 3600 + minutes * 60 + seconds
}
