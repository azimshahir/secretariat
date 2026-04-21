'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link2, Scissors, Sparkles, Trash2, Users } from 'lucide-react'
import { useNavigationTransition } from '@/components/navigation-transition-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { deleteJson, patchJson, postJson } from '@/lib/api/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Agenda, Transcript, TranscriptSegment } from '@/lib/supabase/types'

interface Props {
  meetingId: string
  transcript: Transcript | null
  agendas: Agenda[]
  existingSegments: TranscriptSegment[]
}

export function SemanticMapper({ meetingId, transcript, agendas, existingSegments }: Props) {
  const { push } = useNavigationTransition()
  const [transcriptContent, setTranscriptContent] = useState(transcript?.content ?? '')
  const [segments, setSegments] = useState<TranscriptSegment[]>(existingSegments)
  const [showAssignMenu, setShowAssignMenu] = useState(false)
  const [selection, setSelection] = useState<{ text: string; start: number; end: number } | null>(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [generating, setGenerating] = useState(false)
  const [speakerDialogOpen, setSpeakerDialogOpen] = useState(false)
  const [speakerMapDraft, setSpeakerMapDraft] = useState<Record<string, string>>({})

  const lines = transcriptContent.split('\n').filter(l => l.trim())
  const speakerLabels = useMemo(() => {
    const labels = lines
      .map(line => line.match(/^(Speaker\s*\w+|[\w\s'.-]+?):\s/)?.[1])
      .filter((value): value is string => Boolean(value))
      .filter(label => /^Speaker\s*/i.test(label))
    return [...new Set(labels)]
  }, [lines])

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      setShowAssignMenu(false)
      return
    }

    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    // Calculate offset in full transcript
    const container = document.getElementById('transcript-content')
    if (!container) return

    const fullText = transcriptContent
    const start = fullText.indexOf(text)
    const end = start + text.length

    setSelection({ text, start, end })
    setMenuPos({ x: rect.left + rect.width / 2, y: rect.top - 10 })
    setShowAssignMenu(true)
  }, [transcriptContent])

  async function handleAssign(agendaId: string) {
    if (!selection || !transcript) return
    setShowAssignMenu(false)

    // Detect speaker from selection context
    let speaker: string | null = null
    const speakerMatch = selection.text.match(/^(Speaker\s*\w+|[\w\s'.]+?):\s/)
    if (speakerMatch) speaker = speakerMatch[1]

    try {
      const result = await postJson<{ ok: true; segment: TranscriptSegment }>(
        `/api/meeting/${meetingId}/map`,
        {
          action: 'assign_segment',
          transcriptId: transcript.id,
          agendaId,
          content: selection.text,
          speaker,
          startOffset: selection.start,
          endOffset: selection.end,
        },
      )
      setSegments(prev => [...prev, result.segment])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign segment')
      return
    }

    setSelection(null)
    window.getSelection()?.removeAllRanges()
    toast.success('Segment assigned')
  }

  async function handleRemove(segmentId: string) {
    setSegments(prev => prev.filter(s => s.id !== segmentId))
    try {
      await deleteJson<{ ok: true }>(`/api/meeting/${meetingId}/map`, { segmentId })
      toast.success('Segment removed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove segment')
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      await patchJson<{ ok: true }>(`/api/meeting/${meetingId}/status`, {
        status: 'generating',
      })
      toast.success('Starting minute generation')
      push(`/meeting/${meetingId}/editor`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start generation')
      setGenerating(false)
    }
  }

  const hasSegments = agendas.some(a => segments.some(s => s.agenda_id === a.id))

  function getSplitIndex(content: string) {
    const midpoint = Math.floor(content.length / 2)
    const right = content.indexOf(' ', midpoint)
    return right > 0 ? right : midpoint
  }

  async function handleSplit(segment: TranscriptSegment) {
    const splitIndex = getSplitIndex(segment.content)
    const first = segment.content.slice(0, splitIndex).trim()
    const second = segment.content.slice(splitIndex).trim()
    if (!first || !second) return
    try {
      const result = await postJson<{
        ok: true
        updatedSegment: TranscriptSegment
        insertedSegment: TranscriptSegment
      }>(`/api/meeting/${meetingId}/map`, {
        action: 'split_segment',
        segmentId: segment.id,
        splitIndex,
      })
      setSegments(prev => [
        ...prev.filter(s => s.id !== segment.id),
        result.updatedSegment,
        result.insertedSegment,
      ])
      toast.success('Segment split into two blocks')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to split segment')
    }
  }

  async function handleMerge(segment: TranscriptSegment, nextSegment: TranscriptSegment | undefined) {
    if (!nextSegment) return
    try {
      const result = await postJson<{
        ok: true
        mergedSegment: TranscriptSegment
        removedSegmentId: string
      }>(`/api/meeting/${meetingId}/map`, {
        action: 'merge_segments',
        firstSegmentId: segment.id,
        secondSegmentId: nextSegment.id,
      })
      setSegments(prev => prev
        .filter(s => s.id !== result.removedSegmentId)
        .map(s => (s.id === result.mergedSegment.id ? result.mergedSegment : s)))
      toast.success('Segments merged')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to merge segments')
    }
  }

  function openSpeakerDialog() {
    setSpeakerMapDraft(Object.fromEntries(speakerLabels.map(label => [label, label])))
    setSpeakerDialogOpen(true)
  }

  async function handleApplySpeakerMap() {
    if (!transcript) return
    try {
      const result = await postJson<{ ok: true; content: string }>(
        `/api/meeting/${meetingId}/map`,
        {
          action: 'apply_speaker_map',
          transcriptId: transcript.id,
          speakerMap: speakerMapDraft,
        },
      )
      const updated = result.content
      setTranscriptContent(updated)
      setSegments(prev => prev.map(segment => ({
        ...segment,
        speaker: segment.speaker && speakerMapDraft[segment.speaker] ? speakerMapDraft[segment.speaker] : segment.speaker,
      })))
      toast.success('Speaker labels mapped successfully')
      setSpeakerDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to map speakers')
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(246,251,250,0.78))] lg:flex-row">
      {/* Left Pane: Transcript */}
      <div className="flex w-full flex-col border-b border-border/70 lg:w-1/2 lg:border-r lg:border-b-0">
        <div className="border-b border-border/70 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-[-0.03em]">Transcript</h2>
              <p className="text-xs text-zinc-500">Highlight text and assign to an agenda</p>
            </div>
            {speakerLabels.length > 0 && (
              <Dialog open={speakerDialogOpen} onOpenChange={setSpeakerDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" onClick={openSpeakerDialog} className="gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Map Speakers
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Speaker Mapping</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    {speakerLabels.map(label => (
                      <div key={label} className="grid grid-cols-[120px_1fr] items-center gap-2">
                        <span className="text-xs text-zinc-500">{label}</span>
                        <Input
                          value={speakerMapDraft[label] ?? label}
                          onChange={e => setSpeakerMapDraft(prev => ({ ...prev, [label]: e.target.value }))}
                          placeholder="Enter actual name"
                        />
                      </div>
                    ))}
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleApplySpeakerMap}>Apply Mapping</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
        <ScrollArea className="flex-1 bg-white/72 p-4">
          <div
            id="transcript-content"
            className="space-y-2 text-sm leading-relaxed select-text"
            onMouseUp={handleMouseUp}
          >
            {lines.map((line, i) => {
              const speakerMatch = line.match(/^(Speaker\s*\w+|[\w\s'.]+?):\s(.*)/)
              return (
                <p key={i} className="rounded-xl px-2 py-1.5 hover:bg-secondary/70">
                  {speakerMatch ? (
                    <>
                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {speakerMatch[1]}:
                      </span>{' '}
                      {speakerMatch[2]}
                    </>
                  ) : (
                    line
                  )}
                </p>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Floating Assign Menu */}
      {showAssignMenu && selection && (
        <div
          className="fixed z-50"
          style={{ left: menuPos.x - 80, top: menuPos.y - 45 }}
        >
          <DropdownMenu open onOpenChange={setShowAssignMenu}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="shadow-lg">
                Assign to Agenda
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {agendas.map(a => (
                <DropdownMenuItem key={a.id} onClick={() => handleAssign(a.id)}>
                  {a.agenda_no}: {a.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Right Pane: Agenda Cards */}
      <div className="flex w-full flex-col lg:w-1/2">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-[-0.03em]">Agenda Blocks</h2>
            <p className="text-xs text-zinc-500">{agendas.length} agendas</p>
          </div>
          <Button
            size="sm"
            disabled={!hasSegments || generating}
            onClick={handleGenerate}
            className="gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {generating ? 'Starting...' : 'Generate Minutes'}
          </Button>
        </div>
        <ScrollArea className="flex-1 bg-white/62 p-4">
          <div className="space-y-4">
            {agendas.map(a => {
              const agendaSegments = segments
                .filter(s => s.agenda_id === a.id)
                .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
              return (
                <Card key={a.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        {a.agenda_no}: {a.title}
                      </CardTitle>
                      {agendaSegments.length > 0 && (
                        <Badge variant="secondary">{agendaSegments.length} chunks</Badge>
                      )}
                    </div>
                    {a.presenter && (
                      <p className="text-xs text-zinc-500">Presenter: {a.presenter}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    {agendaSegments.length === 0 ? (
                      <p className="py-4 text-center text-xs text-zinc-400">
                        No text assigned yet
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {agendaSegments.map((seg, index) => {
                          const nextSegment = agendaSegments[index + 1]
                          return (
                          <div
                            key={seg.id}
                            className="group relative rounded-[18px] border border-border/60 bg-secondary/35 p-3 text-xs"
                          >
                            {seg.speaker && (
                              <span className="font-semibold text-zinc-600 dark:text-zinc-400">
                                {seg.speaker}:{' '}
                              </span>
                            )}
                            <span className="text-zinc-700 dark:text-zinc-300">
                              {seg.content.length > 200
                                ? seg.content.slice(0, 200) + '...'
                                : seg.content}
                            </span>
                            <button
                              onClick={() => handleRemove(seg.id)}
                              className="absolute right-1 top-1 hidden rounded p-0.5 text-zinc-400 hover:text-red-500 group-hover:block"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                            <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100">
                              <button
                                onClick={() => handleSplit(seg)}
                                className="rounded border px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Scissors className="mr-1 inline h-3 w-3" />
                                Split
                              </button>
                              {nextSegment && (
                                <button
                                  onClick={() => handleMerge(seg, nextSegment)}
                                  className="rounded border px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                >
                                  <Link2 className="mr-1 inline h-3 w-3" />
                                  Merge Next
                                </button>
                              )}
                            </div>
                          </div>
                        )})}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
