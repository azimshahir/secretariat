'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, GripVertical, FileUp, X, Download, FileX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { uploadAgendaPdf } from '@/actions/file-upload/agenda-pdf'
import { saveAgendaTemplate } from '@/actions/meeting'
import { clearAgendaItemsOnly, clearCurrentAgenda, syncAgendaRows } from './agenda-sync'
import { exportXlsx, exportDocx, exportPdf } from './agenda-export'
import type { Agenda } from '@/lib/supabase/types'

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  committeeId: string | null
  organizationName: string
  existingAgendas: Agenda[]
}

interface AgendaItem { title: string; presenter: string; attachedPdf: string | null }
interface AgendaSection { title: string; attachedPdf: string | null; items: AgendaItem[] }

function parseSections(agendas: Agenda[]): AgendaSection[] {
  if (agendas.length === 0) return []

  const sections: AgendaSection[] = []
  let current: AgendaSection | null = null

  for (const a of agendas) {
    const no = a.agenda_no.trim()
    // Heading = ends with .0 OR is a plain integer ("1", "2")
    if (no.endsWith('.0') || /^\d+$/.test(no)) {
      current = { title: a.title, attachedPdf: a.slide_pages, items: [] }
      sections.push(current)
    } else if (current) {
      current.items.push({ title: a.title, presenter: a.presenter ?? '', attachedPdf: a.slide_pages })
    } else {
      current = {
        title: 'Agenda Items',
        attachedPdf: null,
        items: [{ title: a.title, presenter: a.presenter ?? '', attachedPdf: a.slide_pages }],
      }
      sections.push(current)
    }
  }
  return sections
}

function toExportRows(sections: AgendaSection[]) {
  const columns = ['No.', 'Agenda Item', 'Presenter']
  const rows: string[][] = []
  sections.forEach((s, si) => {
    rows.push([`${si + 1}.0`, s.title, ''])
    s.items.forEach((item, ii) => rows.push([`${si + 1}.${ii + 1}`, item.title, item.presenter]))
  })
  return { columns, rows }
}

function toSyncRows(sections: AgendaSection[]) {
  const columns = ['No.', 'Agenda Item', 'Presenter', 'Attached PDF']
  const rows: string[][] = []
  sections.forEach((s, si) => {
    rows.push([`${si + 1}.0`, s.title, '', s.attachedPdf ?? ''])
    s.items.forEach((item, ii) => rows.push([
      `${si + 1}.${ii + 1}`,
      item.title,
      item.presenter,
      item.attachedPdf ?? '',
    ]))
  })
  return { columns, rows }
}

