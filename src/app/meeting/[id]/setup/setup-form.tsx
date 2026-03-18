'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, FileSpreadsheet, FileAudio, FileText } from 'lucide-react'
import { Dropzone } from '@/components/dropzone'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { parseAgendaExcel } from '@/actions/file-upload/agenda'
import { uploadTranscript } from '@/actions/file-upload/transcript'
import { uploadSlides } from '@/actions/file-upload/slides'
import { updateMeetingStatus } from '@/actions/file-upload/status'
import type { Agenda } from '@/lib/supabase/types'

interface SetupFormProps {
  meetingId: string
  existingAgendas: Agenda[]
  hasExistingTranscript: boolean
}

export function SetupForm({ meetingId, existingAgendas, hasExistingTranscript }: SetupFormProps) {
  const router = useRouter()
  const [agendas, setAgendas] = useState<Agenda[]>(existingAgendas)
  const [hasTranscript, setHasTranscript] = useState(hasExistingTranscript)
  const [proceeding, setProceeding] = useState(false)

  const canProceed = agendas.length > 0 && hasTranscript

  async function handleProceed() {
    setProceeding(true)
    try {
      await updateMeetingStatus(meetingId, 'mapping')
      toast.success('Meeting setup complete. Proceeding to mapping.')
      router.push(`/meeting/${meetingId}/map`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to proceed')
      setProceeding(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Step 1: Agenda Excel */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            <CardTitle className="text-base">Step 1: Agenda Template</CardTitle>
          </div>
          <CardDescription>
            Upload an Excel file with columns: Agenda No, Title, Presenter
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dropzone
            accept=".xlsx,.xls,.csv"
            label="Drop Excel file here"
            hint=".xlsx, .xls, or .csv"
            onFile={async (file) => {
              const count = await parseAgendaExcel(meetingId, file)
              // Refresh agendas from the action result
              const fakeAgendas = Array.from({ length: count }, (_, i) => ({
                id: String(i),
                meeting_id: meetingId,
                agenda_no: String(i + 1),
                title: `Agenda ${i + 1}`,
                presenter: null,
                slide_pages: null,
                format_template_id: null,
                additional_info: null,
                minute_status: 'pending' as const,
                is_skipped: false,
                sort_order: i,
                created_at: new Date().toISOString(),
              }))
              setAgendas(fakeAgendas)
              router.refresh()
              toast.success(`Agenda imported (${count} items)`)
            }}
          />
          {agendas.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {agendas.map(a => (
                <Badge key={a.id} variant="secondary">
                  {a.agenda_no}: {a.title}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Transcript */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileAudio className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base">Step 2: Meeting Transcript</CardTitle>
          </div>
          <CardDescription>
            Upload transcript (.docx / .vtt / .txt) or raw audio/video for Whisper STT
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dropzone
            accept=".docx,.vtt,.txt,audio/*,video/*"
            label="Drop transcript file here"
            hint=".docx/.vtt/.txt or audio/video"
            onFile={async (file) => {
              await uploadTranscript(meetingId, file)
              setHasTranscript(true)
              toast.success('Transcript processed successfully')
            }}
          />
        </CardContent>
      </Card>

      {/* Step 3: Slides PDF */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-orange-600" />
            <CardTitle className="text-base">Step 3: Slide Deck (Optional)</CardTitle>
          </div>
          <CardDescription>
            Upload the consolidated presentation slides for cross-referencing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dropzone
            accept=".pdf"
            label="Drop PDF slides here"
            hint=".pdf only"
            onFile={async (file) => {
              await uploadSlides(meetingId, file)
              toast.success('Slides uploaded and parsed')
            }}
          />
        </CardContent>
      </Card>

      {/* Proceed Button */}
      <Button
        size="lg"
        disabled={!canProceed || proceeding}
        onClick={handleProceed}
        className="self-end gap-2"
      >
        {proceeding ? 'Proceeding...' : 'Proceed to Mapping'}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
