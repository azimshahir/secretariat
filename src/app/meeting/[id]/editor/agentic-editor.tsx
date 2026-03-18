'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  FileText, Loader2, Save, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DualChatbot } from '@/components/dual-chatbot'
import { MinuteEditor } from '@/components/minute-editor'
import { generateMinutesForAgenda } from '@/actions/ai-generate'
import { saveMinuteContent, applyAiChange } from './editor-actions'
import type { Agenda, Minute } from '@/lib/supabase/types'

interface Props {
  meetingId: string
  agendas: Agenda[]
  activeAgendaId: string
  minute: Minute | null
}

export function AgenticEditor({ meetingId, agendas, activeAgendaId, minute }: Props) {
  const router = useRouter()
  const activeIndex = agendas.findIndex(a => a.id === activeAgendaId)
  const activeAgenda = agendas[activeIndex]
  const hasPrev = activeIndex > 0
  const hasNext = activeIndex < agendas.length - 1

  const [content, setContent] = useState(minute?.content ?? '')
  const [confidenceData, setConfidenceData] = useState(minute?.confidence_data ?? [])
  const [minuteId, setMinuteId] = useState<string | null>(minute?.id ?? null)
  const [selectedText, setSelectedText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)

  // Cleaned transcript available?
  const hasTranscript = !!minute?.prompt_1_output

  function openTranscriptWindow() {
    window.open(
      `/meeting/${meetingId}/editor/transcript?agenda=${activeAgendaId}`,
      '_blank',
      'width=720,height=800,scrollbars=yes',
    )
  }

  function openSummaryWindow() {
    window.open(
      `/meeting/${meetingId}/editor/summary?agenda=${activeAgendaId}`,
      '_blank',
      'width=720,height=800,scrollbars=yes',
    )
  }

  const navigateAgenda = useCallback((direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev' ? activeIndex - 1 : activeIndex + 1
    const newAgenda = agendas[newIndex]
    if (newAgenda) {
      router.push(`/meeting/${meetingId}/editor?agenda=${newAgenda.id}`)
      router.refresh()
    }
  }, [activeIndex, agendas, meetingId, router])

  const streamIntoEditor = useCallback(async (finalContent: string) => {
    const tokens = finalContent.match(/\S+\s*/g) ?? [finalContent]
    let draft = ''
    setContent('')
    for (const token of tokens) {
      draft += token
      setContent(draft)
      await new Promise(resolve => setTimeout(resolve, 14))
    }
  }, [])

  const handleGenerate = useCallback(async () => {
    setConfidenceData([])
    setGenerating(true)
    try {
      const result = await generateMinutesForAgenda(activeAgendaId)
      await streamIntoEditor(result.content)
      setConfidenceData(result.markers)
      setMinuteId(result.minuteId ?? null)
      toast.success('Minutes generated')
      router.refresh()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Generation failed'
      console.error('Generation failed:', e)
      toast.error(message)
    } finally {
      setGenerating(false)
    }
  }, [activeAgendaId, streamIntoEditor, router])

  const handleSave = useCallback(async () => {
    if (!minuteId) return
    setSaving(true)
    try {
      await saveMinuteContent(minuteId, content)
      toast.success('Minutes saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save')
    }
    setSaving(false)
  }, [minuteId, content])

  async function handleAiChange(newContent: string) {
    if (!minuteId) return
    setContent(newContent)
    try {
      await applyAiChange(minuteId, newContent)
      toast.success('AI change applied')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to apply AI change')
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isCmdOrCtrl = event.metaKey || event.ctrlKey
      if (isCmdOrCtrl && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (content && minuteId && !saving && !generating) handleSave()
      }
      if (isCmdOrCtrl && event.key === 'Enter') {
        event.preventDefault()
        if (!content && !generating) handleGenerate()
      }
      if (event.altKey && event.key === 'ArrowLeft' && hasPrev) {
        event.preventDefault()
        navigateAgenda('prev')
      }
      if (event.altKey && event.key === 'ArrowRight' && hasNext) {
        event.preventDefault()
        navigateAgenda('next')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [content, minuteId, saving, generating, hasPrev, hasNext, handleSave, handleGenerate, navigateAgenda])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,251,250,0.9))] px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost" size="icon"
            onClick={() => router.push(`/meeting/${meetingId}/setup`)}
            title="Back to Generate MoM"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost" size="icon"
            disabled={!hasPrev}
            onClick={() => navigateAgenda('prev')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm">
            <span className="font-semibold text-primary">{activeAgenda.agenda_no}:</span>{' '}
            <span>{activeAgenda.title}</span>
            <span className="ml-2 text-xs text-zinc-400">
              ({activeIndex + 1} of {agendas.length})
            </span>
          </div>
          <Button
            variant="ghost" size="icon"
            disabled={!hasNext}
            onClick={() => navigateAgenda('next')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {!content && (
            <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? 'Generating...' : 'Generate Minutes'}
            </Button>
          )}
          {content && minuteId && (
            <Button size="sm" variant="outline" onClick={handleSave} disabled={saving || generating} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Split: Editor + Chatbot */}
      <div className="flex flex-1 flex-col gap-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(246,251,250,0.74))] xl:flex-row">
        {/* Left Pane */}
        <div className="flex w-full flex-col border-b border-border/70 xl:w-1/2 xl:border-r xl:border-b-0">
          {/* Action buttons row */}
          <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Generated Minutes
          </h2>
          {generating && content && (
            <span className="text-[11px] text-emerald-600">Streaming draft...</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {hasTranscript && (
              <Button
                size="sm" variant="outline"
                onClick={openTranscriptWindow}
                className="gap-1.5 text-xs"
              >
                <FileText className="h-3.5 w-3.5" />
                Show Transcript
              </Button>
            )}
            {content && (
              <Button
                size="sm" variant="outline"
                onClick={openSummaryWindow}
                className="gap-1.5 text-xs"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Show Summary
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 bg-white/72">
          {/* Minute Editor */}
          {content ? (
            <MinuteEditor
              content={content}
              confidenceData={confidenceData}
              onChange={setContent}
              onSelectionChange={setSelectedText}
            />
          ) : generating ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-zinc-400">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Running 3-Prompt AI Engine...</p>
              <p className="text-xs">Context Cleaning → Cross-Reference → Synthesis</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-zinc-400">
              <Sparkles className="h-8 w-8" />
              <p className="text-sm">Click Generate Minutes to start</p>
            </div>
          )}
        </ScrollArea>
        </div>

        {/* Right Pane: Dual Chatbot */}
        <div className="flex w-full flex-col bg-white/68 xl:w-1/2">
          <DualChatbot
            agendaId={activeAgendaId}
            minuteContent={content}
            selectedText={selectedText}
            onClearSelection={() => setSelectedText('')}
            onContentChange={handleAiChange}
          />
        </div>
      </div>
    </div>
  )
}
