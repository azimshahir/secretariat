'use client'

import type { Editor } from '@tiptap/react'
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiClientError } from '@/lib/api/client'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { RichTextEditor } from '@/components/rich-text-editor'
import {
  buildResolutionPlaceholderBlockHtml,
  countResolutionPlaceholderNodes,
  RESOLUTION_PLACEHOLDER_TOKEN_CLASSES,
} from '@/components/rich-text-extensions'
import {
  findActionLikeMinuteTemplateLabels,
  findClosureOnlyMinuteTemplateSignals,
  findMinuteTemplateStabilityWarnings,
  RESOLUTION_PATH_PLACEHOLDER,
} from '@/lib/meeting-generation/minute-template'
import type { SavedAgendaFormatting, AgendaFormattingState, AgendaFormattingVariantState } from './format-types'
import {
  clearAgendaFormattingRequest,
  saveAgendaFormattingRequest,
  updateAgendaVariantOverrideRequest,
} from './formatting-api'
import {
  type MinutePlaybookMode,
  type MinutePlaybookVariantKey,
} from '@/lib/meeting-generation/minute-playbooks'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  meetingId: string
  agendaId: string
  agendaTitle: string
  committeeId: string
  initialFormatting: AgendaFormattingState | null
  onSaved: (payload: SavedAgendaFormatting) => void
  onCleared: (agendaId: string) => void
}

type VariantTextMap = Record<MinutePlaybookVariantKey, string>

const DEFAULT_PLAYBOOK_MODE: MinutePlaybookMode = 'resolution_paths'
const DEFAULT_SAVE_AS_COMMITTEE_PLAYBOOK = true
const getDraftStorageKey = (agendaId: string) => `mom-format-draft:${agendaId}`

interface FormatDialogDraft {
  name: string
  additionalInfo: string
  saveAsCommitteePlaybook: boolean
  playbookMode: MinutePlaybookMode
  resolutionPathsEnabled: boolean
  variantTexts: VariantTextMap
}

function createEmptyVariantTexts(): VariantTextMap {
  return {
    default: '',
    with_action: '',
    without_action: '',
  }
}

function buildVariantTextsFromFormatting(formatting: AgendaFormattingState | null): VariantTextMap {
  const next = createEmptyVariantTexts()
  for (const variant of formatting?.variants ?? []) {
    next[variant.variantKey] = variant.promptText
  }
  return next
}

function loadDraftFromStorage(agendaId: string): FormatDialogDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getDraftStorageKey(agendaId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FormatDialogDraft> & { promptHtml?: string }
    const legacyPrompt = typeof parsed.promptHtml === 'string' ? parsed.promptHtml : ''
    const variantTexts = createEmptyVariantTexts()
    if (parsed.variantTexts && typeof parsed.variantTexts === 'object') {
      for (const variantKey of Object.keys(variantTexts) as MinutePlaybookVariantKey[]) {
        const value = parsed.variantTexts[variantKey]
        if (typeof value === 'string') {
          variantTexts[variantKey] = value
        }
      }
    } else if (legacyPrompt) {
      variantTexts.default = legacyPrompt
    }

    const draft = {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      additionalInfo: typeof parsed.additionalInfo === 'string' ? parsed.additionalInfo : '',
      saveAsCommitteePlaybook: typeof parsed.saveAsCommitteePlaybook === 'boolean'
        ? parsed.saveAsCommitteePlaybook
        : DEFAULT_SAVE_AS_COMMITTEE_PLAYBOOK,
      playbookMode: parsed.playbookMode === 'legacy_full' ? 'legacy_full' : DEFAULT_PLAYBOOK_MODE,
      resolutionPathsEnabled: Boolean(parsed.resolutionPathsEnabled),
      variantTexts,
    } satisfies FormatDialogDraft

    if (
      !draft.name
      && !draft.additionalInfo
      && !Object.values(draft.variantTexts).some(Boolean)
      && !draft.resolutionPathsEnabled
    ) {
      return null
    }
    return draft
  } catch {
    return null
  }
}

