'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type KeyboardEvent } from 'react'
import { Pencil, Plus, Trash2, Upload, Loader2, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { CommitteeSpeaker } from '@/lib/committee-speakers'

interface Props {
  scope?: 'committee' | 'meeting'
  committeeId: string | null
  meetingId?: string | null
  initialSpeakers: CommitteeSpeaker[]
  committeeSettingsHref?: string | null
  onSpeakersChange?: (speakers: CommitteeSpeaker[]) => void
}

interface EditingRow {
  id: string | null
  speakerName: string
  position: string
}

type SpeakerPayload = {
  id: string
  speaker_name: string
  position: string
  sort_order: number
}

async function readMatchSpeakerApiResult<T extends { ok?: boolean; message?: string }>(
  response: Response,
): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await response.json() as T
  }

  const text = await response.text()
  const titleMatch = text.match(/<title>([^<]+)<\/title>/i)

  return {
    ok: false,
    message: titleMatch?.[1]?.trim() || text.trim() || `Request failed with status ${response.status}`,
  } as T
}

async function upsertCommitteeSpeakerRequest(
  committeeId: string,
  speakerName: string,
  position: string,
) {
  const response = await fetch('/api/committee-generation/speakers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ committeeId, speakerName, position }),
  })

  const result = await readMatchSpeakerApiResult<{
    ok?: boolean
    message?: string
    speaker?: CommitteeSpeaker
  }>(response)

  if (!response.ok || !result.ok || !result.speaker) {
    throw new Error(result.message || 'Failed to save speaker')
  }

  return result.speaker
}

async function deleteCommitteeSpeakerRequest(committeeId: string, speakerId: string) {
  const response = await fetch('/api/committee-generation/speakers', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ committeeId, speakerId }),
  })

  const result = await readMatchSpeakerApiResult<{ ok?: boolean; message?: string }>(response)

  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to delete speaker')
  }
}

async function importCommitteeSpeakersRequest(committeeId: string, file: File) {
  const formData = new FormData()
  formData.set('committeeId', committeeId)
  formData.set('file', file)

  const response = await fetch('/api/committee-generation/speakers/import', {
    method: 'POST',
    body: formData,
  })

  const result = await readMatchSpeakerApiResult<{
    ok?: boolean
    message?: string
    importedCount?: number
    speakers?: CommitteeSpeaker[]
  }>(response)

  if (!response.ok || !result.ok || !result.speakers || typeof result.importedCount !== 'number') {
    throw new Error(result.message || 'Failed to import speakers')
  }

  return {
    importedCount: result.importedCount,
    speakers: result.speakers,
  }
}

