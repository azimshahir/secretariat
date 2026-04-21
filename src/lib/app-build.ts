const BUILD_ID_CANDIDATES = [
  process.env.VERCEL_DEPLOYMENT_ID,
  process.env.VERCEL_GIT_COMMIT_SHA,
  process.env.VERCEL_URL,
]

export function getActiveBuildId(): string {
  for (const candidate of BUILD_ID_CANDIDATES) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  return 'local'
}
