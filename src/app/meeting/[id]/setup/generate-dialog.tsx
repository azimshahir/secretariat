'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
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
  meetingId: string
  existingAgendas: Agenda[]
  hasExistingTranscript: boolean
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
  meetingId,
  existingAgendas,
  hasExistingTranscript,
  initialMeetingRules,
  skippedAgendaIds,
  generationState,
  onStartGeneration,
  onTimelineSaved,
  isGenerateDisabled,
  generateDisabledReason,
}: GenerateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generate Timestamp & MoM</DialogTitle>
          <DialogDescription>
            Use the same generation options from Dashboard, then analyze transcript timing or regenerate minutes from here.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="pr-4 pb-1">
            <MeetingGenerationWorkflow
              meetingId={meetingId}
              existingAgendas={existingAgendas}
              hasExistingTranscript={hasExistingTranscript}
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
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
