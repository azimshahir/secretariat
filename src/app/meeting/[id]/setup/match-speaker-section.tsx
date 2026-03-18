'use client'

import { useRef, useState, useTransition } from 'react'
import { Pencil, Plus, Trash2, Upload, Loader2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  upsertCommitteeSpeaker,
  deleteCommitteeSpeaker,
  importSpeakersFromExcel,
  type CommitteeSpeaker,
} from '@/actions/committee-speakers'

interface Props {
  committeeId: string | null
  initialSpeakers: CommitteeSpeaker[]
}

interface EditingRow {
  id: string | null // null = new row
  speakerName: string
  position: string
}

export function MatchSpeakerSection({ committeeId, initialSpeakers }: Props) {
  const [speakers, setSpeakers] = useState<CommitteeSpeaker[]>(initialSpeakers)
  const [editing, setEditing] = useState<EditingRow | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!committeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Match Speaker</CardTitle>
          <CardDescription>Assign a committee first to manage speakers.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  function handleAdd() {
    setEditing({ id: null, speakerName: '', position: '' })
  }

  function handleEdit(speaker: CommitteeSpeaker) {
    setEditing({ id: speaker.id, speakerName: speaker.speaker_name, position: speaker.position })
  }

  function handleCancelEdit() {
    setEditing(null)
  }

  function handleSave() {
    if (!editing || !editing.speakerName.trim()) {
      toast.error('Speaker name is required')
      return
    }
    startTransition(async () => {
      try {
        const saved = await upsertCommitteeSpeaker(committeeId!, editing.speakerName, editing.position)
        setSpeakers(prev => {
          const exists = prev.find(s => s.id === saved.id)
          if (exists) return prev.map(s => s.id === saved.id ? saved : s)
          return [...prev, saved]
        })
        setEditing(null)
        toast.success('Speaker saved')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save speaker')
      }
    })
  }

  function handleDelete(speakerId: string) {
    startTransition(async () => {
      try {
        await deleteCommitteeSpeaker(speakerId)
        setSpeakers(prev => prev.filter(s => s.id !== speakerId))
        if (editing?.id === speakerId) setEditing(null)
        toast.success('Speaker removed')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete speaker')
      }
    })
  }

  function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    startTransition(async () => {
      try {
        const result = await importSpeakersFromExcel(committeeId!, file)
        // Refetch full list after import
        const { getCommitteeSpeakers } = await import('@/actions/committee-speakers')
        const updated = await getCommitteeSpeakers(committeeId!)
        setSpeakers(updated)
        toast.success(`Imported ${result.importedCount} speaker${result.importedCount === 1 ? '' : 's'}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to import speakers')
      }
    })
    // Reset input so same file can be re-selected
    event.target.value = ''
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); handleSave() }
    if (event.key === 'Escape') handleCancelEdit()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Match Speaker</CardTitle>
          <CardDescription>Map speaker names to their position/role for the minutes.</CardDescription>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Import Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={isPending || editing !== null}
            onClick={handleAdd}
          >
            <Plus className="h-3.5 w-3.5" /> Add Speaker
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {speakers.length === 0 && !editing ? (
          <p className="text-sm text-zinc-400 text-center py-4">No speakers added yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-zinc-500">
                  <th className="px-3 py-2">Speaker</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2 w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {speakers.map(speaker => (
                  editing?.id === speaker.id ? (
                    <EditRow
                      key={speaker.id}
                      editing={editing}
                      isPending={isPending}
                      onChange={setEditing}
                      onSave={handleSave}
                      onCancel={handleCancelEdit}
                      onKeyDown={handleKeyDown}
                    />
                  ) : (
                    <tr key={speaker.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-medium">{speaker.speaker_name}</td>
                      <td className="px-3 py-2">{speaker.position}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" disabled={isPending || editing !== null} onClick={() => handleEdit(speaker)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" disabled={isPending} onClick={() => handleDelete(speaker.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                ))}
                {editing?.id === null && (
                  <EditRow
                    editing={editing}
                    isPending={isPending}
                    onChange={setEditing}
                    onSave={handleSave}
                    onCancel={handleCancelEdit}
                    onKeyDown={handleKeyDown}
                  />
                )}
              </tbody>
            </table>
          </div>
        )}
        {isPending && (
          <div className="flex items-center gap-2 mt-3 text-xs text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving...
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EditRow({ editing, isPending, onChange, onSave, onCancel, onKeyDown }: {
  editing: EditingRow
  isPending: boolean
  onChange: (row: EditingRow) => void
  onSave: () => void
  onCancel: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <tr className="border-b last:border-b-0 bg-zinc-50 dark:bg-zinc-900">
      <td className="px-2 py-1.5">
        <Input
          value={editing.speakerName}
          placeholder="Speaker name"
          autoFocus
          disabled={isPending}
          onChange={e => onChange({ ...editing, speakerName: e.target.value })}
          onKeyDown={onKeyDown}
        />
      </td>
      <td className="px-2 py-1.5">
        <Input
          value={editing.position}
          placeholder="Position / Role"
          disabled={isPending}
          onChange={e => onChange({ ...editing, position: e.target.value })}
          onKeyDown={onKeyDown}
        />
      </td>
      <td className="px-2 py-1.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon-sm" disabled={isPending} onClick={onSave}>
            <Check className="h-3.5 w-3.5 text-green-600" />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={isPending} onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  )
}