export function saveDraftToStorage(agendaId: string, draft: FormatDialogDraft) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(getDraftStorageKey(agendaId), JSON.stringify(draft))
  } catch {
    // Ignore storage failures.
  }
}

export function clearDraftFromStorage(agendaId: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getDraftStorageKey(agendaId))
  } catch {
    // Ignore storage failures.
  }
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

function baseFormatHasResolutionAnchor(value: string) {
  return editorHtmlToPlainText(value)
    .split('\n')
    .map(line => line.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim())
    .some(line => /^(?:\[\s*RESOLUTION_PATH\s*\]|\{\{\s*RESOLUTION_PATH\s*\}\})$/.test(line))
}

function countResolutionAnchorsInHtml(value: string) {
  return editorHtmlToPlainText(value)
    .split('\n')
    .map(line => line.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim())
    .filter(line => /^(?:\[\s*RESOLUTION_PATH\s*\]|\{\{\s*RESOLUTION_PATH\s*\}\})$/.test(line))
    .length
}

function resolutionBranchLabel(variantKey: Exclude<MinutePlaybookVariantKey, 'default'>) {
  return variantKey === 'with_action' ? 'Decision + Follow-up' : 'Decision / Closure Only'
}

function resolutionBranchDescription(variantKey: Exclude<MinutePlaybookVariantKey, 'default'>) {
  if (variantKey === 'with_action') {
    return 'Use when the RESOLVED section includes action, PIC, or due-date follow-up lines. Do not use closure-only wording such as "Status: Closed." here.'
  }
  return 'Use when the agenda reaches a decision, confirmation, deferment, or closure outcome with no Action By, PIC, due date, or follow-up lines.'
}

function resolvedChoiceLabel(enabled: boolean) {
  return enabled ? 'RESOLVED structure on' : 'RESOLVED structure off'
}

function appendResolutionPlaceholderHtml(value: string) {
  if (baseFormatHasResolutionAnchor(value)) return value
  const trimmed = value.trim()
  if (!trimmed) return buildResolutionPlaceholderBlockHtml()
  return `${trimmed}${buildResolutionPlaceholderBlockHtml()}`
}

function renderBracketGuidanceNote(resolutionPathsEnabled: boolean) {
  return (
    <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/70 px-3 py-3 text-xs leading-5 text-sky-900">
      Highlight a block and use <span className="font-medium">From the Paper</span> when that paragraph should come from the agenda paper.
      Leave other blocks untagged to generate them from the discussion. If needed, add a short note such as{' '}
      <span className="font-medium">1.0 Executive Summary</span> to guide the wording.
      {resolutionPathsEnabled ? (
        <> Keep <span className="font-medium">[RESOLUTION_PATH]</span> only where the separate RESOLVED section should appear.</>
      ) : null}
    </div>
  )
}

function renderActionSemanticsWarning(labels: string[]) {
  if (labels.length === 0) return null
  const preview = labels.slice(0, 4).join(', ')
  const suffix = labels.length > 4 ? `, +${labels.length - 4} more` : ''
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
      This Decision / Closure Only branch still contains follow-up-style labels: <span className="font-medium">{preview}{suffix}</span>.
      Save is still allowed, but removing action, PIC, owner, or due-date fields will make this branch behave more cleanly as closure-only content.
    </div>
  )
}

function renderClosureSemanticsWarning(signals: string[]) {
  if (signals.length === 0) return null
  const preview = signals.slice(0, 4).join(', ')
  const suffix = signals.length > 4 ? `, +${signals.length - 4} more` : ''
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
      This Decision + Follow-up branch still contains closure-only wording: <span className="font-medium">{preview}{suffix}</span>.
      Save is still allowed, but replacing those lines with neutral decision wording will make this branch behave more cleanly for follow-up content.
    </div>
  )
}

function renderVariantEditor(params: {
  title: string
  description: string
  variantKey: MinutePlaybookVariantKey
  value: string
  disabled: boolean
  note?: ReactNode
  onChange: (value: string) => void
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-950">{params.title}</h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{params.description}</p>
      </div>

      {params.note ? <div className="mt-3">{params.note}</div> : null}

      <div className="mt-3">
        <RichTextEditor
          content={params.value}
          onChange={params.onChange}
          disabled={params.disabled}
          placeholder={params.variantKey === 'default'
            ? 'Paste the shared minute structure here...'
            : `Optional ${params.title.toLowerCase()} block...`}
        />
      </div>
    </section>
  )
}

