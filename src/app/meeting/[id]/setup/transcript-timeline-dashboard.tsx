'use client'

import { Bot, RefreshCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgendaTimelineRow } from './agenda-timeline-row'

interface TranscriptTimelineDashboardProps {
  rows: AgendaTimelineRow[]
  onRearrange: () => void
  onGenerate?: () => void
  onOpenChatbot?: () => void
  generateLabel?: string
  disabled?: boolean
}

export function TranscriptTimelineDashboard({
  rows,
  onRearrange,
  onGenerate,
  onOpenChatbot,
  generateLabel = 'Generate MoM',
  disabled = false,
}: TranscriptTimelineDashboardProps) {
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 dark:border-zinc-700 dark:bg-zinc-900/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Transcript Timeline Dashboard</h4>
          <p className="text-[11px] text-zinc-500">
            Read-only agenda timestamps. Rearrange to remap the transcript, then generate draft minutes and import the successful results when ready.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onGenerate ? (
            <Button
              type="button"
              size="sm"
              onClick={onGenerate}
              disabled={disabled}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generateLabel}
            </Button>
          ) : null}
          {onOpenChatbot ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenChatbot}
              disabled={disabled}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              <Bot className="h-3.5 w-3.5" />
              MoM Chatbot
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRearrange}
            disabled={disabled}
            className="h-8 gap-1.5 px-3 text-xs"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Rearrange Transcript
          </Button>
        </div>
      </div>

      <div className="flex max-h-[220px] flex-wrap gap-2 overflow-y-auto pr-1">
        {rows.map(row => (
          <span
            key={row.agendaId}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium ${
              row.requiresReview
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200'
                : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200'
            }`}
          >
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Agenda {row.agendaNo}
            </span>
            <span className="text-zinc-400">•</span>
            {row.forcedResolvedOutcomeMode === 'closed' ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-200">
                No transcription
              </span>
            ) : row.startTime && row.endTime ? (
              <>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  {row.startTime}
                </span>
                <span className="text-zinc-400">-</span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                  {row.endTime}
                </span>
              </>
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-200">
                Needs review
              </span>
            )}
            {row.forcedResolvedOutcomeMode === 'closed' ? (
              <>
                <span className="text-zinc-400">•</span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200">
                  No Transcription
                </span>
              </>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
}
