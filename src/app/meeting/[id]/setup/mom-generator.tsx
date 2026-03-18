'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sparkles,
  Loader2,
  Search,
  FileOutput,
  SlidersHorizontal,
  Save,
  EyeOff,
  CopyCheck,
  CheckCheck,
  RotateCcw,
  Circle,
  CircleDot,
  CircleCheck,
  CircleAlert,
  Trash2,
  Ban,
  Clock3,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select'
import type { Agenda } from '@/lib/supabase/types'
import { FormatDialog, clearDraftFromStorage, saveDraftToStorage } from './format-dialog'
import {
  applyFormatToSubItems,
  clearMeetingFormatting,
  clearAllGeneratedMinutes,
  updateAgendaStatus,
  updateAgendaSkipped,
  bulkSaveSkipped,
  getAgendaFormattingState,
} from './mom-actions'
import Link from 'next/link'
import type { AgendaRunState, LiveMinuteEntry, MomGenerationState, StartMomGenerationOptions } from './use-mom-generation-queue'
import type { MinuteEntry } from './minute-entry'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import { GenerateDialog } from './generate-dialog'

interface Props {
  meetingId: string
  committeeId: string | null
  existingAgendas: Agenda[]
  agendaFormatPrompts: Record<string, string>
  hasExistingTranscript: boolean
  initialMeetingRules: string
  currentMinutesByAgenda: Record<string, MinuteEntry>
  onTimelineRowsChange: (rows: AgendaTimelineRow[]) => void
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  onCancelGeneration: () => void
  onResetGenerationState: () => void
  onClearLiveMinutes: () => void
}

interface Section { heading: Agenda; items: Agenda[] }
type AgendaDisplayState = 'done' | 'ongoing' | 'pending' | 'failed' | 'skipped'

const MISSING_ADDITIONAL_INFO_MIGRATION_HINT =
  'Database not updated yet. Please run latest migration for agenda additional info.'

function isMissingAdditionalInfoMigrationErrorMessage(message: string) {
  return message.toLowerCase().includes('additional_info')
}

function groupSections(agendas: Agenda[]): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  for (const a of agendas) {
    const no = a.agenda_no.trim()
    if (no.endsWith('.0') || /^\d+$/.test(no)) {
      current = { heading: a, items: [] }
      sections.push(current)
    } else if (current) {
      current.items.push(a)
    }
  }
  return sections
}

function statusRowClass(status: AgendaDisplayState) {
  if (status === 'done') return 'bg-emerald-100 dark:bg-emerald-950/40'
  if (status === 'ongoing') return 'bg-amber-100 dark:bg-amber-950/40'
  if (status === 'failed') return 'bg-red-100 dark:bg-red-950/40'
  if (status === 'skipped') return 'bg-zinc-100 dark:bg-zinc-800/70'
  return 'bg-zinc-50/80 dark:bg-zinc-800/50'
}

const STATUS_ICON = { done: CircleCheck, ongoing: CircleDot, pending: Circle } as const
const STATUS_CLS = {
  done: 'text-emerald-600 dark:text-emerald-400',
  ongoing: 'text-amber-600 dark:text-amber-400',
  pending: 'text-zinc-400 dark:text-zinc-500',
} as const

const RUN_BADGE_STYLES: Record<AgendaRunState, string> = {
  pending: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  running: 'border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  done: 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  failed: 'border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  skipped: 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
}

function StatusSelect({ status, onChange }: { status: 'done' | 'ongoing' | 'pending'; onChange: (v: 'done' | 'ongoing' | 'pending') => void }) {
  const Icon = STATUS_ICON[status]
  return (
    <Select value={status} onValueChange={(v) => onChange(v as 'done' | 'ongoing' | 'pending')}>
      <SelectTrigger className={`h-6 w-[120px] gap-1.5 px-2 text-[11px] font-medium ${STATUS_CLS[status]}`}>
        <Icon className="h-3 w-3 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="done">Done</SelectItem>
        <SelectItem value="ongoing">Ongoing</SelectItem>
        <SelectItem value="pending">Pending</SelectItem>
      </SelectContent>
    </Select>
  )
}