export function FormatDialog({
  open,
  onOpenChange,
  meetingId,
  agendaId,
  agendaTitle,
  committeeId,
  initialFormatting,
  onSaved,
  onCleared,
}: Props) {
  const initialDraft = loadDraftFromStorage(agendaId)
  const [name, setName] = useState(initialDraft?.name ?? (initialFormatting?.playbookName || agendaTitle))
  const [additionalInfo, setAdditionalInfo] = useState(initialDraft?.additionalInfo ?? (initialFormatting?.additionalInfo ?? ''))
  const [saveAsCommitteePlaybook, setSaveAsCommitteePlaybook] = useState(
    initialDraft?.saveAsCommitteePlaybook ?? DEFAULT_SAVE_AS_COMMITTEE_PLAYBOOK,
  )
  const [playbookMode, setPlaybookMode] = useState<MinutePlaybookMode>(initialDraft?.playbookMode ?? (initialFormatting?.playbookMode ?? DEFAULT_PLAYBOOK_MODE))
  const [resolutionPathsEnabled, setResolutionPathsEnabled] = useState(initialDraft?.resolutionPathsEnabled ?? (initialFormatting?.resolutionPathsEnabled ?? false))
  const [variantTexts, setVariantTexts] = useState<VariantTextMap>(
    initialDraft?.variantTexts ?? buildVariantTextsFromFormatting(initialFormatting),
  )
  const [savedVariants, setSavedVariants] = useState<AgendaFormattingVariantState[]>(initialFormatting?.variants ?? [])
  const [variantOverrideId, setVariantOverrideId] = useState(initialFormatting?.variantOverrideId ?? 'auto')
  const [isPending, startTransition] = useTransition()
  const [isSavingOverride, startSavingOverride] = useTransition()
  const baseEditorRef = useRef<Editor | null>(null)

  const isLegacyFullMode = playbookMode === 'legacy_full'
  const canUseVariantOverride = isLegacyFullMode || resolutionPathsEnabled
  const withoutActionWarnings = useMemo(
    () => (resolutionPathsEnabled ? findActionLikeMinuteTemplateLabels(variantTexts.without_action) : []),
    [resolutionPathsEnabled, variantTexts.without_action],
  )
  const withActionClosureWarnings = useMemo(
    () => (resolutionPathsEnabled ? findClosureOnlyMinuteTemplateSignals(variantTexts.with_action) : []),
    [resolutionPathsEnabled, variantTexts.with_action],
  )
  const baseFormatStabilityWarnings = useMemo(
    () => (isLegacyFullMode ? [] : findMinuteTemplateStabilityWarnings(variantTexts.default)),
    [isLegacyFullMode, variantTexts.default],
  )

  useEffect(() => {
    if (!open) return
      saveDraftToStorage(agendaId, {
        name,
        additionalInfo,
        saveAsCommitteePlaybook,
        playbookMode,
        resolutionPathsEnabled,
        variantTexts,
    })
  }, [
    additionalInfo,
    agendaId,
    name,
    open,
    playbookMode,
    resolutionPathsEnabled,
    saveAsCommitteePlaybook,
    variantTexts,
  ])

  function updateVariantText(variantKey: MinutePlaybookVariantKey, value: string) {
    setVariantTexts(prev => ({ ...prev, [variantKey]: value }))
  }

  function getCurrentBaseFormatValue() {
    return baseEditorRef.current?.getHTML() ?? variantTexts.default
  }

  function getBaseResolutionPlaceholderCount() {
    const editorCount = countResolutionPlaceholderNodes(baseEditorRef.current)
    if (editorCount > 0) return editorCount
    return countResolutionAnchorsInHtml(getCurrentBaseFormatValue())
  }

  function handleInsertResolutionPlaceholder() {
    if (getBaseResolutionPlaceholderCount() > 0) {
      toast.info('Base format already contains the RESOLVED placeholder box')
      return
    }

    if (baseEditorRef.current) {
      baseEditorRef.current.chain().focus().insertContent(buildResolutionPlaceholderBlockHtml()).run()
      return
    }

    updateVariantText('default', appendResolutionPlaceholderHtml(variantTexts.default))
  }

  function handleSave() {
    const currentDefaultVariantText = getCurrentBaseFormatValue()
    const resolutionPlaceholderCount = getBaseResolutionPlaceholderCount()
    if (currentDefaultVariantText !== variantTexts.default) {
      setVariantTexts(prev => ({ ...prev, default: currentDefaultVariantText }))
    }

    if (!editorHtmlToPlainText(currentDefaultVariantText)) {
      toast.error('Base format is required')
      return
    }

    if (!isLegacyFullMode) {
      if (!resolutionPathsEnabled && resolutionPlaceholderCount > 0) {
        toast.error(`Remove ${RESOLUTION_PATH_PLACEHOLDER} or enable Resolution Paths`)
        return
      }
      if (resolutionPathsEnabled && resolutionPlaceholderCount === 0) {
        toast.error(`Base format must include ${RESOLUTION_PATH_PLACEHOLDER}`)
        return
      }
      if (resolutionPathsEnabled && resolutionPlaceholderCount > 1) {
        toast.error(`Base format can only contain one ${RESOLUTION_PATH_PLACEHOLDER}`)
        return
      }
      if (resolutionPathsEnabled && (
        !editorHtmlToPlainText(variantTexts.with_action)
        && !editorHtmlToPlainText(variantTexts.without_action)
      )) {
        toast.error('Add at least one Resolution Paths branch before saving')
        return
      }
    }

    startTransition(async () => {
      try {
        const payload = await saveAgendaFormattingRequest(meetingId, {
          agendaId,
          committeeId,
          name: name.trim() || agendaTitle,
          playbookMode,
          resolutionPathsEnabled,
          variants: [
            { variantKey: 'default', promptText: currentDefaultVariantText },
            { variantKey: 'with_action', promptText: isLegacyFullMode || resolutionPathsEnabled ? variantTexts.with_action : '' },
            { variantKey: 'without_action', promptText: isLegacyFullMode || resolutionPathsEnabled ? variantTexts.without_action : '' },
          ],
          additionalInfo: additionalInfo.trim(),
          saveAsCommitteePlaybook,
        })
        setSavedVariants(payload.variants)
        setPlaybookMode(payload.playbookMode)
        setResolutionPathsEnabled(payload.resolutionPathsEnabled)
        setVariantOverrideId(payload.variantOverrideId ?? 'auto')
        setVariantTexts({
          default: payload.variants.find(variant => variant.variantKey === 'default')?.promptText ?? '',
          with_action: payload.variants.find(variant => variant.variantKey === 'with_action')?.promptText ?? '',
          without_action: payload.variants.find(variant => variant.variantKey === 'without_action')?.promptText ?? '',
        })
        onSaved(payload)
        const normalizedBaseFormat = payload.variants.find(variant => variant.variantKey === 'default')?.promptText ?? ''
        const formattingWasNormalized = normalizedBaseFormat !== currentDefaultVariantText
        toast.success(
          formattingWasNormalized
            ? 'Formatting normalized for exact mode and saved'
            : saveAsCommitteePlaybook
              ? 'Reusable playbook saved to the committee library'
              : 'Playbook saved',
        )
      } catch (error) {
        const compileIssues = error instanceof ApiClientError
          ? ((error.details as { issues?: Array<{ message?: string }> } | undefined)?.issues ?? [])
          : []
        toast.error(compileIssues[0]?.message ?? (error instanceof Error ? error.message : 'Failed to save playbook'))
      }
    })
  }

  function handleClearFormatting() {
    clearDraftFromStorage(agendaId)
    startTransition(async () => {
      try {
        await clearAgendaFormattingRequest(meetingId, agendaId)
        setName(agendaTitle)
        setAdditionalInfo('')
        setSaveAsCommitteePlaybook(DEFAULT_SAVE_AS_COMMITTEE_PLAYBOOK)
        setPlaybookMode(DEFAULT_PLAYBOOK_MODE)
        setResolutionPathsEnabled(false)
        setVariantTexts(createEmptyVariantTexts())
        setSavedVariants([])
        setVariantOverrideId('auto')
        toast.success('Formatting cleared')
        onCleared(agendaId)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to clear formatting')
      }
    })
  }

  function handleVariantOverrideChange(nextValue: string) {
    const nextOverrideId = nextValue === 'auto' ? null : nextValue
    setVariantOverrideId(nextValue)
    startSavingOverride(async () => {
      try {
        const payload = await updateAgendaVariantOverrideRequest(meetingId, agendaId, nextOverrideId)
        onSaved(payload)
        toast.success(nextOverrideId ? 'Variant override saved' : 'Auto variant selection restored')
      } catch (error) {
        setVariantOverrideId(initialFormatting?.variantOverrideId ?? 'auto')
        toast.error(error instanceof Error ? error.message : 'Failed to update variant override')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          saveDraftToStorage(agendaId, {
            name,
            additionalInfo,
            saveAsCommitteePlaybook,
            playbookMode,
            resolutionPathsEnabled,
            variantTexts,
          })
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Agenda Playbook</DialogTitle>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              isLegacyFullMode
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}>
              {isLegacyFullMode ? 'Legacy variant layout' : 'Resolution Paths UI'}
            </span>
            {!isLegacyFullMode ? (
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-800">
                {resolvedChoiceLabel(resolutionPathsEnabled)}
              </span>
            ) : null}
          </div>
          <DialogDescription>
            Choose first whether RESOLVED should stay inside the same exact format or use a separate exact section. Use the placeholder box to mark exactly where the RESOLVED block should appear.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-1.5">
              <label htmlFor="playbook-name" className="text-sm font-medium">Playbook name</label>
              <Input
                id="playbook-name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. ALCO Resolution Playbook"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Manual variant override</label>
              {canUseVariantOverride ? (
                <>
                  <Select value={variantOverrideId} onValueChange={handleVariantOverrideChange} disabled={isSavingOverride || savedVariants.length === 0}>
                    <SelectTrigger>
                      <SelectValue placeholder="Auto select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto select</SelectItem>
                      {savedVariants.filter(variant => variant.id).map(variant => (
                        <SelectItem key={variant.id} value={variant.id ?? variant.variantKey}>
                          {variant.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-zinc-500">
                    {isLegacyFullMode
                      ? 'Legacy full-template variants can still be selected manually here.'
                      : 'Auto mode chooses No Resolution, Decision / Closure Only, or Decision + Follow-up only while RESOLVED structure is enabled.'}
                  </p>
                </>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs leading-5 text-zinc-600">
                  Manual RESOLVED branch selection is disabled while <span className="font-medium text-zinc-800">RESOLVED structure needed</span> is off. The shared base format will be used as-is.
                </div>
              )}
            </div>
          </div>

          {!isLegacyFullMode ? (
            <section className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="resolved-structure-needed" className="text-sm font-semibold text-zinc-950">
                    RESOLVED structure needed
                  </Label>
                  <p className="text-xs leading-5 text-zinc-500">
                    Keep this off when the whole minute can follow one shared exact format. Turn it on only when RESOLVED needs its own exact structure.
                  </p>
                </div>
                <Switch
                  id="resolved-structure-needed"
                  checked={resolutionPathsEnabled}
                  onCheckedChange={setResolutionPathsEnabled}
                  aria-label="RESOLVED structure needed"
                />
              </div>

              <div className="mt-4 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-600">
                {resolutionPathsEnabled
                  ? 'RESOLVED will use separate exact blocks for Decision / Closure Only and Decision + Follow-up.'
                  : 'RESOLVED stays inside the same shared base format, so no extra RESOLVED blocks are needed.'}
              </div>

              {resolutionPathsEnabled ? (
                <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-600">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      Insert the RESOLVED placeholder box <span className={RESOLUTION_PLACEHOLDER_TOKEN_CLASSES}>[RESOLUTION_PATH]</span> into the base format where the selected RESOLVED block should appear.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={handleInsertResolutionPlaceholder}>
                      Insert Resolution Placeholder
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {isLegacyFullMode ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                This playbook uses legacy full-template variants. Existing behavior is preserved here until you rebuild it with Resolution Paths.
              </div>

              {renderVariantEditor({
                title: 'Base Format',
                description: 'Legacy full-template mode keeps a full minute format for the base case.',
                variantKey: 'default',
                value: variantTexts.default,
                disabled: isPending,
                note: renderBracketGuidanceNote(false),
                onChange: value => updateVariantText('default', value),
              })}
              {renderVariantEditor({
                title: resolutionBranchLabel('without_action'),
                description: 'Legacy full-template mode keeps a separate full minute format for this case.',
                variantKey: 'without_action',
                value: variantTexts.without_action,
                disabled: isPending,
                onChange: value => updateVariantText('without_action', value),
              })}
              {renderVariantEditor({
                title: resolutionBranchLabel('with_action'),
                description: 'Legacy full-template mode keeps a separate full minute format for this case.',
                variantKey: 'with_action',
                value: variantTexts.with_action,
                disabled: isPending,
                onChange: value => updateVariantText('with_action', value),
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <section className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">Base Format</h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {resolutionPathsEnabled
                      ? 'This shared exact structure is used for the full minute. Insert the RESOLVED placeholder box only where the separate RESOLVED section should appear.'
                      : 'This shared exact structure is used for the full minute, including any wording that would normally appear without a separate RESOLVED section.'}
                  </p>
                </div>

                <div className="mt-3">
                  {renderBracketGuidanceNote(resolutionPathsEnabled)}
                </div>

                {baseFormatStabilityWarnings.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
                    {baseFormatStabilityWarnings[0]?.message}
                  </div>
                ) : null}

                <div className="mt-3">
                  <RichTextEditor
                    content={variantTexts.default}
                    onChange={value => updateVariantText('default', value)}
                    disabled={isPending}
                    placeholder="Paste the shared minute structure here..."
                    enableResolutionPlaceholderToken
                    enableMinuteSourceTagging
                    onEditorReady={editor => {
                      baseEditorRef.current = editor
                    }}
                  />
                </div>
              </section>

              {resolutionPathsEnabled ? (
                <>
                  {renderVariantEditor({
                    title: resolutionBranchLabel('without_action'),
                    description: resolutionBranchDescription('without_action'),
                    variantKey: 'without_action',
                    value: variantTexts.without_action,
                    disabled: isPending,
                    note: renderActionSemanticsWarning(withoutActionWarnings),
                    onChange: value => updateVariantText('without_action', value),
                  })}
                  {renderVariantEditor({
                    title: resolutionBranchLabel('with_action'),
                    description: resolutionBranchDescription('with_action'),
                    variantKey: 'with_action',
                    value: variantTexts.with_action,
                    disabled: isPending,
                    note: renderClosureSemanticsWarning(withActionClosureWarnings),
                    onChange: value => updateVariantText('with_action', value),
                  })}
                </>
              ) : null}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="fmt-additional" className="text-sm font-medium">Additional Information</label>
            <Textarea
              id="fmt-additional"
              value={additionalInfo}
              onChange={event => setAdditionalInfo(event.target.value)}
              placeholder="Agenda-specific corrections, terminology notes, or speaker exceptions..."
              rows={4}
              className="max-h-48 resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={saveAsCommitteePlaybook}
                onCheckedChange={checked => setSaveAsCommitteePlaybook(Boolean(checked))}
              />
              Save a reusable copy to the committee playbook library
            </label>
            <p className="text-xs text-zinc-500">
              This adds a reusable playbook to the committee library for manual reuse. To auto-prefill future meetings, use <span className="font-medium text-zinc-700">Save as Committee Default</span> in Step 2.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Close
            </Button>
            <Button type="button" variant="outline" onClick={handleClearFormatting} disabled={isPending}>
              Clear formatting
            </Button>
            <Button type="button" onClick={handleSave} disabled={isPending} className="gap-2">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save Playbook
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
