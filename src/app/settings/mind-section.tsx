'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { MinuteMindEntryDialog, type MinuteMindEntryDialogValue } from '@/components/minute-mind-entry-dialog'
import type { MinuteMindEntryRecord } from '@/lib/meeting-generation/minute-mind'

const DEFAULT_DIALOG_VALUE: MinuteMindEntryDialogValue = {
  scopeType: 'committee',
  entryType: 'formatting_rule',
  title: '',
  content: '',
  appliesToGeneration: true,
  appliesToChat: true,
  isActive: true,
}

export function MindSection({ committeeId }: { committeeId: string }) {
  const router = useRouter()
  const [entries, setEntries] = useState<MinuteMindEntryRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<MinuteMindEntryRecord | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let ignore = false
    async function load() {
      setIsLoading(true)
      try {
        const result = await getJson<{ ok: true; entries: MinuteMindEntryRecord[] }>(
          `/api/settings/mind?committeeId=${encodeURIComponent(committeeId)}`,
        )
        if (!ignore) {
          setEntries(result.entries)
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error instanceof Error ? error.message : 'Failed to load backend memory')
        }
      } finally {
        if (!ignore) {
          setIsLoading(false)
        }
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [committeeId])

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [entries],
  )

  function openNewDialog() {
    setEditingEntry(null)
    setDialogOpen(true)
  }

  function openEditDialog(entry: MinuteMindEntryRecord) {
    setEditingEntry(entry)
    setDialogOpen(true)
  }

  function handleDelete(entryId: string) {
    const confirmed = window.confirm('Delete this backend memory entry?')
    if (!confirmed) return

    startTransition(async () => {
      try {
        await deleteJson<{ ok: true }>('/api/settings/mind', { entryId })
        setEntries(prev => prev.filter(entry => entry.id !== entryId))
        toast.success('Backend memory entry deleted')
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete entry')
      }
    })
  }

  async function handleSubmit(value: MinuteMindEntryDialogValue) {
    startTransition(async () => {
      try {
        if (editingEntry) {
          const result = await patchJson<{ ok: true; entry: MinuteMindEntryRecord }>(
            '/api/settings/mind',
            {
              entryId: editingEntry.id,
              ...value,
            },
          )
          setEntries(prev => prev.map(entry => (entry.id === result.entry.id ? result.entry : entry)))
          toast.success('Backend memory updated')
        } else {
          const result = await postJson<{ ok: true; entry: MinuteMindEntryRecord }>(
            `/api/settings/mind?committeeId=${encodeURIComponent(committeeId)}`,
            value,
          )
          setEntries(prev => [result.entry, ...prev])
          toast.success('Backend memory saved')
        }
        setDialogOpen(false)
        setEditingEntry(null)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save backend memory')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Backend memory stores durable rules, writing preferences, role naming, reusable exceptions, and short committee facts. Keep long-form bank manuals, policy papers, and reference documents in RAG instead of memory.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={openNewDialog}>
          <Plus className="h-3.5 w-3.5" />
          Add Memory Entry
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
          Loading backend memory...
        </div>
      ) : sortedEntries.length > 0 ? (
        <div className="space-y-3">
          {sortedEntries.map(entry => (
            <div key={entry.id} className="rounded-2xl border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{entry.title}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">{entry.entryType.replace(/_/g, ' ')}</span>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">{entry.appliesToGeneration ? 'Generation' : 'No generation'}</span>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">{entry.appliesToChat ? 'Chat' : 'No chat'}</span>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5">{entry.isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEditDialog(entry)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700" onClick={() => handleDelete(entry.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-600">{entry.content}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-zinc-400">No backend memory entries yet.</p>
      )}

      <MinuteMindEntryDialog
        key={editingEntry?.id ?? 'new-memory-entry'}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditingEntry(null)
          }
        }}
        title={editingEntry ? 'Edit Backend Memory' : 'Add Backend Memory'}
        description="Store durable rules, wording preferences, role naming, short committee facts, or exceptions that should persist across future work. Do not paste long reference documents here; use RAG for those."
        scopeOptions={[{ value: 'committee', label: 'Committee' }]}
        hideScopeSelect
        submitLabel={editingEntry ? 'Update Memory' : 'Save to Memory'}
        isSubmitting={isPending}
        initialValue={editingEntry
          ? {
              scopeType: 'committee',
              entryType: editingEntry.entryType,
              title: editingEntry.title,
              content: editingEntry.content,
              appliesToGeneration: editingEntry.appliesToGeneration,
              appliesToChat: editingEntry.appliesToChat,
              isActive: editingEntry.isActive,
            }
          : DEFAULT_DIALOG_VALUE}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