async function saveMeetingSpeakerOverridesRequest(meetingId: string, speakers: CommitteeSpeaker[]) {
  const response = await fetch(`/api/meeting/${meetingId}/settings-overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save_speakers',
      speakers: speakers.map((speaker, index) => ({
        id: speaker.id,
        speaker_name: speaker.speaker_name,
        position: speaker.position,
        sort_order: typeof speaker.sort_order === 'number' ? speaker.sort_order : index,
      })),
    }),
  })

  const result = await readMatchSpeakerApiResult<{
    ok?: boolean
    message?: string
    speakers?: SpeakerPayload[]
  }>(response)

  if (!response.ok || !result.ok || !Array.isArray(result.speakers)) {
    throw new Error(result.message || 'Failed to save meeting speaker overrides')
  }

  return result.speakers.map(row => ({
    id: row.id,
    committee_id: '',
    speaker_name: row.speaker_name,
    position: row.position,
    sort_order: row.sort_order,
  }))
}

async function importMeetingSpeakersRequest(meetingId: string, file: File) {
  const formData = new FormData()
  formData.set('file', file)

  const response = await fetch(`/api/meeting/${meetingId}/speakers/import`, {
    method: 'POST',
    body: formData,
  })

  const result = await readMatchSpeakerApiResult<{
    ok?: boolean
    message?: string
    importedCount?: number
    speakers?: SpeakerPayload[]
  }>(response)

  if (!response.ok || !result.ok || !Array.isArray(result.speakers) || typeof result.importedCount !== 'number') {
    throw new Error(result.message || 'Failed to import speakers')
  }

  return {
    importedCount: result.importedCount,
    speakers: result.speakers.map(row => ({
      id: row.id,
      committee_id: '',
      speaker_name: row.speaker_name,
      position: row.position,
      sort_order: row.sort_order,
    })),
  }
}

function createLocalSpeakerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `speaker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function MatchSpeakerSection({
  scope = 'committee',
  committeeId,
  meetingId = null,
  initialSpeakers,
  committeeSettingsHref = null,
  onSpeakersChange,
}: Props) {
  const isMeetingMode = scope === 'meeting'
  const [speakers, setSpeakers] = useState<CommitteeSpeaker[]>(initialSpeakers)
  const [editing, setEditing] = useState<EditingRow | null>(null)
  const [isSectionOpen, setIsSectionOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const disabled = isMeetingMode ? !meetingId : !committeeId

  useEffect(() => {
    setSpeakers(initialSpeakers)
  }, [initialSpeakers])

  function commitSpeakers(next: CommitteeSpeaker[]) {
    setSpeakers(next)
    onSpeakersChange?.(next)
  }

  if (disabled) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Match Speaker</CardTitle>
            <CardDescription>
              {isMeetingMode
                ? 'Meeting context is required to manage meeting-only speaker overrides.'
                : 'Assign a committee first to manage speakers.'}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={isSectionOpen ? 'Collapse match speaker section' : 'Expand match speaker section'}
            onClick={() => setIsSectionOpen(open => !open)}
          >
            {isSectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CardHeader>
        {isSectionOpen ? <CardContent /> : null}
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

    if (isMeetingMode) {
      const currentSpeakers = [...speakers]
      const existingIndex = currentSpeakers.findIndex(speaker => speaker.id === editing.id)
      const nextSpeaker: CommitteeSpeaker = {
        id: editing.id ?? createLocalSpeakerId(),
        committee_id: '',
        speaker_name: editing.speakerName.trim(),
        position: editing.position.trim(),
        sort_order: existingIndex >= 0 ? currentSpeakers[existingIndex].sort_order : currentSpeakers.length,
      }
      const next = existingIndex >= 0
        ? currentSpeakers.map((speaker, index) => (index === existingIndex ? nextSpeaker : speaker))
        : [...currentSpeakers, nextSpeaker]

      startTransition(async () => {
        try {
          const saved = await saveMeetingSpeakerOverridesRequest(meetingId!, next)
          commitSpeakers(saved)
          setEditing(null)
          toast.success('Saved this meeting-only speaker override')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to save speaker override')
        }
      })
      return
    }

    startTransition(async () => {
      try {
        const saved = await upsertCommitteeSpeakerRequest(
          committeeId!,
          editing.speakerName,
          editing.position,
        )
        const next = (() => {
          const exists = speakers.find(s => s.id === saved.id)
          if (exists) return speakers.map(s => s.id === saved.id ? saved : s)
          return [...speakers, saved]
        })()
        commitSpeakers(next)
        setEditing(null)
        toast.success('Speaker saved')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save speaker')
      }
    })
  }

  function handleDelete(speakerId: string) {
    if (isMeetingMode) {
      const next = speakers
        .filter(s => s.id !== speakerId)
        .map((speaker, index) => ({ ...speaker, sort_order: index }))

      startTransition(async () => {
        try {
          const saved = await saveMeetingSpeakerOverridesRequest(meetingId!, next)
          commitSpeakers(saved)
          if (editing?.id === speakerId) setEditing(null)
          toast.success('Removed this meeting-only speaker override')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to delete speaker override')
        }
      })
      return
    }

    startTransition(async () => {
      try {
        await deleteCommitteeSpeakerRequest(committeeId!, speakerId)
        const next = speakers.filter(s => s.id !== speakerId)
        commitSpeakers(next)
        if (editing?.id === speakerId) setEditing(null)
        toast.success('Speaker removed')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete speaker')
      }
    })
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    startTransition(async () => {
      try {
        if (isMeetingMode) {
          const result = await importMeetingSpeakersRequest(meetingId!, file)
          commitSpeakers(result.speakers)
          toast.success(`Imported ${result.importedCount} speaker${result.importedCount === 1 ? '' : 's'} for this meeting`)
          return
        }

        const result = await importCommitteeSpeakersRequest(committeeId!, file)
        commitSpeakers(result.speakers)
        toast.success(`Imported ${result.importedCount} speaker${result.importedCount === 1 ? '' : 's'}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to import speakers')
      }
    })

    event.target.value = ''
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); handleSave() }
    if (event.key === 'Escape') handleCancelEdit()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Match Speaker</CardTitle>
          <CardDescription>
            {isMeetingMode
              ? 'Override the speaker roster for this meeting only.'
              : 'Map speaker names to their position/role for the minutes.'}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isSectionOpen ? 'Collapse match speaker section' : 'Expand match speaker section'}
          onClick={() => setIsSectionOpen(open => !open)}
        >
          {isSectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </CardHeader>
      {isSectionOpen && (
      <CardContent>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          {isMeetingMode ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <div className="flex items-center gap-2 font-medium">
                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Meeting-only
                </span>
                <span>Applies to this meeting only</span>
              </div>
              {committeeSettingsHref ? (
                <p className="mt-1 leading-5 text-emerald-700">
                  Committee-wide speaker defaults are managed in{' '}
                  <Link href={committeeSettingsHref} className="font-semibold underline underline-offset-2">
                    Committee Settings
                  </Link>.
                </p>
              ) : null}
            </div>
          ) : (
            <div />
          )}
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
        </div>
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
      )}
    </Card>
  )
}

function EditRow({ editing, isPending, onChange, onSave, onCancel, onKeyDown }: {
  editing: EditingRow
  isPending: boolean
  onChange: (row: EditingRow) => void
  onSave: () => void
  onCancel: () => void
  onKeyDown: (e: KeyboardEvent) => void
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
