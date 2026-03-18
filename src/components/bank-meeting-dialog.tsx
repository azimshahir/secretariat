'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Committee } from '@/lib/supabase/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  committees: Committee[]
}

export function BankMeetingDialog({ open, onOpenChange, committees }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Committee | null>(null)

  function handleClose(v: boolean) {
    if (!v) setSelected(null)
    onOpenChange(v)
  }

  function handleCreate() {
    if (!selected) return
    handleClose(false)
    router.push(`/?committee=${selected.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bank Secretariat</DialogTitle>
          <DialogDescription>Select a committee to create a secretariat workspace</DialogDescription>
        </DialogHeader>
        {committees.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4 text-center">
            No committees activated. Add committees in Settings first.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {committees.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  selected?.id === c.id
                    ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                {selected?.id === c.id
                  ? <Check className="h-4 w-4 shrink-0 text-zinc-900 dark:text-zinc-100" />
                  : <Building2 className="h-4 w-4 shrink-0 text-zinc-400" />}
                <span className="text-sm font-medium">{c.name}</span>
              </button>
            ))}
          </div>
        )}
        {selected && (
          <DialogFooter>
            <Button onClick={handleCreate}>Create Secretariat</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
