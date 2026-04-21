'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { ApiClientError } from '@/lib/api/client'
import { deleteJson, getJson, postJson } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  findActionLikeMinuteTemplateLabels,
  findClosureOnlyMinuteTemplateSignals,
  findMinuteTemplateStabilityWarnings,
  RESOLUTION_PATH_PLACEHOLDER,
} from '@/lib/meeting-generation/minute-template'
import { type MinutePlaybookMode, type MinutePlaybookVariantKey } from '@/lib/meeting-generation/minute-playbooks'

interface PlaybookVariant {
  id: string | null
  variantKey: MinutePlaybookVariantKey
  label: string
  templateId: string | null
  templateName: string | null
  promptText: string
  compiledTemplateVersion: number | null
  isCompiled: boolean
}

interface Playbook {
  playbookId: string
  name: string
  scope: 'agenda' | 'committee'
  isReusable: boolean
  playbookMode: MinutePlaybookMode
  resolutionPathsEnabled: boolean
  hasResolutionAnchor: boolean
  defaultVariantKey: MinutePlaybookVariantKey
  variants: PlaybookVariant[]
}

interface VariantTextMap {
  default: string
  with_action: string
  without_action: string
}

const DEFAULT_PLAYBOOK_MODE: MinutePlaybookMode = 'resolution_paths'

function emptyVariantTexts(): VariantTextMap {
  return {
    default: '',
    with_action: '',
    without_action: '',
  }
}

function resolutionBranchLabel(variantKey: Exclude<MinutePlaybookVariantKey, 'default'>) {
  return variantKey === 'with_action' ? 'Decision + Follow-up' : 'Decision / Closure Only'
}

function resolvedChoiceLabel(enabled: boolean) {
  return enabled ? 'RESOLVED structure on' : 'RESOLVED structure off'
}

function appendResolutionPlaceholder(value: string) {
  if (hasResolutionPlaceholderLine(value)) return value
  return value.trim() ? `${value.trim()}\n\n${RESOLUTION_PATH_PLACEHOLDER}` : RESOLUTION_PATH_PLACEHOLDER
}

function hasResolutionPlaceholderLine(value: string) {
  return value
    .split('\n')
    .map(line => line.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim())
    .some(line => /^(?:\[\s*RESOLUTION_PATH\s*\]|\{\{\s*RESOLUTION_PATH\s*\}\})$/.test(line))
}

