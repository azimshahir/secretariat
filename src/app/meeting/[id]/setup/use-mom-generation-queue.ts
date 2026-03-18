'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { generateMinutesForAgenda, type GenerationConfig } from '@/actions/ai-generate'
import type { Agenda } from '@/lib/supabase/types'
import { updateAgendaStatus } from './mom-actions'
import type { MinuteEntry } from './minute-entry'

export type AgendaRunState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type LiveMinuteEntry = MinuteEntry

export interface AgendaQueueItem {
  id: string
  agendaNo: string
  title: string
}

export interface MomGenerationState {
  isGenerating: boolean
  cancelRequested: boolean
  currentAgendaId: string | null
  completedCount: number
  totalCount: number
  queueItems: AgendaQueueItem[]
  runStateByAgendaId: Record<string, AgendaRunState>
  errorByAgendaId: Record<string, string>
  liveMinutesByAgenda: Record<string, LiveMinuteEntry>
}

export interface StartMomGenerationOptions {
  agendas: Agenda[]
  generationConfig: GenerationConfig
}

const EMPTY_STATE: MomGenerationState = {
  isGenerating: false,
  cancelRequested: false,
  currentAgendaId: null,
  completedCount: 0,
  totalCount: 0,
  queueItems: [],
  runStateByAgendaId: {},
  errorByAgendaId: {},
  liveMinutesByAgenda: {},
}

function toQueueItems(agendas: Agenda[]): AgendaQueueItem[] {
  return agendas.map(agenda => ({
    id: agenda.id,
    agendaNo: agenda.agenda_no,
    title: agenda.title,
  }))
}

function summarizeRun(generated: number, skipped: number, failed: number) {
  return `${generated} done, ${skipped} skipped, ${failed} failed`
}

export function useMomGenerationQueue() {
  const router = useRouter()
  const [state, setState] = useState<MomGenerationState>(EMPTY_STATE)
  const cancelRef = useRef(false)
  const runningRef = useRef(false)

  async function persistAgendaStatus(agendaId: string, status: 'done' | 'ongoing' | 'pending') {
    try {
      await updateAgendaStatus([agendaId], status)
    } catch {
      // Keep the queue moving even if a status sync fails.
    }
  }

  function cancelGeneration() {
    if (!runningRef.current) return
    cancelRef.current = true
    setState(prev => ({ ...prev, cancelRequested: true }))
  }

  function resetGenerationState() {
    if (runningRef.current) return
    setState(prev => ({
      ...EMPTY_STATE,
      liveMinutesByAgenda: prev.liveMinutesByAgenda,
    }))
  }

  function clearLiveMinutes() {
    setState(prev => ({
      ...prev,
      liveMinutesByAgenda: {},
      queueItems: [],
      runStateByAgendaId: {},
      errorByAgendaId: {},
      currentAgendaId: null,
      completedCount: 0,
      totalCount: 0,
      cancelRequested: false,
    }))
  }

  async function runQueue(agendas: Agenda[], generationConfig: GenerationConfig) {
    let processed = 0
    let generated = 0
    let skipped = 0
    let failed = 0

    for (const agenda of agendas) {
      if (cancelRef.current) break

      setState(prev => ({
        ...prev,
        currentAgendaId: agenda.id,
        runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'running' },
      }))
      await persistAgendaStatus(agenda.id, 'ongoing')

      try {
        const result = await generateMinutesForAgenda(agenda.id, generationConfig)
        generated += 1
        processed += 1

        setState(prev => ({
          ...prev,
          completedCount: processed,
          runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'done' },
          liveMinutesByAgenda: {
            ...prev.liveMinutesByAgenda,
            [agenda.id]: {
              content: result.content,
              updatedAt: new Date().toISOString(),
              minuteId: result.minuteId ?? undefined,
            },
          },
        }))
        await persistAgendaStatus(agenda.id, 'done')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isMissingSegments = message.toLowerCase().includes('no transcript segments')

        processed += 1
        if (isMissingSegments) {
          skipped += 1
          setState(prev => ({
            ...prev,
            completedCount: processed,
            runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'skipped' },
          }))
        } else {
          failed += 1
          setState(prev => ({
            ...prev,
            completedCount: processed,
            runStateByAgendaId: { ...prev.runStateByAgendaId, [agenda.id]: 'failed' },
            errorByAgendaId: { ...prev.errorByAgendaId, [agenda.id]: message },
          }))
        }

        await persistAgendaStatus(agenda.id, 'pending')
      }
    }

    const wasCancelled = cancelRef.current
    cancelRef.current = false
    runningRef.current = false

    setState(prev => ({
      ...prev,
      isGenerating: false,
      cancelRequested: false,
      currentAgendaId: null,
    }))

    router.refresh()

    const summary = summarizeRun(generated, skipped, failed)
    if (wasCancelled) {
      toast.info(`Generation stopped after current agenda (${summary})`)
      return
    }

    if (failed > 0) {
      toast.error(`Generation finished with errors (${summary})`)
      return
    }

    toast.success(`Generation finished (${summary})`)
  }

  async function startGeneration({ agendas, generationConfig }: StartMomGenerationOptions) {
    if (runningRef.current) {
      toast.info('Generation is already running')
      return false
    }

    if (agendas.length === 0) {
      toast.info('No agendas to generate')
      return false
    }

    const queueItems = toQueueItems(agendas)
    runningRef.current = true
    cancelRef.current = false

    setState(prev => ({
      ...prev,
      isGenerating: true,
      cancelRequested: false,
      currentAgendaId: agendas[0].id,
      completedCount: 0,
      totalCount: agendas.length,
      queueItems,
      runStateByAgendaId: Object.fromEntries(agendas.map(agenda => [agenda.id, 'pending' as const])),
      errorByAgendaId: {},
    }))

    void runQueue(agendas, generationConfig)
    return true
  }

  return {
    state,
    startGeneration,
    cancelGeneration,
    resetGenerationState,
    clearLiveMinutes,
  }
}
