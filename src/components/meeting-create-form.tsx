'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { useNavigationTransition } from '@/components/navigation-transition-provider'
import { postJson } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface CommitteeOption {
  id: string
  name: string
}

interface MeetingCreateFormProps {
  committees: CommitteeOption[]
  selectedCommitteeId?: string
  titlePlaceholder: string
  defaultDate?: string
  submitLabel?: string
  disabled?: boolean
}

export function MeetingCreateForm({
  committees,
  selectedCommitteeId,
  titlePlaceholder,
  defaultDate,
  submitLabel = 'Create Meeting',
  disabled = false,
}: MeetingCreateFormProps) {
  const { push } = useNavigationTransition()
  const [pending, startTransition] = useTransition()
  const [meetingDate] = useState(
    defaultDate ?? new Date().toISOString().slice(0, 10),
  )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        startTransition(async () => {
          try {
            const result = await postJson<{
              ok: true
              meetingId: string
              redirectPath: string
            }>('/api/meetings', {
              title: String(formData.get('title') ?? ''),
              meetingDate: String(formData.get('meetingDate') ?? ''),
              committeeId: String(formData.get('committeeId') ?? ''),
              agendaItems: [],
            })
            push(result.redirectPath)
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : 'Failed to create meeting',
            )
          }
        })
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Meeting Title
        </label>
        <Input
          id="title"
          name="title"
          placeholder={titlePlaceholder}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="meetingDate" className="text-sm font-medium">
          Meeting Date
        </label>
        <Input
          id="meetingDate"
          name="meetingDate"
          type="date"
          defaultValue={meetingDate}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="committeeId" className="text-sm font-medium">
          Secretariat
        </label>
        <select
          id="committeeId"
          name="committeeId"
          defaultValue={selectedCommitteeId ?? ''}
          required
          className="h-11 rounded-2xl border border-border/80 bg-white/80 px-4 text-sm shadow-[0_12px_32px_-28px_rgba(15,23,42,0.45)] outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
        >
          <option value="" disabled>
            Select a secretariat
          </option>
          {committees.map(committee => (
            <option key={committee.id} value={committee.id}>
              {committee.name}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="submit"
        className="mt-2"
        disabled={disabled || pending || committees.length === 0}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating...
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  )
}
