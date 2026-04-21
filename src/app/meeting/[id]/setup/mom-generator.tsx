'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sparkles,
  Building2,
  Loader2,
  Search,
  FileOutput,
  SlidersHorizontal,
  Save,
  EyeOff,
  CopyCheck,
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
  Pencil,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Dispatch, SetStateAction } from 'react'
import { useNavigationTransition } from '@/components/navigation-transition-provider'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select'
import { parseMomDraftTimeoutSeconds } from '@/lib/meeting-generation/draft-timeout'
import type { Agenda } from '@/lib/supabase/types'
import { FormatDialog, clearDraftFromStorage, saveDraftToStorage } from './format-dialog'
import {
  applyFormatToSubItemsRequest,
  bulkSaveSkippedRequest,
  clearAllGeneratedMinutesRequest,
  clearMeetingFormattingRequest,
  getAgendaFormattingStateRequest,
  saveCommitteeFormattingDefaultRequest,
  updateAgendaSkippedRequest,
} from './formatting-api'
import Link from 'next/link'
import { patchJson, postJson } from '@/lib/api/client'
import {
  getResolvedOutcomeLabel,
  type ResolvedOutcomeMode,
} from '@/lib/meeting-generation/resolved-outcome'
import {
  isMomDraftTimeoutMessage,
  type AgendaRunState,
  type DraftMinuteEntry,
  type MomGenerationState,
  type StartMomGenerationOptions,
} from './use-mom-generation-queue'
import { isMinuteEntryStale, type MinuteEntry } from './minute-entry'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import { GenerateDialog } from './generate-dialog'
import {
  switchResolvedOutcomeRequest,
  updateAgendaDraftContentRequest,
  updateAgendaStatusesRequest,
} from './meeting-generation-api'
import type { AgendaFormattingState } from './format-types'
import { fetchTemplateBuffer } from './docx-template-engine'
import { buildExtractMinuteFromTemplate } from './extract-minute-template-engine'
import type { ExtractMinuteDownloadResult } from '@/lib/extract-minute-types'

interface Props {
  meetingId: string
  committeeId: string | null
  existingAgendas: Agenda[]
  agendaStatuses: Map<string, 'done' | 'ongoing' | 'pending'>
  onAgendaStatusesChange: Dispatch<SetStateAction<Map<string, 'done' | 'ongoing' | 'pending'>>>
  agendaFormatPrompts: Record<string, string>
  hasExistingTranscript: boolean
  hasSavedTimeline: boolean
  timelineRows: AgendaTimelineRow[]
  initialMeetingRules: string
  currentMinutesByAgenda: Record<string, MinuteEntry>
  onTimelineRowsChange: (rows: AgendaTimelineRow[]) => void
  generationState: MomGenerationState
  onStartGeneration: (options: StartMomGenerationOptions) => Promise<boolean>
  skippedAgendaIds: string[]
  onSkippedAgendaIdsChange: (agendaIds: string[]) => void
  hasDraftProgress: boolean
  onOpenDraftProgress: () => void
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
  return 'bg-white dark:bg-zinc-900'
}

const STATUS_ICON = { done: CircleCheck, ongoing: CircleDot, pending: Circle } as const
const STATUS_CLS = {
  done: 'text-emerald-600 dark:text-emerald-400',
  ongoing: 'text-amber-600 dark:text-amber-400',
  pending: 'text-zinc-400 dark:text-zinc-500',
} as const

const RUN_BADGE_STYLES: Record<AgendaRunState, string> = {
  pending: 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  queued: 'border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
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

function getRunStateLabel(state: AgendaRunState, errorMessage?: string, attemptCount?: number) {
  if (state === 'queued') return 'Queued retry'
  if (state === 'running') return attemptCount && attemptCount > 1 ? 'Running retry' : 'Running'
  if (state === 'done') return 'Done'
  if (state === 'failed') return isMomDraftTimeoutMessage(errorMessage) ? 'Timed Out' : 'Failed'
  if (state === 'skipped') return 'Skipped'
  return 'Pending'
}

function RunStateBadge({ state, errorMessage, attemptCount }: {
  state: AgendaRunState
  errorMessage?: string
  attemptCount?: number
}) {
  if (state === 'running') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${RUN_BADGE_STYLES[state]}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {getRunStateLabel(state, errorMessage, attemptCount)}
      </span>
    )
  }

  const Icon = state === 'done'
    ? CircleCheck
    : state === 'failed'
      ? CircleAlert
      : state === 'queued'
        ? RotateCcw
      : state === 'skipped'
        ? Ban
        : Clock3

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${RUN_BADGE_STYLES[state]}`}>
      <Icon className="h-3 w-3" />
      {getRunStateLabel(state, errorMessage, attemptCount)}
    </span>
  )
}

function toMinuteMap(source: Record<string, MinuteEntry>) {
  return new Map<string, MinuteEntry>(
    Object.entries(source).map(([agendaId, value]) => [agendaId, {
      content: value.content,
      updatedAt: value.updatedAt,
      minuteId: value.minuteId ?? null,
      sourceAgendaRevision: value.sourceAgendaRevision ?? null,
      agendaContentRevision: value.agendaContentRevision ?? null,
      isStale: value.isStale ?? false,
      resolvedOutcomeMode: value.resolvedOutcomeMode ?? null,
      resolutionVariantKey: value.resolutionVariantKey ?? null,
      resolutionVariantLabel: value.resolutionVariantLabel ?? null,
      resolutionVariantSource: value.resolutionVariantSource ?? null,
      resolutionExactRenderEnforced: value.resolutionExactRenderEnforced ?? false,
    }]),
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

function getResolutionVariantSourceLabel(source?: MinuteEntry['resolutionVariantSource'] | null) {
  if (source === 'manual') return 'Manual override'
  if (source === 'auto') return 'Auto selected'
  return null
}

function sanitizeFileName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9-_ ]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function mergeMinutes(
  base: Record<string, MinuteEntry>,
  live: Record<string, DraftMinuteEntry>,
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
  if (runState === 'queued' || runState === 'running') return 'ongoing'
  if (runState === 'failed') return 'failed'
  if (runState === 'skipped') return 'skipped'
  return status
}

function OutcomeStateBadge({ mode }: { mode: ResolvedOutcomeMode | null }) {
  if (!mode) return null

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      mode === 'follow_up'
        ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
        : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
    }`}>
      {getResolvedOutcomeLabel(mode)}
    </span>
  )
}

