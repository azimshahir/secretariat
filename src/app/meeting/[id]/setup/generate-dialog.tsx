'use client'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import type { Agenda } from '@/lib/supabase/types'
import { MeetingGenerationWorkflow } from './meeting-generation-workflow'
import type { MomGenerationState, StartMomGenerationOptions } from './use-mom-generation-queue'
import type { AgendaTimelineRow } from './agenda-timeline-row'

interface GenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: 'generate' | 'rearrange'
  meetingId: string
  existingAgendas: Agenda[]
  hasExistingTranscript: boolean
  hasSavedTimeline?: boolean
  existingTimelineRows?: AgendaTimelineRow[]
  initialMeetingRules: string
  skippedAgendaIds?: string[]
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  onTimelineSaved?: (rows: AgendaTimelineRow[]) => void
  isGenerateDisabled?: boolean
  generateDisabledReason?: string
}

export function GenerateDialog({
  open,
  onOpenChange,
  mode = 'generate',
  meetingId,
  existingAgendas,
  hasExistingTranscript,
  hasSavedTimeline = false,
  existingTimelineRows = [],
  initialMeetingRules,
  skippedAgendaIds,
  generationState,
  onStartGeneration,
  onTimelineSaved,
  isGenerateDisabled,
  generateDisabledReason,
}: GenerateDialogProps) {
  const title = mode === 'rearrange'
    ? 'Rearrange Transcript Timeline'
    : 'Generate Timestamp & Draft MoM'
  const description = mode === 'rearrange'
    ? 'Rebuild the transcript timeline from the saved transcript, adjust the agenda mapping, then save or generate once the timestamps look right.'
    : 'Build draft minutes from the transcript flow here, then import the successful drafts into the current MoM once you are happy with the results.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(100vw-2rem,1100px)] flex-col overflow-hidden p-0 sm:max-w-[1100px]">
        <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 pb-6 pt-5">
            <MeetingGenerationWorkflow
              meetingId={meetingId}
              existingAgendas={existingAgendas}
              hasExistingTranscript={hasExistingTranscript}
              hasSavedTimeline={hasSavedTimeline}
              existingTimelineRows={existingTimelineRows}
              intent={mode}
              initialMeetingRules={initialMeetingRules}
              skippedAgendaIds={skippedAgendaIds}
              generationState={generationState}
              onStartGeneration={onStartGeneration}
              onTimelineSaved={onTimelineSaved}
              onGenerationStarted={() => onOpenChange(false)}
              isGenerateDisabled={isGenerateDisabled}
              generateDisabledReason={generateDisabledReason}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
