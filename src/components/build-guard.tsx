'use client'

import { useEffect, useRef } from 'react'

const SESSION_KEY_PREFIX = 'primary-app-stale-build-reload'
const STALE_ACTION_SIGNATURES = [
  'was not found on the server',
  'failed-to-find-server-action',
]

function extractErrorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    return [value.message, value.stack].filter(Boolean).join('\n')
  }
  if (typeof value !== 'object' || value === null) return ''

  const record = value as Record<string, unknown>
  return [
    extractErrorText(record.message),
    extractErrorText(record.reason),
    extractErrorText(record.digest),
    extractErrorText(record.stack),
  ]
    .filter(Boolean)
    .join('\n')
}

function isStaleActionError(value: unknown) {
  const normalized = extractErrorText(value).toLowerCase()
  return STALE_ACTION_SIGNATURES.some(signature => normalized.includes(signature))
}

function buildSessionKey(
  reason: 'build-mismatch' | 'stale-action',
  currentBuildId: string | null,
  nextBuildId: string | null,
) {
  return [
    SESSION_KEY_PREFIX,
    reason,
    currentBuildId ?? 'unknown',
    nextBuildId ?? 'unknown',
  ].join(':')
}

interface BuildGuardProps {
  initialBuildId?: string | null
}

export function BuildGuard({ initialBuildId = null }: BuildGuardProps) {
  const currentBuildIdRef = useRef<string | null>(initialBuildId)

  useEffect(() => {
    currentBuildIdRef.current = initialBuildId
  }, [initialBuildId])

  useEffect(() => {
    let disposed = false
    let checking = false

    function reloadOnce(
      reason: 'build-mismatch' | 'stale-action',
      nextBuildId: string | null = null,
    ) {
      const currentBuildId = currentBuildIdRef.current
      const sessionKey = buildSessionKey(reason, currentBuildId, nextBuildId)

      try {
        if (window.sessionStorage.getItem(sessionKey) === '1') return
        window.sessionStorage.setItem(sessionKey, '1')
      } catch {
        // Ignore storage failures and still attempt recovery.
      }

      window.location.reload()
    }

    async function checkBuild() {
      if (disposed || checking) return
      if (document.visibilityState === 'hidden') return

      checking = true
      try {
        const response = await fetch('/api/app-build', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) return

        const payload = (await response.json().catch(() => null)) as
          | { buildId?: unknown }
          | null
        const nextBuildId =
          typeof payload?.buildId === 'string' && payload.buildId.trim().length > 0
            ? payload.buildId.trim()
            : null
        const currentBuildId = currentBuildIdRef.current

        if (!currentBuildId || !nextBuildId || currentBuildId === nextBuildId) return
        reloadOnce('build-mismatch', nextBuildId)
      } catch {
        // Ignore transient fetch failures.
      } finally {
        checking = false
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      void checkBuild()
    }

    function handleFocus() {
      void checkBuild()
    }

    function handleError(event: ErrorEvent) {
      if (!isStaleActionError(event.error ?? event.message)) return
      reloadOnce('stale-action')
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      if (!isStaleActionError(event.reason)) return
      reloadOnce('stale-action')
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return null
}
