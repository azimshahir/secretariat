'use client'

import { Loader2 } from 'lucide-react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

interface FormSubmitButtonProps {
  idleLabel: string
  pendingLabel?: string
  className?: string
  disabled?: boolean
}

export function FormSubmitButton({
  idleLabel,
  pendingLabel = 'Submitting...',
  className,
  disabled = false,
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending || disabled} className={className}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {pendingLabel}
        </>
      ) : idleLabel}
    </Button>
  )
}
