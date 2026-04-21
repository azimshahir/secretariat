'use client'

import Link from 'next/link'
import { useState, type ChangeEvent } from 'react'
import { Check, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  isExtractMinuteSectionTitle,
  type TemplateSection,
} from './settings-template-model'

interface Props {
  section: TemplateSection
  scope?: 'committee' | 'meeting'
  committeeSettingsHref?: string | null
  onSaveSection: (
    payload: {
      prompt: string
      templateFileName: string | null
      noTemplateNeeded: boolean
    },
    selectedFile: File | null,
  ) => void | Promise<void>
  onTitleChange: (title: string) => void
  onImportToCurrentAgenda?: (file?: File) => Promise<void>
}

export function SettingsTemplateSection({
  section,
  scope = 'committee',
  committeeSettingsHref = null,
  onSaveSection,
  onTitleChange,
  onImportToCurrentAgenda,
}: Props) {
  const isMeetingMode = scope === 'meeting'
  const isExtractMinuteSection = isExtractMinuteSectionTitle(section.title)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [draftPrompt, setDraftPrompt] = useState(section.prompt)
  const [draftTemplateFileName, setDraftTemplateFileName] = useState<string | null>(section.templateFileName)
  const [draftNoTemplateNeeded, setDraftNoTemplateNeeded] = useState(section.noTemplateNeeded)
  const [draftTemplateFile, setDraftTemplateFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [importSuccessful, setImportSuccessful] = useState(false)
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null)
  const [importStatusTone, setImportStatusTone] = useState<'success' | 'error' | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [showPromptEdit, setShowPromptEdit] = useState(false)

  function isDocxFileName(fileName: string | null | undefined) {
    return Boolean(fileName?.trim().toLowerCase().endsWith('.docx'))
  }

  function handleOpenEditor() {
    setDraftPrompt(section.prompt)
    setDraftTemplateFileName(section.templateFileName)
    setDraftNoTemplateNeeded(section.noTemplateNeeded)
    setDraftTemplateFile(null)
    setImportSuccessful(false)
    setImportStatusMessage(null)
    setImportStatusTone(null)
    setShowPromptEdit(false)
    setFileInputKey(key => key + 1)
    setIsEditorOpen(true)
  }

  function handleTemplateChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    if (!selected) return
    if (isExtractMinuteSection && !isDocxFileName(selected.name)) {
      event.target.value = ''
      toast.error('Extract Minute requires a DOCX template to preserve the exact format')
      return
    }
    setDraftTemplateFileName(selected.name)
    setDraftTemplateFile(selected)
    setDraftNoTemplateNeeded(false)
    setImportSuccessful(false)
    setImportStatusMessage(null)
    setImportStatusTone(null)
  }

  function handleNoTemplateChange(checked: boolean) {
    setDraftNoTemplateNeeded(checked)
    setImportSuccessful(false)
    setImportStatusMessage(null)
    setImportStatusTone(null)
    if (checked) {
      setDraftTemplateFileName(null)
      setDraftTemplateFile(null)
      setFileInputKey(key => key + 1)
    }
  }

  async function handleSaveSection() {
    if (isExtractMinuteSection && !draftNoTemplateNeeded && !isDocxFileName(draftTemplateFileName)) {
      toast.error('Extract Minute requires a DOCX template to preserve the exact format')
      return
    }

    try {
      await onSaveSection(
        {
          prompt: draftPrompt,
          templateFileName: draftTemplateFileName,
          noTemplateNeeded: draftNoTemplateNeeded,
        },
        draftNoTemplateNeeded ? null : draftTemplateFile,
      )
      setIsEditorOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save section')
    }
  }

  async function handleImportToCurrentAgenda() {
    if (!onImportToCurrentAgenda) return
    if (!draftTemplateFile) {
      toast.error('Please choose a template file first')
      return
    }
    setIsImporting(true)
    try {
      await onImportToCurrentAgenda(draftTemplateFile ?? undefined)
      setImportSuccessful(true)
      setImportStatusTone('success')
      setImportStatusMessage('Import completed. You can now review formatting in Generate MoM.')
      setIsEditorOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import template'
      setImportSuccessful(false)
      setImportStatusTone('error')
      setImportStatusMessage(message)
      toast.error(message)
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {section.isCustom ? (
          <Input
            value={section.title}
            onChange={event => onTitleChange(event.target.value)}
            className="max-w-xs"
          />
        ) : (
          <p className="font-medium">{section.title}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleOpenEditor}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      </div>

      <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Secretariat Instructions</DialogTitle>
            <DialogDescription>{section.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {isMeetingMode ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <div className="flex items-center gap-2 font-medium">
                  <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    Meeting-only
                  </span>
                  <span>Applies to this meeting only</span>
                </div>
                {committeeSettingsHref ? (
                  <p className="mt-1 leading-5 text-emerald-700">
                    Committee-wide defaults are managed in{' '}
                    <Link href={committeeSettingsHref} className="font-semibold underline underline-offset-2">
                      Committee Settings
                    </Link>.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor={`template-${section.id}`} className="text-sm font-medium">
                Upload Template
              </label>
              <Input
                key={fileInputKey}
                id={`template-${section.id}`}
                type="file"
                accept={isExtractMinuteSection
                  ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  : undefined}
                disabled={draftNoTemplateNeeded}
                onChange={handleTemplateChange}
              />
              {isExtractMinuteSection ? (
                <p className="text-xs text-zinc-500">
                  Extract Minute uses exact-format DOCX injection, so this section only supports Word `.docx` templates.
                </p>
              ) : null}
              {draftNoTemplateNeeded ? (
                <p className="text-xs text-zinc-500">No template needed for this section.</p>
              ) : draftTemplateFileName ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    Selected Template
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-emerald-900 break-all">
                    {draftTemplateFileName}
                  </p>
                  {isExtractMinuteSection && !isDocxFileName(draftTemplateFileName) ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Re-upload this section as a DOCX template before using Extract Minute.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No template uploaded.</p>
              )}
              {onImportToCurrentAgenda && (
                <div className="space-y-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { void handleImportToCurrentAgenda() }}
                    disabled={draftNoTemplateNeeded || isImporting || !draftTemplateFile}
                  >
                    {isImporting
                      ? 'Importing'
                      : importSuccessful
                        ? 'Successful'
                        : 'Import to Current Agenda'}
                    {isImporting && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                    {!isImporting && importSuccessful && <Check className="ml-2 h-4 w-4" />}
                  </Button>
                  {!draftTemplateFile && draftTemplateFileName && (
                    <p className="text-xs text-zinc-500">
                      Re-select this file first to import into Current Agenda.
                    </p>
                  )}
                  {importStatusMessage && importStatusTone === 'error' && (
                    <p className="text-xs text-rose-600">{importStatusMessage}</p>
                  )}
                  {importStatusMessage && importStatusTone === 'success' && (
                    <p className="text-xs text-emerald-600">{importStatusMessage}</p>
                  )}
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
                checked={draftNoTemplateNeeded}
                onChange={event => handleNoTemplateChange(event.target.checked)}
              />
              No Template Needed
            </label>

            {/* Secretariat Instructions — hidden by default, click Edit to reveal */}
            {!showPromptEdit ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm font-medium">Secretariat Instructions</span>
                <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => setShowPromptEdit(true)}>
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor={`prompt-${section.id}`} className="text-sm font-medium">
                  Secretariat Instructions
                </label>
                <Textarea
                  id={`prompt-${section.id}`}
                  value={draftPrompt}
                  onChange={event => setDraftPrompt(event.target.value)}
                  rows={10}
                  className="max-h-[45vh] resize-y overflow-y-auto"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => { void handleSaveSection() }}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
