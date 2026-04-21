'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useTransition, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Download,
  GripVertical,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createDefaultAgendaColumnConfig,
  getAgendaCustomColumnIds,
  normalizeAgendaColumnConfig,
  type AgendaColumnDefinition,
  type AgendaSyncPayload,
} from '@/lib/agenda-columns'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { exportXlsx, exportDocx, exportPdf } from './agenda-export'
import {
  NO_PDF_MARKER,
  USE_HEADER_PDF_MARKER,
  hasRealAgendaPdf,
  isExplicitNoAgendaPdf,
  usesHeaderAgendaPdf,
} from '@/lib/agenda-pdf'
import {
  type AgendaSection,
  parseAgendaSections,
  toAgendaExportRows,
  toAgendaSyncRows,
} from './agenda-structure'
import type { Agenda } from '@/lib/supabase/types'
import type { AgendaLinkedDataState } from './agenda-linked-data'

interface Props {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  committeeId: string | null
  organizationName: string
  existingAgendas: Agenda[]
  linkedDataByAgendaId: Record<string, AgendaLinkedDataState>
  agendaColumnConfig: Record<string, unknown>[]
  agendaLockedAt: string | null
  isLockActionPending: boolean
  onUnlockAgenda: () => void
}

const EDITABLE_CELL_CLASS = 'h-9 w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm outline-none transition focus:border-zinc-300 focus:bg-white focus:ring-2 focus:ring-zinc-200/60 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:focus:bg-zinc-900'
const LOCKED_CELL_CLASS = 'h-9 w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none'
const DRAG_HANDLE_CLASS = 'flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-zinc-400 transition select-none touch-none hover:border-zinc-200 hover:bg-white hover:text-zinc-600'
const COLUMN_HEADER_INPUT_CLASS = 'h-8 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-600 outline-none transition focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200/60'
const COLUMN_TEXT_CLASS = 'truncate text-[11px] font-semibold text-zinc-500'
const ROW_DELETE_BUTTON_CLASS = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-zinc-300 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500'

function buildEmptyCustomCells(columnConfig: AgendaColumnDefinition[]) {
  return Object.fromEntries(
    getAgendaCustomColumnIds(columnConfig).map(columnId => [columnId, '']),
  ) as Record<string, string>
}

function createEmptyItem(columnConfig: AgendaColumnDefinition[]) {
  return {
    id: null,
    title: '',
    presenter: '',
    plannedTime: '',
    attachedPdf: null,
    customCells: buildEmptyCustomCells(columnConfig),
  }
}

function createEmptySection(columnConfig: AgendaColumnDefinition[]) {
  return {
    id: null,
    title: '',
    presenter: '',
    plannedTime: '',
    attachedPdf: null,
    customCells: buildEmptyCustomCells(columnConfig),
    items: [] as AgendaSection['items'],
  }
}

function createCustomColumn() {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: 'New Column',
    kind: 'custom' as const,
    order: 0,
  }
}

function getBuiltInColumnDefinition(fieldKey: 'title' | 'plannedTime' | 'presenter') {
  return createDefaultAgendaColumnConfig().find(column => column.fieldKey === fieldKey) ?? null
}

function getColumnTemplateWidth(column: AgendaColumnDefinition) {
  if (column.fieldKey === 'agendaNo') return '56px'
  if (column.fieldKey === 'title') return 'minmax(320px,1fr)'
  if (column.fieldKey === 'plannedTime') return '120px'
  if (column.fieldKey === 'presenter') return '160px'
  return '180px'
}

function getColumnMinWidth(column: AgendaColumnDefinition) {
  if (column.fieldKey === 'agendaNo') return 56
  if (column.fieldKey === 'title') return 320
  if (column.fieldKey === 'plannedTime') return 120
  if (column.fieldKey === 'presenter') return 160
  return 180
}

function getBaseFileName(path: string) {
  if (!path) return 'No PDF attached'
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function getFileName(path: string | null, headerPath?: string | null) {
  if (!path) return 'No PDF attached'
  if (path === NO_PDF_MARKER) return 'No PDF'
  if (path === USE_HEADER_PDF_MARKER) {
    return hasRealAgendaPdf(headerPath)
      ? `Use header PDF (${getBaseFileName(headerPath!)})`
      : 'Use header PDF'
  }
  return getBaseFileName(path)
}

async function readApiResult<T extends { ok?: boolean; message?: string }>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await response.json() as T
  }

  const text = await response.text()
  const titleMatch = text.match(/<title>([^<]+)<\/title>/i)
  return {
    ok: false,
    message: titleMatch?.[1]?.trim() || `Request failed with status ${response.status}`,
  } as T
}

async function syncAgendaRowsRequest(meetingId: string, payload: AgendaSyncPayload) {
  const response = await fetch(`/api/meeting/${meetingId}/agenda-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = await readApiResult<{ ok?: boolean; message?: string }>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to save agenda')
  }
}

type AgendaClearMode = 'items' | 'all'

async function clearAgendaRequest(meetingId: string, mode: AgendaClearMode) {
  const response = await fetch(`/api/meeting/${meetingId}/agenda-clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })

  const result = await readApiResult<{
    ok?: boolean
    message?: string
    status?: 'cleared' | 'no_items_cleared' | 'no_rows_cleared'
    deletedCount?: number
    beforeCount?: number
    afterCount?: number
  }>(response)

  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to clear agenda')
  }

  return result
}

