'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { useNavigationTransition } from '@/components/navigation-transition-provider'
import { Input } from '@/components/ui/input'
import { postJson } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import type { Committee } from '@/lib/supabase/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  committeeId?: string
  committeeName?: string
  committees?: Pick<Committee, 'id' | 'name'>[]
}

export function NormalMeetingDialog({
  open,
  onOpenChange,
  committeeId,
  committeeName,
  committees = [],
}: Props) {
  const { push } = useNavigationTransition()
  const [pending, startTransition] = useTransition()
  const today = new Date().toISOString().slice(0, 10)
  const title = committeeName ? `New ${committeeName} Meeting` : 'New Meeting'
  const description = committeeName
    ? `Create a new meeting under ${committeeName}`
    : 'Choose the secretariat first, then create the meeting record under it.'
  const defaultCommitteeId =
    committeeId ?? (committees.length === 1 ? committees[0].id : '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
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
                  committeeId: String(formData.get('committeeId') ?? committeeId ?? ''),
                  agendaItems: [],
                })
                onOpenChange(false)
                push(result.redirectPath)
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : 'Failed to create meeting',
                )
              }
            })
          }}
          className="space-y-4"
        >
          {committeeId ? (
            <input type="hidden" name="committeeId" value={committeeId} />
          ) : (
            <div className="space-y-2">
              <label htmlFor="normal-committee" className="text-sm font-medium">
                Secretariat
              </label>
              <select
                id="normal-committee"
                name="committeeId"
                defaultValue={defaultCommitteeId}
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
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="normal-title" className="text-sm font-medium">Title</label>
            <Input
              id="normal-title"
              name="title"
              placeholder={committeeName
                ? `e.g. ${committeeName} Meeting No. __/${new Date().getFullYear()}`
                : 'e.g. Board of Directors Meeting'}
              required
              minLength={3}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="normal-date" className="text-sm font-medium">Meeting Date</label>
            <Input
              id="normal-date"
              name="meetingDate"
              type="date"
              defaultValue={today}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!committeeId && committees.length === 0}
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Meeting'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
