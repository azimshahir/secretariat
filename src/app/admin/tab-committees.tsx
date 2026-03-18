'use client'

import { useState, useTransition, useRef } from 'react'
import { toast } from 'sonner'
import { Pencil, Upload, Trash2, FileText, Loader2, Check, X, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { saveCommittee } from '@/app/settings/actions'
import {
  uploadCommitteeRagDocument,
  deleteCommitteeRagDocument,
} from '@/app/meeting/[id]/setup/rag-actions'

interface Committee {
  id: string
  name: string
  slug: string
  category: string
  persona_prompt: string | null
  glossary_count: number
  rag_docs: RagDoc[]
}
interface RagDoc {
  id: string
  category: string
  document_name: string
  file_name: string
  created_at: string
}

const CATEGORY_COLORS: Record<string, string> = {
  'Banking': 'bg-blue-100 text-blue-700',
  'Construction & Property': 'bg-amber-100 text-amber-700',
  'Oil & Gas': 'bg-orange-100 text-orange-700',
  'NGOs & Foundations': 'bg-emerald-100 text-emerald-700',
  'Others': 'bg-zinc-100 text-zinc-700',
}

function PersonaPanel({ committee }: { committee: Committee }) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleSubmit(fd: FormData) {
    startTransition(async () => {
      try { await saveCommittee(fd); toast.success('Persona updated'); setEditing(false) }
      catch { toast.error('Failed to save') }
    })
  }

  if (editing) {
    return (
      <form action={handleSubmit} className="space-y-3">
        <input type="hidden" name="id" value={committee.id} />
        <Input name="name" defaultValue={committee.name} placeholder="Committee name" required />
        <Input name="slug" defaultValue={committee.slug} placeholder="committee-slug" required />
        <Textarea name="personaPrompt" defaultValue={committee.persona_prompt ?? ''} className="min-h-32" placeholder="System persona..." required />
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}><X className="h-3 w-3" /></Button>
          <Button type="submit" size="sm" disabled={pending} className="gap-1">
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium">System Persona</p>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="gap-1 text-xs">
          <Pencil className="h-3 w-3" /> Edit
        </Button>
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
        {committee.persona_prompt || 'No persona configured.'}
      </p>
    </div>
  )
}

function RagPanel({ committee }: { committee: Committee }) {
  const [docs, setDocs] = useState(committee.rag_docs)
  const [uploading, startUpload] = useTransition()
  const [deleting, setDeleting] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleUpload(fd: FormData) {
    const file = fd.get('file') as File
    const docName = (fd.get('documentName') as string)?.trim() || file?.name || 'Untitled'
    const category = (fd.get('category') as string)?.trim() || 'General'
    if (!file || file.size === 0) { toast.error('Select a PDF file'); return }
    startUpload(async () => {
      try {
        const doc = await uploadCommitteeRagDocument(committee.id, category, docName, file)
        setDocs(prev => [{ id: doc.id, category: doc.category, document_name: doc.documentName, file_name: doc.fileName, created_at: doc.createdAt }, ...prev])
        toast.success('Document uploaded & chunked')
        formRef.current?.reset()
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
    })
  }

  async function handleDelete(docId: string) {
    setDeleting(docId)
    try {
      await deleteCommitteeRagDocument(docId)
      setDocs(prev => prev.filter(d => d.id !== docId))
      toast.success('Document removed')
    } catch { toast.error('Failed to delete') }
    finally { setDeleting(null) }
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} action={handleUpload} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Document File</label>
          <Input name="file" type="file" accept=".pdf,.docx" required disabled={uploading} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Document Name</label>
          <Input name="documentName" placeholder="e.g. ALCO Guidelines 2025" disabled={uploading} />
          <input type="hidden" name="category" value="General" />
        </div>
        <Button type="submit" size="sm" disabled={uploading} className="gap-1">
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          Upload
        </Button>
      </form>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No documents yet. Upload a PDF to build this committee&apos;s knowledge base.</p>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{doc.document_name}</p>
                  <p className="text-xs text-muted-foreground">{doc.file_name} · {new Date(doc.created_at).toLocaleDateString('en-MY')}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(doc.id)} disabled={deleting === doc.id} className="shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50">
                {deleting === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CommitteeDialog({ committee, open, onClose }: { committee: Committee; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
              {committee.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <DialogTitle>{committee.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">{committee.slug}</p>
            </div>
          </div>
        </DialogHeader>
        <Tabs defaultValue="persona" className="mt-2">
          <TabsList>
            <TabsTrigger value="persona">Persona</TabsTrigger>
            <TabsTrigger value="documents">Knowledge Base ({committee.rag_docs.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="persona" className="pt-4">
            <PersonaPanel committee={committee} />
          </TabsContent>
          <TabsContent value="documents" className="pt-4">
            <RagPanel committee={committee} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export function TabCommittees({ committees, categories }: { committees: Committee[]; categories: string[] }) {
  const [selected, setSelected] = useState<Committee | null>(null)

  return (
    <>
      <div className="space-y-6">
        {categories.map(cat => {
          const items = committees.filter(c => c.category === cat)
          if (items.length === 0) return null
          return (
            <section key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={CATEGORY_COLORS[cat] ?? 'bg-zinc-100 text-zinc-700'}>{cat}</Badge>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="rounded-lg border divide-y">
                {items.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.slug}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.rag_docs.length > 0 && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <FileText className="h-2.5 w-2.5" /> {c.rag_docs.length}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px]">{c.glossary_count} terms</Badge>
                      <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
        {committees.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No committees configured yet.</p>
        )}
      </div>

      {selected && (
        <CommitteeDialog committee={selected} open={!!selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
