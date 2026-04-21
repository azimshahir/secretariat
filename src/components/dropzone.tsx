'use client'

import { useCallback, useRef, useState } from 'react'
import { Upload, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DropzoneProps {
  accept: string
  label: string
  hint: string
  onFile: (file: File) => Promise<void>
  completeHint?: string
  completeVariant?: 'success' | 'selected'
}

export function Dropzone({
  accept,
  label,
  hint,
  onFile,
  completeHint = 'Uploaded successfully',
  completeVariant = 'success',
}: DropzoneProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [fileName, setFileName] = useState<string>()
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setStatus('loading')
    setFileName(file.name)
    setError(undefined)
    try {
      await onFile(file)
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setStatus('idle')
    }
  }, [onFile])

  function openFilePicker() {
    if (status === 'loading') return
    if (inputRef.current) {
      inputRef.current.value = ''
      inputRef.current.click()
    }
  }

  return (
    <>
    <div
      role="button"
      tabIndex={status === 'loading' ? -1 : 0}
      aria-disabled={status === 'loading'}
      onClick={() => openFilePicker()}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openFilePicker()
        }
      }}
      onDragEnter={e => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={e => {
        const nextTarget = e.relatedTarget
        if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
          return
        }
        setDragOver(false)
      }}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2',
        status === 'loading' ? 'cursor-progress' : 'cursor-pointer',
        dragOver && 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800',
        status === 'done' && completeVariant === 'success' && 'border-green-500 bg-green-50 dark:bg-green-950',
        status === 'done' && completeVariant === 'selected' && 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40',
        status === 'idle' && !dragOver && 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700',
      )}
    >
      {status === 'loading' && <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />}
      {status === 'done' && (
        <CheckCircle2 className={cn(
          'h-8 w-8',
          completeVariant === 'success' ? 'text-green-500' : 'text-blue-500',
        )} />
      )}
      {status === 'idle' && <Upload className="h-8 w-8 text-zinc-400" />}

      <div className="text-center">
        <p className="text-sm font-medium">{status === 'done' ? fileName : label}</p>
        <p className="text-xs text-zinc-500">{status === 'done' ? completeHint : hint}</p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={e => {
        const file = e.target.files?.[0]
        if (file) void handleFile(file)
      }}
    />
    </>
  )
}
