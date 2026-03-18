'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { saveFormatTemplate } from './actions'

interface Template { id: string; name: string; prompt_text: string }

export function FormatSection({ committeeId, templates }: { committeeId: string; templates: Template[] }) {
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await saveFormatTemplate(formData)
        toast.success('Template saved')
        setEditing(false)
      } catch { toast.error('Failed to save template') }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Save standard minute structures for quick reuse.</p>
        {!editing && (
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setEditing(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Template
          </Button>
        )}
      </div>

      {editing && (
        <form action={handleSubmit} className="space-y-3 rounded-md border p-4">
          <input type="hidden" name="committeeId" value={committeeId} />
          <Input name="name" placeholder="Template name" required />
          <Textarea name="promptText" className="min-h-24" placeholder="Format prompt text..." required />
          <div className="flex items-center gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />} Save
            </Button>
          </div>
        </form>
      )}

      {templates.length > 0 ? (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="rounded-md border p-3">
              <p className="text-sm font-medium">{t.name}</p>
              <p className="mt-1 line-clamp-3 text-xs text-zinc-500">{t.prompt_text}</p>
            </div>
          ))}
        </div>
      ) : !editing && (
        <p className="text-sm text-zinc-400 text-center py-4">No templates yet.</p>
      )}
    </div>
  )
}
