'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  deleteCommitteeRagDocument,
  listCommitteeRagDocuments,
  uploadCommitteeRagDocument,
  type CommitteeRagDocumentSummary,
} from './rag-actions'

type DocumentCategory = 'TOR' | 'Policy' | 'Framework' | 'Manual' | 'Books' | 'Others'

interface DocumentDraft {
  id: string
  category: DocumentCategory
  customName: string
  file: File | null
}

const CATEGORY_OPTIONS: Array<{ value: DocumentCategory; label: string }> = [
  { value: 'TOR', label: 'TOR' },
  { value: 'Policy', label: 'Policy' },
  { value: 'Framework', label: 'Framework' },
  { value: 'Manual', label: 'Manual' },
  { value: 'Books', label: 'Books' },
  { value: 'Others', label: 'Others (please include)' },
]

let draftCounter = 0

function createDocumentDraft(): DocumentDraft {
  draftCounter += 1
  return {
    id: `rag-doc-${draftCounter}`,
    category: 'TOR',
    customName: '',
    file: null,
  }
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface RagTabProps {
  committeeId: string | null
  initialDocuments: CommitteeRagDocumentSummary[]
}

export function RagTab({ committeeId, initialDocuments }: RagTabProps) {
  const [isRagOpen, setIsRagOpen] = useState(true)
  const [documents, setDocuments] = useState<DocumentDraft[]>([createDocumentDraft()])
  const [uploadedDocuments, setUploadedDocuments] = useState<CommitteeRagDocumentSummary[]>(initialDocuments)
  const [isPending, startTransition] = useTransition()
  const disabled = !committeeId

  async function refreshDocuments() {
    if (!committeeId) return
    try {
      const rows = await listCommitteeRagDocuments(committeeId)
      setUploadedDocuments(rows)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load RAG documents')
    }
  }

  function updateDocument(documentId: string, updater: (document: DocumentDraft) => DocumentDraft) {
    setDocuments(prev => prev.map(document => (document.id === documentId ? updater(document) : document)))
  }

  function addDocument() {
    setDocuments(prev => [...prev, createDocumentDraft()])
  }

  function handleUploadAll() {
    if (!committeeId) {
      toast.error('Attach this meeting to a committee first')
      return
    }

    const incompleteRow = documents.find(document => !document.file)
    if (incompleteRow) {
      toast.error('Please upload a PDF file for every document row before Upload All.')
      return
    }

    const othersWithoutName = documents.find(
      document => document.category === 'Others' && document.customName.trim().length === 0,
    )
    if (othersWithoutName) {
      toast.error('Please fill in the document name for rows using Others (please include).')
      return
    }

    startTransition(async () => {
      try {
        for (const document of documents) {
          if (!document.file) continue
          const documentName = document.category === 'Others'
            ? document.customName.trim()
            : document.category
          await uploadCommitteeRagDocument(
            committeeId,
            document.category,
            documentName,
            document.file,
          )
        }
        setDocuments([createDocumentDraft()])
        await refreshDocuments()
        toast.success('Committee RAG documents uploaded')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to upload RAG documents')
      }
    })
  }

  function handleDelete(documentId: string) {
    startTransition(async () => {
      try {
        await deleteCommitteeRagDocument(documentId)
        setUploadedDocuments(prev => prev.filter(document => document.id !== documentId))
        toast.success('RAG document deleted')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete RAG document')
      }
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>RAG</CardTitle>
          <CardDescription>Upload committee reference PDFs for retrieval during minute generation.</CardDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isRagOpen ? 'Collapse RAG section' : 'Expand RAG section'}
          onClick={() => setIsRagOpen(open => !open)}
        >
          {isRagOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </CardHeader>
      {isRagOpen && (
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {documents.map((document, index) => (
              <div key={document.id} className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium text-zinc-600">Document {index + 1}</p>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor={`category-${document.id}`} className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Document Type
                    </label>
                    <select
                      id={`category-${document.id}`}
                      value={document.category}
                      disabled={disabled || isPending}
                      className="border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
                      onChange={event => updateDocument(document.id, current => ({
                        ...current,
                        category: event.target.value as DocumentCategory,
                        customName: event.target.value === 'Others' ? current.customName : '',
                      }))}
                    >
                      {CATEGORY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor={`file-${document.id}`} className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Upload Document
                    </label>
                    <Input
                      id={`file-${document.id}`}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      disabled={disabled || isPending}
                      onChange={event => updateDocument(document.id, current => ({
                        ...current,
                        file: event.target.files?.[0] ?? null,
                      }))}
                    />
                  </div>
                </div>

                {document.category === 'Others' && (
                  <div className="space-y-1.5">
                    <label htmlFor={`other-name-${document.id}`} className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Document Name
                    </label>
                    <Input
                      id={`other-name-${document.id}`}
                      value={document.customName}
                      disabled={disabled || isPending}
                      onChange={event => updateDocument(document.id, current => ({ ...current, customName: event.target.value }))}
                      placeholder="Please include document name"
                    />
                  </div>
                )}

                {document.file && (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{document.file.name}</Badge>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" className="gap-2" onClick={addDocument} disabled={disabled || isPending}>
              <Plus className="h-4 w-4" />
              Add documents
            </Button>

            <Button type="button" className="gap-2" onClick={handleUploadAll} disabled={disabled || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload All
            </Button>
          </div>

          {disabled && (
            <p className="text-xs text-zinc-500">
              Attach this meeting to a committee first to manage RAG documents.
            </p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Uploaded documents</p>
            {uploadedDocuments.length === 0 ? (
              <div className="rounded-md border px-3 py-2 text-sm text-zinc-500">
                No committee RAG documents yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                {uploadedDocuments.map((document, index) => (
                  <div
                    key={document.id}
                    className={`flex items-center justify-between gap-3 px-3 py-2 ${
                      index < uploadedDocuments.length - 1 ? 'border-b' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{document.fileName}</p>
                      <p className="text-xs text-zinc-500">
                        {document.documentName} • {document.category} • {formatDate(document.createdAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => handleDelete(document.id)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
