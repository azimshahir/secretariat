'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Download, FileUp, GripVertical, Plus, RefreshCcw, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import type { Agenda } from '@/lib/supabase/types'
import {
  saveMeetingPackConfig,
  uploadMeetingPackPdf,
} from './meeting-pack-actions'
import {
  groupAgendasForMeetingPack,
  type AgendaPackSection,
  type MeetingPackConfig,
  type TopLevelBlockId,
} from './meeting-pack-model'

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  agendas: Agenda[]
  initialConfig: MeetingPackConfig
}

function cloneConfig(config: MeetingPackConfig) {
  return JSON.parse(JSON.stringify(config)) as MeetingPackConfig
}

function createCustomSectionId() {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getFileName(path: string | null) {
  if (!path) return null
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function sanitizeFilename(input: string) {
  return input.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

function getSafeMeetingPackError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message.includes('MeetingPackConfig is not defined')) {
      return 'Meeting Pack config failed to load. Please refresh and try again.'
    }
    if (message) return message
  }
  return fallback
}

function getBlockLabel(
  blockId: TopLevelBlockId,
  config: MeetingPackConfig,
  sectionMap: Map<string, AgendaPackSection>,
) {
  if (blockId === 'front_page') return 'Front Page'
  if (blockId === 'confidentiality') return 'Confidentiality Statements'
  if (blockId === 'end_notes') return 'End of Meeting Notes'
  if (blockId.startsWith('section:')) {
    const headingId = blockId.slice('section:'.length)
    const section = sectionMap.get(headingId)
    if (section) return `${section.heading.agenda_no} ${section.heading.title}`
    return 'Unknown Section'
  }
  if (blockId.startsWith('custom:')) {
    const customId = blockId.slice('custom:'.length)
    return config.customSections.find(s => s.id === customId)?.title || 'Custom Section'
  }
  return blockId
}

function getPdfPath(
  blockId: TopLevelBlockId,
  config: MeetingPackConfig,
  overrideMap: Map<string, string>,
  sectionMap: Map<string, AgendaPackSection>,
): string | null {
  if (blockId === 'front_page' || blockId === 'confidentiality' || blockId === 'end_notes') {
    return config.fixedSections[blockId].pdfPath
  }
  if (blockId.startsWith('section:')) {
    const headingId = blockId.slice('section:'.length)
    const section = sectionMap.get(headingId)
    if (!section) return null
    return overrideMap.get(section.heading.id) ?? section.heading.slide_pages
  }
  if (blockId.startsWith('custom:')) {
    const customId = blockId.slice('custom:'.length)
    return config.customSections.find(s => s.id === customId)?.pdfPath ?? null
  }
  return null
}

