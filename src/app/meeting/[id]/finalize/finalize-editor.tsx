'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, Loader2, Send, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Document, HeadingLevel, Packer, Paragraph, TextRun,
} from 'docx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { submitFinalizedMom } from '@/actions/finalize-mom'

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  initialContent: string
  templateUrl: string | null
  isFinalized: boolean
}

function sanitize(input: string) {
  return input.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function isHeading(line: string) {
  return /^(AGENDA\s+\d|#{1,3}\s|MINUTE OF MEETING|MINUTES OF|ACTION ITEM)/i.test(line.trim())
}

async function buildDocx(text: string, title: string, date: string) {
  const lines = text.split('\n')
  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: date, italics: true, color: '666666' })],
    }),
    new Paragraph({ text: '' }),
  ]
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { children.push(new Paragraph({ text: '' })); continue }
    if (isHeading(trimmed)) {
      children.push(new Paragraph({ text: trimmed.replace(/^#+\s*/, ''), heading: HeadingLevel.HEADING_2 }))
    } else {
      children.push(new Paragraph({ text: trimmed }))
    }
  }
  return Packer.toBlob(new Document({ sections: [{ children }] }))
}

export function FinalizeEditor({
  meetingId, meetingTitle, meetingDate, initialContent, templateUrl, isFinalized,
}: Props) {
  const router = useRouter()
  const [content, setContent] = useState(initialContent)
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)

  async function handleSubmit() {
    if (!content.trim()) { toast.error('Content cannot be empty'); return }
    setSubmitting(true)
    try {
      await submitFinalizedMom(meetingId, content)
      toast.success('MoM finalized successfully')
      router.push(`/meeting/${meetingId}/view`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to finalize')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      const filename = `${sanitize(meetingTitle) || 'minutes'}.docx`

      if (templateUrl) {
        // Use template engine if available
        const { fetchTemplateBuffer } = await import('../setup/docx-template-engine')
        const { buildMomFromTemplate } = await import('../setup/mom-template-engine')
        try {
          const templateBuffer = await fetchTemplateBuffer(templateUrl)
          const blob = await buildMomFromTemplate(templateBuffer, content, {
            meetingTitle, meetingDate,
          })
          downloadBlob(filename, blob)
          toast.success('DOCX downloaded')
          return
        } catch { /* fall through to fallback */ }
      }

      downloadBlob(filename, await buildDocx(content, meetingTitle, meetingDate))
      toast.success('DOCX downloaded')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => router.push(`/meeting/${meetingId}/setup`)}
            className="mb-2 flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Setup
          </button>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.05em]">
            Finalize Minute of Meeting
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{meetingTitle} &mdash; {meetingDate}</p>
        </div>
        {isFinalized && (
          <div className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Finalized
          </div>
        )}
      </div>

      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        className="min-h-[600px] resize-y border-border/70 bg-white/94 font-mono text-sm leading-7"
        placeholder="MoM content..."
      />

      <div className="flex items-center justify-end gap-3">
        <Button variant="outline" className="gap-2" onClick={() => { void handleDownload() }} disabled={downloading}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {downloading ? 'Downloading...' : 'Download DOCX'}
        </Button>
        <Button className="gap-2" onClick={() => { void handleSubmit() }} disabled={submitting || !content.trim()}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? 'Submitting...' : 'Submit MoM'}
        </Button>
      </div>
    </div>
  )
}
