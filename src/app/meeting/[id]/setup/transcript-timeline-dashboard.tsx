'use client'

import { RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgendaTimelineRow } from './agenda-timeline-row'

interface TranscriptTimelineDashboardProps {
  rows: AgendaTimelineRow[]
  onRearrange: () => void
  disabled?: boolean
}

export function TranscriptTimelineDashboard({
  rows,
  onRearrange,
  disabled = false,
}: TranscriptTimelineDashboardProps) {
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 dark:border-zinc-700 dark:bg-zinc-900/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Transcript Timeline Dashboard</h4>
          <p className="text-[11px] text-zinc-500">
            Read-only agenda timestamps. Rearrange to remap and resubmit MoM.
          </p>
        </div>
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

      <div className="flex max-h-[220px] flex-wrap gap-2 overflow-y-auto pr-1">
        {rows.map(row => (
          <span
            key={row.agendaId}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
          >
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Agenda {row.agendaNo}
            </span>
            <span className="text-zinc-400">•</span>
            <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
              {row.startTime}
            </span>
            <span className="text-zinc-400">-</span>
            <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
              {row.endTime}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