export function MeetingPackBuilder({ meetingId, meetingTitle, meetingDate, agendas, initialConfig }: Props) {
  const [open, setOpen] = useState(false)
  const [isLoadingConfig] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [uploadingField, setUploadingField] = useState<string | null>(null)
  const [config, setConfig] = useState<MeetingPackConfig>(initialConfig)
  const [draft, setDraft] = useState<MeetingPackConfig | null>(null)

  const dragRef = useRef<number | null>(null)

  const agendaSections = useMemo(() => groupAgendasForMeetingPack(agendas), [agendas])
  const sectionMap = useMemo(
    () => new Map(agendaSections.map(s => [s.heading.id, s])),
    [agendaSections],
  )

  const overrideMap = useMemo(() => {
    if (!draft) return new Map<string, string>()
    return new Map(draft.agendaPdfOverrides.map(o => [o.agendaId, o.pdfPath]))
  }, [draft])

  function openEditor() {
    if (!config) return
    setDraft(cloneConfig(config))
    setOpen(true)
  }

  function moveBlock(from: number, to: number) {
    if (from === to) return
    setDraft(current => {
      if (!current) return current
      const order = [...current.topLevelOrder]
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      return { ...current, topLevelOrder: order }
    })
  }

  async function handleUpload(fieldKey: string, file: File | null, apply: (path: string | null) => void) {
    if (!file) return
    setUploadingField(fieldKey)
    try {
      const uploaded = await uploadMeetingPackPdf(meetingId, file)
      apply(uploaded.path)
      toast.success('PDF updated')
    } catch (e) {
      toast.error(getSafeMeetingPackError(e, 'Failed to upload PDF'))
    } finally {
      setUploadingField(current => (current === fieldKey ? null : current))
    }
  }

  function setPdfForBlock(blockId: TopLevelBlockId, path: string | null) {
    setDraft(current => {
      if (!current) return current

      if (blockId === 'front_page' || blockId === 'confidentiality' || blockId === 'end_notes') {
        return {
          ...current,
          fixedSections: { ...current.fixedSections, [blockId]: { pdfPath: path } },
        }
      }

      if (blockId.startsWith('section:')) {
        const headingId = blockId.slice('section:'.length)
        const overrides = [...current.agendaPdfOverrides]
        const idx = overrides.findIndex(o => o.agendaId === headingId)
        if (path) {
          if (idx >= 0) overrides[idx] = { agendaId: headingId, pdfPath: path }
          else overrides.push({ agendaId: headingId, pdfPath: path })
        } else if (idx >= 0) {
          overrides.splice(idx, 1)
        }
        return { ...current, agendaPdfOverrides: overrides }
      }

      if (blockId.startsWith('custom:')) {
        const customId = blockId.slice('custom:'.length)
        return {
          ...current,
          customSections: current.customSections.map(s =>
            s.id === customId ? { ...s, pdfPath: path } : s,
          ),
        }
      }

      return current
    })
  }

  function setSubItemPdf(agendaId: string, path: string | null) {
    setDraft(current => {
      if (!current) return current
      const overrides = [...current.agendaPdfOverrides]
      const idx = overrides.findIndex(o => o.agendaId === agendaId)
      if (path) {
        if (idx >= 0) overrides[idx] = { agendaId, pdfPath: path }
        else overrides.push({ agendaId, pdfPath: path })
      } else if (idx >= 0) {
        overrides.splice(idx, 1)
      }
      return { ...current, agendaPdfOverrides: overrides }
    })
  }

  function addCustomSection() {
    setDraft(current => {
      if (!current) return current
      const id = createCustomSectionId()
      return {
        ...current,
        customSections: [...current.customSections, { id, title: `Custom Section ${current.customSections.length + 1}`, pdfPath: null }],
        topLevelOrder: [...current.topLevelOrder, `custom:${id}`],
      }
    })
  }

  function removeCustomSection(customId: string) {
    setDraft(current => {
      if (!current) return current
      return {
        ...current,
        customSections: current.customSections.filter(s => s.id !== customId),
        topLevelOrder: current.topLevelOrder.filter(b => b !== `custom:${customId}`),
      }
    })
  }

  async function persistDraft() {
    if (!draft) return null
    setIsSaving(true)
    try {
      const saved = await saveMeetingPackConfig(meetingId, draft)
      setConfig(saved)
      setDraft(cloneConfig(saved))
      toast.success('Meeting Pack saved')
      return saved
    } catch (e) {
      toast.error(getSafeMeetingPackError(e, 'Failed to save Meeting Pack'))
      return null
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDownloadMeetingPack() {
    if (!draft) return
    setIsDownloading(true)
    try {
      const saved = await persistDraft()
      if (!saved) return

      const response = await fetch(`/api/meeting/${meetingId}/meeting-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: saved }),
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Failed to download Meeting Pack')
      }

      const warningCount = Number(response.headers.get('x-meeting-pack-warning-count') ?? '0')
      const warningHeader = response.headers.get('x-meeting-pack-warnings')
      if (warningCount > 0) {
        const decoded = warningHeader ? decodeURIComponent(warningHeader) : ''
        toast.info(`Downloaded with ${warningCount} warning${warningCount > 1 ? 's' : ''}${decoded ? `: ${decoded}` : ''}`)
      }

      const blob = await response.blob()
      const fileName = `${sanitizeFilename(`${meetingTitle}_meeting_pack`) || 'meeting_pack'}.pdf`
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      URL.revokeObjectURL(url)

      toast.success('Meeting Pack downloaded')
    } catch (e) {
      toast.error(getSafeMeetingPackError(e, 'Failed to download Meeting Pack'))
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Meeting Pack</CardTitle>
            <CardDescription>
              Finalize and download one merged PDF from your configured agenda attachments.
            </CardDescription>
          </div>
          <Button type="button" onClick={openEditor} disabled={isLoadingConfig || !config}>
            Finalize Meeting Pack
          </Button>
        </CardHeader>
        <CardContent>
          {!config ? (
            <p className="text-sm text-zinc-500">
              {isLoadingConfig ? 'Loading meeting pack configuration...' : 'Meeting pack configuration not available.'}
            </p>
          ) : (
            <div className="space-y-1.5 text-sm text-zinc-600">
              <p>Sections: {config.topLevelOrder.length}</p>
              <p>Agenda rows linked: {agendas.length}</p>
              <p>
                Dividers:{' '}
                {config.includeSectionDividerPages ? 'Section ON' : 'Section OFF'}
                {' | '}
                {config.includeSubsectionDividerPages ? 'Subsection ON' : 'Subsection OFF'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finalize Meeting Pack</DialogTitle>
            <DialogDescription>
              {meetingTitle} • {new Date(meetingDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
            </DialogDescription>
          </DialogHeader>

          {!draft ? (
            <p className="text-sm text-zinc-500">Loading editor...</p>
          ) : (
            <div className="space-y-6">
              <UnifiedList
                draft={draft}
                sectionMap={sectionMap}
                overrideMap={overrideMap}
                uploadingField={uploadingField}
                dragRef={dragRef}
                onMove={moveBlock}
                onUpload={(key, file, apply) => { void handleUpload(key, file, apply) }}
                onSetPdf={setPdfForBlock}
                onSetSubItemPdf={setSubItemPdf}
                onAddCustom={addCustomSection}
                onRemoveCustom={removeCustomSection}
                onRenameCustom={(customId, title) => setDraft(current => {
                  if (!current) return current
                  return {
                    ...current,
                    customSections: current.customSections.map(s =>
                      s.id === customId ? { ...s, title } : s,
                    ),
                  }
                })}
              />

              <Separator />

              <div className="space-y-3">
                <p className="text-sm font-semibold">Divider Pages</p>
                <DividerToggle
                  id="section-divider-toggle"
                  label="Insert Section Divider Pages"
                  description="A centered page with the agenda number and title is generated before each section."
                  enabled={draft.includeSectionDividerPages}
                  onToggle={checked => setDraft(c => (c ? { ...c, includeSectionDividerPages: checked } : c))}
                  customPdfPath={draft.sectionDividerPdfPath}
                  uploadingField={uploadingField}
                  fieldKey="divider-section"
                  onUpload={(key, file, apply) => { void handleUpload(key, file, apply) }}
                  onSetPath={path => setDraft(c => (c ? { ...c, sectionDividerPdfPath: path } : c))}
                />
                <DividerToggle
                  id="subsection-divider-toggle"
                  label="Insert Subsection Divider Pages"
                  description="A centered page with the sub-agenda number and title is generated before each sub-item."
                  enabled={draft.includeSubsectionDividerPages}
                  onToggle={checked => setDraft(c => (c ? { ...c, includeSubsectionDividerPages: checked } : c))}
                  customPdfPath={draft.subsectionDividerPdfPath}
                  uploadingField={uploadingField}
                  fieldKey="divider-subsection"
                  onUpload={(key, file, apply) => { void handleUpload(key, file, apply) }}
                  onSetPath={path => setDraft(c => (c ? { ...c, subsectionDividerPdfPath: path } : c))}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="outline" onClick={() => { void persistDraft() }} disabled={!draft || isSaving || isDownloading}>Save</Button>
            <Button type="button" className="gap-2" onClick={() => { void handleDownloadMeetingPack() }} disabled={!draft || isSaving || isDownloading}>
              <Download className="h-4 w-4" />
              Download Meeting Pack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ─── Unified list (extracted to stay under 150-line limit per component) ─── */

interface UnifiedListProps {
  draft: MeetingPackConfig
  sectionMap: Map<string, AgendaPackSection>
  overrideMap: Map<string, string>
  uploadingField: string | null
  dragRef: React.RefObject<number | null>
  onMove: (from: number, to: number) => void
  onUpload: (key: string, file: File | null, apply: (path: string | null) => void) => void
  onSetPdf: (blockId: TopLevelBlockId, path: string | null) => void
  onSetSubItemPdf: (agendaId: string, path: string | null) => void
  onAddCustom: () => void
  onRemoveCustom: (customId: string) => void
  onRenameCustom: (customId: string, title: string) => void
}

function UnifiedList({
  draft, sectionMap, overrideMap, uploadingField, dragRef,
  onMove, onUpload, onSetPdf, onSetSubItemPdf, onAddCustom, onRemoveCustom, onRenameCustom,
}: UnifiedListProps) {
  return (
    <div className="space-y-1">
      {draft.topLevelOrder.map((blockId, index) => (
        <div key={blockId}>
          <div
            className="flex items-center gap-2 rounded-md border px-3 py-2 bg-white dark:bg-zinc-950"
            onDragOver={e => e.preventDefault()}
            onDrop={() => { if (dragRef.current !== null) { onMove(dragRef.current, index); dragRef.current = null } }}
          >
            <span
              draggable
              onDragStart={() => { dragRef.current = index }}
              className="cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="h-3.5 w-3.5 text-zinc-300" />
            </span>

            <BlockRow
              blockId={blockId}
              draft={draft}
              sectionMap={sectionMap}
              overrideMap={overrideMap}
              uploadingField={uploadingField}
              onUpload={onUpload}
              onSetPdf={onSetPdf}
              onRemoveCustom={onRemoveCustom}
              onRenameCustom={onRenameCustom}
            />
          </div>

          {/* Nested sub-items for section blocks */}
          {blockId.startsWith('section:') && (() => {
            const section = sectionMap.get(blockId.slice('section:'.length))
            if (!section || section.items.length === 0) return null
            return section.items.map(item => (
              <SubItemRow
                key={item.id}
                item={item}
                overrideMap={overrideMap}
                uploadingField={uploadingField}
                onUpload={onUpload}
                onSetPdf={onSetSubItemPdf}
              />
            ))
          })()}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" className="gap-1.5 mt-2" onClick={onAddCustom}>
        <Plus className="h-3.5 w-3.5" />
        Add Custom Section
      </Button>
    </div>
  )
}

/* ─── Single block row ─── */

interface BlockRowProps {
  blockId: TopLevelBlockId
  draft: MeetingPackConfig
  sectionMap: Map<string, AgendaPackSection>
  overrideMap: Map<string, string>
  uploadingField: string | null
  onUpload: (key: string, file: File | null, apply: (path: string | null) => void) => void
  onSetPdf: (blockId: TopLevelBlockId, path: string | null) => void
  onRemoveCustom: (customId: string) => void
  onRenameCustom: (customId: string, title: string) => void
}

function BlockRow({
  blockId, draft, sectionMap, overrideMap, uploadingField,
  onUpload, onSetPdf, onRemoveCustom, onRenameCustom,
}: BlockRowProps) {
  const label = getBlockLabel(blockId, draft, sectionMap)
  const pdfPath = getPdfPath(blockId, draft, overrideMap, sectionMap)
  const fieldKey = `block-${blockId}`
  const isCustom = blockId.startsWith('custom:')
  const customId = isCustom ? blockId.slice('custom:'.length) : null

  return (
    <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
      <div className="min-w-0 flex-1">
        {isCustom && customId ? (
          <Input
            value={label}
            onChange={e => onRenameCustom(customId, e.target.value)}
            className="h-7 text-sm max-w-xs"
            placeholder="Section title"
          />
        ) : (
          <p className="text-sm font-medium truncate">{label}</p>
        )}
        {pdfPath && <p className="text-xs text-zinc-500 truncate">{getFileName(pdfPath)}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <UploadButton
          fieldKey={fieldKey}
          uploading={uploadingField === fieldKey}
          hasPdf={!!pdfPath}
          onFile={file => onUpload(fieldKey, file, path => onSetPdf(blockId, path))}
        />
        {pdfPath && (
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => onSetPdf(blockId, null)}>
            <RefreshCcw className="h-3 w-3" />
            No PDF
          </Button>
        )}
        {isCustom && customId && (
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2 text-red-500 hover:text-red-600" onClick={() => onRemoveCustom(customId)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

/* ─── Sub-item row (nested under a section heading) ─── */

interface SubItemRowProps {
  item: Agenda
  overrideMap: Map<string, string>
  uploadingField: string | null
  onUpload: (key: string, file: File | null, apply: (path: string | null) => void) => void
  onSetPdf: (agendaId: string, path: string | null) => void
}

function SubItemRow({ item, overrideMap, uploadingField, onUpload, onSetPdf }: SubItemRowProps) {
  const overridePdf = overrideMap.get(item.id)
  const pdfPath = overridePdf ?? item.slide_pages
  const fieldKey = `sub-${item.id}`

  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-100 dark:border-zinc-800 ml-8 px-3 py-1.5 mt-0.5 bg-zinc-50/50 dark:bg-zinc-900/50">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{item.agenda_no} {item.title}</p>
        {pdfPath && <p className="text-xs text-zinc-500 truncate">{getFileName(pdfPath)}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <UploadButton
          fieldKey={fieldKey}
          uploading={uploadingField === fieldKey}
          hasPdf={!!pdfPath}
          onFile={file => onUpload(fieldKey, file, path => onSetPdf(item.id, path))}
        />
        {overridePdf && (
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => onSetPdf(item.id, null)}>
            <RefreshCcw className="h-3 w-3" />
            No PDF
          </Button>
        )}
      </div>
    </div>
  )
}

/* ─── Divider toggle with optional custom PDF upload ─── */

function DividerToggle({ id, label, description, enabled, onToggle, customPdfPath, uploadingField, fieldKey, onUpload, onSetPath }: {
  id: string
  label: string
  description: string
  enabled: boolean
  onToggle: (checked: boolean) => void
  customPdfPath: string | null
  uploadingField: string | null
  fieldKey: string
  onUpload: (key: string, file: File | null, apply: (path: string | null) => void) => void
  onSetPath: (path: string | null) => void
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between px-3 py-2">
        <Label htmlFor={id} className="text-sm">{label}</Label>
        <Switch id={id} checked={enabled} onCheckedChange={onToggle} />
      </div>
      {enabled && (
        <div className="border-t px-3 py-2 space-y-1.5 bg-zinc-50/50 dark:bg-zinc-900/50">
          <p className="text-xs text-zinc-500">{description}</p>
          <div className="flex items-center gap-2">
            <UploadButton
              fieldKey={fieldKey}
              uploading={uploadingField === fieldKey}
              hasPdf={!!customPdfPath}
              onFile={file => onUpload(fieldKey, file, path => onSetPath(path))}
            />
            {customPdfPath ? (
              <>
                <p className="text-xs text-zinc-500 truncate max-w-xs">{getFileName(customPdfPath)}</p>
                <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => onSetPath(null)}>
                  <RefreshCcw className="h-3 w-3" />
                  Use generated
                </Button>
              </>
            ) : (
              <p className="text-xs text-zinc-400">Upload your own divider page format (optional)</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Shared upload button ─── */

function UploadButton({ fieldKey, uploading, hasPdf, onFile }: {
  fieldKey: string
  uploading: boolean
  hasPdf: boolean
  onFile: (file: File | null) => void
}) {
  return (
    <label
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
        uploading
          ? 'pointer-events-none opacity-60 border-zinc-200 text-zinc-400'
          : 'cursor-pointer border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
      }`}
    >
      <FileUp className="h-3 w-3" />
      {hasPdf ? 'Change' : 'Upload PDF'}
      <input
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={e => { onFile(e.target.files?.[0] ?? null); e.target.value = '' }}
      />
    </label>
  )
}
