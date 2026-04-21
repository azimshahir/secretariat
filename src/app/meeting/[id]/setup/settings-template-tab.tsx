'use client'

import Link from 'next/link'
import {
  startTransition,
  useCallback,
  type Dispatch,
  type SetStateAction,
  useState,
} from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SettingsTemplateSection } from './settings-template-section'
import type { AgendaLinkedDataState } from './agenda-linked-data'
import {
  createOtherGroup,
  createOtherSection,
  isMinuteOfMeetingSectionTitle,
  serializeTemplateGroupsForStorage,
  type TemplateGroup,
  type TemplateSection,
} from './settings-template-model'
import type { AgendaImportResult, PresenterImportResult } from '@/lib/agenda-template-import'
import type { MomTemplateValidation } from '@/lib/mom-template-types'

type SettingsTemplateScope = 'committee' | 'meeting'

async function readApiResult<T extends { ok?: boolean; message?: string }>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await response.json() as T
  }

  const text = await response.text()
  const titleMatch = text.match(/<title>([^<]+)<\/title>/i)
  const message = titleMatch?.[1]?.trim()
    || (text.trim() ? `Request failed with status ${response.status}` : 'Request failed')

  return { ok: false, message } as T
}

async function uploadCommitteeTemplateRequest(committeeId: string, sectionTitle: string, file: File) {
  const formData = new FormData()
  formData.set('committeeId', committeeId)
  formData.set('sectionTitle', sectionTitle)
  formData.set('file', file)

  const response = await fetch('/api/committee-generation/template', {
    method: 'POST',
    body: formData,
  })
  const result = await readApiResult<{
    ok?: boolean
    message?: string
    storagePath?: string
    fileName?: string
    momTemplateValidation?: MomTemplateValidation | null
  }>(response)
  if (!response.ok || !result.ok || !result.storagePath) {
    throw new Error(result.message || 'Failed to upload template')
  }
  return {
    storagePath: result.storagePath,
    fileName: result.fileName ?? file.name,
    momTemplateValidation: result.momTemplateValidation ?? null,
  }
}

async function uploadMeetingTemplateRequest(meetingId: string, sectionTitle: string, file: File) {
  const formData = new FormData()
  formData.set('sectionTitle', sectionTitle)
  formData.set('file', file)

  const response = await fetch(`/api/meeting/${meetingId}/settings-template-upload`, {
    method: 'POST',
    body: formData,
  })
  const result = await readApiResult<{
    ok?: boolean
    message?: string
    storagePath?: string
    fileName?: string
    momTemplateValidation?: MomTemplateValidation | null
  }>(response)
  if (!response.ok || !result.ok || !result.storagePath) {
    throw new Error(result.message || 'Failed to upload meeting template')
  }
  return {
    storagePath: result.storagePath,
    fileName: result.fileName ?? file.name,
    momTemplateValidation: result.momTemplateValidation ?? null,
  }
}

async function saveCommitteeTemplateGroupsRequest(committeeId: string, groups: TemplateGroup[]) {
  const response = await fetch('/api/committee-generation/template-sections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      committeeId,
      groups: serializeTemplateGroupsForStorage(groups),
    }),
  })
  const result = await readApiResult<{ ok?: boolean; message?: string }>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to save committee secretariat instructions')
  }
}