export function MomGenerator({
  meetingId,
  committeeId,
  existingAgendas,
  agendaStatuses,
  onAgendaStatusesChange,
  agendaFormatPrompts,
  hasExistingTranscript,
  hasSavedTimeline,
  timelineRows,
  initialMeetingRules,
  currentMinutesByAgenda,
  onTimelineRowsChange,
  generationState,
  onStartGeneration,
  skippedAgendaIds,
  onSkippedAgendaIdsChange,
  hasDraftProgress,
  onOpenDraftProgress,
}: Props) {
  const router = useRouter()
  const { push } = useNavigationTransition()
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false)
  const [isClearingFormatting, setIsClearingFormatting] = useState(false)
  const [isClearingMinutes, setIsClearingMinutes] = useState(false)
  const [isSavingCommitteeDefault, setIsSavingCommitteeDefault] = useState(false)
  const [formatDialogAgendaId, setFormatDialogAgendaId] = useState<string | null>(null)
  const [expandedAgendaIds, setExpandedAgendaIds] = useState<Set<string>>(new Set())
  const [agendaPromptTexts, setAgendaPromptTexts] = useState<Map<string, string>>(
    () => new Map(Object.entries(agendaFormatPrompts)),
  )
  const [formattedAgendas, setFormattedAgendas] = useState<Map<string, string>>(
    () => new Map(existingAgendas.filter(a => a.format_template_id).map(a => [a.id, a.format_template_id!])),
  )
  const [agendaPlaybookIds, setAgendaPlaybookIds] = useState<Map<string, string>>(
    () => new Map(existingAgendas.filter(a => a.minute_playbook_id).map(a => [a.id, a.minute_playbook_id!])),
  )
  const [agendaFormattingStates, setAgendaFormattingStates] = useState<Map<string, AgendaFormattingState>>(
    () => new Map(),
  )
  const [agendaInfos, setAgendaInfos] = useState<Map<string, string>>(
    () => new Map(existingAgendas.filter(a => a.additional_info).map(a => [a.id, a.additional_info!])),
  )
  const skippedAgendaIdSet = useMemo(() => new Set(skippedAgendaIds), [skippedAgendaIds])
  const [minutesByAgenda, setMinutesByAgenda] = useState<Map<string, MinuteEntry>>(
    () => mergeMinutes(currentMinutesByAgenda, generationState.draftMinutesByAgenda),
  )
  const [editingMinuteAgendaIds, setEditingMinuteAgendaIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [minuteDraftTexts, setMinuteDraftTexts] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [savingMinuteAgendaIds, setSavingMinuteAgendaIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [switchingOutcomeAgendaIds, setSwitchingOutcomeAgendaIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [pendingOutcomeModeByAgendaId, setPendingOutcomeModeByAgendaId] = useState<Map<string, ResolvedOutcomeMode>>(
    () => new Map(),
  )
  const [extractingAgendaId, setExtractingAgendaId] = useState<string | null>(null)

  const prevFormatPromptsKey = useRef(JSON.stringify(agendaFormatPrompts))
  const draftMinutesRef = useRef(generationState.draftMinutesByAgenda)
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
    setAgendaPlaybookIds(prev => {
      const next = new Map(prev)
      for (const agenda of existingAgendas) {
        if (agenda.minute_playbook_id) next.set(agenda.id, agenda.minute_playbook_id)
      }
      return next
    })
    setAgendaInfos(prev => {
      const next = new Map(prev)
      for (const agenda of existingAgendas) {
        if (agenda.additional_info) next.set(agenda.id, agenda.additional_info)
      }
      return next
    })
    setAgendaFormattingStates(new Map())
  }, [agendaFormatPrompts, existingAgendas])

  useEffect(() => {
    draftMinutesRef.current = generationState.draftMinutesByAgenda
  }, [generationState.draftMinutesByAgenda])

  useEffect(() => {
    setMinutesByAgenda(mergeMinutes(currentMinutesByAgenda, draftMinutesRef.current))
  }, [currentMinutesByAgenda])

  useEffect(() => {
    if (Object.keys(generationState.draftMinutesByAgenda).length === 0) return
    setMinutesByAgenda(prev => {
      const next = new Map(prev)
      Object.entries(generationState.draftMinutesByAgenda).forEach(([agendaId, minute]) => {
        next.set(agendaId, minute)
      })
      return next
    })
  }, [generationState.draftMinutesByAgenda])

  const hasFormatting = (id: string) => formattedAgendas.has(id) || agendaPromptTexts.has(id) || agendaPlaybookIds.has(id)
  const hasAnyCommitteeFormattingSource = useMemo(
    () => existingAgendas.some(agenda =>
      formattedAgendas.has(agenda.id)
      || agendaPlaybookIds.has(agenda.id)
      || Boolean(agendaInfos.get(agenda.id)?.trim()),
    ),
    [agendaInfos, agendaPlaybookIds, existingAgendas, formattedAgendas],
  )
  const generationDialogAgendas = useMemo(
    () => existingAgendas.map(agenda => ({
      ...agenda,
      format_template_id: formattedAgendas.get(agenda.id) ?? agenda.format_template_id,
      minute_playbook_id: agendaPlaybookIds.get(agenda.id) ?? agenda.minute_playbook_id,
    })),
    [agendaPlaybookIds, existingAgendas, formattedAgendas],
  )

  const sections = groupSections(existingAgendas)
  const importedMinuteCount = Object.keys(currentMinutesByAgenda).length
  const hasImportedMinutes = importedMinuteCount > 0
  const hasDraftBatch = Boolean(generationState.activeBatch)
  const failedDraftAgendaIds = Object.entries(generationState.runStateByAgendaId)
    .filter(([agendaId, runState]) => runState === 'failed' && !skippedAgendaIdSet.has(agendaId))
    .map(([agendaId]) => agendaId)
  const resumableDraftAgendaIds = generationState.resumableAgendaIds
    .filter(agendaId => !skippedAgendaIdSet.has(agendaId))
  const interruptedDraftCount = generationState.interruptedAgendaIds
    .filter(agendaId => !skippedAgendaIdSet.has(agendaId))
    .length

  const allDone = useMemo(() => {
    const active = existingAgendas.filter(a => !skippedAgendaIdSet.has(a.id))
    return active.length > 0 && active.every(a =>
      agendaStatuses.get(a.id) === 'done'
      && Boolean(currentMinutesByAgenda[a.id]?.content?.trim())
      && !isMinuteEntryStale(currentMinutesByAgenda[a.id])
    )
  }, [existingAgendas, skippedAgendaIdSet, agendaStatuses, currentMinutesByAgenda])
  const activeAgendaCount = useMemo(
    () => existingAgendas.filter(agenda => !skippedAgendaIdSet.has(agenda.id)).length,
    [existingAgendas, skippedAgendaIdSet],
  )
  const isStepTwoDone = useMemo(() => {
    const activeAgendas = existingAgendas.filter(agenda => !skippedAgendaIdSet.has(agenda.id))
    return activeAgendas.length > 0 && activeAgendas.every(
      agenda => (agendaStatuses.get(agenda.id) ?? 'pending') === 'done',
    )
  }, [agendaStatuses, existingAgendas, skippedAgendaIdSet])
  const isStepTwoPending = useMemo(() => {
    const activeAgendas = existingAgendas.filter(agenda => !skippedAgendaIdSet.has(agenda.id))
    return activeAgendas.length > 0 && activeAgendas.every(
      agenda => (agendaStatuses.get(agenda.id) ?? 'pending') === 'pending',
    )
  }, [agendaStatuses, existingAgendas, skippedAgendaIdSet])
  const staleCurrentAgendaIds = useMemo(
    () => existingAgendas
      .filter(agenda => !skippedAgendaIdSet.has(agenda.id) && isMinuteEntryStale(currentMinutesByAgenda[agenda.id]))
      .map(agenda => agenda.id),
    [currentMinutesByAgenda, existingAgendas, skippedAgendaIdSet],
  )

  const missingFormatAgendas = useMemo(
    () => existingAgendas.filter(
      agenda => !skippedAgendaIdSet.has(agenda.id)
        && !formattedAgendas.has(agenda.id)
        && !agendaPlaybookIds.has(agenda.id),
    ),
    [agendaPlaybookIds, existingAgendas, skippedAgendaIdSet, formattedAgendas],
  )
  const isFormatComplete = missingFormatAgendas.length === 0
  const hasGeneratedMinutes = hasImportedMinutes

  function toggleNotMinuted(id: string) {
    const wasSkipped = skippedAgendaIdSet.has(id)
    const nextSkippedAgendaIds = wasSkipped
      ? skippedAgendaIds.filter(agendaId => agendaId !== id)
      : [...skippedAgendaIds, id]

    onSkippedAgendaIdsChange(nextSkippedAgendaIds)
    void updateAgendaSkippedRequest(meetingId, id, !wasSkipped).catch(() => {
      onSkippedAgendaIdsChange(skippedAgendaIds)
      toast.error('Failed to update Not Minuted status')
    })
  }

  function toggleExpanded(id: string) {
    setExpandedAgendaIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function beginMinuteEdit(agendaId: string, content: string) {
    setMinuteDraftTexts(prev => new Map(prev).set(agendaId, content))
    setEditingMinuteAgendaIds(prev => {
      const next = new Set(prev)
      next.add(agendaId)
      return next
    })
  }

  function cancelMinuteEdit(agendaId: string) {
    setEditingMinuteAgendaIds(prev => {
      const next = new Set(prev)
      next.delete(agendaId)
      return next
    })
    setMinuteDraftTexts(prev => {
      const next = new Map(prev)
      next.delete(agendaId)
      return next
    })
  }

  async function saveMinuteEdit(agendaId: string, minute: MinuteEntry) {
    const minuteId = minute.minuteId
    const activeBatchId = generationState.activeBatch?.id ?? null
    const runState = generationState.runStateByAgendaId[agendaId]
    if (!minuteId && (!activeBatchId || runState !== 'done')) {
      toast.error('No editable draft found for this agenda')
      return
    }

    const content = minuteDraftTexts.get(agendaId) ?? minute.content
    setSavingMinuteAgendaIds(prev => {
      const next = new Set(prev)
      next.add(agendaId)
      return next
    })

    try {
      const updatedAt = new Date().toISOString()
      if (!minuteId) {
        const updatedDraft = await updateAgendaDraftContentRequest(meetingId, activeBatchId!, agendaId, content)
        setMinutesByAgenda(prev => new Map(prev).set(agendaId, {
          ...minute,
          content: updatedDraft.content ?? content,
          updatedAt: updatedDraft.updatedAt ?? updatedAt,
          minuteId: null,
          sourceAgendaRevision: updatedDraft.sourceAgendaRevision ?? minute.sourceAgendaRevision ?? null,
          agendaContentRevision: minute.agendaContentRevision ?? updatedDraft.sourceAgendaRevision ?? null,
          isStale: false,
          resolvedOutcomeMode: updatedDraft.resolvedOutcomeMode ?? minute.resolvedOutcomeMode ?? null,
          resolutionVariantKey: updatedDraft.resolutionVariantKey ?? minute.resolutionVariantKey ?? null,
          resolutionVariantLabel: updatedDraft.resolutionVariantLabel ?? minute.resolutionVariantLabel ?? null,
          resolutionVariantSource: updatedDraft.resolutionVariantSource ?? minute.resolutionVariantSource ?? null,
          resolutionExactRenderEnforced: updatedDraft.resolutionExactRenderEnforced ?? minute.resolutionExactRenderEnforced ?? false,
        }))
        cancelMinuteEdit(agendaId)
        toast.success('Draft updated')
        return
      }

      await patchJson<{ ok: true }>(`/api/meeting/${meetingId}/minute`, {
        minuteId,
        content,
        mode: 'manual',
      })

      setMinutesByAgenda(prev => new Map(prev).set(agendaId, {
        content,
        updatedAt,
        minuteId,
        sourceAgendaRevision: minute.agendaContentRevision ?? minute.sourceAgendaRevision ?? null,
        agendaContentRevision: minute.agendaContentRevision ?? minute.sourceAgendaRevision ?? null,
        isStale: false,
        resolvedOutcomeMode: minute.resolvedOutcomeMode ?? null,
        resolutionVariantKey: minute.resolutionVariantKey ?? null,
        resolutionVariantLabel: minute.resolutionVariantLabel ?? null,
        resolutionVariantSource: minute.resolutionVariantSource ?? null,
        resolutionExactRenderEnforced: minute.resolutionExactRenderEnforced ?? false,
      }))
      cancelMinuteEdit(agendaId)
      toast.success('Minute saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save minute')
    } finally {
      setSavingMinuteAgendaIds(prev => {
        const next = new Set(prev)
        next.delete(agendaId)
        return next
      })
    }
  }

  async function switchAgendaResolvedOutcome(
    agendaId: string,
    nextMode: ResolvedOutcomeMode,
    minute: MinuteEntry,
  ) {
    const content = minute.content.trim()
    if (!content) {
      toast.error('Generate a minute for this agenda before switching the outcome')
      return
    }

    setSwitchingOutcomeAgendaIds(prev => {
      const next = new Set(prev)
      next.add(agendaId)
      return next
    })
    setPendingOutcomeModeByAgendaId(prev => new Map(prev).set(agendaId, nextMode))

    try {
      const result = await switchResolvedOutcomeRequest(meetingId, {
        agendaId,
        nextMode,
        minuteContent: content,
        source: 'manual_toggle',
      })

      const updatedAt = new Date().toISOString()
      setMinutesByAgenda(prev => new Map(prev).set(agendaId, {
        content: result.content,
        updatedAt,
        minuteId: result.minuteId,
        sourceAgendaRevision: minute.agendaContentRevision ?? minute.sourceAgendaRevision ?? null,
        agendaContentRevision: minute.agendaContentRevision ?? minute.sourceAgendaRevision ?? null,
        isStale: false,
        resolvedOutcomeMode: result.resolvedOutcomeMode,
        resolutionVariantKey: result.resolutionVariantKey,
        resolutionVariantLabel: result.resolutionVariantLabel,
        resolutionVariantSource: result.resolutionVariantSource,
        resolutionExactRenderEnforced: result.resolutionExactRenderEnforced,
      }))
      toast.success(`Agenda outcome switched to ${getResolvedOutcomeLabel(result.resolvedOutcomeMode)}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to switch agenda outcome')
    } finally {
      setSwitchingOutcomeAgendaIds(prev => {
        const next = new Set(prev)
        next.delete(agendaId)
        return next
      })
      setPendingOutcomeModeByAgendaId(prev => {
        const next = new Map(prev)
        next.delete(agendaId)
        return next
      })
    }
  }

  async function setStatus(agendaId: string, status: 'done' | 'ongoing' | 'pending') {
    onAgendaStatusesChange(prev => new Map(prev).set(agendaId, status))
    try { await updateAgendaStatusesRequest(meetingId, [agendaId], status) } catch { /* optimistic */ }
  }

  async function bulkStatus(status: 'done' | 'pending') {
    const activeAgendaIds = existingAgendas
      .filter(agenda => !skippedAgendaIdSet.has(agenda.id))
      .map(agenda => agenda.id)

    if (activeAgendaIds.length === 0) {
      toast.info('All agendas are marked as Not Minuted')
      return
    }

    onAgendaStatusesChange(prev => {
      const next = new Map(prev)
      activeAgendaIds.forEach(id => next.set(id, status))
      return next
    })

    try { await updateAgendaStatusesRequest(meetingId, activeAgendaIds, status) } catch { toast.error('Failed to update') }
  }

  async function handleFormatting(agendaId: string) {
    if (!committeeId) {
      toast.error('No committee linked — assign a committee first')
      return
    }
    try {
      const formatting = await getAgendaFormattingStateRequest(meetingId, agendaId)
      setAgendaFormattingStates(prev => new Map(prev).set(agendaId, formatting))
      // Merge server data with existing client state — don't overwrite client values with empty server responses
      // (server may return empty due to RLS, missing column, or pending DB write from applyFormatToSubItems)
      setFormattedAgendas(prev => {
        const next = new Map(prev)
        if (formatting.templateId) next.set(agendaId, formatting.templateId)
        else next.delete(agendaId)
        return next
      })
      setAgendaPlaybookIds(prev => {
        const next = new Map(prev)
        if (formatting.playbookId) next.set(agendaId, formatting.playbookId)
        else next.delete(agendaId)
        return next
      })
      setAgendaPromptTexts(prev => {
        const next = new Map(prev)
        if (formatting.promptText) next.set(agendaId, formatting.promptText)
        else next.delete(agendaId)
        return next
      })
      setAgendaInfos(prev => {
        const next = new Map(prev)
        if (formatting.additionalInfo) next.set(agendaId, formatting.additionalInfo)
        else next.delete(agendaId)
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
    try {
      const sourceFormatting = agendaFormattingStates.get(sectionHeadingId)
        ?? await getAgendaFormattingStateRequest(meetingId, sectionHeadingId)

      if (!sourceFormatting.templateId && !sourceFormatting.playbookId) {
        toast.error('Save formatting on the heading first before applying to sub-items')
        return
      }

      const result = await applyFormatToSubItemsRequest(meetingId, {
        sourceAgendaId: sectionHeadingId,
      }, itemIds)

      setFormattedAgendas(prev => {
        const next = new Map(prev)
        itemIds.forEach(id => {
          if (sourceFormatting.templateId) next.set(id, sourceFormatting.templateId)
          else next.delete(id)
        })
        return next
      })
      setAgendaPlaybookIds(prev => {
        const next = new Map(prev)
        itemIds.forEach(id => {
          if (sourceFormatting.playbookId) next.set(id, sourceFormatting.playbookId)
          else next.delete(id)
        })
        return next
      })
      setAgendaPromptTexts(prev => {
        const next = new Map(prev)
        itemIds.forEach(id => {
          if (sourceFormatting.promptText) next.set(id, sourceFormatting.promptText)
          else next.delete(id)
        })
        return next
      })
      setAgendaInfos(prev => {
        const next = new Map(prev)
        itemIds.forEach(id => {
          if (sourceFormatting.additionalInfo) next.set(id, sourceFormatting.additionalInfo)
          else next.delete(id)
        })
        return next
      })
      setAgendaFormattingStates(prev => {
        const next = new Map(prev)
        next.set(sectionHeadingId, sourceFormatting)
        itemIds.forEach(id => next.set(id, { ...sourceFormatting, agendaId: id }))
        return next
      })

      // Save localStorage drafts for each sub-item so FormatDialog picks them up on open
      const headingInfo = sourceFormatting.additionalInfo ?? ''
      const headingName = sourceFormatting.playbookName ?? sourceFormatting.templateName ?? ''
      for (const id of itemIds) {
        const itemTitle = existingAgendas.find(a => a.id === id)?.title ?? ''
        saveDraftToStorage(id, {
          name: headingName || itemTitle,
          additionalInfo: headingInfo,
          saveAsCommitteePlaybook: true,
          playbookMode: sourceFormatting.playbookMode,
          resolutionPathsEnabled: sourceFormatting.resolutionPathsEnabled,
          variantTexts: {
            default: sourceFormatting.variants.find(variant => variant.variantKey === 'default')?.promptText ?? sourceFormatting.promptText,
            with_action: sourceFormatting.variants.find(variant => variant.variantKey === 'with_action')?.promptText ?? '',
            without_action: sourceFormatting.variants.find(variant => variant.variantKey === 'without_action')?.promptText ?? '',
          },
        })
      }
      toast.success(
        result.autoSavedCommitteeDefault
          ? `Format applied to ${itemIds.length} sub-item${itemIds.length > 1 ? 's' : ''} and future meetings will inherit it`
          : `Format applied to ${itemIds.length} sub-item${itemIds.length > 1 ? 's' : ''}`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to apply format')
    }
  }

  function handleGoDeeper(agendaId: string) {
    push(`/meeting/${meetingId}/editor?agenda=${agendaId}&returnTab=generate`)
  }

  function resolveExtractMinuteContent(agendaId: string) {
    const draftMinute = generationState.draftMinutesByAgenda[agendaId]
    if (draftMinute?.content?.trim()) {
      return draftMinute.content.trim()
    }

    const visibleEditedMinute = minuteDraftTexts.get(agendaId)?.trim()
    if (visibleEditedMinute) {
      return visibleEditedMinute
    }

    const liveMinute = minutesByAgenda.get(agendaId)
    if (liveMinute?.content?.trim()) {
      return liveMinute.content.trim()
    }

    const importedMinute = currentMinutesByAgenda[agendaId]
    return importedMinute?.content?.trim() ?? ''
  }

  async function handleExtractMinute(agenda: Agenda) {
    if (skippedAgendaIdSet.has(agenda.id)) {
      toast.error('Extract Minute is not available for agendas marked as Not Minuted')
      return
    }

    const minuteContent = resolveExtractMinuteContent(agenda.id)
    if (!minuteContent) {
      toast.error('Generate or import a minute for this agenda first')
      return
    }

    setExtractingAgendaId(agenda.id)
    try {
      const result = await postJson<ExtractMinuteDownloadResult & {
        ok: true
      }>(`/api/meeting/${meetingId}/extract-minute`, {
        agendaId: agenda.id,
        minuteContent,
      })

      const templateBuffer = await fetchTemplateBuffer(result.templateUrl)
      const blob = await buildExtractMinuteFromTemplate(templateBuffer, result)

      const filename = `${sanitizeFileName(`${result.meetingTitle}_${result.agendaNo}_${result.agendaTitle}`) || 'extract_minute'}.docx`
      downloadBlob(filename, blob)
      toast.success(`Extract Minute downloaded for Agenda ${result.agendaNo}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download Extract Minute')
    } finally {
      setExtractingAgendaId(current => (current === agenda.id ? null : current))
    }
  }

  async function handleSaveProgress() {
    try {
      await bulkSaveSkippedRequest(meetingId, skippedAgendaIds)
      toast.success("Saved this meeting's Step 2 state.")
    } catch {
      toast.error("Failed to save this meeting's Step 2 state")
    }
  }

  async function handleSaveCommitteeDefault() {
    if (!committeeId) {
      toast.error('Link this meeting to a committee before saving a committee default')
      return
    }
    if (!hasAnyCommitteeFormattingSource) {
      toast.error('Add at least one agenda formatting before saving a committee default')
      return
    }

    setIsSavingCommitteeDefault(true)
    try {
      await saveCommitteeFormattingDefaultRequest(meetingId)
      toast.success('Future meetings in this committee will start with this formatting.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save committee default')
    } finally {
      setIsSavingCommitteeDefault(false)
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
      await clearMeetingFormattingRequest(meetingId)
      existingAgendas.forEach(a => clearDraftFromStorage(a.id))
      setFormattedAgendas(new Map())
      setAgendaPlaybookIds(new Map())
      setAgendaFormattingStates(new Map())
      setAgendaInfos(new Map())
      setAgendaPromptTexts(new Map())
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
      await clearAllGeneratedMinutesRequest(meetingId)
      setMinutesByAgenda(mergeMinutes({}, generationState.draftMinutesByAgenda))
      onAgendaStatusesChange(new Map(existingAgendas.map(a => [a.id, 'pending'])))
      toast.success('All generated minutes cleared')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear minutes')
    } finally {
      setIsClearingMinutes(false)
    }
  }

  function renderStatusControl(
    agendaId: string,
    status: 'done' | 'ongoing' | 'pending',
    isSkipped: boolean,
  ) {
    if (isSkipped) {
      return <RunStateBadge state="skipped" />
    }

    const runState = generationState.runStateByAgendaId[agendaId]
    const errorMessage = generationState.errorByAgendaId[agendaId]
    const attemptCount = generationState.draftRowsByAgendaId[agendaId]?.attemptCount
    if (runState === 'queued' || runState === 'running' || runState === 'failed' || runState === 'skipped') {
      return <RunStateBadge state={runState} errorMessage={errorMessage} attemptCount={attemptCount} />
    }

    return (
      <StatusSelect
        status={status}
        onChange={(value) => setStatus(agendaId, value)}
      />
    )
  }

  async function handleRegenerateFailedAgenda(agendaId: string) {
    if (!generationState.activeBatch || !generationState.lastGenerationConfig) {
      toast.error('No active draft batch is available to regenerate')
      return
    }

    const agenda = existingAgendas.find(item => item.id === agendaId)
    if (!agenda) return

    const started = await onStartGeneration({
      agendas: [agenda],
      generationConfig: {
        ...generationState.lastGenerationConfig,
        skippedAgendaIds,
      },
      reuseActiveBatch: true,
    })

    if (started) {
      toast.success(generationState.isGenerating
        ? `Queued retry for ${agenda.agenda_no}`
        : `Regenerating draft for ${agenda.agenda_no}`)
    }
  }

  async function handleRegenerateFailedAgendas() {
    if (!generationState.activeBatch || !generationState.lastGenerationConfig) {
      toast.error('No active draft batch is available to regenerate')
      return
    }

    const retryAgendas = existingAgendas.filter(
      agenda => failedDraftAgendaIds.includes(agenda.id) && !skippedAgendaIdSet.has(agenda.id),
    )
    if (retryAgendas.length === 0) return

    const started = await onStartGeneration({
      agendas: retryAgendas,
      generationConfig: {
        ...generationState.lastGenerationConfig,
        skippedAgendaIds,
      },
      reuseActiveBatch: true,
    })

    if (started) {
      toast.success(generationState.isGenerating
        ? `Queued ${retryAgendas.length} failed draft${retryAgendas.length === 1 ? '' : 's'} for retry`
        : `Regenerating ${retryAgendas.length} failed draft${retryAgendas.length === 1 ? '' : 's'}`)
    }
  }

  async function handleResumeRemainingAgendas() {
    if (!generationState.activeBatch || !generationState.lastGenerationConfig) {
      toast.error('No active draft MoM batch is available to resume')
      return
    }

    const resumableAgendas = existingAgendas.filter(
      agenda => resumableDraftAgendaIds.includes(agenda.id) && !skippedAgendaIdSet.has(agenda.id),
    )
    if (resumableAgendas.length === 0) return

    const started = await onStartGeneration({
      agendas: resumableAgendas,
      generationConfig: {
        ...generationState.lastGenerationConfig,
        skippedAgendaIds,
      },
      reuseActiveBatch: true,
    })

    if (started) {
      toast.success(interruptedDraftCount > 0
        ? `Resuming ${resumableAgendas.length} interrupted draft${resumableAgendas.length === 1 ? '' : 's'}`
        : `Resuming ${resumableAgendas.length} remaining draft${resumableAgendas.length === 1 ? '' : 's'}`)
    }
  }

  function renderMinutePanel(agenda: Agenda, skipped: boolean) {
    if (!expandedAgendaIds.has(agenda.id)) return null
    const importedMinute = currentMinutesByAgenda[agenda.id]
    const draftMinute = generationState.draftMinutesByAgenda[agenda.id]
    const liveMinute = minutesByAgenda.get(agenda.id)
    const minute = liveMinute ?? draftMinute ?? importedMinute
    const hasImportedMinute = Boolean(importedMinute?.content?.trim())
    const hasDraftMinute = Boolean(draftMinute?.content?.trim())
    const isEditingMinute = editingMinuteAgendaIds.has(agenda.id)
    const isSavingMinute = savingMinuteAgendaIds.has(agenda.id)
    const isSwitchingOutcome = switchingOutcomeAgendaIds.has(agenda.id)
    const pendingOutcomeMode = pendingOutcomeModeByAgendaId.get(agenda.id) ?? null
    const runState = generationState.runStateByAgendaId[agenda.id]
    const error = generationState.errorByAgendaId[agenda.id]
    const attemptCount = generationState.draftRowsByAgendaId[agenda.id]?.attemptCount ?? 0
    const timeoutSeconds = parseMomDraftTimeoutSeconds(error)
    const status = skipped
      ? 'Skipped'
      : runState === 'failed' && isMomDraftTimeoutMessage(error)
        ? 'Draft Timed Out'
      : runState === 'failed'
        ? 'Draft Failed'
      : runState === 'queued'
          ? 'Retry Queued'
        : runState === 'done' && hasDraftMinute
          ? 'Draft Ready'
        : hasImportedMinute
            ? 'Imported'
          : runState === 'running'
            ? (attemptCount > 1 ? 'Draft Retrying' : 'Draft Generating')
            : runState === 'skipped'
              ? 'Draft Skipped'
              : 'Pending'
    const canEditMinute = (status === 'Imported' && Boolean(minute?.minuteId)) || (status === 'Draft Ready' && Boolean(minute?.content?.trim()))
    const canSwitchOutcome = (status === 'Imported' || status === 'Draft Ready') && Boolean(minute?.content?.trim())
    const isStaleMinute = isMinuteEntryStale(minute)
    const minuteDraftText = minuteDraftTexts.get(agenda.id) ?? minute?.content ?? ''
    const resolvedOutcomeMode = minute?.resolvedOutcomeMode ?? null
    const resolutionVariantLabel = minute?.resolutionVariantLabel ?? generationState.draftRowsByAgendaId[agenda.id]?.resolutionVariantLabel ?? null
    const resolutionVariantSource = minute?.resolutionVariantSource ?? generationState.draftRowsByAgendaId[agenda.id]?.resolutionVariantSource ?? null
    const resolutionSourceLabel = getResolutionVariantSourceLabel(resolutionVariantSource)
    const showsResolutionVariant = Boolean(minute?.resolutionExactRenderEnforced ?? generationState.draftRowsByAgendaId[agenda.id]?.resolutionExactRenderEnforced)

    return (
      <div className="border-t border-zinc-100 bg-zinc-50/60 px-12 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/30">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                status === 'Draft Ready' || status === 'Imported'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : status === 'Draft Failed' || status === 'Draft Timed Out'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    : status === 'Retry Queued'
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                    : status === 'Draft Generating' || status === 'Draft Retrying'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : status === 'Draft Skipped' || status === 'Skipped'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {status}
            </span>
            {isStaleMinute ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                Stale
              </span>
            ) : null}
            {resolvedOutcomeMode ? (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                resolvedOutcomeMode === 'follow_up'
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
              }`}>
                {getResolvedOutcomeLabel(resolvedOutcomeMode)}
              </span>
            ) : null}
            {showsResolutionVariant && resolutionVariantLabel ? (
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                {resolutionVariantLabel}
              </span>
            ) : null}
            {showsResolutionVariant && resolutionSourceLabel ? (
              <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {resolutionSourceLabel}
              </span>
            ) : null}
            {minute?.updatedAt && (
              <span className="text-[11px] text-zinc-500">Updated {formatUpdatedAt(minute.updatedAt)}</span>
            )}
            {isSwitchingOutcome ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Updating outcome
              </span>
            ) : null}
          </div>

          {canEditMinute ? (
            <div className="flex items-center gap-2">
              {isEditingMinute ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => cancelMinuteEdit(agenda.id)}
                    disabled={isSavingMinute}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => {
                      if (minute) {
                        void saveMinuteEdit(agenda.id, minute)
                      }
                    }}
                    disabled={isSavingMinute}
                  >
                    {isSavingMinute ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {isSavingMinute ? 'Saving...' : 'Save'}
                  </Button>
                </>
              ) : (
                <>
                  {canSwitchOutcome && minute ? (
                    <div className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/90 p-1 dark:border-zinc-700 dark:bg-zinc-900">
                      {(['closed', 'follow_up'] as const).map(mode => (
                        <Button
                          key={mode}
                          variant={resolvedOutcomeMode === mode ? 'default' : 'ghost'}
                          size="sm"
                          className="h-7 rounded-full px-2 text-xs"
                          disabled={isSavingMinute || isSwitchingOutcome || resolvedOutcomeMode === mode}
                          onClick={() => {
                            if (!isSwitchingOutcome && resolvedOutcomeMode !== mode) {
                              void switchAgendaResolvedOutcome(agenda.id, mode, minute)
                            }
                          }}
                        >
                          {isSwitchingOutcome && pendingOutcomeMode === mode ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {getResolvedOutcomeLabel(mode)}
                            </span>
                          ) : (
                            getResolvedOutcomeLabel(mode)
                          )}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => {
                      if (minute) {
                        beginMinuteEdit(agenda.id, minute.content)
                      }
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>
        {status === 'Draft Ready' && minute ? (
          isEditingMinute ? (
            <div className="space-y-3">
              {isStaleMinute ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  This draft is based on an older Step 1 agenda version. Saving after review will update this draft before import.
                </div>
              ) : null}
              <Textarea
                value={minuteDraftText}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setMinuteDraftTexts(prev => new Map(prev).set(agenda.id, nextValue))
                }}
                rows={8}
                className="min-h-[220px] rounded-xl text-sm leading-6"
                disabled={isSavingMinute}
              />
              <p className="text-[11px] text-zinc-500">
                Edit this draft here. Saving updates the draft batch, so Import MoM will use your edited version.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {isStaleMinute ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  This draft is based on an older Step 1 agenda version. Review or regenerate it before finalizing.
                </div>
              ) : null}
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                Draft generated successfully. Review it here, regenerate any failed agendas, then click <span className="font-semibold">Import MoM</span> to commit all successful drafts.
              </div>
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs leading-5 dark:border-zinc-700 dark:bg-zinc-900">
                {minute.content}
              </div>
            </div>
          )
        ) : status === 'Imported' && minute ? (
          isEditingMinute ? (
            <div className="space-y-3">
              {isStaleMinute ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  Step 1 changed after this minute was generated. Saving after review will mark this minute as up to date again.
                </div>
              ) : null}
              <Textarea
                value={minuteDraftText}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setMinuteDraftTexts(prev => new Map(prev).set(agenda.id, nextValue))
                }}
                rows={8}
                className="min-h-[220px] rounded-xl text-sm leading-6"
                disabled={isSavingMinute}
              />
              <p className="text-[11px] text-zinc-500">
                Edit this imported minute here and save without leaving the Generate MoM screen.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {isStaleMinute ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  Step 1 changed after this minute was generated. Review or regenerate this agenda before finalizing the meeting.
                </div>
              ) : null}
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs leading-5 dark:border-zinc-700 dark:bg-zinc-900">
                {minute.content}
              </div>
            </div>
          )
        ) : status === 'Draft Failed' || status === 'Draft Timed Out' ? (
          <div className="space-y-3">
            <p className="text-xs text-red-600 dark:text-red-400">
              {error ?? (status === 'Draft Timed Out'
                ? timeoutSeconds
                  ? `Draft generation timed out after ${timeoutSeconds} seconds for this agenda.`
                  : 'Draft generation timed out for this agenda.'
                : 'Draft generation failed for this agenda.')}
            </p>
            {generationState.lastGenerationConfig ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { void handleRegenerateFailedAgenda(agenda.id) }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {generationState.isGenerating ? 'Queue this retry' : 'Regenerate this draft'}
              </Button>
            ) : null}
          </div>
        ) : status === 'Draft Generating' || status === 'Draft Retrying' ? (
          <p className="text-xs text-blue-600 dark:text-blue-300">
            {status === 'Draft Retrying'
              ? 'This agenda draft is currently being retried with the current timeout budget.'
              : 'This agenda draft is currently being generated.'}
          </p>
        ) : status === 'Retry Queued' ? (
          <p className="text-xs text-violet-600 dark:text-violet-300">This agenda has been queued to regenerate after the current draft finishes.</p>
        ) : status === 'Draft Skipped' || status === 'Skipped' ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-300">Marked as Not Minuted for this run.</p>
        ) : (
          <p className="text-xs text-zinc-600 dark:text-zinc-300">No draft minute yet for this row.</p>
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
                    }
                    className="gap-2"
                  >
                    {generationState.isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {hasDraftBatch || hasImportedMinutes ? 'Regenerate Draft MoM' : 'Generate Draft MoM'}
                  </Button>
                </span>
              </TooltipTrigger>
              {!isFormatComplete ? (
                <TooltipContent>
                  Exact mode requires saved formatting for every active agenda before generation can start.
                </TooltipContent>
              ) : null}
            </Tooltip>
            <Button variant="outline" onClick={handleSaveProgress} className="gap-2">
              <Save className="h-4 w-4" />
              Save Progress
            </Button>
            <Button
              variant="outline"
              onClick={() => { void handleSaveCommitteeDefault() }}
              disabled={!committeeId || !hasAnyCommitteeFormattingSource || isSavingCommitteeDefault || generationState.isGenerating}
              className="gap-2"
            >
              {isSavingCommitteeDefault ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
              Save as Committee Default
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
            {hasDraftProgress ? (
              <Button
                variant="outline"
                onClick={onOpenDraftProgress}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Draft Progress
              </Button>
            ) : null}
            <p className="basis-full text-xs text-zinc-500">
              Save Progress affects this meeting only. Save as Committee Default pre-fills future meetings in this committee.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!generationState.isGenerating && resumableDraftAgendaIds.length > 0 && generationState.lastGenerationConfig ? (
              <Button
                size="sm"
                onClick={() => { void handleResumeRemainingAgendas() }}
                className="gap-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Resume Remaining ({resumableDraftAgendaIds.length})
              </Button>
            ) : null}
            {failedDraftAgendaIds.length > 0 && generationState.lastGenerationConfig ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleRegenerateFailedAgendas() }}
                className="gap-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {generationState.isGenerating ? 'Queue Failed Retry' : 'Regenerate Failed'}
              </Button>
            ) : null}
          </div>
        </div>

        {staleCurrentAgendaIds.length > 0 ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            {staleCurrentAgendaIds.length === 1
              ? '1 imported minute is stale because Step 1 changed after it was generated. Review or regenerate it before Finalize MoM.'
              : `${staleCurrentAgendaIds.length} imported minutes are stale because Step 1 changed after they were generated. Review or regenerate them before Finalize MoM.`}
          </div>
        ) : null}

        <div className="rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-700">
          {sections.map(section => {
            const isSkipped = skippedAgendaIdSet.has(section.heading.id)
            const itemIds = section.items.map(i => i.id)
            const headingStatus = agendaStatuses.get(section.heading.id) ?? 'pending'
            const headingMinute = minutesByAgenda.get(section.heading.id) ?? currentMinutesByAgenda[section.heading.id]
            const headingResolvedOutcomeMode = headingMinute?.minuteId
              ? headingMinute.resolvedOutcomeMode ?? null
              : null
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
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm font-semibold">{section.heading.title}</span>
                    <OutcomeStateBadge mode={headingResolvedOutcomeMode} />
                  </div>

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
                      onClick={() => { void handleExtractMinute(section.heading) }}
                      disabled={Boolean(extractingAgendaId)}
                      className="h-6 px-2 rounded border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 text-[11px] font-medium text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-900/30 transition-colors"
                    >
                      {extractingAgendaId === section.heading.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <FileOutput className="h-3 w-3" />
                      )}
                      {extractingAgendaId === section.heading.id ? 'Preparing...' : 'Extract Minute'}
                    </button>

                    {renderStatusControl(section.heading.id, headingStatus, isSkipped)}

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
                  const itemSkipped = skippedAgendaIdSet.has(item.id)
                  const itemStatus = agendaStatuses.get(item.id) ?? 'pending'
                  const itemMinute = minutesByAgenda.get(item.id) ?? currentMinutesByAgenda[item.id]
                  const itemResolvedOutcomeMode = itemMinute?.minuteId
                    ? itemMinute.resolvedOutcomeMode ?? null
                    : null
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
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-sm">{item.title}</span>
                          <OutcomeStateBadge mode={itemResolvedOutcomeMode} />
                        </div>
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
                            onClick={() => { void handleExtractMinute(item) }}
                            disabled={Boolean(extractingAgendaId)}
                            className="h-6 px-2 rounded border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 text-[11px] font-medium text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-900/30 transition-colors"
                          >
                            {extractingAgendaId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <FileOutput className="h-3 w-3" />
                            )}
                            {extractingAgendaId === item.id ? 'Preparing...' : 'Extract Minute'}
                          </button>

                          {renderStatusControl(item.id, itemStatus, itemSkipped)}

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

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-3">
          <p className="text-xs text-zinc-500">
            Bulk update Step 2 status. Formatting, templates, and playbook selections stay in this meeting.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkStatus('pending')}
              className="gap-2"
              disabled={generationState.isGenerating || activeAgendaCount === 0 || isStepTwoPending}
            >
              <RotateCcw className="h-4 w-4" />
              Mark all as pending
            </Button>
            <Button
              size="sm"
              onClick={() => bulkStatus('done')}
              className="gap-2"
              disabled={generationState.isGenerating || activeAgendaCount === 0 || isStepTwoDone}
            >
              <CircleCheck className="h-4 w-4" />
              Mark all as complete
            </Button>
          </div>
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

      {formatDialogAgendaId && committeeId && (
        <FormatDialog
          key={formatDialogAgendaId}
          open
          onOpenChange={open => { if (!open) setFormatDialogAgendaId(null) }}
          meetingId={meetingId}
          agendaId={formatDialogAgendaId}
          agendaTitle={existingAgendas.find(a => a.id === formatDialogAgendaId)?.title ?? ''}
          committeeId={committeeId}
          initialFormatting={agendaFormattingStates.get(formatDialogAgendaId) ?? null}
          onSaved={(payload) => {
            const currentAgendaId = formatDialogAgendaId
            if (!currentAgendaId) return

            setFormattedAgendas(prev => new Map(prev).set(currentAgendaId, payload.templateId))
            setAgendaPlaybookIds(prev => {
              const next = new Map(prev)
              if (payload.playbookId) next.set(currentAgendaId, payload.playbookId)
              else next.delete(currentAgendaId)
              return next
            })
            setAgendaPromptTexts(prev => new Map(prev).set(currentAgendaId, payload.promptText))
            setAgendaFormattingStates(prev => {
              const next = new Map(prev)
              const previous = next.get(currentAgendaId)
              next.set(currentAgendaId, {
                agendaId: payload.agendaId,
                playbookId: payload.playbookId,
                playbookName: payload.playbookName,
                playbookScope: payload.playbookScope,
                playbookMode: payload.playbookMode,
                resolutionPathsEnabled: payload.resolutionPathsEnabled,
                hasResolutionAnchor: payload.hasResolutionAnchor,
                templateId: payload.templateId,
                templateName: payload.templateName,
                promptText: payload.promptText,
                additionalInfo: payload.additionalInfo,
                compiledTemplateVersion: payload.compiledTemplateVersion,
                isCompiled: payload.isCompiled,
                variantOverrideId: payload.variantOverrideId,
                variantOverrideKey: payload.variantOverrideKey,
                defaultVariantKey: payload.defaultVariantKey,
                variants: payload.variants,
                availablePlaybooks: previous?.availablePlaybooks ?? [],
              })
              return next
            })
            setAgendaInfos(prev => {
              const next = new Map(prev)
              if (payload.additionalInfo) next.set(currentAgendaId, payload.additionalInfo)
              else next.delete(currentAgendaId)
              return next
            })
          }}
          onCleared={(agendaId) => {
            setFormattedAgendas(prev => { const next = new Map(prev); next.delete(agendaId); return next })
            setAgendaPlaybookIds(prev => { const next = new Map(prev); next.delete(agendaId); return next })
            setAgendaPromptTexts(prev => { const next = new Map(prev); next.delete(agendaId); return next })
            setAgendaInfos(prev => { const next = new Map(prev); next.delete(agendaId); return next })
            setAgendaFormattingStates(prev => { const next = new Map(prev); next.delete(agendaId); return next })
          }}
        />
      )}

      <GenerateDialog
        open={isGenerateDialogOpen}
        onOpenChange={setIsGenerateDialogOpen}
        meetingId={meetingId}
        existingAgendas={generationDialogAgendas}
        hasExistingTranscript={hasExistingTranscript}
        hasSavedTimeline={hasSavedTimeline}
        existingTimelineRows={timelineRows}
        initialMeetingRules={initialMeetingRules}
        skippedAgendaIds={skippedAgendaIds}
        generationState={generationState}
        onStartGeneration={onStartGeneration}
        onTimelineSaved={onTimelineRowsChange}
      />
    </TooltipProvider>
  )
}
