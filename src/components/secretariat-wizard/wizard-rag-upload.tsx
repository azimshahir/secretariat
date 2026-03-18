'use client'

import { Plus, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RagDraft } from './wizard-types'

type DocumentCategory = RagDraft['category']

const CATEGORY_OPTIONS: { value: DocumentCategory; label: string }[] = [
  { value: 'TOR', label: 'TOR' },
  { value: 'Policy', label: 'Policy' },
  { value: 'Framework', label: 'Framework' },
  { value: 'Manual', label: 'Manual' },
  { value: 'Books', label: 'Books' },
  { value: 'Others', label: 'Others (please include)' },
]

let ragCounter = 0
export function createRagDraft(): RagDraft {
  ragCounter += 1
  return { id: `rag-${ragCounter}`, category: 'TOR', customName: '', file: null }
}

interface WizardRagUploadProps {
  files: RagDraft[]
  onChange: (files: RagDraft[]) => void
}

export function WizardRagUpload({ files, onChange }: WizardRagUploadProps) {
  function updateRag(id: string, updater: (d: RagDraft) => RagDraft) {
    onChange(files.map(f => (f.id === id ? updater(f) : f)))
  }

  return (
    <div className="rounded-[18px] border border-border/70 bg-white/92 p-4 space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Reference documents (RAG)</p>
        <p className="text-xs text-muted-foreground">
          Upload committee reference documents (PDF or DOCX) to enhance minute generation accuracy.
        </p>
      </div>

      {files.map((draft, index) => (
        <div key={draft.id} className="space-y-3 rounded-md border border-border/70 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-600">Document {index + 1}</p>
            {files.length > 1 && (
              <Button type="button" variant="ghost" size="sm"
                onClick={() => onChange(files.filter(f => f.id !== draft.id))}
                className="h-7 gap-1 text-xs">
                <Trash2 className="h-3 w-3" /> Remove
              </Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Document Type</label>
              <select value={draft.category}
                onChange={e => updateRag(draft.id, d => ({
                  ...d, category: e.target.value as DocumentCategory,
                  customName: e.target.value === 'Others' ? d.customName : '',
                }))}
                className="border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]">
                {CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Upload Document</label>
              <Input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={e => updateRag(draft.id, d => ({ ...d, file: e.target.files?.[0] ?? null }))} />
            </div>
          </div>
          {draft.category === 'Others' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Document Name</label>
              <Input value={draft.customName}
                onChange={e => updateRag(draft.id, d => ({ ...d, customName: e.target.value }))}
                placeholder="Please include document name" />
            </div>
          )}
          {draft.file && <Badge variant="outline">{draft.file.name}</Badge>}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="gap-2"
        onClick={() => onChange([...files, createRagDraft()])}>
        <Plus className="h-4 w-4" /> Add document
      </Button>
    </div>
  )
}