async function saveMeetingTemplateGroupsRequest(meetingId: string, groups: TemplateGroup[]) {
  const response = await fetch(`/api/meeting/${meetingId}/settings-overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save_templates',
      groups: serializeTemplateGroupsForStorage(groups),
    }),
  })
  const result = await readApiResult<{ ok?: boolean; message?: string }>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to save meeting-only template overrides')
  }
}

async function importAgendaTemplateRequest(meetingId: string, file: File) {
  const formData = new FormData()
  formData.set('meetingId', meetingId)
  formData.set('file', file)

  const response = await fetch('/api/committee-generation/import-agenda', {
    method: 'POST',
    body: formData,
  })
  const result = await readApiResult<({ ok?: boolean; message?: string } & Partial<AgendaImportResult>)>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to import agenda template')
  }
  return result as { ok: true } & AgendaImportResult
}

async function importPresenterTemplateRequest(meetingId: string, file: File) {
  const formData = new FormData()
  formData.set('meetingId', meetingId)
  formData.set('file', file)

  const response = await fetch('/api/committee-generation/import-presenter-list', {
    method: 'POST',
    body: formData,
  })
  const result = await readApiResult<({ ok?: boolean; message?: string } & Partial<PresenterImportResult>)>(response)
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to import presenter list template')
  }
  return result as { ok: true } & PresenterImportResult
}

interface Props {
  scope?: SettingsTemplateScope
  meetingId?: string | null
  committeeId: string | null
  groups: TemplateGroup[]
  linkedDataByAgendaId?: Record<string, AgendaLinkedDataState>
  onGroupsChange: Dispatch<SetStateAction<TemplateGroup[]>>
  onImportCompleted?: () => void
  committeeSettingsHref?: string | null
}

function replaceGroup(
  groups: TemplateGroup[],
  groupId: string,
  updater: (group: TemplateGroup) => TemplateGroup,
) {
  return groups.map(group => (group.id === groupId ? updater(group) : group))
}

function replaceSection(
  groups: TemplateGroup[],
  groupId: string,
  sectionId: string,
  updater: (section: TemplateSection) => TemplateSection,
) {
  return replaceGroup(groups, groupId, group => ({
    ...group,
    sections: group.sections.map(section => (section.id === sectionId ? updater(section) : section)),
  }))
}

export function SettingsTemplateTab({
  scope = 'committee',
  meetingId = null,
  committeeId,
  groups,
  linkedDataByAgendaId = {},
  onGroupsChange,
  onImportCompleted,
  committeeSettingsHref = null,
}: Props) {
  const isMeetingMode = scope === 'meeting'
  const [isTemplateOpen, setIsTemplateOpen] = useState(false)
  const router = useRouter()

  const setGroups = useCallback((next: TemplateGroup[] | ((current: TemplateGroup[]) => TemplateGroup[])) => {
    onGroupsChange(next)
  }, [onGroupsChange])

  async function persistGroups(nextGroups: TemplateGroup[]) {
    if (isMeetingMode) {
      if (!meetingId) {
        throw new Error('Meeting not found')
      }
      await saveMeetingTemplateGroupsRequest(meetingId, nextGroups)
      return
    }

    if (!committeeId) {
      throw new Error('No committee linked — assign a committee first')
    }
    await saveCommitteeTemplateGroupsRequest(committeeId, nextGroups)
  }

  function isMinuteOfMeetingSection(section: TemplateSection) {
    return isMinuteOfMeetingSectionTitle(section.title)
  }

  async function saveSection(
    groupId: string,
    sectionId: string,
    section: TemplateSection,
    payload: {
      prompt: string
      templateFileName: string | null
      noTemplateNeeded: boolean
    },
    selectedFile: File | null,
  ) {
    const previousGroups = groups
    let nextTemplateStoragePath = payload.noTemplateNeeded ? null : section.templateStoragePath
    let nextTemplateFileName = payload.templateFileName
    let nextMomTemplateValidation = payload.noTemplateNeeded ? null : section.momTemplateValidation

    try {
      if (selectedFile) {
        const uploadResult = isMeetingMode
          ? await uploadMeetingTemplateRequest(meetingId!, section.title, selectedFile)
          : await uploadCommitteeTemplateRequest(committeeId!, section.title, selectedFile)
        nextTemplateStoragePath = uploadResult.storagePath
        nextTemplateFileName = uploadResult.fileName
        nextMomTemplateValidation = uploadResult.momTemplateValidation ?? null
      }

      const nextGroups = replaceSection(previousGroups, groupId, sectionId, current => ({
        ...current,
        prompt: payload.prompt,
        templateFileName: nextTemplateFileName,
        templateStoragePath: nextTemplateStoragePath,
        momTemplateValidation: payload.noTemplateNeeded ? null : nextMomTemplateValidation,
        noTemplateNeeded: payload.noTemplateNeeded,
      }))

      setGroups(nextGroups)
      await persistGroups(nextGroups)
      toast.success(
        isMeetingMode
          ? 'Saved this meeting-only secretariat override'
          : isMinuteOfMeetingSection(section)
            ? 'Committee minute instructions saved'
            : 'Committee secretariat instructions saved',
      )
    } catch (error) {
      setGroups(previousGroups)
      throw error
    }
  }

  function addOtherSection(groupId: string) {
    setGroups(prev => replaceGroup(prev, groupId, group => {
      const count = group.sections.filter(section => section.isCustom).length + 1
      return { ...group, sections: [...group.sections, createOtherSection(count)] }
    }))
  }

  function addOtherGroup() {
    setGroups(prev => [...prev, createOtherGroup(prev.filter(group => group.isCustom).length + 1)])
  }

  function getImportType(section: TemplateSection): 'agenda' | 'presenter' | null {
    const title = section.title.trim().toLowerCase()
    if (title === 'agenda') return 'agenda'
    if (title === 'presenter list') return 'presenter'
    return null
  }

  async function importTemplateToCurrentAgenda(
    type: 'agenda' | 'presenter',
    file: File | undefined,
  ) {
    if (!meetingId) {
      throw new Error('Meeting not found')
    }

    if (type === 'agenda') {
      const hasLinkedGeneratedData = Object.values(linkedDataByAgendaId).some(
        state => state.hasMinute || state.hasDraft || state.hasActionItems,
      )
      if (
        hasLinkedGeneratedData
        && !window.confirm('This agenda import will replace the current Step 1 rows and delete linked generated minutes, draft MoM, and action items. Continue?')
      ) {
        return
      }

      if (!file) throw new Error('Please choose a template file first')
      const result = await importAgendaTemplateRequest(meetingId, file)
      const ocrTag = result.usedAiOcr ? ' (AI OCR)' : ''
      const skippedInfo = result.skippedCount > 0 ? `, skipped ${result.skippedCount}` : ''
      toast.success(`Imported ${result.importedCount} agenda row${result.importedCount === 1 ? '' : 's'}${ocrTag}${skippedInfo}`)
      if (result.warnings.length > 0) {
        toast.info(result.warnings.slice(0, 2).join(' | '))
      }
      onImportCompleted?.()
      startTransition(() => {
        router.refresh()
      })
      return
    }

    if (!file) throw new Error('Please choose a template file first')
    const result = await importPresenterTemplateRequest(meetingId, file)
    const ocrTag = result.usedAiOcr ? ' (AI OCR)' : ''
    const skippedInfo = result.skippedCount > 0 ? `, skipped ${result.skippedCount}` : ''
    toast.success(`Presenter import done: ${result.updatedCount} updated, ${result.createdCount} created${ocrTag}${skippedInfo}`)
    if (result.warnings.length > 0) {
      toast.info(result.warnings.slice(0, 2).join(' | '))
    }
    onImportCompleted?.()
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Secretariat Instructions</CardTitle>
          {isMeetingMode ? (
            <p className="mt-2 text-xs text-zinc-500">
              Changes here apply to this meeting only.
              {committeeSettingsHref ? (
                <>
                  {' '}
                  Manage committee-wide defaults in{' '}
                  <Link href={committeeSettingsHref} className="font-medium underline underline-offset-2">
                    Committee Settings
                  </Link>.
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isTemplateOpen ? 'Collapse secretariat instructions section' : 'Expand secretariat instructions section'}
          onClick={() => setIsTemplateOpen(open => !open)}
        >
          {isTemplateOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </CardHeader>
      {isTemplateOpen && (
        <CardContent className="space-y-4">
          <div className="space-y-4">
            {groups.map((group, index) => (
              <div key={group.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold uppercase tracking-wide text-zinc-600">{group.title}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => addOtherSection(group.id)}>
                      <Plus className="h-3.5 w-3.5" />
                      Add others
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      aria-label={group.isOpen ? `Collapse ${group.title}` : `Expand ${group.title}`}
                      onClick={() => setGroups(prev => replaceGroup(prev, group.id, current => ({ ...current, isOpen: !current.isOpen })))}
                    >
                      {group.isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {group.isOpen && (
                  <div className="space-y-2">
                    {group.sections.map(section => {
                      const importType = isMeetingMode ? getImportType(section) : null
                      return (
                        <SettingsTemplateSection
                          key={section.id}
                          section={section}
                          scope={scope}
                          committeeSettingsHref={committeeSettingsHref}
                          onSaveSection={(payload, selectedFile) => saveSection(group.id, section.id, section, payload, selectedFile)}
                          onTitleChange={title => setGroups(prev => replaceSection(prev, group.id, section.id, current => ({ ...current, title })))}
                          onImportToCurrentAgenda={importType
                            ? async file => importTemplateToCurrentAgenda(importType, file)
                            : undefined}
                        />
                      )
                    })}
                  </div>
                )}

                {index < groups.length - 1 && <Separator />}
              </div>
            ))}

            <Separator />
            <Button variant="outline" className="gap-2" onClick={addOtherGroup}>
              <Plus className="h-4 w-4" />
              Add others
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