const NO_PDF_MARKER = '__no_pdf__'
function getFileName(path: string | null) {
  if (!path) return 'No PDF attached'
  if (path === NO_PDF_MARKER) return 'No PDF'
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

export function AgendaEditor(props: Props) {
  const { meetingId, committeeId, meetingTitle } = props
  const router = useRouter()

  const date = new Date(props.meetingDate).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  const [headers, setHeaders] = useState([
    props.organizationName || 'Organization', props.meetingTitle, `as at ${date}`,
  ])
  const [sections, setSections] = useState<AgendaSection[]>(parseSections(props.existingAgendas))
  const [isPending, startTransition] = useTransition()
  const [isClearingItems, setIsClearingItems] = useState(false)
  const [isClearingAll, setIsClearingAll] = useState(false)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'docx' | 'pdf'>('xlsx')
  const dragSection = useRef<number | null>(null)
  const dragItem = useRef<{ si: number; ii: number } | null>(null)

  // --- Section CRUD ---
  const addSection = () => setSections(p => [...p, { title: '', attachedPdf: null, items: [] }])
  const delSection = (si: number) => setSections(p => p.filter((_, i) => i !== si))
  const setSectionTitle = (si: number, title: string) =>
    setSections(p => p.map((s, i) => i === si ? { ...s, title } : s))
  const setSectionPdf = (si: number, attachedPdf: string | null) =>
    setSections(p => p.map((s, i) => i === si ? { ...s, attachedPdf } : s))
  const moveSection = (from: number, to: number) => {
    if (from === to) return
    setSections(p => { const n = [...p]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n })
  }

  // --- Item CRUD ---
  const addItem = (si: number) =>
    setSections(p => p.map((s, i) => i === si ? { ...s, items: [...s.items, { title: '', presenter: '', attachedPdf: null }] } : s))
  const delItem = (si: number, ii: number) =>
    setSections(p => p.map((s, i) => i === si ? { ...s, items: s.items.filter((_, j) => j !== ii) } : s))
  const setItem = (si: number, ii: number, field: 'title' | 'presenter', val: string) =>
    setSections(p => p.map((s, i) => i === si ? { ...s, items: s.items.map((it, j) => j === ii ? { ...it, [field]: val } : it) } : s))
  const setItemPdf = (si: number, ii: number, attachedPdf: string | null) =>
    setSections(p => p.map((s, i) => i === si ? {
      ...s,
      items: s.items.map((it, j) => j === ii ? { ...it, attachedPdf } : it),
    } : s))
  const moveItem = (si: number, from: number, to: number) => {
    if (from === to) return
    setSections(p => p.map((s, i) => {
      if (i !== si) return s
      const items = [...s.items]; const [m] = items.splice(from, 1); items.splice(to, 0, m)
      return { ...s, items }
    }))
  }

  // --- Header ops ---
  const addHeaderLine = () => setHeaders(p => [...p, ''])
  const delHeaderLine = (i: number) => { if (headers.length > 1) setHeaders(p => p.filter((_, j) => j !== i)) }

  async function handleAttachPdf(
    key: string,
    file: File | null,
    setter: (path: string | null) => void,
  ) {
    if (!file) return
    setUploadingKey(key)
    try {
      const uploaded = await uploadAgendaPdf(meetingId, file)
      setter(uploaded.path)
      toast.success('PDF attached')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to attach PDF')
    } finally {
      setUploadingKey(curr => (curr === key ? null : curr))
    }
  }

  // --- Save & Export ---
  function handleSave() {
    const { columns, rows } = toSyncRows(sections)
    startTransition(async () => {
      try { await syncAgendaRows(meetingId, columns, rows); router.refresh(); toast.success('Agenda saved') }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save') }
    })
  }
  function handleSaveTemplate() {
    if (!committeeId) return toast.error('No committee linked')
    const { columns, rows } = toExportRows(sections)
    const templateSections = sections.map(section => ({
      title: section.title,
      items: section.items.map(item => ({
        title: item.title,
        presenter: item.presenter,
      })),
    }))
    startTransition(async () => {
      try {
        await saveAgendaTemplate(committeeId, JSON.stringify({ headers, columns, rows, sections: templateSections }))
        toast.success('Agenda format saved as permanent template')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save template') }
    })
  }

  async function handleClearItems() {
    const confirmed = window.confirm('This will remove all agenda items but keep section headings. Continue?')
    if (!confirmed) return

    setIsClearingItems(true)
    try {
      const result = await clearAgendaItemsOnly(meetingId)
      if (result.status === 'no_items_cleared') {
        toast.error('No item rows were cleared. Please check data state/permissions.')
        return
      }

      setSections(current => current.map(section => ({ ...section, items: [] })))
      router.refresh()
      toast.success(`Cleared ${result.deletedCount} agenda item${result.deletedCount === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to clear agenda items')
    } finally {
      setIsClearingItems(false)
    }
  }

  async function handleClearEverything() {
    const confirmed = window.confirm('This will permanently remove all agenda sections and items. Continue?')
    if (!confirmed) return

    setIsClearingAll(true)
    try {
      const result = await clearCurrentAgenda(meetingId)

      if (result.status === 'no_rows_cleared') {
        toast.error(`No rows were cleared (before: ${result.beforeCount}, after: ${result.afterCount}). Please check permissions/data state.`)
        return
      }

      setSections([])
      router.refresh()
      toast.success(`Cleared ${result.deletedCount} agenda row${result.deletedCount === 1 ? '' : 's'} (before: ${result.beforeCount}, after: ${result.afterCount})`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to clear Current Agenda')
    } finally {
      setIsClearingAll(false)
    }
  }

  const { columns, rows } = toExportRows(sections)
  const sheetData = { headers, columns, rows }
  const filename = meetingTitle.replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Agenda'

  function handleDownloadExport() {
    if (exportFormat === 'xlsx') {
      exportXlsx(sheetData, filename)
      return
    }
    if (exportFormat === 'docx') {
      exportDocx(sheetData, filename)
      return
    }
    exportPdf(sheetData, filename)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-zinc-500">Export:</span>
        <Select
          value={exportFormat}
          onValueChange={value => setExportFormat(value as 'xlsx' | 'docx' | 'pdf')}
        >
          <SelectTrigger className="w-40 h-9">
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
            <SelectItem value="docx">Word (.docx)</SelectItem>
            <SelectItem value="pdf">PDF (.pdf)</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={handleDownloadExport}>
          <Download className="h-4 w-4" />
          Download
        </Button>
      </div>

      <div className="rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden">
        {/* Editable header lines */}
        <div className="border-b bg-zinc-50 dark:bg-zinc-800/50 px-6 py-4 space-y-0.5">
          {headers.map((line, i) => (
            <div key={i} className="flex items-center gap-1 group/header">
              <input
                className={`flex-1 bg-transparent text-center outline-none focus:bg-white dark:focus:bg-zinc-800 focus:ring-1 focus:ring-zinc-300 rounded px-2 py-0.5 ${
                  i === 0 ? 'text-xs font-medium uppercase tracking-wider text-zinc-400' :
                  i === 1 ? 'text-sm font-semibold' : 'text-xs text-zinc-500'
                }`}
                value={line}
                onChange={e => setHeaders(p => p.map((h, j) => j === i ? e.target.value : h))}
              />
              {headers.length > 1 && (
                <button onClick={() => delHeaderLine(i)}
                  className="opacity-0 group-hover/header:opacity-100 text-zinc-300 hover:text-red-500 transition-all shrink-0">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <button onClick={addHeaderLine}
            className="mx-auto flex items-center gap-1 text-[11px] text-zinc-300 hover:text-zinc-500 transition-colors mt-1">
            <Plus className="h-3 w-3" /> Add line
          </button>
        </div>

        {/* Hierarchical sections */}
        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {sections.map((section, si) => (
            <div key={si}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragSection.current !== null) { moveSection(dragSection.current, si); dragSection.current = null } }}
            >
              {/* Section heading row */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-100/80 dark:bg-zinc-800/60 group/section">
                <span draggable onDragStart={() => { dragSection.current = si }}
                  className="cursor-grab active:cursor-grabbing shrink-0">
                  <GripVertical className="h-3.5 w-3.5 text-zinc-300" />
                </span>
                <span className="text-sm font-bold text-zinc-600 dark:text-zinc-300 shrink-0 tabular-nums w-10">
                  {si + 1}.0
                </span>
                <input
                  className="flex-1 bg-transparent text-sm font-semibold outline-none focus:bg-white dark:focus:bg-zinc-800 focus:ring-1 focus:ring-zinc-300 rounded px-2 py-0.5"
                  value={section.title} placeholder="Section title"
                  onChange={e => setSectionTitle(si, e.target.value)}
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  {section.attachedPdf !== NO_PDF_MARKER && (
                    <label
                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
                        uploadingKey === `section-${si}`
                          ? 'pointer-events-none opacity-60 border-zinc-200 text-zinc-400'
                          : 'cursor-pointer border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
                      }`}
                    >
                      <FileUp className="h-3 w-3" />
                      {uploadingKey === `section-${si}` ? 'Uploading...' : 'Attached PDF'}
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={event => {
                          const file = event.target.files?.[0] ?? null
                          event.target.value = ''
                          void handleAttachPdf(`section-${si}`, file, path => setSectionPdf(si, path))
                        }}
                      />
                    </label>
                  )}
                  {!section.attachedPdf && (
                    <button
                      type="button"
                      onClick={() => setSectionPdf(si, NO_PDF_MARKER)}
                      className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-200 px-2 py-1 text-[11px] text-zinc-400 hover:text-orange-500 hover:border-orange-300 transition-colors"
                    >
                      <FileX className="h-3 w-3" /> No PDF
                    </button>
                  )}
                  <span className={`max-w-32 truncate text-[11px] ${
                    section.attachedPdf === NO_PDF_MARKER ? 'text-orange-400 font-medium' : 'text-zinc-400'
                  }`}>
                    {getFileName(section.attachedPdf)}
                  </span>
                  {section.attachedPdf && (
                    <button
                      type="button"
                      onClick={() => setSectionPdf(si, null)}
                      className="text-zinc-300 hover:text-zinc-500 transition-colors"
                      aria-label="Remove attached PDF"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <button onClick={() => delSection(si)}
                  className="opacity-0 group-hover/section:opacity-100 text-zinc-300 hover:text-red-500 transition-all shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Sub-items */}
              {section.items.map((item, ii) => (
                <div key={ii}
                  className="flex items-center gap-2 px-3 py-1.5 pl-10 group/item border-t border-zinc-100 dark:border-zinc-800"
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => {
                    if (dragItem.current && dragItem.current.si === si) {
                      moveItem(si, dragItem.current.ii, ii); dragItem.current = null
                    }
                  }}
                >
                  <span draggable onDragStart={() => { dragItem.current = { si, ii } }}
                    className="cursor-grab active:cursor-grabbing shrink-0">
                    <GripVertical className="h-3 w-3 text-zinc-200" />
                  </span>
                  <span className="text-sm text-zinc-400 shrink-0 tabular-nums w-10">
                    {si + 1}.{ii + 1}
                  </span>
                  <input
                    className="flex-1 bg-transparent text-sm outline-none focus:bg-white dark:focus:bg-zinc-800 focus:ring-1 focus:ring-zinc-300 rounded px-2 py-0.5 min-w-0"
                    value={item.title} placeholder="Agenda item title"
                    onChange={e => setItem(si, ii, 'title', e.target.value)}
                  />
                  <input
                    className="w-32 bg-transparent text-sm text-zinc-500 outline-none focus:bg-white dark:focus:bg-zinc-800 focus:ring-1 focus:ring-zinc-300 rounded px-2 py-0.5"
                    value={item.presenter} placeholder="Presenter"
                    onChange={e => setItem(si, ii, 'presenter', e.target.value)}
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.attachedPdf !== NO_PDF_MARKER && (
                      <label
                        className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
                          uploadingKey === `item-${si}-${ii}`
                            ? 'pointer-events-none opacity-60 border-zinc-200 text-zinc-400'
                            : 'cursor-pointer border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
                        }`}
                      >
                        <FileUp className="h-3 w-3" />
                        {uploadingKey === `item-${si}-${ii}` ? 'Uploading...' : 'Attached PDF'}
                        <input
                          type="file"
                          accept=".pdf"
                          className="hidden"
                          onChange={event => {
                            const file = event.target.files?.[0] ?? null
                            event.target.value = ''
                            void handleAttachPdf(`item-${si}-${ii}`, file, path => setItemPdf(si, ii, path))
                          }}
                        />
                      </label>
                    )}
                    {!item.attachedPdf && (
                      <button
                        type="button"
                        onClick={() => setItemPdf(si, ii, NO_PDF_MARKER)}
                        className="inline-flex items-center gap-1 rounded border border-dashed border-zinc-200 px-2 py-1 text-[11px] text-zinc-400 hover:text-orange-500 hover:border-orange-300 transition-colors"
                      >
                        <FileX className="h-3 w-3" /> No PDF
                      </button>
                    )}
                    <span className={`max-w-32 truncate text-[11px] ${
                      item.attachedPdf === NO_PDF_MARKER ? 'text-orange-400 font-medium' : 'text-zinc-400'
                    }`}>
                      {getFileName(item.attachedPdf)}
                    </span>
                    {item.attachedPdf && (
                      <button
                        type="button"
                        onClick={() => setItemPdf(si, ii, null)}
                        className="text-zinc-300 hover:text-zinc-500 transition-colors"
                        aria-label="Remove attached PDF"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <button onClick={() => delItem(si, ii)}
                    className="opacity-0 group-hover/item:opacity-100 text-zinc-300 hover:text-red-500 transition-all shrink-0">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {/* Add sub-item */}
              <div className="pl-14 py-1.5 border-t border-zinc-50 dark:border-zinc-800/50">
                <button onClick={() => addItem(si)}
                  className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-zinc-500 transition-colors">
                  <Plus className="h-3 w-3" /> Add item
                </button>
              </div>
            </div>
          ))}

          {sections.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-400 text-xs">
              No sections yet. Click &quot;+ Add Section&quot; to begin.
            </div>
          )}
        </div>

        {/* Add section */}
        <div className="border-t px-4 py-2">
          <button onClick={addSection}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Add Section
          </button>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={isPending || isClearingItems || isClearingAll}>Save Agenda</Button>

          <div className="flex items-center gap-2 rounded-md border px-2 py-1">
            <span className="text-xs font-medium text-zinc-500">Clear</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleClearItems() }}
              disabled={isPending || isClearingItems || isClearingAll}
              className="h-7 gap-1.5 text-orange-700 border-orange-200 hover:border-orange-300 hover:text-orange-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isClearingItems ? 'Clearing items...' : 'Clear items'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleClearEverything() }}
              disabled={isPending || isClearingItems || isClearingAll}
              className="h-7 gap-1.5 border-red-200 text-red-600 hover:border-red-300 hover:text-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isClearingAll ? 'Clearing all...' : 'Clear everything'}
            </Button>
          </div>

          {committeeId && (
            <Button variant="outline" size="sm" onClick={handleSaveTemplate}
              disabled={isPending || isClearingItems || isClearingAll || sections.length === 0} className="gap-2">
              <Save className="h-3.5 w-3.5" /> Make this permanent to all Agenda format
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