export function FormatSection({ committeeId }: { committeeId: string }) {
  const router = useRouter()
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [editingPlaybookId, setEditingPlaybookId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [playbookMode, setPlaybookMode] = useState<MinutePlaybookMode>(DEFAULT_PLAYBOOK_MODE)
  const [resolutionPathsEnabled, setResolutionPathsEnabled] = useState(false)
  const [variantTexts, setVariantTexts] = useState<VariantTextMap>(emptyVariantTexts())
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let ignore = false
    async function load() {
      setIsLoading(true)
      try {
        const result = await getJson<{ ok: true; playbooks: Playbook[] }>(
          `/api/settings/playbook?committeeId=${encodeURIComponent(committeeId)}`,
        )
        if (!ignore) {
          setPlaybooks(result.playbooks)
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error instanceof Error ? error.message : 'Failed to load playbooks')
        }
      } finally {
        if (!ignore) {
          setIsLoading(false)
        }
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [committeeId])

  const sortedPlaybooks = useMemo(
    () => [...playbooks].sort((left, right) => left.name.localeCompare(right.name)),
    [playbooks],
  )

  const isLegacyFullMode = playbookMode === 'legacy_full'
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

  function updateVariantText(variantKey: MinutePlaybookVariantKey, value: string) {
    setVariantTexts(prev => ({ ...prev, [variantKey]: value }))
  }

  function resetEditor() {
    setIsEditing(false)
    setEditingPlaybookId(null)
    setName('')
    setPlaybookMode(DEFAULT_PLAYBOOK_MODE)
    setResolutionPathsEnabled(false)
    setVariantTexts(emptyVariantTexts())
  }

  function startEditing(playbook?: Playbook) {
    if (!playbook) {
      setEditingPlaybookId(null)
      setName('')
      setPlaybookMode(DEFAULT_PLAYBOOK_MODE)
      setResolutionPathsEnabled(false)
      setVariantTexts(emptyVariantTexts())
      setIsEditing(true)
      return
    }

    setEditingPlaybookId(playbook.playbookId)
    setName(playbook.name)
    setPlaybookMode(playbook.playbookMode)
    setResolutionPathsEnabled(playbook.resolutionPathsEnabled)
    setVariantTexts({
      default: playbook.variants.find(variant => variant.variantKey === 'default')?.promptText ?? '',
      with_action: playbook.variants.find(variant => variant.variantKey === 'with_action')?.promptText ?? '',
      without_action: playbook.variants.find(variant => variant.variantKey === 'without_action')?.promptText ?? '',
    })
    setIsEditing(true)
  }

  function handleSave() {
    if (!variantTexts.default.trim()) {
      toast.error('Base format is required')
      return
    }

    if (!isLegacyFullMode) {
      if (!resolutionPathsEnabled && hasResolutionPlaceholderLine(variantTexts.default)) {
        toast.error(`Remove ${RESOLUTION_PATH_PLACEHOLDER} or enable Resolution Paths`)
        return
      }
      if (resolutionPathsEnabled && !hasResolutionPlaceholderLine(variantTexts.default)) {
        toast.error(`Base format must include ${RESOLUTION_PATH_PLACEHOLDER}`)
        return
      }
      if (resolutionPathsEnabled && !variantTexts.with_action.trim() && !variantTexts.without_action.trim()) {
        toast.error('Add at least one Resolution Paths branch before saving')
        return
      }
      if (withoutActionWarnings.length > 0) {
        toast.error(`Decision / Closure Only cannot include follow-up labels: ${withoutActionWarnings.slice(0, 4).join(', ')}`)
        return
      }
      if (withActionClosureWarnings.length > 0) {
        toast.error(`Decision + Follow-up cannot include closure-only wording: ${withActionClosureWarnings.slice(0, 4).join(', ')}`)
        return
      }
    }

    startTransition(async () => {
      try {
        const result = await postJson<{ ok: true; playbook: Playbook | null }>(
          '/api/settings/playbook',
          {
            committeeId,
            playbookId: editingPlaybookId,
            name: name.trim() || 'Committee Playbook',
            defaultVariantKey: 'default',
            playbookMode,
            resolutionPathsEnabled,
            variants: [
              { variantKey: 'default', promptText: variantTexts.default },
              { variantKey: 'with_action', promptText: isLegacyFullMode || resolutionPathsEnabled ? variantTexts.with_action : '' },
              { variantKey: 'without_action', promptText: isLegacyFullMode || resolutionPathsEnabled ? variantTexts.without_action : '' },
            ],
          },
        )

        const savedPlaybook = result.playbook
        if (savedPlaybook) {
          setPlaybooks(prev => {
            const next = prev.filter(playbook => playbook.playbookId !== savedPlaybook.playbookId)
            next.push(savedPlaybook)
            return next
          })
        }

        const normalizedDefaultText = savedPlaybook?.variants.find(variant => variant.variantKey === 'default')?.promptText ?? ''
        const formattingWasNormalized = normalizedDefaultText && normalizedDefaultText !== variantTexts.default
        toast.success(
          formattingWasNormalized
            ? 'Formatting normalized for exact mode and saved'
            : editingPlaybookId
              ? 'Playbook updated'
              : 'Playbook created',
        )
        resetEditor()
        router.refresh()
      } catch (error) {
        const compileIssues = error instanceof ApiClientError
          ? ((error.details as { issues?: Array<{ message?: string }> } | undefined)?.issues ?? [])
          : []
        toast.error(compileIssues[0]?.message ?? (error instanceof Error ? error.message : 'Failed to save playbook'))
      }
    })
  }

  function handleDelete(playbookId: string) {
    const confirmed = window.confirm('Delete this committee playbook? Agendas already using it will fall back to their last saved default template.')
    if (!confirmed) return

    startTransition(async () => {
      try {
        await deleteJson<{ ok: true }>('/api/settings/playbook', { playbookId })
        setPlaybooks(prev => prev.filter(playbook => playbook.playbookId !== playbookId))
        toast.success('Playbook deleted')
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete playbook')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Manage reusable exact-format playbooks for this committee.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Use one shared base format, then turn on Resolution Paths only when the RESOLVED block needs alternate exact outcomes. If you still see a simple Default / With Action / Without Action editor, refresh into the latest UI build.
          </p>
        </div>
        {!isEditing ? (
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => startEditing()}>
            <Plus className="h-3.5 w-3.5" />
            Add Playbook
          </Button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="space-y-4 rounded-2xl border p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-950">Committee Playbook Editor</p>
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
            <p className="text-xs text-zinc-500">
              Choose first whether RESOLVED should stay inside the same exact format or use a separate exact section.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Playbook name</label>
            <Input
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Committee Resolution Playbook"
            />
          </div>

          {isLegacyFullMode ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                This playbook uses legacy full-template variants. Existing behavior is preserved here until you rebuild it with Resolution Paths.
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Base Format</label>
                {baseFormatStabilityWarnings.length > 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
                    {baseFormatStabilityWarnings[0]?.message}
                  </div>
                ) : null}
                <Textarea
                  value={variantTexts.default}
                  onChange={event => updateVariantText('default', event.target.value)}
                  rows={7}
                  placeholder="Paste the base legacy format here..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">{resolutionBranchLabel('without_action')}</label>
                <Textarea
                  value={variantTexts.without_action}
                  onChange={event => updateVariantText('without_action', event.target.value)}
                  rows={5}
                  placeholder="Optional legacy decision / closure-only full format..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">{resolutionBranchLabel('with_action')}</label>
                <Textarea
                  value={variantTexts.with_action}
                  onChange={event => updateVariantText('with_action', event.target.value)}
                  rows={5}
                  placeholder="Optional legacy decision + follow-up full format..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">RESOLVED Structure</p>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                    Resolution Paths UI
                  </span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-medium text-blue-800">
                    {resolvedChoiceLabel(resolutionPathsEnabled)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Decide here whether RESOLVED should stay inside the shared exact format or use its own exact section.
                </p>

                <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-3 py-3">
                  <div className="space-y-1">
                    <Label htmlFor="committee-resolved-structure-needed" className="text-sm font-medium text-zinc-950">
                      RESOLVED structure needed
                    </Label>
                    <p className="text-xs text-zinc-500">
                      Leave this off when the entire minute can follow one shared format. Turn it on only when RESOLVED needs its own exact structure.
                    </p>
                  </div>
                  <Switch
                    id="committee-resolved-structure-needed"
                    checked={resolutionPathsEnabled}
                    onCheckedChange={setResolutionPathsEnabled}
                    aria-label="RESOLVED structure needed"
                  />
                </div>

                <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-600">
                  {resolutionPathsEnabled
                    ? 'RESOLVED will use separate exact blocks for Decision / Closure Only and Decision + Follow-up.'
                    : 'RESOLVED stays inside the same shared base format, so no extra RESOLVED blocks are needed.'}
                </div>

                {resolutionPathsEnabled ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      Insert <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[12px]">{RESOLUTION_PATH_PLACEHOLDER}</code> where the selected RESOLVED block should appear.
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => updateVariantText('default', appendResolutionPlaceholder(variantTexts.default))}>
                      Insert Resolution Placeholder
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Base Format</label>
                <Textarea
                  value={variantTexts.default}
                  onChange={event => updateVariantText('default', event.target.value)}
                  rows={8}
                  placeholder="Paste the shared minute structure here..."
                />
                <p className="text-xs text-zinc-500">
                  {resolutionPathsEnabled
                    ? `Use ${RESOLUTION_PATH_PLACEHOLDER} only where the separate RESOLVED section should appear.`
                    : 'Keep everything in one shared exact format when no separate RESOLVED section is needed.'}
                </p>
              </div>

              {resolutionPathsEnabled ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{resolutionBranchLabel('without_action')}</label>
                    <Textarea
                      value={variantTexts.without_action}
                      onChange={event => updateVariantText('without_action', event.target.value)}
                      rows={5}
                      placeholder="Optional decision / closure-only RESOLVED block..."
                    />
                    {withoutActionWarnings.length > 0 ? (
                      <p className="text-xs leading-5 text-amber-700">
                        Follow-up-style labels detected here: {withoutActionWarnings.slice(0, 4).join(', ')}
                        {withoutActionWarnings.length > 4 ? `, +${withoutActionWarnings.length - 4} more` : ''}. Remove action, PIC, owner, or due-date fields from this branch.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{resolutionBranchLabel('with_action')}</label>
                    <Textarea
                      value={variantTexts.with_action}
                      onChange={event => updateVariantText('with_action', event.target.value)}
                      rows={5}
                      placeholder="Optional decision + follow-up RESOLVED block..."
                    />
                    {withActionClosureWarnings.length > 0 ? (
                      <p className="text-xs leading-5 text-amber-700">
                        Closure-only wording detected here: {withActionClosureWarnings.slice(0, 4).join(', ')}
                        {withActionClosureWarnings.length > 4 ? `, +${withActionClosureWarnings.length - 4} more` : ''}. Replace those lines with neutral decision wording and keep follow-up owners or tasks here.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={resetEditor} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={isPending} className="gap-1.5">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save Playbook
            </Button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
          Loading playbooks...
        </div>
      ) : sortedPlaybooks.length > 0 ? (
        <div className="space-y-3">
          {sortedPlaybooks.map(playbook => (
            <div key={playbook.playbookId} className="rounded-2xl border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{playbook.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {playbook.playbookMode === 'legacy_full'
                      ? 'Legacy full-template mode.'
                      : playbook.resolutionPathsEnabled
                        ? 'Resolution Paths enabled.'
                        : 'Base-format only.'}
                  </p>
                  {!isLoading ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {playbook.playbookMode === 'legacy_full' ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                          Legacy variant layout
                        </span>
                      ) : (
                        <>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                            Resolution Paths UI
                          </span>
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                            {resolvedChoiceLabel(playbook.resolutionPathsEnabled)}
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => startEditing(playbook)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700" onClick={() => handleDelete(playbook.playbookId)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {playbook.variants.map(variant => (
                    <div key={`${playbook.playbookId}:${variant.variantKey}`} className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        {variant.variantKey === 'default'
                          ? 'Base Format'
                          : variant.label}
                      </p>
                      {variant.isCompiled && variant.compiledTemplateVersion ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          v{variant.compiledTemplateVersion}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-xs leading-5 text-zinc-600">
                      {variant.promptText || 'Not configured'}
                    </p>
                    {variant.variantKey === 'without_action' && findActionLikeMinuteTemplateLabels(variant.promptText).length > 0 ? (
                      <p className="mt-2 text-[11px] leading-5 text-amber-700">
                        This saved Decision / Closure Only branch still contains follow-up-style labels.
                      </p>
                    ) : null}
                    {variant.variantKey === 'with_action' && findClosureOnlyMinuteTemplateSignals(variant.promptText).length > 0 ? (
                      <p className="mt-2 text-[11px] leading-5 text-amber-700">
                        This saved Decision + Follow-up branch still contains closure-only wording.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : !isEditing ? (
        <p className="py-4 text-center text-sm text-zinc-400">No reusable playbooks yet.</p>
      ) : null}
    </div>
  )
}
