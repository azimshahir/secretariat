'use client'

import { useState, useTransition } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useNavigationTransition } from '@/components/navigation-transition-provider'
import { postJson } from '@/lib/api/client'
import type { Committee } from '@/lib/supabase/types'

interface Suggestion {
  title: string
  committeeId: string | null
  committeeName: string | null
  agendaItems: string[]
  reasoning: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  committees: Committee[]
}

export function AiSuggestDialog({ open, onOpenChange, committees }: Props) {
  const { push } = useNavigationTransition()
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isCreating, startCreating] = useTransition()
  const today = new Date().toISOString().slice(0, 10)

  function handleClose(v: boolean) {
    if (!v) setSuggestion(null)
    onOpenChange(v)
  }

  function handleSuggest(formData: FormData) {
    const description = formData.get('description') as string
    startTransition(async () => {
      try {
        const result = await postJson<{
          ok: true
          suggestion: Suggestion
        }>('/api/meetings/suggest', {
          description,
          committees: committees.map(c => ({ id: c.id, name: c.name })),
        })
        setSuggestion(result.suggestion)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to suggest meeting',
        )
      }
    })
  }

  function handleCreate(formData: FormData) {
    const title = formData.get('title') as string
    const meetingDate = formData.get('meetingDate') as string
    const committeeId = String(formData.get('committeeId') ?? '').trim()
    const agendaItems = suggestion?.agendaItems ?? []

    startCreating(async () => {
      try {
        const result = await postJson<{
          ok: true
          meetingId: string
          redirectPath: string
        }>('/api/meetings', {
          title,
          meetingDate,
          committeeId,
          agendaItems,
        })
        handleClose(false)
        push(result.redirectPath)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to create meeting',
        )
      }
    })
  }

  // Phase 1: Describe meeting
  if (!suggestion) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI Suggestion
            </DialogTitle>
            <DialogDescription>
              Describe your meeting and AI will suggest title, committee, and agenda items
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              handleSuggest(new FormData(event.currentTarget))
            }}
            className="space-y-4"
          >
            <Textarea
              name="description"
              placeholder="e.g. Monthly risk review to discuss credit exposure, market risk limits, and the new Basel III requirements..."
              rows={4}
              required
              minLength={10}
            />
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isPending ? 'Thinking...' : 'Get Suggestions'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    )
  }

  // Phase 2: Review and confirm suggestions
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI Suggestions</DialogTitle>
          <DialogDescription>{suggestion.reasoning}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleCreate(new FormData(event.currentTarget))
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="ai-title" className="text-sm font-medium">Suggested Title</label>
            <Input id="ai-title" name="title" defaultValue={suggestion.title} required minLength={3} />
          </div>
          <div className="space-y-2">
            <label htmlFor="ai-committee" className="text-sm font-medium">
              Secretariat
            </label>
            <select
              id="ai-committee"
              name="committeeId"
              defaultValue={
                suggestion.committeeId ??
                (committees.length === 1 ? committees[0].id : '')
              }
              required
              className="h-11 w-full rounded-2xl border border-border/80 bg-white/80 px-4 text-sm shadow-[0_12px_32px_-28px_rgba(15,23,42,0.45)] outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
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
            <p className="text-xs text-zinc-500">
              {suggestion.committeeName
                ? `AI matched this to ${suggestion.committeeName}. You can change it before creating the meeting.`
                : 'AI could not match a secretariat confidently, so choose one before creating the meeting.'}
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="ai-date" className="text-sm font-medium">Meeting Date</label>
            <Input id="ai-date" name="meetingDate" type="date" defaultValue={today} required />
          </div>
          {suggestion.agendaItems.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm font-medium">Suggested Agenda Items</span>
              <ol className="list-decimal list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                {suggestion.agendaItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
              <p className="text-xs text-zinc-400">These will be pre-loaded into your meeting setup</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSuggestion(null)}>
              Back
            </Button>
            <Button type="submit" disabled={isCreating || committees.length === 0}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Meeting
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
