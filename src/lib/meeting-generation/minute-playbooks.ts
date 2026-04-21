import {
  buildStoredMinuteTemplateData,
  getCompiledMinuteTemplate,
  hasMinuteTemplateResolutionAnchor,
  isCompiledMinuteTemplate,
  type MinuteTemplateCompileMode,
} from './minute-template'
import type { DatabaseClient } from './shared'

export const MINUTE_PLAYBOOK_VARIANT_KEYS = ['default', 'with_action', 'without_action'] as const

export type MinutePlaybookVariantKey = (typeof MINUTE_PLAYBOOK_VARIANT_KEYS)[number]
export type MinutePlaybookScope = 'agenda' | 'committee'
export type MinutePlaybookMode = 'resolution_paths' | 'legacy_full'

type SupabaseLike = Pick<DatabaseClient, 'from'>

export interface MinutePlaybookVariantRecord {
  id: string
  playbookId: string
  variantKey: MinutePlaybookVariantKey
  formatTemplateId: string
  templateName: string | null
  promptText: string
  compiledTemplateJson: unknown
  compiledTemplateVersion: number | null
  isCompiled: boolean
}

export interface MinutePlaybookRecord {
  id: string
  committeeId: string
  name: string
  scope: MinutePlaybookScope
  isReusable: boolean
  defaultVariantKey: MinutePlaybookVariantKey
  variants: MinutePlaybookVariantRecord[]
}

export interface MinutePlaybookVariantInput {
  variantKey: MinutePlaybookVariantKey
  promptText: string
}

export function isMinutePlaybookVariantKey(value: string): value is MinutePlaybookVariantKey {
  return (MINUTE_PLAYBOOK_VARIANT_KEYS as readonly string[]).includes(value)
}

export function getMinutePlaybookVariantLabel(variantKey: MinutePlaybookVariantKey) {
  if (variantKey === 'with_action') return 'Decision + Follow-up'
  if (variantKey === 'without_action') return 'Decision / Closure Only'
  return 'No Resolution'
}

export function emptyMinutePlaybookVariantTexts() {
  return {
    default: '',
    with_action: '',
    without_action: '',
  } satisfies Record<MinutePlaybookVariantKey, string>
}

export function toMinutePlaybookVariantTextMap(
  variants: Array<Pick<MinutePlaybookVariantRecord, 'variantKey' | 'promptText'>>,
) {
  const next = emptyMinutePlaybookVariantTexts()
  for (const variant of variants) {
    next[variant.variantKey] = variant.promptText
  }
  return next
}

export function getMinutePlaybookVariant(
  playbook: MinutePlaybookRecord | null | undefined,
  variantKey: MinutePlaybookVariantKey,
) {
  return playbook?.variants.find(variant => variant.variantKey === variantKey) ?? null
}

export function getMinutePlaybookVariantById(
  playbook: MinutePlaybookRecord | null | undefined,
  variantId: string | null | undefined,
) {
  if (!playbook || !variantId) return null
  return playbook.variants.find(variant => variant.id === variantId) ?? null
}

export function getMinutePlaybookDefaultVariant(playbook: MinutePlaybookRecord | null | undefined) {
  if (!playbook) return null
  return (
    getMinutePlaybookVariant(playbook, playbook.defaultVariantKey)
    ?? getMinutePlaybookVariant(playbook, 'default')
    ?? playbook.variants[0]
    ?? null
  )
}

export function getMinutePlaybookMode(playbook: MinutePlaybookRecord | null | undefined): MinutePlaybookMode {
  const defaultVariant = getMinutePlaybookDefaultVariant(playbook)
  const defaultTemplate = defaultVariant
    ? getCompiledMinuteTemplate(defaultVariant.compiledTemplateJson)
    : null

  if (defaultTemplate && hasMinuteTemplateResolutionAnchor(defaultTemplate)) {
    return 'resolution_paths'
  }

  const hasLegacyAlternates = Boolean(
    playbook?.variants.some(variant => variant.variantKey !== 'default' && variant.promptText.trim()),
  )

  return hasLegacyAlternates ? 'legacy_full' : 'resolution_paths'
}

export function playbookHasResolutionAnchor(playbook: MinutePlaybookRecord | null | undefined) {
  const defaultVariant = getMinutePlaybookDefaultVariant(playbook)
  const defaultTemplate = defaultVariant
    ? getCompiledMinuteTemplate(defaultVariant.compiledTemplateJson)
    : null
  return Boolean(defaultTemplate && hasMinuteTemplateResolutionAnchor(defaultTemplate))
}

