'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { postJson } from '@/lib/api/client'
import { Button } from '@/components/ui/button'

interface Props {
  meetingId: string
}

export function FinalizeMeetingButton({ meetingId }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleFinalize() {
    setPending(true)
    try {
      await postJson<{ ok: true }>(`/api/meeting/${meetingId}/finalize`, {})
      toast.success('Meeting finalized')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to finalize meeting')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button size="sm" onClick={() => { void handleFinalize() }} disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {pending ? 'Finalizing...' : 'Finalize Meeting'}
    </Button>
  )
}
