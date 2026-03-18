'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { RichTextEditor } from '@/components/rich-text-editor'
import { clearAgendaFormatting, upsertFormatFromPaste, type SavedAgendaFormatting } from './mom-actions'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  agendaId: string
  agendaTitle: string
  committeeId: string
  initialPromptText?: string
  initialAdditionalInfo?: string
  initialTemplateName?: string
  onSaved: (payload: SavedAgendaFormatting) => void
  onCleared: (agendaId: string) => void
}

const getDraftStorageKey = (agendaId: string) => `mom-format-draft:${agendaId}`

interface FormatDialogDraft {
  name: string
  promptHtml: string
  additionalInfo: string
}

function loadDraftFromStorage(agendaId: string): FormatDialogDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(agendaId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FormatDialogDraft>
    const draft = {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      promptHtml: typeof parsed.promptHtml === 'string' ? parsed.promptHtml : '',
      additionalInfo: typeof parsed.additionalInfo === 'string' ? parsed.additionalInfo : '',
    }
    // Only return draft if it has actual content, so empty drafts don't override server data
    if (!draft.promptHtml && !draft.additionalInfo) return null
    return draft
  } catch {
    return null
  }
}

export function saveDraftToStorage(agendaId: string, draft: FormatDialogDraft) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getDraftStorageKey(agendaId), JSON.stringify(draft))
  } catch { /* Ignore storage errors */ }
}

export function clearDraftFromStorage(agendaId: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getDraftStorageKey(agendaId))
  } catch { /* Ignore storage errors */ }
}

function editorHtmlToPlainText(value: string) {
  if (!value.trim()) return ''
  if (typeof window === 'undefined') return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const container = document.createElement('div')
  container.innerHTML = value
  return (container.innerText || container.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim()
}

export function FormatDialog({
  open, onOpenChange, agendaId, agendaTitle, committeeId,
  initialPromptText, initialAdditionalInfo, initialTemplateName,
  onSaved, onCleared,
}: Props) {
  const initialDraft = loadDraftFromStorage(agendaId)
  const [name, setName] = useState(initialDraft?.name ?? (initialTemplateName || agendaTitle))
  const [promptHtml, setPromptHtml] = useState(
    initialDraft?.promptHtml ?? (initialPromptText ?? ''),
  )
  const [additionalInfo, setAdditionalInfo] = useState(initialDraft?.additionalInfo ?? (initialAdditionalInfo ?? ''))
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Persist draft to localStorage
  useEffect(() => {
    saveDraftToStorage(agendaId, { name, promptHtml, additionalInfo })
  }, [agendaId, name, promptHtml, additionalInfo])

  function handleSave() {
    const promptPlainText = editorHtmlToPlainText(promptHtml)
    if (!promptPlainText) {
      toast.error('Previous minute format is required')
      return
    }

    startTransition(async () => {
      try {
        const payload = await upsertFormatFromPaste(
          agendaId,
          committeeId,
          name.trim() || agendaTitle,
          promptHtml,
          additionalInfo.trim(),
        )
        toast.success('Format template saved')
        setLastSavedAt(new Date().toLocaleTimeString('en-MY', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }))
        saveDraftToStorage(agendaId, { name, promptHtml, additionalInfo })
        onSaved(payload)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save format template')
      }
    })
  }

  function handleClearFormatting() {
    clearDraftFromStorage(agendaId)
    setName('')
    setPromptHtml('')
    setAdditionalInfo('')
    startTransition(async () => {
      try {
        await clearAgendaFormatting(agendaId)
        toast.success('Formatting cleared')
        onCleared(agendaId)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to clear formatting')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
        if (!next) saveDraftToStorage(agendaId, { name, promptHtml, additionalInfo })
        onOpenChange(next)
      }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste Format Reference</DialogTitle>
          <DialogDescription>
            Paste a previous minute example. The AI will mimic its style when generating.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label htmlFor="fmt-name" className="text-sm font-medium">
              Template name
            </label>
            <Input
              id="fmt-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. ALCO Noted Format"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Previous minute format
            </label>
            <p className="text-xs text-zinc-500">
              Loaded from imported template. You can edit before save.
            </p>
            <RichTextEditor
              content={promptHtml}
              onChange={setPromptHtml}
              disabled={isPending}
              placeholder="Paste a sample of how the minute format should look..."
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fmt-additional" className="text-sm font-medium">
              Additional Information
            </label>
            <Textarea
              id="fmt-additional"
              value={additionalInfo}
              onChange={e => setAdditionalInfo(e.target.value)}
              placeholder="e.g. CBO used CRO's mic for this section, speaker changed midway..."
              rows={3}
              className="max-h-40 resize-y overflow-y-auto"
            />
          </div>
          {lastSavedAt && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Saved at {lastSavedAt}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Close
            </Button>
            <Button type="button" variant="outline" onClick={handleClearFormatting} disabled={isPending}>
              Clear formatting
            </Button>
            <Button onClick={handleSave} disabled={isPending} className="gap-2">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Format
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