export function playbookHasCompleteExactFormatting(playbook: MinutePlaybookRecord | null | undefined) {
  if (!playbook || playbook.variants.length === 0) return false

  const defaultVariant = getMinutePlaybookDefaultVariant(playbook)
  if (!defaultVariant || !isCompiledMinuteTemplate(defaultVariant.compiledTemplateJson)) {
    return false
  }

  return playbook.variants.every(variant => isCompiledMinuteTemplate(variant.compiledTemplateJson))
}

function mapTemplateRowsById(
  templateRows: Array<{
    id: string
    name: string
    prompt_text: string
    compiled_template_json: unknown
    compiled_template_version: number | null
  }>,
) {
  return new Map(
    templateRows.map(template => [template.id, {
      id: template.id,
      name: template.name,
      promptText: template.prompt_text,
      compiledTemplateJson: template.compiled_template_json,
      compiledTemplateVersion: template.compiled_template_version ?? null,
    }]),
  )
}

export async function loadMinutePlaybooksByIds(
  supabase: SupabaseLike,
  playbookIds: string[],
) {
  if (playbookIds.length === 0) return new Map<string, MinutePlaybookRecord>()

  const { data: playbookRows, error: playbookError } = await supabase
    .from('minute_playbooks')
    .select('id, committee_id, name, scope, is_reusable, default_variant_key')
    .in('id', playbookIds)

  if (playbookError) {
    throw new Error(playbookError.message)
  }

  const { data: variantRows, error: variantError } = await supabase
    .from('minute_playbook_variants')
    .select('id, playbook_id, variant_key, format_template_id')
    .in('playbook_id', playbookIds)

  if (variantError) {
    throw new Error(variantError.message)
  }

  const templateIds = Array.from(
    new Set(
      (variantRows ?? [])
        .map(variant => variant.format_template_id)
        .filter((value): value is string => Boolean(value)),
    ),
  )

  const { data: templateRows, error: templateError } = templateIds.length > 0
    ? await supabase
        .from('format_templates')
        .select('id, name, prompt_text, compiled_template_json, compiled_template_version')
        .in('id', templateIds)
    : { data: [], error: null }

  if (templateError) {
    throw new Error(templateError.message)
  }

  const templateById = mapTemplateRowsById(templateRows ?? [])
  const variantsByPlaybookId = new Map<string, MinutePlaybookVariantRecord[]>()

  for (const variant of variantRows ?? []) {
    if (!isMinutePlaybookVariantKey(variant.variant_key)) continue
    const template = templateById.get(variant.format_template_id)
    if (!template) continue

    const items = variantsByPlaybookId.get(variant.playbook_id) ?? []
    items.push({
      id: variant.id,
      playbookId: variant.playbook_id,
      variantKey: variant.variant_key,
      formatTemplateId: variant.format_template_id,
      templateName: template.name,
      promptText: template.promptText,
      compiledTemplateJson: template.compiledTemplateJson,
      compiledTemplateVersion: template.compiledTemplateVersion,
      isCompiled: Boolean(
        template.compiledTemplateJson
        && typeof template.compiledTemplateJson === 'object'
        && (template.compiledTemplateJson as { kind?: string }).kind === 'minute_template',
      ),
    })
    variantsByPlaybookId.set(variant.playbook_id, items)
  }

  const result = new Map<string, MinutePlaybookRecord>()

  for (const row of playbookRows ?? []) {
    if (row.scope !== 'agenda' && row.scope !== 'committee') continue
    if (!isMinutePlaybookVariantKey(row.default_variant_key)) continue

    result.set(row.id, {
      id: row.id,
      committeeId: row.committee_id,
      name: row.name,
      scope: row.scope,
      isReusable: Boolean(row.is_reusable),
      defaultVariantKey: row.default_variant_key,
      variants: (variantsByPlaybookId.get(row.id) ?? []).sort((left, right) => (
        MINUTE_PLAYBOOK_VARIANT_KEYS.indexOf(left.variantKey)
        - MINUTE_PLAYBOOK_VARIANT_KEYS.indexOf(right.variantKey)
      )),
    })
  }

  return result
}

export async function listCommitteeMinutePlaybooks(
  supabase: SupabaseLike,
  committeeId: string,
) {
  const { data: rows, error } = await supabase
    .from('minute_playbooks')
    .select('id')
    .eq('committee_id', committeeId)
    .eq('scope', 'committee')
    .eq('is_reusable', true)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return loadMinutePlaybooksByIds(
    supabase,
    (rows ?? []).map(row => row.id),
  )
}

export function buildCompiledMinuteTemplateFromPrompt(
  promptText: string,
  options?: { mode?: MinuteTemplateCompileMode },
) {
  return buildStoredMinuteTemplateData(promptText, options)
}
