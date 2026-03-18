'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, Loader2, MessageCircleQuestion, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { Agenda } from '@/lib/supabase/types'
import { DualChatbot } from '@/components/dual-chatbot'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { applyAiChange } from '../editor/editor-actions'
import type { MinuteEntry } from './minute-entry'

interface DashboardChatbotSectionProps {
  meetingId: string
  agendas: Agenda[]
  currentMinutesByAgenda: Record<string, MinuteEntry>
  liveMinutesByAgenda: Record<string, MinuteEntry>
  isGenerating: boolean
}

function toMinuteMap(source: Record<string, MinuteEntry>) {
  return new Map<string, MinuteEntry>(
    Object.entries(source).map(([agendaId, value]) => [agendaId, value]),
  )
}

export function DashboardChatbotSection({
  meetingId,
  agendas,
  currentMinutesByAgenda,
  liveMinutesByAgenda,
  isGenerating,
}: DashboardChatbotSectionProps) {
  const router = useRouter()
  const [selectedAgendaId, setSelectedAgendaId] = useState<string | null>(null)
  const [localMinutesByAgenda, setLocalMinutesByAgenda] = useState<Map<string, MinuteEntry>>(
    () => new Map(),
  )

  const minutesByAgenda = useMemo(() => {
    const next = toMinuteMap(currentMinutesByAgenda)
    Object.entries(liveMinutesByAgenda).forEach(([agendaId, minute]) => {
      next.set(agendaId, minute)
    })
    localMinutesByAgenda.forEach((minute, agendaId) => {
      next.set(agendaId, minute)
    })
    return next
  }, [currentMinutesByAgenda, liveMinutesByAgenda, localMinutesByAgenda])

  const availableAgendas = useMemo(
    () => agendas.filter(agenda => {
      const minute = minutesByAgenda.get(agenda.id)
      return Boolean(minute?.content?.trim())
    }),
    [agendas, minutesByAgenda],
  )

  const effectiveSelectedAgendaId = selectedAgendaId && availableAgendas.some(agenda => agenda.id === selectedAgendaId)
    ? selectedAgendaId
    : availableAgendas[0]?.id ?? null

  const selectedAgenda = availableAgendas.find(agenda => agenda.id === effectiveSelectedAgendaId) ?? null
  const selectedMinute = selectedAgenda ? minutesByAgenda.get(selectedAgenda.id) ?? null : null

  if (!selectedAgenda || !selectedMinute) return null

  const selectedAgendaIdValue = selectedAgenda.id

  async function handleAiChange(newContent: string) {
    const currentAgendaId = selectedAgendaIdValue
    const previousMinute = minutesByAgenda.get(currentAgendaId)
    const minuteId = previousMinute?.minuteId

    if (!previousMinute || !minuteId) {
      toast.error('This minute is not ready for chatbot edits yet.')
      return
    }

    setLocalMinutesByAgenda(prev => {
      const next = new Map(prev)
      next.set(currentAgendaId, {
        ...previousMinute,
        content: newContent,
        updatedAt: new Date().toISOString(),
      })
      return next
    })

    try {
      await applyAiChange(minuteId, newContent)
      toast.success('AI change applied')
    } catch (error) {
      setLocalMinutesByAgenda(prev => {
        const next = new Map(prev)
        next.set(currentAgendaId, previousMinute)
        return next
      })
      toast.error(error instanceof Error ? error.message : 'Failed to apply chatbot change')
    }
  }

  return (
    <div className="mt-6 space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4" />
            MoM Chatbot
          </h4>
          <p className="text-xs text-zinc-500">
            {isGenerating
              ? 'Chat opens agenda-by-agenda as each minute finishes. Use Go Deeper for excerpt-level edits.'
              : 'Chat directly against generated minutes from the dashboard.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedAgendaIdValue}
            onChange={event => setSelectedAgendaId(event.target.value)}
            className="h-9 min-w-[260px] rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {availableAgendas.map(agenda => (
              <option key={agenda.id} value={agenda.id}>
                {agenda.agenda_no} - {agenda.title}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => router.push(`/meeting/${meetingId}/editor?agenda=${selectedAgendaIdValue}`)}
          >
            <Search className="h-3.5 w-3.5" />
            Go Deeper
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {selectedAgenda.agenda_no} - {selectedAgenda.title}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Updated {new Date(selectedMinute.updatedAt).toLocaleString('en-MY', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            {isGenerating && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                Live
              </span>
            )}
          </div>

          <ScrollArea className="h-[520px] p-4">
            <div className="whitespace-pre-wrap text-sm leading-6 text-zinc-800 dark:text-zinc-200">
              {selectedMinute.content}
            </div>
          </ScrollArea>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <MessageCircleQuestion className="h-4 w-4 text-zinc-500" />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Ask questions or revise the selected minute
            </p>
          </div>
          <div className="h-[520px]">
            <DualChatbot
              agendaId={selectedAgendaIdValue}
              minuteContent={selectedMinute.content}
              onContentChange={handleAiChange}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
