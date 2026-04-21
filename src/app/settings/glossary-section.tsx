'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'
import { postFormData } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface GlossaryItem { id: string; acronym: string; full_meaning: string }

export function GlossarySection({ committeeId, glossary }: { committeeId: string; glossary: GlossaryItem[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await saveGlossaryTerm(formData)
        toast.success('Glossary term saved')
        setEditing(false)
        router.refresh()
      } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to save glossary term') }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Maintain official acronym mappings.</p>
        {!editing && (
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => setEditing(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Term
          </Button>
        )}
      </div>

      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit(new FormData(event.currentTarget))
          }}
          className="space-y-3 rounded-md border p-4"
        >
          <input type="hidden" name="committeeId" value={committeeId} />
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Input name="acronym" placeholder="Acronym" required />
            <Input name="fullMeaning" placeholder="Full meaning" required />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)} disabled={isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />} Save
            </Button>
          </div>
        </form>
      )}

      {glossary.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-zinc-500">
                <th className="px-3 py-2">Acronym</th>
                <th className="px-3 py-2">Full Meaning</th>
              </tr>
            </thead>
            <tbody>
              {glossary.map(item => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-medium">{item.acronym}</td>
                  <td className="px-3 py-2">{item.full_meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !editing && (
        <p className="text-sm text-zinc-400 text-center py-4">No glossary terms yet.</p>
      )}
    </div>
  )
}

async function saveGlossaryTerm(formData: FormData) {
  await postFormData<{ ok: true }>('/api/settings/glossary', formData)
}
