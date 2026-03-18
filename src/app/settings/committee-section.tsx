'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog'
import { saveCommittee } from './actions'

export function AddCommitteeButton() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await saveCommittee(formData)
        toast.success('Committee created')
        setOpen(false)
      } catch { toast.error('Failed to create committee') }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Committee
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Committee</DialogTitle>
          <DialogDescription>Create a new committee profile with a dedicated system persona.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-3">
          <Input name="name" placeholder="Committee name (e.g. ALCO)" required />
          <Input name="slug" placeholder="committee-slug" required />
          <Textarea name="personaPrompt" className="min-h-24" placeholder="System persona for this committee..." required />
          <div className="flex items-center gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