async function saveAgendaTemplateRequest(committeeId: string, templateJson: string) {
  const response = await fetch('/api/committee-generation/agenda-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ committeeId, templateJson }),
  })

  const result = await readApiResult<{ ok?: boolean; message?: string }>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to save agenda template')
  }
}

async function uploadAgendaPdfRequest(meetingId: string, agendaId: string, file: File) {
  const formData = new FormData()
  formData.set('agendaId', agendaId)
  formData.set('mode', 'upload')
  formData.set('file', file)

  const response = await fetch(`/api/meeting/${meetingId}/agenda-pdf`, {
    method: 'POST',
    body: formData,
  })

  const result = await readApiResult<{
    ok?: boolean
    message?: string
    path?: string
  }>(response)

  if (!response.ok || !result.ok || !result.path) {
    throw new Error(result.message || 'Failed to upload agenda PDF')
  }

  return result.path
}

async function markAgendaNoPdfRequest(meetingId: string, agendaId: string) {
  const formData = new FormData()
  formData.set('agendaId', agendaId)
  formData.set('mode', 'no_pdf')

  const response = await fetch(`/api/meeting/${meetingId}/agenda-pdf`, {
    method: 'POST',
    body: formData,
  })

  const result = await readApiResult<{
    ok?: boolean
    message?: string
    path?: string
  }>(response)

  if (!response.ok || !result.ok || !result.path) {
    throw new Error(result.message || 'Failed to update agenda PDF')
  }

  return result.path
}

async function applyHeaderPdfToItemsRequest(
  meetingId: string,
  headerAgendaId: string,
  agendaIds: string[],
) {
  const formData = new FormData()
  formData.set('mode', 'apply_header_pdf')
  formData.set('headerAgendaId', headerAgendaId)
  formData.set('agendaIds', JSON.stringify(agendaIds))

  const response = await fetch(`/api/meeting/${meetingId}/agenda-pdf`, {
    method: 'POST',
    body: formData,
  })

  const result = await readApiResult<{
    ok?: boolean
    message?: string
    updatedAgendaIds?: string[]
  }>(response)

  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to apply header PDF')
  }

  return result.updatedAgendaIds ?? []
}

export interface AgendaEditorHandle {
  getDraft: () => AgendaSyncPayload
}

