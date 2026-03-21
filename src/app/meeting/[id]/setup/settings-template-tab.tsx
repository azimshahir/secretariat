'use client'

import { type Dispatch, type SetStateAction, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { uploadItineraryTemplate } from '@/actions/itinerary-template'
import { importAgendaToCurrentAgenda, importPresenterListToCurrentAgenda } from './agenda-template-import'
import { saveCommitteeMinuteInstruction } from './committee-generation-actions'
import { SettingsTemplateSection } from './settings-template-section'
import {
  createOtherSection,
  type TemplateGroup,
  type TemplateSection,
} from './settings-template-model'

interface Props {
  meetingId: string
  committeeId: string | null
  groups: TemplateGroup[]
  onGroupsChange: Dispatch<SetStateAction<TemplateGroup[]>>
}

export function SettingsTemplateTab({ meetingId, committeeId, groups, onGroupsChange }: Props) {
  const [isTemplateOpen, setIsTemplateOpen] = useState(true)
  const router = useRouter()
  const setGroups = onGroupsChange

  function updateGroup(groupId: string, updater: (group: TemplateGroup) => TemplateGroup) {
    setGroups(prev => prev.map(group => (group.id === groupId ? updater(group) : group)))
  }

  function updateSection(groupId: string, sectionId: string, updater: (section: TemplateSection) => TemplateSection) {
    updateGroup(groupId, group => ({
      ...group,
      sections: group.sections.map(section => (section.id === sectionId ? updater(section) : section)),
    }))
  }

  function isMinuteOfMeetingSection(section: TemplateSection) {
    return section.title.trim().toLowerCase() === 'minute of meeting'
  }

  async function saveSection(
    groupId: string,
    sectionId: string,
    section: TemplateSection,
    payload: {
      prompt: string
      templateFileName: string | null
      templateFile: File | null
      noTemplateNeeded: boolean
    },
  ) {
    updateSection(groupId, sectionId, section => ({
      ...section,
      prompt: payload.prompt,
      templateFileName: payload.templateFileName,
      templateFile: payload.templateFile,
      noTemplateNeeded: payload.noTemplateNeeded,
    }))

    // Persist template file to Supabase Storage (itineraries + MoM)
    const isItinerary = groups.find(g => g.id === 'itineraries')?.sections.some(s => s.id === sectionId)
    const isMoM = isMinuteOfMeetingSection(section)
    if ((isItinerary || isMoM) && payload.templateFile && committeeId) {
      try {
        const { storagePath } = await uploadItineraryTemplate(committeeId, section.title, payload.templateFile)
        updateSection(groupId, sectionId, s => ({ ...s, templateStoragePath: storagePath }))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to upload template')
      }
    }

    if (!isMinuteOfMeetingSection(section)) {
      toast.success('Secretariat instructions saved')
      return
    }

    if (!committeeId) {
      toast.error('No committee linked — assign a committee first')
      return
    }

    try {
      await saveCommitteeMinuteInstruction(committeeId, payload.prompt)
      toast.success('Minute of Meeting instruction saved')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save minute instruction')
    }
  }

  function addOtherSection(groupId: string) {
    updateGroup(groupId, group => {
      const count = group.sections.filter(section => section.isCustom).length + 1
      return { ...group, sections: [...group.sections, createOtherSection(count)] }
    })
  }

  function addOtherGroup() {
    const count = groups.filter(group => group.isCustom).length + 1
    setGroups(prev => [
      ...prev,
      {
        id: `other-group-${Date.now()}-${count}`,
        title: `Others ${count}`,
        sections: [createOtherSection(1)],
        isOpen: true,
        isCustom: true,
      },
    ])
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
    if (type === 'agenda') {
      if (!file) throw new Error('Please choose a template file first')
      const result = await importAgendaToCurrentAgenda(meetingId, file)
      const ocrTag = result.usedAiOcr ? ' (AI OCR)' : ''
      const skippedInfo = result.skippedCount > 0 ? `, skipped ${result.skippedCount}` : ''
      toast.success(`Imported ${result.importedCount} agenda row${result.importedCount === 1 ? '' : 's'}${ocrTag}${skippedInfo}`)
      if (result.warnings.length > 0) {
        toast.info(result.warnings.slice(0, 2).join(' | '))
      }
      router.refresh()
      return
    }

    if (!file) throw new Error('Please choose a template file first')
    const result = await importPresenterListToCurrentAgenda(meetingId, file)
    const ocrTag = result.usedAiOcr ? ' (AI OCR)' : ''
    const skippedInfo = result.skippedCount > 0 ? `, skipped ${result.skippedCount}` : ''
    toast.success(`Presenter import done: ${result.updatedCount} updated, ${result.createdCount} created${ocrTag}${skippedInfo}`)
    if (result.warnings.length > 0) {
      toast.info(result.warnings.slice(0, 2).join(' | '))
    }
    router.refresh()
  }

  return (
    <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-2">
      <CardTitle>Secretariat Instructions</CardTitle>
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
                    onClick={() => updateGroup(group.id, current => ({ ...current, isOpen: !current.isOpen }))}
                  >
                    {group.isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {group.isOpen && (
                <div className="space-y-2">
                  {group.sections.map(section => {
                    const importType = getImportType(section)
                    return (
                      <SettingsTemplateSection
                        key={section.id}
                        section={section}
                        onSaveSection={payload => saveSection(group.id, section.id, section, payload)}
                        onTitleChange={title => updateSection(group.id, section.id, current => ({ ...current, title }))}
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
