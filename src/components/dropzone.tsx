'use client'

import { useCallback, useState } from 'react'
import { Upload, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DropzoneProps {
  accept: string
  label: string
  hint: string
  onFile: (file: File) => Promise<void>
}

export function Dropzone({ accept, label, hint, onFile }: DropzoneProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [fileName, setFileName] = useState<string>()
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string>()

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

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors',
        dragOver && 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800',
        status === 'done' && 'border-green-500 bg-green-50 dark:bg-green-950',
        status === 'idle' && !dragOver && 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700',
      )}
    >
      {status === 'loading' && <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />}
      {status === 'done' && <CheckCircle2 className="h-8 w-8 text-green-500" />}
      {status === 'idle' && <Upload className="h-8 w-8 text-zinc-400" />}

      <div className="text-center">
        <p className="text-sm font-medium">{status === 'done' ? fileName : label}</p>
        <p className="text-xs text-zinc-500">{status === 'done' ? 'Uploaded successfully' : hint}</p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {status !== 'done' && (
        <input
          type="file"
          accept={accept}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
      )}
    </div>
  )
}
