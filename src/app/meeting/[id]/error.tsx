'use client'

import { Button } from '@/components/ui/button'

export default function MeetingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Meeting Error</h2>
        <p className="mt-2 text-sm text-zinc-500">
          {error.message || 'Failed to load meeting data.'}
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Button variant="outline" onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.href = '/'}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
