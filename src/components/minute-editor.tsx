'use client'

import { useState, useCallback } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ConfidenceMarker {
  offset: number
  length: number
  score: number
  reason: string
}

interface MinuteEditorProps {
  content: string
  confidenceData: ConfidenceMarker[]
  onChange: (content: string) => void
  onSelectionChange?: (selectedText: string) => void
}

export function MinuteEditor({ content, confidenceData, onChange, onSelectionChange }: MinuteEditorProps) {
  const [editing, setEditing] = useState(false)

  const handleSelection = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      if (!onSelectionChange) return
      const target = e.currentTarget
      const start = target.selectionStart ?? 0
      const end = target.selectionEnd ?? 0
      onSelectionChange(start < end ? target.value.slice(start, end) : '')
    },
    [onSelectionChange]
  )

  return (
    <div className="flex flex-col p-4">
      {editing ? (
        <Textarea
          value={content}
          onChange={e => onChange(e.target.value)}
          onSelect={handleSelection}
          onMouseUp={handleSelection}
          onKeyUp={handleSelection}
          className="min-h-[400px] resize-y text-sm leading-6"
          placeholder="Generated minutes will appear here..."
          autoFocus
        />
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-6 text-zinc-800 dark:text-zinc-200">
          {content}
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          variant={editing ? 'default' : 'outline'}
          onClick={() => setEditing(prev => !prev)}
          className="gap-1.5 text-xs"
        >
          <Pencil className="h-3.5 w-3.5" />
          {editing ? 'Done Editing' : 'Edit'}
        </Button>
      </div>
    </div>
  )
}
