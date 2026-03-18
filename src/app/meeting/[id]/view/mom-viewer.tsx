'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  content: string
}

const LINES_PER_PAGE = 60

export function MomViewer({ meetingId, meetingTitle, meetingDate, content }: Props) {
  const pages = useMemo(() => {
    const lines = content.split('\n')
    const result: string[][] = []
    for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
      result.push(lines.slice(i, i + LINES_PER_PAGE))
    }
    return result.length > 0 ? result : [['']]
  }, [content])

  const [currentPage, setCurrentPage] = useState(0)
  const totalPages = pages.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/meeting/${meetingId}/setup`}
            className="mb-2 flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Setup
          </Link>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.05em]">
            {meetingTitle}
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
            <span>{meetingDate}</span>
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
              Finalized
            </Badge>
          </div>
        </div>
        <Link href={`/meeting/${meetingId}/finalize`}>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        </Link>
      </div>

      <div className="rounded-[30px] border border-border/70 bg-white/94 p-8 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.42)] backdrop-blur">
        <div className="whitespace-pre-wrap font-mono text-sm leading-7 text-zinc-800 dark:text-zinc-200">
          {pages[currentPage].join('\n')}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => p - 1)}
            disabled={currentPage === 0}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-sm text-zinc-500">
            Page {currentPage + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => p + 1)}
            disabled={currentPage === totalPages - 1}
            className="gap-1"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