export const AgendaEditor = forwardRef<AgendaEditorHandle, Props>(function AgendaEditor(props, ref) {
  const {
    meetingId,
    committeeId,
    meetingTitle,
    agendaColumnConfig: initialAgendaColumnConfig,
    linkedDataByAgendaId,
    agendaLockedAt,
    isLockActionPending,
    onUnlockAgenda,
  } = props
  const router = useRouter()
  const isLocked = Boolean(agendaLockedAt)
  const showPdfColumn = isLocked

  const date = new Date(props.meetingDate).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const defaultHeaders = useMemo(() => ([
    props.organizationName || 'Organization',
    props.meetingTitle,
    `as at ${date}`,
  ]), [date, props.meetingTitle, props.organizationName])

  const [headers, setHeaders] = useState(defaultHeaders)
  const [columnConfig, setColumnConfig] = useState<AgendaColumnDefinition[]>(
    () => normalizeAgendaColumnConfig(initialAgendaColumnConfig),
  )
  const [sections, setSections] = useState<AgendaSection[]>(parseAgendaSections(props.existingAgendas))
  const [dragOverColumn, setDragOverColumn] = useState<{
    columnId: string
    position: 'before' | 'after'
  } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isClearingItems, setIsClearingItems] = useState(false)
  const [isClearingAll, setIsClearingAll] = useState(false)
  const [updatingPdfKey, setUpdatingPdfKey] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'docx' | 'pdf'>('xlsx')
  const dragSection = useRef<number | null>(null)
  const dragItem = useRef<{ si: number; ii: number } | null>(null)
  const dragColumn = useRef<string | null>(null)
  const isBusy = isPending || isClearingItems || isClearingAll || isLockActionPending

  useImperativeHandle(ref, () => ({
    getDraft: () => toAgendaSyncRows(sections, columnConfig),
  }), [sections, columnConfig])

  useEffect(() => {
    setHeaders(defaultHeaders)
  }, [defaultHeaders, meetingId])

  useEffect(() => {
    setColumnConfig(normalizeAgendaColumnConfig(initialAgendaColumnConfig))
  }, [initialAgendaColumnConfig, meetingId])

  useEffect(() => {
    setSections(parseAgendaSections(props.existingAgendas))
  }, [meetingId, props.existingAgendas])

  const gridStyle = useMemo(() => {
    const minWidth = 40
      + columnConfig.reduce((total, column) => total + getColumnMinWidth(column), 0)
      + (showPdfColumn ? 280 : 0)
      + 28

    return {
      gridTemplateColumns: [
        '40px',
        ...columnConfig.map(getColumnTemplateWidth),
        ...(showPdfColumn ? ['280px'] : []),
        '28px',
      ].join(' '),
      minWidth: `${minWidth}px`,
    }
  }, [columnConfig, showPdfColumn])

  function buildDeleteWarning(rowIds: string[]) {
    const linkedStates = rowIds
      .map(rowId => linkedDataByAgendaId[rowId])
      .filter((state): state is AgendaLinkedDataState => Boolean(state))

    if (linkedStates.length === 0) return null

    const hasMinutes = linkedStates.some(state => state.hasMinute)
    const hasDrafts = linkedStates.some(state => state.hasDraft)
    const hasActionItems = linkedStates.some(state => state.hasActionItems)
    const details = [
      hasMinutes ? 'generated minutes' : null,
      hasDrafts ? 'draft MoM' : null,
      hasActionItems ? 'action items' : null,
    ].filter(Boolean)

    if (details.length === 0) return null

    return `Deleting this row will also remove linked ${details.join(', ')} for the affected agenda items. Continue?`
  }

  function confirmDeleteForRowIds(rowIds: Array<string | null | undefined>) {
    const impactedIds = rowIds.filter((rowId): rowId is string => Boolean(rowId))
    const warning = buildDeleteWarning(impactedIds)
    if (!warning) return true
    return window.confirm(warning)
  }

  // --- Section CRUD ---
  const addSection = () => setSections(p => [...p, createEmptySection(columnConfig)])
  const delSection = (si: number) => {
    const section = sections[si]
    if (!section) return

    const rowIds = [section.id, ...section.items.map(item => item.id)]
    if (!confirmDeleteForRowIds(rowIds)) return

    setSections(current => current.filter((_, index) => index !== si))
  }
  const setSectionField = (si: number, field: 'title' | 'presenter' | 'plannedTime', value: string) =>
    setSections(p => p.map((s, i) => i === si ? { ...s, [field]: value } : s))
  const setSectionCustomCell = (si: number, columnId: string, value: string) =>
    setSections(p => p.map((s, i) => i === si ? {
      ...s,
      customCells: { ...s.customCells, [columnId]: value },
    } : s))
  const moveSection = (from: number, to: number) => {
    if (from === to) return
    setSections(p => { const n = [...p]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n })
  }

  // --- Item CRUD ---
  const addItem = (si: number) =>
    setSections(p => p.map((s, i) => i === si ? {
      ...s,
      items: [...s.items, createEmptyItem(columnConfig)],
    } : s))
  const delItem = (si: number, ii: number) => {
    const item = sections[si]?.items[ii]
    if (!item) return
    if (!confirmDeleteForRowIds([item.id])) return

    setSections(current => current.map((section, sectionIndex) =>
      sectionIndex === si
        ? { ...section, items: section.items.filter((_, itemIndex) => itemIndex !== ii) }
        : section,
    ))
  }
  const setItem = (si: number, ii: number, field: 'title' | 'presenter' | 'plannedTime', val: string) =>
    setSections(p => p.map((s, i) => i === si ? { ...s, items: s.items.map((it, j) => j === ii ? { ...it, [field]: val } : it) } : s))
  const setItemCustomCell = (si: number, ii: number, columnId: string, value: string) =>
    setSections(p => p.map((s, i) => i === si ? {
      ...s,
      items: s.items.map((it, j) => j === ii ? {
        ...it,
        customCells: { ...it.customCells, [columnId]: value },
      } : it),
    } : s))
  const moveItem = (si: number, from: number, to: number) => {
    if (from === to) return
    setSections(p => p.map((s, i) => {
      if (i !== si) return s
      const items = [...s.items]; const [m] = items.splice(from, 1); items.splice(to, 0, m)
      return { ...s, items }
    }))
  }

  // --- Column CRUD ---
  function renameColumn(columnId: string, label: string) {
    setColumnConfig(current => current.map(column =>
      column.id === columnId && column.kind !== 'fixed'
        ? { ...column, label }
        : column,
    ))
  }

  function addCustomColumn() {
    const nextColumn = createCustomColumn()
    setColumnConfig(current => normalizeAgendaColumnConfig([
      ...current,
      { ...nextColumn, order: current.length },
    ]))
    setSections(current => current.map(section => ({
      ...section,
      customCells: { ...section.customCells, [nextColumn.id]: '' },
      items: section.items.map(item => ({
        ...item,
        customCells: { ...item.customCells, [nextColumn.id]: '' },
      })),
    })))
  }

  function addBuiltInColumn(fieldKey: 'title' | 'plannedTime' | 'presenter') {
    const nextColumn = getBuiltInColumnDefinition(fieldKey)
    if (!nextColumn) return

    setColumnConfig(current => {
      if (current.some(column => column.fieldKey === fieldKey)) return current
      return normalizeAgendaColumnConfig([
        ...current,
        { ...nextColumn, order: current.length },
      ])
    })
  }

  function deleteColumn(column: AgendaColumnDefinition) {
    setColumnConfig(current => normalizeAgendaColumnConfig(
      current.filter(currentColumn => currentColumn.id !== column.id),
    ))

    if (column.kind === 'custom') {
      setSections(current => current.map(section => {
        const restSectionCells = { ...section.customCells }
        delete restSectionCells[column.id]
        return {
          ...section,
          customCells: restSectionCells,
          items: section.items.map(item => {
            const restItemCells = { ...item.customCells }
            delete restItemCells[column.id]
            return {
              ...item,
              customCells: restItemCells,
            }
          }),
        }
      }))
    }
  }

  const missingAddableBuiltInColumns = useMemo(
    () =>
      (['title', 'plannedTime', 'presenter'] as const)
        .filter(fieldKey => !columnConfig.some(column => column.fieldKey === fieldKey))
        .map(fieldKey => getBuiltInColumnDefinition(fieldKey))
        .filter((column): column is AgendaColumnDefinition => Boolean(column)),
    [columnConfig],
  )

  const canOpenAddColumnMenu = missingAddableBuiltInColumns.length > 0 || !isLocked
  const showAddColumnMenu = !isLocked || missingAddableBuiltInColumns.length > 0

  const canDeleteColumn = (column: AgendaColumnDefinition) => {
    if (isLocked) return false
    if (column.kind === 'custom') return true
    if (column.kind === 'built_in') return true
    return false
  }

  const getDeleteColumnLabel = (column: AgendaColumnDefinition) => {
    if (column.kind === 'custom') return `Delete ${column.label} column`
    return `Remove ${column.label} column`
  }

  function moveColumn(
    fromColumnId: string,
    toColumnId: string,
    position: 'before' | 'after' = 'before',
  ) {
    setColumnConfig(current => {
      const fixedColumn = current.find(column => column.kind === 'fixed')
      if (!fixedColumn) return current

      const movableColumns = current.filter(column => column.kind !== 'fixed')
      const fromIndex = movableColumns.findIndex(column => column.id === fromColumnId)
      if (fromIndex < 0) return current

      const reordered = [...movableColumns]
      const [moved] = reordered.splice(fromIndex, 1)
      if (!moved) return current

      const insertIndex = (() => {
        if (toColumnId === fixedColumn.id) return 0

        const targetIndex = reordered.findIndex(column => column.id === toColumnId)
        if (targetIndex < 0) return -1
        return position === 'after' ? targetIndex + 1 : targetIndex
      })()

      if (insertIndex < 0) return current

      reordered.splice(insertIndex, 0, moved)

      return normalizeAgendaColumnConfig([fixedColumn, ...reordered])
    })
  }

  function resolveColumnDropPosition(
    event: DragEvent<HTMLDivElement>,
    column: AgendaColumnDefinition,
  ): 'before' | 'after' {
    if (column.kind === 'fixed') return 'after'

    const bounds = event.currentTarget.getBoundingClientRect()
    const midpoint = bounds.left + (bounds.width / 2)
    return event.clientX >= midpoint ? 'after' : 'before'
  }

  // --- Header ops ---
  const addHeaderLine = () => setHeaders(p => [...p, ''])
  const delHeaderLine = (i: number) => { if (headers.length > 1) setHeaders(p => p.filter((_, j) => j !== i)) }

  function setAgendaPdfForRow(agendaId: string, nextPath: string) {
    setSections(current => current.map(section => {
      if (section.id === agendaId) {
        return {
          ...section,
          attachedPdf: nextPath,
        }
      }

      const nextItems = section.items.map(item => item.id === agendaId ? {
        ...item,
        attachedPdf: nextPath,
      } : item)

      if (nextItems === section.items) return section

      return {
        ...section,
        items: nextItems,
      }
    }))
  }

  async function handleAgendaPdfUpload(agendaId: string | null, file: File | null) {
    if (!agendaId || !file) return

    const operationKey = `upload:${agendaId}`
    setUpdatingPdfKey(operationKey)

    try {
      const nextPath = await uploadAgendaPdfRequest(meetingId, agendaId, file)
      setAgendaPdfForRow(agendaId, nextPath)
      router.refresh()
      toast.success('Agenda PDF updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload agenda PDF')
    } finally {
      setUpdatingPdfKey(current => current === operationKey ? null : current)
    }
  }

  async function handleAgendaNoPdf(agendaId: string | null) {
    if (!agendaId) return

    const operationKey = `no-pdf:${agendaId}`
    setUpdatingPdfKey(operationKey)

    try {
      const nextPath = await markAgendaNoPdfRequest(meetingId, agendaId)
      setAgendaPdfForRow(agendaId, nextPath)
      router.refresh()
      toast.success('Agenda marked as No PDF')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update agenda PDF')
    } finally {
      setUpdatingPdfKey(current => current === operationKey ? null : current)
    }
  }

  async function handleApplyHeaderPdfToItems(sectionIndex: number) {
    const section = sections[sectionIndex]
    if (!section?.id) return

    if (!hasRealAgendaPdf(section.attachedPdf)) {
      toast.error('Upload a PDF on the heading row first')
      return
    }

    const eligibleItemIds = section.items
      .filter(item => {
        if (!item.id) return false
        if (!item.attachedPdf) return true
        if (isExplicitNoAgendaPdf(item.attachedPdf)) return true
        return false
      })
      .map(item => item.id as string)

    if (eligibleItemIds.length === 0) {
      toast.message('No subheadings to update', {
        description: 'All subheadings already have their own PDFs or use the header PDF.',
      })
      return
    }

    const operationKey = `apply-header:${section.id}`
    setUpdatingPdfKey(operationKey)

    try {
      const updatedIds = await applyHeaderPdfToItemsRequest(meetingId, section.id, eligibleItemIds)
      if (updatedIds.length === 0) {
        toast.error('No subheadings were updated. Please try again.')
        return
      }

      setSections(current => current.map((currentSection, currentIndex) => {
        if (currentIndex !== sectionIndex) return currentSection
        return {
          ...currentSection,
          items: currentSection.items.map(item =>
            item.id && updatedIds.includes(item.id)
              ? { ...item, attachedPdf: USE_HEADER_PDF_MARKER }
              : item,
          ),
        }
      }))
      router.refresh()
      toast.success('Header PDF applied to subheadings')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to apply header PDF')
    } finally {
      setUpdatingPdfKey(current => current === operationKey ? null : current)
    }
  }

  // --- Save & Export ---
  function handleSave() {
    if (isLocked) {
      toast.error('Step 1 is done. Reverse to Pending to edit the agenda again.')
      return
    }

    const payload = toAgendaSyncRows(sections, columnConfig)
    startTransition(async () => {
      try { await syncAgendaRowsRequest(meetingId, payload); router.refresh(); toast.success('Agenda saved') }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save') }
    })
  }
  function handleSaveTemplate() {
    if (!committeeId) return toast.error('No committee linked')
    if (isLocked) return toast.error('Reverse to Pending first if you want to update the template.')
    const { columns, rows } = toAgendaExportRows(sections, createDefaultAgendaColumnConfig())
    const templateSections = sections.map(section => ({
      title: section.title,
      presenter: section.presenter,
      plannedTime: section.plannedTime,
      items: section.items.map(item => ({
        title: item.title,
        presenter: item.presenter,
        plannedTime: item.plannedTime,
      })),
    }))
    startTransition(async () => {
      try {
        await saveAgendaTemplateRequest(
          committeeId,
          JSON.stringify({ headers, columns, rows, sections: templateSections }),
        )
        toast.success('Agenda format saved as permanent template')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save template') }
    })
  }

  async function handleClearItems() {
    if (isLocked) {
      toast.error('Step 1 is done. Reverse to Pending to edit the agenda again.')
      return
    }

    const confirmed = window.confirm('This will remove all agenda items but keep section headings. Continue?')
    if (!confirmed) return

    setIsClearingItems(true)
    try {
      const result = await clearAgendaRequest(meetingId, 'items')
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
    if (isLocked) {
      toast.error('Step 1 is done. Reverse to Pending to edit the agenda again.')
      return
    }

    const confirmed = window.confirm('This will permanently remove all agenda sections and items. Continue?')
    if (!confirmed) return

    setIsClearingAll(true)
    try {
      const result = await clearAgendaRequest(meetingId, 'all')

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

  const { columns, rows } = toAgendaExportRows(sections, columnConfig)
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

  function renderSectionColumnCell(section: AgendaSection, sectionIndex: number, column: AgendaColumnDefinition) {
    if (column.fieldKey === 'agendaNo') {
      return (
        <span className="block text-sm font-bold text-zinc-600 dark:text-zinc-300 tabular-nums">
          {sectionIndex + 1}.0
        </span>
      )
    }

    if (column.fieldKey === 'title') {
      return (
        <input
          readOnly={isLocked}
          aria-label={`Agenda section ${sectionIndex + 1} title`}
          className={`min-w-0 w-full font-semibold ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
          value={section.title}
          onChange={event => setSectionField(sectionIndex, 'title', event.target.value)}
        />
      )
    }

    if (column.fieldKey === 'plannedTime') {
      return (
        <input
          readOnly={isLocked}
          aria-label={`Agenda section ${sectionIndex + 1} time`}
          className={`min-w-0 w-full text-zinc-500 ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
          value={section.plannedTime}
          onChange={event => setSectionField(sectionIndex, 'plannedTime', event.target.value)}
        />
      )
    }

    if (column.fieldKey === 'presenter') {
      return (
        <input
          readOnly={isLocked}
          aria-label={`Agenda section ${sectionIndex + 1} presenter`}
          className={`min-w-0 w-full text-zinc-500 ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
          value={section.presenter}
          onChange={event => setSectionField(sectionIndex, 'presenter', event.target.value)}
        />
      )
    }

    return (
      <input
        readOnly={isLocked}
        aria-label={`Agenda section ${sectionIndex + 1} ${column.label}`}
        className={`min-w-0 w-full ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
        value={section.customCells[column.id] ?? ''}
        onChange={event => setSectionCustomCell(sectionIndex, column.id, event.target.value)}
      />
    )
  }

  function renderItemColumnCell(
    item: AgendaSection['items'][number],
    sectionIndex: number,
    itemIndex: number,
    column: AgendaColumnDefinition,
  ) {
    if (column.fieldKey === 'agendaNo') {
      return (
        <span className="block text-sm text-zinc-400 tabular-nums">
          {sectionIndex + 1}.{itemIndex + 1}
        </span>
      )
    }

    if (column.fieldKey === 'title') {
      return (
        <input
          readOnly={isLocked}
          aria-label={`Agenda item ${sectionIndex + 1}.${itemIndex + 1} title`}
          className={`min-w-0 w-full ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
          value={item.title}
          style={{ paddingLeft: '1.75rem' }}
          onChange={event => setItem(sectionIndex, itemIndex, 'title', event.target.value)}
        />
      )
    }

    if (column.fieldKey === 'plannedTime') {
      return (
        <input
          readOnly={isLocked}
          aria-label={`Agenda item ${sectionIndex + 1}.${itemIndex + 1} time`}
          className={`min-w-0 w-full text-zinc-500 ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
          value={item.plannedTime}
          onChange={event => setItem(sectionIndex, itemIndex, 'plannedTime', event.target.value)}
        />
      )
    }

    if (column.fieldKey === 'presenter') {
      return (
        <input
          readOnly={isLocked}
          aria-label={`Agenda item ${sectionIndex + 1}.${itemIndex + 1} presenter`}
          className={`min-w-0 w-full text-zinc-500 ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
          value={item.presenter}
          onChange={event => setItem(sectionIndex, itemIndex, 'presenter', event.target.value)}
        />
      )
    }

    return (
      <input
        readOnly={isLocked}
        aria-label={`Agenda item ${sectionIndex + 1}.${itemIndex + 1} ${column.label}`}
        className={`min-w-0 w-full ${isLocked ? LOCKED_CELL_CLASS : EDITABLE_CELL_CLASS}`}
        value={item.customCells[column.id] ?? ''}
        onChange={event => setItemCustomCell(sectionIndex, itemIndex, column.id, event.target.value)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">Export:</span>
          <Select
            value={exportFormat}
            onValueChange={value => setExportFormat(value as 'xlsx' | 'docx' | 'pdf')}
          >
            <SelectTrigger className="h-9 w-40">
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
      </div>

      <div className="rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden">
        {/* Editable header lines */}
        <div className="border-b bg-zinc-50 dark:bg-zinc-800/50 px-6 py-4 space-y-0.5">
          {headers.map((line, i) => (
            <div key={i} className="flex items-center gap-1 group/header">
              <input
                readOnly={isLocked}
                className={`flex-1 text-center outline-none rounded px-2 py-0.5 ${
                  i === 0 ? 'text-xs font-medium uppercase tracking-wider text-zinc-400' :
                  i === 1 ? 'text-sm font-semibold' : 'text-xs text-zinc-500'
                } ${isLocked ? 'bg-transparent' : 'bg-transparent focus:bg-white dark:focus:bg-zinc-800 focus:ring-1 focus:ring-zinc-300'}`}
                value={line}
                onChange={e => setHeaders(p => p.map((h, j) => j === i ? e.target.value : h))}
              />
              {!isLocked && headers.length > 1 && (
                <button onClick={() => delHeaderLine(i)}
                  className="opacity-0 group-hover/header:opacity-100 text-zinc-300 hover:text-red-500 transition-all shrink-0">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {!isLocked && (
            <button onClick={addHeaderLine}
              className="mx-auto flex items-center gap-1 text-[11px] text-zinc-300 hover:text-zinc-500 transition-colors mt-1">
              <Plus className="h-3 w-3" /> Add line
            </button>
          )}
        </div>

        {showAddColumnMenu && (
          <div className="flex justify-end border-b bg-white px-4 py-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={!canOpenAddColumnMenu}>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-600 transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" /> Add column
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44 rounded-xl">
                {missingAddableBuiltInColumns.map(column => (
                  <DropdownMenuItem
                    key={column.id}
                    onClick={() => {
                      if (column.fieldKey === 'title' || column.fieldKey === 'plannedTime' || column.fieldKey === 'presenter') {
                        addBuiltInColumn(column.fieldKey)
                      }
                    }}
                  >
                    Add {column.label} column
                  </DropdownMenuItem>
                ))}
                {!isLocked ? (
                  <DropdownMenuItem onClick={addCustomColumn}>
                    Add custom column
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Hierarchical sections */}
        <div className="overflow-x-auto">
          <div
            className="grid items-center gap-2 border-b border-zinc-200 bg-zinc-50/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/60"
            style={gridStyle}
          >
            <span />
            {columnConfig.map(column => {
              const isDraggable = !isLocked && column.kind !== 'fixed'
              const dropPosition = dragOverColumn?.columnId === column.id ? dragOverColumn.position : null

              return (
                <div
                  key={column.id}
                  className="relative min-w-0"
                  onDragOver={event => {
                    if (!dragColumn.current || isLocked) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDragOverColumn({
                      columnId: column.id,
                      position: resolveColumnDropPosition(event, column),
                    })
                  }}
                  onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragOverColumn(current => current?.columnId === column.id ? null : current)
                    }
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    if (!dragColumn.current || isLocked) return
                    moveColumn(
                      dragColumn.current,
                      column.id,
                      resolveColumnDropPosition(event, column),
                    )
                    dragColumn.current = null
                    setDragOverColumn(null)
                  }}
                >
                  {dropPosition ? (
                    <span
                      className={`pointer-events-none absolute inset-y-1 z-10 w-0.5 rounded-full bg-primary/70 ${
                        dropPosition === 'before' ? 'left-0' : 'right-0'
                      }`}
                    />
                  ) : null}
                  <div className="flex items-center gap-1 min-w-0">
                    {isDraggable ? (
                      <span
                        draggable
                        onDragStart={event => {
                          dragColumn.current = column.id
                          setDragOverColumn({
                            columnId: column.id,
                            position: 'before',
                          })
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', `column-${column.id}`)
                        }}
                        onDragEnd={() => {
                          dragColumn.current = null
                          setDragOverColumn(null)
                        }}
                        className={`${DRAG_HANDLE_CLASS} h-6 w-6 shrink-0 cursor-grab active:cursor-grabbing`}
                        title="Drag column"
                      >
                        <GripVertical className="h-3 w-3" />
                      </span>
                    ) : (
                      <span className="w-6 shrink-0" />
                    )}
                    {isLocked || column.kind === 'fixed' ? (
                      <span className={COLUMN_TEXT_CLASS}>{column.label}</span>
                    ) : (
                      <input
                        aria-label={`${column.label} column label`}
                        className={COLUMN_HEADER_INPUT_CLASS}
                        value={column.label}
                        onChange={event => renameColumn(column.id, event.target.value)}
                      />
                    )}
                    {canDeleteColumn(column) ? (
                      <button
                        type="button"
                        onClick={() => deleteColumn(column)}
                        className="shrink-0 text-zinc-300 hover:text-red-500 transition-colors"
                        aria-label={getDeleteColumnLabel(column)}
                        title={getDeleteColumnLabel(column)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
            {showPdfColumn && <span>PDF</span>}
            <span />
          </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {sections.map((section, si) => {
            return (
            <div key={si}
              onDragOver={event => {
                if (isLocked || dragSection.current === null) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={event => {
                event.preventDefault()
                if (!isLocked && dragSection.current !== null) {
                  moveSection(dragSection.current, si)
                  dragSection.current = null
                }
              }}
            >
              {/* Section heading row */}
              <div
                className="grid items-center gap-2 bg-zinc-100/80 px-3 py-2.5 dark:bg-zinc-800/60 group/section"
                style={gridStyle}
              >
                <div
                  draggable={!isLocked}
                  onDragStart={event => {
                    if (isLocked) return
                    dragSection.current = si
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', `section-${si}`)
                  }}
                  onDragEnd={() => { dragSection.current = null }}
                  className={`${isLocked ? 'opacity-30' : 'cursor-grab active:cursor-grabbing'} shrink-0 select-none ${DRAG_HANDLE_CLASS}`}
                  title={isLocked ? 'Agenda locked' : 'Drag row'}
                  aria-label={isLocked ? 'Agenda locked' : `Drag section ${si + 1}`}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </div>
                {columnConfig.map(column => (
                  <div key={column.id} className="min-w-0">
                    {renderSectionColumnCell(section, si, column)}
                  </div>
                ))}
                {showPdfColumn && (
                  <AgendaPdfCell
                    pdfPath={section.attachedPdf}
                    agendaId={section.id}
                    isUpdating={
                      updatingPdfKey === `upload:${section.id}`
                      || updatingPdfKey === `no-pdf:${section.id}`
                      || updatingPdfKey === `apply-header:${section.id}`
                    }
                    onUpload={file => { void handleAgendaPdfUpload(section.id, file) }}
                    onMarkNoPdf={() => { void handleAgendaNoPdf(section.id) }}
                    canApplyHeaderToItems={
                      isLocked
                      && Boolean(section.id)
                      && hasRealAgendaPdf(section.attachedPdf)
                      && section.items.some(item => {
                        if (!item.id) return false
                        if (!item.attachedPdf) return true
                        if (isExplicitNoAgendaPdf(item.attachedPdf)) return true
                        return false
                      })
                    }
                    onApplyHeaderToItems={() => { void handleApplyHeaderPdfToItems(si) }}
                  />
                )}
                {!isLocked && (
                  <button
                    type="button"
                    onClick={() => delSection(si)}
                    className={ROW_DELETE_BUTTON_CLASS}
                    aria-label={`Delete section ${si + 1}`}
                    title="Delete row"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Sub-items */}
              {section.items.map((item, ii) => (
                <div key={ii}
                  className="grid items-center gap-2 px-3 py-1.5 group/item border-t border-zinc-100 dark:border-zinc-800"
                  style={gridStyle}
                  onDragOver={event => {
                    if (isLocked || !dragItem.current || dragItem.current.si !== si) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    if (!isLocked && dragItem.current && dragItem.current.si === si) {
                      moveItem(si, dragItem.current.ii, ii); dragItem.current = null
                    }
                  }}
                >
                  <div
                    draggable={!isLocked}
                    onDragStart={event => {
                      if (isLocked) return
                      dragItem.current = { si, ii }
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', `item-${si}-${ii}`)
                    }}
                    onDragEnd={() => { dragItem.current = null }}
                    className={`${isLocked ? 'opacity-30' : 'cursor-grab active:cursor-grabbing'} shrink-0 select-none ${DRAG_HANDLE_CLASS}`}
                    title={isLocked ? 'Agenda locked' : 'Drag row'}
                    aria-label={isLocked ? 'Agenda locked' : `Drag item ${si + 1}.${ii + 1}`}
                  >
                    <GripVertical className="h-3 w-3" />
                  </div>
                  {columnConfig.map(column => (
                    <div key={column.id} className="min-w-0">
                      {renderItemColumnCell(item, si, ii, column)}
                    </div>
                  ))}
                  {showPdfColumn && (
                    <AgendaPdfCell
                      pdfPath={item.attachedPdf}
                      headerPdfPath={section.attachedPdf}
                      agendaId={item.id}
                      isUpdating={updatingPdfKey === `upload:${item.id}` || updatingPdfKey === `no-pdf:${item.id}`}
                      onUpload={file => { void handleAgendaPdfUpload(item.id, file) }}
                      onMarkNoPdf={() => { void handleAgendaNoPdf(item.id) }}
                    />
                  )}
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => delItem(si, ii)}
                      className={ROW_DELETE_BUTTON_CLASS}
                      aria-label={`Delete item ${si + 1}.${ii + 1}`}
                      title="Delete row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {/* Add sub-item */}
              {!isLocked && (
                <div className="pl-14 py-1.5 border-t border-zinc-50 dark:border-zinc-800/50">
                  <button onClick={() => addItem(si)}
                    className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-zinc-500 transition-colors">
                    <Plus className="h-3 w-3" /> Add item
                  </button>
                </div>
              )}
            </div>
          )})}

          {sections.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-400 text-xs">
              No sections yet. Click &quot;+ Add Section&quot; to begin.
            </div>
          )}
        </div>
        </div>

        {/* Add section */}
        {!isLocked && (
          <div className="border-t px-4 py-2">
            <button onClick={addSection}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add Section
            </button>
          </div>
        )}
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {!isLocked ? (
            <>
            <Button size="sm" onClick={handleSave} disabled={isBusy}>Save Agenda</Button>

            <div className="flex items-center gap-2 rounded-md border px-2 py-1">
              <span className="text-xs font-medium text-zinc-500">Clear</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleClearItems() }}
                disabled={isBusy}
                className="h-7 gap-1.5 text-orange-700 border-orange-200 hover:border-orange-300 hover:text-orange-800"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isClearingItems ? 'Clearing items...' : 'Clear items'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void handleClearEverything() }}
                disabled={isBusy}
                className="h-7 gap-1.5 border-red-200 text-red-600 hover:border-red-300 hover:text-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isClearingAll ? 'Clearing all...' : 'Clear everything'}
              </Button>
            </div>

            {committeeId && (
              <Button variant="outline" size="sm" onClick={handleSaveTemplate}
                disabled={isBusy || sections.length === 0} className="gap-2">
                <Save className="h-3.5 w-3.5" /> Make this permanent to all Agenda format
              </Button>
            )}
            </>
          ) : null}
        </div>

        {isLocked ? (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            <span>Step 1 is done. Reverse to Pending to edit agenda rows again.</span>
            <Button onClick={onUnlockAgenda} disabled={isLockActionPending} variant="outline" size="sm" className="gap-2">
              <RotateCcw className="h-4 w-4" />
              {isLockActionPending ? 'Reversing...' : 'Reverse to Pending'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
})

function AgendaPdfCell({
  pdfPath,
  headerPdfPath,
  agendaId,
  isUpdating,
  onUpload,
  onMarkNoPdf,
  canApplyHeaderToItems,
  onApplyHeaderToItems,
}: {
  pdfPath: string | null
  headerPdfPath?: string | null
  agendaId: string | null
  isUpdating: boolean
  onUpload: (file: File | null) => void
  onMarkNoPdf: () => void
  canApplyHeaderToItems?: boolean
  onApplyHeaderToItems?: () => void
}) {
  const fileToneClass = pdfPath === NO_PDF_MARKER
    ? 'text-orange-400 font-medium'
    : usesHeaderAgendaPdf(pdfPath)
      ? (hasRealAgendaPdf(headerPdfPath) ? 'text-sky-600 font-medium' : 'text-amber-500 font-medium')
      : 'text-zinc-400'
  const hasRealPdf = hasRealAgendaPdf(pdfPath)

  return (
    <div className="flex min-w-0 flex-col gap-1.5 shrink-0">
      <span className={`max-w-64 truncate text-[11px] ${fileToneClass}`}>
        {getFileName(pdfPath, headerPdfPath)}
      </span>
      <div className="flex items-center gap-1.5">
        <label
          className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium ${
            isUpdating || !agendaId
              ? 'pointer-events-none opacity-60 border-zinc-200 text-zinc-400'
              : 'cursor-pointer border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
          }`}
        >
          {hasRealPdf ? 'Change' : 'Upload PDF'}
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={event => {
              onUpload(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-zinc-500 hover:text-zinc-700"
          onClick={onMarkNoPdf}
          disabled={isUpdating || !agendaId}
        >
          No PDF
        </Button>
      </div>
      {onApplyHeaderToItems ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full max-w-64 px-2 text-[10px] leading-tight sm:text-[11px]"
          onClick={onApplyHeaderToItems}
          disabled={isUpdating || !agendaId || !canApplyHeaderToItems}
        >
          Apply PDF to all subheading
        </Button>
      ) : null}
    </div>
  )
}