function RunStateBadge({ state }: { state: AgendaRunState }) {
  if (state === 'running') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${RUN_BADGE_STYLES[state]}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading...
      </span>
    )
  }

  const Icon = state === 'done'
    ? CircleCheck
    : state === 'failed'
      ? CircleAlert
      : state === 'skipped'
        ? Ban
        : Clock3

  const label = state === 'done'
    ? 'Done'
    : state === 'failed'
      ? 'Failed'
      : state === 'skipped'
        ? 'Skipped'
        : 'Pending'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${RUN_BADGE_STYLES[state]}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

function toMinuteMap(source: Record<string, { content: string; updatedAt: string }>) {
  return new Map<string, MinuteEntry>(
    Object.entries(source).map(([agendaId, value]) => [agendaId, { content: value.content, updatedAt: value.updatedAt }]),
  )
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function mergeMinutes(
  base: Record<string, { content: string; updatedAt: string }>,
  live: Record<string, LiveMinuteEntry>,
) {
  const next = toMinuteMap(base)
  Object.entries(live).forEach(([agendaId, minute]) => {
    next.set(agendaId, minute)
  })
  return next
}

function resolveDisplayState(
  status: 'done' | 'ongoing' | 'pending',
  runState?: AgendaRunState,
): AgendaDisplayState {
  if (runState === 'running') return 'ongoing'
  if (runState === 'done') return 'done'
  if (runState === 'failed') return 'failed'
  if (runState === 'skipped') return 'skipped'
  return status
}

export function MomGenerator({
  meetingId,
  committeeId,
  existingAgendas,
  agendaFormatPrompts,
  hasExistingTranscript,
  initialMeetingRules,
  currentMinutesByAgenda,
  onTimelineRowsChange,
  generationState,
  onStartGeneration,
  onCancelGeneration,
  onResetGenerationState,
  onClearLiveMinutes,
}: Props) {
  const router = useRouter()
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false)
  const [isClearingFormatting, setIsClearingFormatting] = useState(false)
  const [isClearingMinutes, setIsClearingMinutes] = useState(false)
  const [notMinuted, setNotMinuted] = useState<Set<string>>(
    () => new Set(existingAgendas.filter(a => a.is_skipped).map(a => a.id)),
  )
  const [formatDialogAgendaId, setFormatDialogAgendaId] = useState<string | null>(null)
  const [expandedAgendaIds, setExpandedAgendaIds] = useState<Set<string>>(new Set())
  const [agendaPromptTexts, setAgendaPromptTexts] = useState<Map<string, string>>(
    () => new Map(Object.entries(agendaFormatPrompts)),
  )
  const [formattedAgendas, setFormattedAgendas] = useState<Map<string, string>>(
    () => new Map(existingAgendas.filter(a => a.format_template_id).map(a => [a.id, a.format_template_id!])),
  )
  const [agendaStatuses, setAgendaStatuses] = useState<Map<string, 'done' | 'ongoing' | 'pending'>>(
    () => new Map(existingAgendas.map(a => [a.id, a.minute_status ?? 'pending'])),
  )
  const [agendaInfos, setAgendaInfos] = useState<Map<string, string>>(
    () => new Map(existingAgendas.filter(a => a.additional_info).map(a => [a.id, a.additional_info!])),
  )
  const [agendaTemplateNames, setAgendaTemplateNames] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [minutesByAgenda, setMinutesByAgenda] = useState<Map<string, MinuteEntry>>(
    () => toMinuteMap(currentMinutesByAgenda),
  )

  const prevFormatPromptsKey = useRef(JSON.stringify(agendaFormatPrompts))
  const liveMinutesRef = useRef(generationState.liveMinutesByAgenda)
  useEffect(() => {
    const key = JSON.stringify(agendaFormatPrompts)
    if (key === prevFormatPromptsKey.current) return
    prevFormatPromptsKey.current = key
    setAgendaPromptTexts(prev => {
      const next = new Map(prev)
      for (const [id, text] of Object.entries(agendaFormatPrompts)) next.set(id, text)
      return next
    })
    setFormattedAgendas(prev => {
      const next = new Map(prev)
      for (const agenda of existingAgendas) {
        if (agenda.format_template_id) next.set(agenda.id, agenda.format_template_id)
      }
      return next
    })
    setAgendaStatuses(new Map(existingAgendas.map(a => [a.id, a.minute_status ?? 'pending'])))
    setAgendaInfos(prev => {
      const next = new Map(prev)
      for (const agenda of existingAgendas) {
        if (agenda.additional_info) next.set(agenda.id, agenda.additional_info)
      }
      return next
    })
  }, [agendaFormatPrompts, existingAgendas])

  useEffect(() => {
    liveMinutesRef.current = generationState.liveMinutesByAgenda
  }, [generationState.liveMinutesByAgenda])

  useEffect(() => {
    setMinutesByAgenda(mergeMinutes(currentMinutesByAgenda, liveMinutesRef.current))
  }, [currentMinutesByAgenda])

  useEffect(() => {
    if (Object.keys(generationState.liveMinutesByAgenda).length === 0) return
    setMinutesByAgenda(prev => {
      const next = new Map(prev)
      Object.entries(generationState.liveMinutesByAgenda).forEach(([agendaId, minute]) => {
        next.set(agendaId, minute)
      })
      return next
    })
  }, [generationState.liveMinutesByAgenda])

  useEffect(() => {
    const runStates = generationState.runStateByAgendaId
    if (Object.keys(runStates).length === 0) return

    setAgendaStatuses(prev => {
      const next = new Map(prev)
      Object.entries(runStates).forEach(([agendaId, runState]) => {
        if (runState === 'running') next.set(agendaId, 'ongoing')
        else if (runState === 'done') next.set(agendaId, 'done')
        else if (runState === 'failed' || runState === 'skipped') next.set(agendaId, 'pending')
      })
      return next
    })
  }, [generationState.runStateByAgendaId])

  const hasFormatting = (id: string) => formattedAgendas.has(id) || agendaPromptTexts.has(id)

  const sections = groupSections(existingAgendas)

  const allDone = useMemo(() => {
    const active = existingAgendas.filter(a => !notMinuted.has(a.id))
    return active.length > 0 && active.every(a => agendaStatuses.get(a.id) === 'done')
  }, [existingAgendas, notMinuted, agendaStatuses])

  const missingFormatAgendas = useMemo(
    () => existingAgendas.filter(agenda => !notMinuted.has(agenda.id) && !formattedAgendas.has(agenda.id)),
    [existingAgendas, notMinuted, formattedAgendas],
  )
  const isFormatComplete = missingFormatAgendas.length === 0
  const hasGeneratedMinutes = minutesByAgenda.size > 0
  const currentQueueAgenda = generationState.queueItems.find(agenda => agenda.id === generationState.currentAgendaId) ?? null

  function toggleNotMinuted(id: string) {
    const wasSkipped = notMinuted.has(id)
    setNotMinuted(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    void updateAgendaSkipped(id, !wasSkipped)
  }

  function toggleExpanded(id: string) {
    setExpandedAgendaIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setStatus(agendaId: string, status: 'done' | 'ongoing' | 'pending') {
    setAgendaStatuses(prev => new Map(prev).set(agendaId, status))
    try { await updateAgendaStatus([agendaId], status) } catch { /* optimistic */ }
  }

  async function bulkStatus(status: 'done' | 'pending') {
    const allIds = existingAgendas.map(a => a.id)
    setAgendaStatuses(new Map(allIds.map(id => [id, status])))
    try { await updateAgendaStatus(allIds, status) } catch { toast.error('Failed to update') }
  }

  async function handleFormatting(agendaId: string) {
    if (!committeeId) {
      toast.error('No committee linked — assign a committee first')
      return
    }
    try {
      const formatting = await getAgendaFormattingState(agendaId)
      // Merge server data with existing client state — don't overwrite client values with empty server responses
      // (server may return empty due to RLS, missing column, or pending DB write from applyFormatToSubItems)
      setFormattedAgendas(prev => {
        const next = new Map(prev)
        if (formatting.templateId) next.set(agendaId, formatting.templateId)
        return next
      })
      setAgendaPromptTexts(prev => {
        const next = new Map(prev)
        if (formatting.promptText) next.set(agendaId, formatting.promptText)
        return next
      })
      setAgendaInfos(prev => {
        const next = new Map(prev)
        if (formatting.additionalInfo) next.set(agendaId, formatting.additionalInfo)
        return next
      })
      setAgendaTemplateNames(prev => {
        const next = new Map(prev)
        if (formatting.templateName) next.set(agendaId, formatting.templateName)
        return next
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load saved formatting'
      if (isMissingAdditionalInfoMigrationErrorMessage(message)) {
        toast.error(MISSING_ADDITIONAL_INFO_MIGRATION_HINT)
      } else {
        toast.error('Failed to load saved formatting')
      }
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Formatting] Failed to load formatting state', error)
      }
    }
    setFormatDialogAgendaId(agendaId)
  }

  async function handleApplyToAll(sectionHeadingId: string, itemIds: string[]) {
    const templateId = formattedAgendas.get(sectionHeadingId)
    if (!templateId) {
      toast.error('Save formatting on the heading first before applying to sub-items')
      return
    }
    try {
      await applyFormatToSubItems(templateId, itemIds)
      setFormattedAgendas(prev => {
        const next = new Map(prev)
        itemIds.forEach(id => next.set(id, templateId))
        return next
      })
      setAgendaPromptTexts(prev => {
        const next = new Map(prev)
        const sourcePrompt = next.get(sectionHeadingId)
        if (sourcePrompt) {
          itemIds.forEach(id => next.set(id, sourcePrompt))
        }
        return next
      })
      setAgendaTemplateNames(prev => {
        const next = new Map(prev)
        const sourceName = next.get(sectionHeadingId)
        if (sourceName) {
          itemIds.forEach(id => next.set(id, sourceName))
        }
        return next
      })
      setAgendaInfos(prev => {
        const next = new Map(prev)
        const sourceInfo = next.get(sectionHeadingId)
        if (sourceInfo) {
          itemIds.forEach(id => next.set(id, sourceInfo))
        }
        return next
      })
      // Save localStorage drafts for each sub-item so FormatDialog picks them up on open
      const headingPrompt = agendaPromptTexts.get(sectionHeadingId) ?? ''
      const headingInfo = agendaInfos.get(sectionHeadingId) ?? ''
      const headingName = agendaTemplateNames.get(sectionHeadingId) ?? ''
      for (const id of itemIds) {
        const itemTitle = existingAgendas.find(a => a.id === id)?.title ?? ''
        saveDraftToStorage(id, {
          name: headingName || itemTitle,
          promptHtml: headingPrompt,
          additionalInfo: headingInfo,
        })
      }
      toast.success(`Format applied to ${itemIds.length} sub-item${itemIds.length > 1 ? 's' : ''}`)
    } catch {
      toast.error('Failed to apply format')
    }
  }

  function handleGoDeeper(agendaId: string) {
    router.push(`/meeting/${meetingId}/editor?agenda=${agendaId}`)
  }

  function handleExtractMinute() {
    toast.info('Extract Minute — coming soon')
  }

  async function handleSaveFormatting() {
    try {
      await bulkSaveSkipped(meetingId, Array.from(notMinuted))
      toast.success('Formatting & skip states saved')
    } catch {
      toast.error('Failed to save formatting')
    }
  }

  async function handleClearFormatting() {
    if (existingAgendas.length === 0) {
      toast.info('No agenda formatting to clear')
      return
    }
    const confirmed = window.confirm('Clear formatting for all agendas in this meeting?')
    if (!confirmed) return

    setIsClearingFormatting(true)
    try {
      await clearMeetingFormatting(meetingId)
      existingAgendas.forEach(a => clearDraftFromStorage(a.id))
      setFormattedAgendas(new Map())
      setAgendaInfos(new Map())
      setAgendaPromptTexts(new Map())
      setAgendaTemplateNames(new Map())
      toast.success('Formatting cleared for this meeting')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear formatting')
    } finally {
      setIsClearingFormatting(false)
    }
  }

  async function handleClearAllMinutes() {
    const hasMinutes = Object.keys(currentMinutesByAgenda).length > 0
    if (!hasMinutes) { toast.info('No generated minutes to clear'); return }
    const confirmed = window.confirm('Are you sure you want to clear ALL generated minutes? This cannot be undone.')
    if (!confirmed) return

    setIsClearingMinutes(true)
    try {
      await clearAllGeneratedMinutes(meetingId)
      onClearLiveMinutes()
      onResetGenerationState()
      setMinutesByAgenda(new Map())
      setAgendaStatuses(new Map(existingAgendas.map(a => [a.id, 'pending'])))
      toast.success('All generated minutes cleared')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear minutes')
    } finally {
      setIsClearingMinutes(false)
    }
  }

  function renderStatusControl(agendaId: string, status: 'done' | 'ongoing' | 'pending') {
    const runState = generationState.runStateByAgendaId[agendaId]
    if (runState === 'running' || runState === 'failed' || runState === 'skipped') {
      return <RunStateBadge state={runState} />
    }

    return (
      <StatusSelect
        status={runState === 'done' ? 'done' : status}
        onChange={(value) => setStatus(agendaId, value)}
      />
    )
  }

  function renderMinutePanel(agenda: Agenda, skipped: boolean) {
    if (!expandedAgendaIds.has(agenda.id)) return null
    const minute = minutesByAgenda.get(agenda.id)
    const hasMinute = Boolean(minute?.content?.trim())
    const runState = generationState.runStateByAgendaId[agenda.id]
    const error = generationState.errorByAgendaId[agenda.id]
    const status = skipped
      ? 'Skipped'
      : runState === 'failed'
        ? 'Failed'
        : hasMinute
          ? 'Generated'
          : runState === 'running'
            ? 'Generating'
            : runState === 'skipped'
              ? 'Skipped'
              : 'Pending'

    return (
      <div className="border-t border-zinc-100 bg-zinc-50/60 px-12 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/30">
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              status === 'Generated'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : status === 'Failed'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : status === 'Generating'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : status === 'Skipped'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {status}
          </span>
          {minute?.updatedAt && (
            <span className="text-[11px] text-zinc-500">Updated {formatUpdatedAt(minute.updatedAt)}</span>
          )}
        </div>
        {status === 'Generated' && minute ? (
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs leading-5 dark:border-zinc-700 dark:bg-zinc-900">
            {minute.content}
          </div>
        ) : status === 'Failed' ? (
          <p className="text-xs text-red-600 dark:text-red-400">{error ?? 'Generation failed for this agenda.'}</p>
        ) : status === 'Generating' ? (
          <p className="text-xs text-blue-600 dark:text-blue-300">This agenda is currently being generated.</p>
        ) : status === 'Skipped' ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-300">Marked as Not Minuted for this run.</p>
        ) : (
          <p className="text-xs text-zinc-600 dark:text-zinc-300">No generated minute yet for this row.</p>
        )}
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={() => setIsGenerateDialogOpen(true)}
                    disabled={
                      generationState.isGenerating
                      || existingAgendas.length === 0
                      || !isFormatComplete
                    }
                    className="gap-2"
                  >
                    {generationState.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {hasGeneratedMinutes ? 'Generate new MoM' : 'Generate Minute of Meeting'}
                  </Button>
                </span>
              </TooltipTrigger>
              {!isFormatComplete ? (
                <TooltipContent>Format not complete. Set formatting for all non-skipped agendas.</TooltipContent>
              ) : null}
            </Tooltip>
            <Button variant="outline" onClick={handleSaveFormatting} className="gap-2">
              <Save className="h-4 w-4" />
              Save Formatting
            </Button>
            <Button
              variant="outline"
              onClick={() => { void handleClearFormatting() }}
              disabled={isClearingFormatting || existingAgendas.length === 0 || generationState.isGenerating}
              className="gap-2"
            >
              {isClearingFormatting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Clear Formatting
            </Button>
            {hasGeneratedMinutes && (
              <Button
                variant="outline"
                onClick={() => { void handleClearAllMinutes() }}
                disabled={isClearingMinutes || generationState.isGenerating}
                className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              >
                {isClearingMinutes ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Clear All Generated
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => bulkStatus('done')} className="gap-1.5 text-xs" disabled={generationState.isGenerating}>
              <CheckCheck className="h-3.5 w-3.5" />
              Mark All Done
            </Button>
            <Button variant="outline" size="sm" onClick={() => bulkStatus('pending')} className="gap-1.5 text-xs" disabled={generationState.isGenerating}>
              <RotateCcw className="h-3.5 w-3.5" />
              Mark All Pending
            </Button>
          </div>
        </div>

        {generationState.isGenerating && generationState.totalCount > 0 && (
          <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="font-medium text-blue-900 dark:text-blue-200">
                  {generationState.cancelRequested
                    ? 'Cancelling after current agenda...'
                    : `Generating ${Math.min(generationState.completedCount + 1, generationState.totalCount)} of ${generationState.totalCount}`}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onCancelGeneration}
                className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 dark:text-red-400 dark:border-red-800"
              >
                {generationState.cancelRequested ? 'Cancelling...' : 'Cancel'}
              </Button>
            </div>
            <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                style={{ width: `${generationState.totalCount === 0 ? 0 : (generationState.completedCount / generationState.totalCount) * 100}%` }}
              />
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-300 truncate">
              {currentQueueAgenda ? `${currentQueueAgenda.agendaNo} - ${currentQueueAgenda.title}` : 'Preparing queue...'}
            </p>
          </div>
        )}

        <div className="rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-700">
          {sections.map(section => {
            const isSkipped = notMinuted.has(section.heading.id)
            const itemIds = section.items.map(i => i.id)
            const headingStatus = agendaStatuses.get(section.heading.id) ?? 'pending'
            const headingDisplayState = resolveDisplayState(
              headingStatus,
              generationState.runStateByAgendaId[section.heading.id],
            )
            const headingExpanded = expandedAgendaIds.has(section.heading.id)
            return (
              <div key={section.heading.id}>
                <div className={`flex items-center gap-3 px-4 py-2.5 transition-all ${isSkipped ? 'opacity-40 bg-zinc-50/80 dark:bg-zinc-800/50' : statusRowClass(headingDisplayState)}`}>
                  <button
                    onClick={() => toggleExpanded(section.heading.id)}
                    className="h-6 w-6 rounded border border-zinc-300 bg-white/80 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    aria-label={headingExpanded ? 'Collapse minute panel' : 'Expand minute panel'}
                  >
                    {headingExpanded ? <ChevronDown className="mx-auto h-3.5 w-3.5" /> : <ChevronRight className="mx-auto h-3.5 w-3.5" />}
                  </button>
                  <span className="text-xs font-bold text-zinc-500 tabular-nums shrink-0 w-8">
                    {section.heading.agenda_no}
                  </span>
                  <span className="flex-1 text-sm font-semibold truncate">{section.heading.title}</span>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {section.items.length > 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className={`h-6 w-6 rounded border flex items-center justify-center transition-colors ${
                            hasFormatting(section.heading.id)
                              ? 'border-violet-400 bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-300'
                              : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-violet-600 hover:bg-violet-50 hover:border-violet-300 dark:hover:bg-violet-900/30'
                          }`}>
                            <SlidersHorizontal className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => { void handleFormatting(section.heading.id) }}>
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            Formatting
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => { void handleApplyToAll(section.heading.id, itemIds) }}>
                            <CopyCheck className="h-3.5 w-3.5" />
                            Apply to all subheadings
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleFormatting(section.heading.id)}
                            className={`h-6 w-6 rounded border flex items-center justify-center transition-colors ${
                              hasFormatting(section.heading.id)
                                ? 'border-violet-400 bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-300'
                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-violet-600 hover:bg-violet-50 hover:border-violet-300 dark:hover:bg-violet-900/30'
                            }`}
                          >
                            <SlidersHorizontal className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Formatting</TooltipContent>
                      </Tooltip>
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => handleGoDeeper(section.heading.id)}
                          className="h-6 w-6 rounded border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/30 transition-colors"
                        >
                          <Search className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Go Deeper</TooltipContent>
                    </Tooltip>

                    <button
                      onClick={handleExtractMinute}
                      className="h-6 px-2 rounded border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 text-[11px] font-medium text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-900/30 transition-colors"
                    >
                      <FileOutput className="h-3 w-3" />
                      Extract Minute
                    </button>

                    {renderStatusControl(section.heading.id, headingStatus)}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => toggleNotMinuted(section.heading.id)}
                          className={`h-6 px-1.5 rounded flex items-center gap-1 text-[11px] border transition-colors ${
                            isSkipped
                              ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-500 border-orange-300 dark:border-orange-700'
                              : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:text-orange-500 hover:bg-orange-50 hover:border-orange-200 dark:hover:bg-orange-900/20'
                          }`}
                        >
                          <EyeOff className="h-3 w-3" />
                          <span className="sr-only sm:not-sr-only">{isSkipped ? 'Skipped' : 'Not Minuted'}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{isSkipped ? 'Re-enable minutes for this heading' : 'Skip this heading from minutes'}</TooltipContent>
                    </Tooltip>

                  </div>
                </div>
                {renderMinutePanel(section.heading, isSkipped)}

                {section.items.map(item => {
                  const itemSkipped = notMinuted.has(item.id)
                  const itemStatus = agendaStatuses.get(item.id) ?? 'pending'
                  const itemDisplayState = resolveDisplayState(
                    itemStatus,
                    generationState.runStateByAgendaId[item.id],
                  )
                  const itemExpanded = expandedAgendaIds.has(item.id)
                  return (
                    <div key={item.id}>
                      <div
                        className={`flex items-center gap-3 px-4 py-2 pl-8 border-t border-zinc-100 dark:border-zinc-800 transition-all ${
                          itemSkipped ? 'opacity-40 bg-zinc-50/80 dark:bg-zinc-800/50' : statusRowClass(itemDisplayState)
                        }`}
                      >
                        <button
                          onClick={() => toggleExpanded(item.id)}
                          className="h-6 w-6 rounded border border-zinc-300 bg-white/80 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                          aria-label={itemExpanded ? 'Collapse minute panel' : 'Expand minute panel'}
                        >
                          {itemExpanded ? <ChevronDown className="mx-auto h-3.5 w-3.5" /> : <ChevronRight className="mx-auto h-3.5 w-3.5" />}
                        </button>
                        <span className="text-xs text-zinc-400 tabular-nums shrink-0 w-8">{item.agenda_no}</span>
                        <span className="flex-1 text-sm truncate">{item.title}</span>
                        <span className="text-xs text-zinc-400 shrink-0 max-w-24 truncate">{item.presenter ?? ''}</span>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleFormatting(item.id)}
                                className={`h-6 w-6 rounded border flex items-center justify-center transition-colors ${
                                  hasFormatting(item.id)
                                    ? 'border-violet-400 bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-300'
                                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-violet-600 hover:bg-violet-50 hover:border-violet-300 dark:hover:bg-violet-900/30'
                                }`}
                              >
                                <SlidersHorizontal className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Formatting</TooltipContent>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleGoDeeper(item.id)}
                                className="h-6 w-6 rounded border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-900/30 transition-colors"
                              >
                                <Search className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Go Deeper</TooltipContent>
                          </Tooltip>

                          <button
                            onClick={handleExtractMinute}
                            className="h-6 px-2 rounded border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 text-[11px] font-medium text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-900/30 transition-colors"
                          >
                            <FileOutput className="h-3 w-3" />
                            Extract Minute
                          </button>

                          {renderStatusControl(item.id, itemStatus)}

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => toggleNotMinuted(item.id)}
                                className={`h-6 px-1.5 rounded flex items-center gap-1 text-[11px] border transition-colors ${
                                  itemSkipped
                                    ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-500 border-orange-300 dark:border-orange-700'
                                    : 'text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:text-orange-500 hover:bg-orange-50 hover:border-orange-200 dark:hover:bg-orange-900/20'
                                }`}
                              >
                                <EyeOff className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{itemSkipped ? 'Re-enable minutes' : 'Skip from minutes'}</TooltipContent>
                          </Tooltip>

                        </div>
                      </div>
                      {renderMinutePanel(item, itemSkipped)}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {existingAgendas.length === 0 && (
            <div className="px-4 py-12 text-center text-zinc-400 text-sm">
              No agenda items yet. Add agendas in the &quot;Agenda&quot; tab first.
            </div>
          )}
        </div>

        {allDone && (
          <div className="flex justify-end pt-2">
            <Link href={`/meeting/${meetingId}/finalize`}>
              <Button className="gap-2" disabled={generationState.isGenerating}>
                <FileOutput className="h-4 w-4" />
                Finalize MoM
              </Button>
            </Link>
          </div>
        )}
      </div>

      {formatDialogAgendaId && committeeId && (() => {
        const resolvedPrompt = agendaPromptTexts.get(formatDialogAgendaId) ?? ''
        return (
          <FormatDialog
            key={formatDialogAgendaId}
            open
            onOpenChange={open => { if (!open) setFormatDialogAgendaId(null) }}
            agendaId={formatDialogAgendaId}
            agendaTitle={existingAgendas.find(a => a.id === formatDialogAgendaId)?.title ?? ''}
            committeeId={committeeId}
            initialTemplateName={agendaTemplateNames.get(formatDialogAgendaId)}
            initialPromptText={resolvedPrompt}
            initialAdditionalInfo={agendaInfos.get(formatDialogAgendaId) ?? ''}
            onSaved={(payload) => {
              setFormattedAgendas(prev => new Map(prev).set(formatDialogAgendaId, payload.templateId))
              setAgendaPromptTexts(prev => new Map(prev).set(formatDialogAgendaId, payload.promptText))
              setAgendaTemplateNames(prev => new Map(prev).set(formatDialogAgendaId, payload.templateName))
              setAgendaInfos(prev => {
                const next = new Map(prev)
                if (payload.additionalInfo) next.set(formatDialogAgendaId, payload.additionalInfo)
                else next.delete(formatDialogAgendaId)
                return next
              })
            }}
            onCleared={(agendaId) => {
              setFormattedAgendas(prev => { const next = new Map(prev); next.delete(agendaId); return next })
              setAgendaPromptTexts(prev => { const next = new Map(prev); next.delete(agendaId); return next })
              setAgendaTemplateNames(prev => { const next = new Map(prev); next.delete(agendaId); return next })
              setAgendaInfos(prev => { const next = new Map(prev); next.delete(agendaId); return next })
            }}
          />
        )
      })()}

      <GenerateDialog
        open={isGenerateDialogOpen}
        onOpenChange={setIsGenerateDialogOpen}
        meetingId={meetingId}
        existingAgendas={existingAgendas}
        hasExistingTranscript={hasExistingTranscript}
        initialMeetingRules={initialMeetingRules}
        skippedAgendaIds={Array.from(notMinuted)}
        generationState={generationState}
        onStartGeneration={onStartGeneration}
        onTimelineSaved={onTimelineRowsChange}
      />
    </TooltipProvider>
  )
}
