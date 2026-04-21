'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { updateAgendaStatusWithClient } from '@/lib/meeting-generation/agenda-status'
import {
  buildCompiledMinuteTemplateFromPrompt,
  getMinutePlaybookDefaultVariant,
  getMinutePlaybookMode,
  getMinutePlaybookVariantById,
  getMinutePlaybookVariantLabel,
  listCommitteeMinutePlaybooks,
  loadMinutePlaybooksByIds,
  MINUTE_PLAYBOOK_VARIANT_KEYS,
  playbookHasResolutionAnchor,
  toMinutePlaybookVariantTextMap,
  type MinutePlaybookMode,
  type MinutePlaybookRecord,
  type MinutePlaybookVariantKey,
} from '@/lib/meeting-generation/minute-playbooks'
import {
  getCompiledMinuteTemplate,
  hasMinuteTemplateResolutionAnchor,
  RESOLUTION_PATH_PLACEHOLDER,
  type MinuteTemplateCompileMode,
} from '@/lib/meeting-generation/minute-template'
import type { DatabaseClient } from '@/lib/meeting-generation/shared'
import {
  saveAgendaFormattingSchema,
  uuidSchema,
} from '@/lib/validation'
import type {
  AgendaFormattingState,
  AgendaFormattingVariantState,
  CommitteePlaybookOption,
  SavedAgendaFormatting,
} from './format-types'

const MISSING_CLEAR_FORMATTING_RPC_HINT =
  'Database migration missing: clear formatting RPC functions are not created yet. Please run the latest Supabase migrations.'
const MISSING_COMPILED_TEMPLATE_HINT =
  'Database migration missing: compiled minute template columns are not created yet. Please run the latest Supabase migrations.'
const MISSING_PLAYBOOK_SCHEMA_HINT =
  'Database migration missing: minute playbook tables/columns are not created yet. Please run the latest Supabase migrations.'

type SupabaseErrorLike = { code?: string | null; message?: string | null } | null | undefined
type ServerSupabase = Awaited<ReturnType<typeof createClient>>

function toErrorMessage(error: SupabaseErrorLike, fallback: string) {
  const message = (error?.message ?? '').trim()
  return message || fallback
}

function isMissingRpcFunctionError(error: SupabaseErrorLike, functionName: string) {
  if (!error) return false
  if (error.code === 'PGRST202') return true
  const message = (error.message ?? '').toLowerCase()
  const fn = functionName.toLowerCase()
  return message.includes(fn) && (message.includes('schema cache') || message.includes('function'))
}

function isMissingAdditionalInfoColumnError(error: SupabaseErrorLike) {
  if (!error) return false
  if (error.code === '42703') return true
  const message = (error.message ?? '').toLowerCase()
  if (!message.includes('additional_info')) return false
  return (
    message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find')
    || error.code === 'PGRST204'
  )
}

function isMissingCompiledTemplateColumnError(error: SupabaseErrorLike) {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('compiled_template_json')
    || message.includes('compiled_template_version')
    || message.includes('compiled_template_hash')
  )
}

function isMissingPlaybookSchemaError(error: SupabaseErrorLike) {
  if (!error) return false
  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('minute_playbooks')
    || message.includes('minute_playbook_variants')
    || message.includes('minute_playbook_id')
    || message.includes('minute_playbook_variant_override_id')
  )
}

function emptyVariantState(variantKey: MinutePlaybookVariantKey): AgendaFormattingVariantState {
  return {
    id: null,
    variantKey,
    label: getMinutePlaybookVariantLabel(variantKey),
    templateId: null,
    templateName: null,
    promptText: '',
    compiledTemplateVersion: null,
    isCompiled: false,
  }
}

function buildVariantStatesFromPlaybook(playbook: MinutePlaybookRecord | null | undefined) {
  return MINUTE_PLAYBOOK_VARIANT_KEYS.map(variantKey => {
    const variant = playbook?.variants.find(item => item.variantKey === variantKey) ?? null
    if (!variant) return emptyVariantState(variantKey)
    return {
      id: variant.id,
      variantKey,
      label: getMinutePlaybookVariantLabel(variantKey),
      templateId: variant.formatTemplateId,
      templateName: variant.templateName,
      promptText: variant.promptText,
      compiledTemplateVersion: variant.compiledTemplateVersion,
      isCompiled: variant.isCompiled,
    } satisfies AgendaFormattingVariantState
  })
}

function buildVariantStatesFromLegacyTemplate(template: {
  id: string
  name: string
  prompt_text: string
  compiled_template_version: number | null
  compiled_template_json?: unknown
} | null | undefined) {
  return MINUTE_PLAYBOOK_VARIANT_KEYS.map(variantKey => {
    if (variantKey !== 'default' || !template) return emptyVariantState(variantKey)
    return {
      id: null,
      variantKey,
      label: getMinutePlaybookVariantLabel(variantKey),
      templateId: template.id,
      templateName: template.name,
      promptText: template.prompt_text,
      compiledTemplateVersion: template.compiled_template_version ?? null,
      isCompiled: Boolean(
        template.compiled_template_json
        && typeof template.compiled_template_json === 'object'
        && (template.compiled_template_json as { kind?: string }).kind === 'minute_template',
      ),
    } satisfies AgendaFormattingVariantState
  })
}

function buildFormattingModeState(params: {
  playbook?: MinutePlaybookRecord | null
  template?: { compiled_template_json?: unknown } | null
  variants?: AgendaFormattingVariantState[]
}): {
  playbookMode: MinutePlaybookMode
  resolutionPathsEnabled: boolean
  hasResolutionAnchor: boolean
} {
  if (params.playbook) {
    const playbookMode = getMinutePlaybookMode(params.playbook)
    const hasResolutionAnchor = playbookHasResolutionAnchor(params.playbook)
    return {
      playbookMode,
      resolutionPathsEnabled: hasResolutionAnchor,
      hasResolutionAnchor,
    }
  }

  const compiledTemplate = getCompiledMinuteTemplate(params.template?.compiled_template_json ?? null)
  const hasResolutionAnchor = Boolean(compiledTemplate && hasMinuteTemplateResolutionAnchor(compiledTemplate))
  const hasLegacyAlternates = Boolean(
    params.variants?.some(variant => variant.variantKey !== 'default' && variant.promptText.trim()),
  )

  return {
    playbookMode: hasLegacyAlternates ? 'legacy_full' : 'resolution_paths',
    resolutionPathsEnabled: hasResolutionAnchor,
    hasResolutionAnchor,
  }
}

function resolvePlaybookTemplateCompileMode(params: {
  scope: 'agenda' | 'committee'
  isReusable: boolean
}): MinuteTemplateCompileMode {
  return params.scope === 'agenda' && !params.isReusable ? 'agenda_exact' : 'flexible'
}

function validateResolutionPathVariants(params: {
  normalizedVariants: Array<{ variantKey: MinutePlaybookVariantKey; promptText: string }>
  resolutionPathsEnabled: boolean
  compileMode?: MinuteTemplateCompileMode
}) {
  const defaultVariant = params.normalizedVariants.find(variant => variant.variantKey === 'default')
  if (!defaultVariant) {
    throw new Error('Default exact template is required')
  }

  const defaultTemplate = buildCompiledMinuteTemplateFromPrompt(defaultVariant.promptText, {
    mode: params.compileMode,
  }).compiledTemplateJson
  const compiledDefault = getCompiledMinuteTemplate(defaultTemplate)
  if (!params.resolutionPathsEnabled) {
    if (compiledDefault && hasMinuteTemplateResolutionAnchor(compiledDefault)) {
      throw new Error(`Remove ${RESOLUTION_PATH_PLACEHOLDER} or enable Resolution Paths`)
    }
    return
  }

  if (!compiledDefault || !hasMinuteTemplateResolutionAnchor(compiledDefault)) {
    throw new Error(`Base format must include ${RESOLUTION_PATH_PLACEHOLDER}`)
  }

  const branchVariants = params.normalizedVariants.filter(variant => variant.variantKey !== 'default')
  if (branchVariants.length === 0) {
    throw new Error('Add at least one Resolution Paths branch before saving')
  }

  for (const variant of branchVariants) {
    const compiledVariant = getCompiledMinuteTemplate(
      buildCompiledMinuteTemplateFromPrompt(variant.promptText, {
        mode: params.compileMode,
      }).compiledTemplateJson,
    )
    if (compiledVariant && hasMinuteTemplateResolutionAnchor(compiledVariant)) {
      throw new Error(`Resolution branch templates cannot contain ${RESOLUTION_PATH_PLACEHOLDER}`)
    }
  }
}

function buildCommitteePlaybookOptions(playbooks: MinutePlaybookRecord[]): CommitteePlaybookOption[] {
  return playbooks.map(playbook => {
    const modeState = buildFormattingModeState({ playbook })
    return {
      playbookId: playbook.id,
      name: playbook.name,
      scope: playbook.scope,
      isReusable: playbook.isReusable,
      playbookMode: modeState.playbookMode,
      resolutionPathsEnabled: modeState.resolutionPathsEnabled,
      hasResolutionAnchor: modeState.hasResolutionAnchor,
      defaultVariantKey: playbook.defaultVariantKey,
      variants: buildVariantStatesFromPlaybook(playbook),
    }
  })
}

function normalizeMinutePlaybookText(value: string) {
  return value.trim()
}

function hasMatchingReusableCommitteePlaybook(
  sourcePlaybook: MinutePlaybookRecord,
  reusablePlaybooks: MinutePlaybookRecord[],
) {
  const sourceVariants = toMinutePlaybookVariantTextMap(sourcePlaybook.variants)

  return reusablePlaybooks.some(playbook => {
    if (playbook.id === sourcePlaybook.id) return true

    const candidateVariants = toMinutePlaybookVariantTextMap(playbook.variants)
    return MINUTE_PLAYBOOK_VARIANT_KEYS.every(variantKey => (
      normalizeMinutePlaybookText(candidateVariants[variantKey])
      === normalizeMinutePlaybookText(sourceVariants[variantKey])
    ))
  })
}

function buildSavedAgendaFormattingFromPlaybook(params: {
  agendaId: string
  playbook: MinutePlaybookRecord
  additionalInfo: string
  variantOverrideId: string | null
}) {
  const defaultVariant = getMinutePlaybookDefaultVariant(params.playbook)
  if (!defaultVariant) {
    throw new Error('Default playbook variant is missing')
  }

  const overrideVariant = getMinutePlaybookVariantById(params.playbook, params.variantOverrideId)
  const modeState = buildFormattingModeState({ playbook: params.playbook })

  return {
    agendaId: params.agendaId,
    playbookId: params.playbook.id,
    playbookName: params.playbook.name,
    playbookScope: params.playbook.scope,
    playbookMode: modeState.playbookMode,
    resolutionPathsEnabled: modeState.resolutionPathsEnabled,
    hasResolutionAnchor: modeState.hasResolutionAnchor,
    templateId: defaultVariant.formatTemplateId,
    templateName: defaultVariant.templateName ?? params.playbook.name,
    promptText: defaultVariant.promptText,
    additionalInfo: params.additionalInfo,
    compiledTemplateVersion: defaultVariant.compiledTemplateVersion ?? 1,
    isCompiled: defaultVariant.isCompiled,
    variantOverrideId: overrideVariant?.id ?? null,
    variantOverrideKey: overrideVariant?.variantKey ?? null,
    defaultVariantKey: params.playbook.defaultVariantKey,
    variants: buildVariantStatesFromPlaybook(params.playbook),
  } satisfies SavedAgendaFormatting
}

async function clearAgendaFormattingLegacy(supabase: ServerSupabase, agendaId: string) {
  const { error } = await supabase
    .from('agendas')
    .update({
      format_template_id: null,
      minute_playbook_id: null,
      minute_playbook_variant_override_id: null,
      additional_info: null,
    })
    .eq('id', agendaId)

  if (!error) return

  if (isMissingPlaybookSchemaError(error) || isMissingAdditionalInfoColumnError(error)) {
    const { error: fallbackError } = await supabase
      .from('agendas')
      .update({ format_template_id: null })
      .eq('id', agendaId)
    if (!fallbackError) return
    throw new Error(toErrorMessage(fallbackError, 'Failed to clear formatting'))
  }

  throw new Error(toErrorMessage(error, 'Failed to clear formatting'))
}

async function clearMeetingFormattingLegacy(supabase: ServerSupabase, meetingId: string) {
  const { error } = await supabase
    .from('agendas')
    .update({
      format_template_id: null,
      minute_playbook_id: null,
      minute_playbook_variant_override_id: null,
      additional_info: null,
    })
    .eq('meeting_id', meetingId)

  if (!error) return

  if (isMissingPlaybookSchemaError(error) || isMissingAdditionalInfoColumnError(error)) {
    const { error: fallbackError } = await supabase
      .from('agendas')
      .update({ format_template_id: null })
      .eq('meeting_id', meetingId)
    if (!fallbackError) return
    throw new Error(toErrorMessage(fallbackError, 'Failed to clear meeting formatting'))
  }

  throw new Error(toErrorMessage(error, 'Failed to clear meeting formatting'))
}

async function loadAgendaPlaybookContext(
  supabase: ServerSupabase,
  agendaId: string,
) {
  const { data: agenda, error } = await supabase
    .from('agendas')
    .select('id, meeting_id, format_template_id, minute_playbook_id, minute_playbook_variant_override_id, additional_info')
    .eq('id', agendaId)
    .single()

  if (error) {
    if (isMissingPlaybookSchemaError(error)) {
      throw new Error(MISSING_PLAYBOOK_SCHEMA_HINT)
    }
    if (isMissingAdditionalInfoColumnError(error)) {
      const fallback = await supabase
        .from('agendas')
        .select('id, meeting_id, format_template_id')
        .eq('id', agendaId)
        .single()
      if (fallback.error || !fallback.data) {
        throw new Error(toErrorMessage(fallback.error, 'Failed to load agenda formatting'))
      }
      return {
        id: fallback.data.id,
        meeting_id: fallback.data.meeting_id,
        format_template_id: fallback.data.format_template_id,
        minute_playbook_id: null,
        minute_playbook_variant_override_id: null,
        additional_info: '',
      }
    }
    throw new Error(toErrorMessage(error, 'Failed to load agenda formatting'))
  }

  return agenda
}

async function insertFormatTemplate(
  supabase: ServerSupabase,
  params: {
    committeeId: string
    name: string
    promptText: string
    compileMode?: MinuteTemplateCompileMode
  },
) {
  const compiledTemplate = buildCompiledMinuteTemplateFromPrompt(params.promptText, {
    mode: params.compileMode,
  })
  const { data: template, error } = await supabase
    .from('format_templates')
    .insert({
      committee_id: params.committeeId,
      name: params.name,
      prompt_text: params.promptText,
      compiled_template_json: compiledTemplate.compiledTemplateJson,
      compiled_template_version: compiledTemplate.compiledTemplateVersion,
      compiled_template_hash: compiledTemplate.compiledTemplateHash,
    })
    .select('id')
    .single()

  if (error || !template) {
    if (isMissingCompiledTemplateColumnError(error)) {
      throw new Error(MISSING_COMPILED_TEMPLATE_HINT)
    }
    throw new Error(toErrorMessage(error, 'Failed to save format template'))
  }

  return {
    templateId: template.id,
    compiledTemplateVersion: compiledTemplate.compiledTemplateVersion,
  }
}

async function ensureMinutePlaybook(
  supabase: ServerSupabase,
  params: {
    playbookId: string | null
    committeeId: string
    name: string
    scope: 'agenda' | 'committee'
    isReusable: boolean
    createdBy: string
  },
) {
  if (params.playbookId) {
    const { error } = await supabase
      .from('minute_playbooks')
      .update({
        name: params.name,
        default_variant_key: 'default',
        scope: params.scope,
        is_reusable: params.isReusable,
      })
      .eq('id', params.playbookId)
    if (error) {
      if (isMissingPlaybookSchemaError(error)) {
        throw new Error(MISSING_PLAYBOOK_SCHEMA_HINT)
      }
      throw new Error(error.message)
    }
    return params.playbookId
  }

  const { data, error } = await supabase
    .from('minute_playbooks')
    .insert({
      committee_id: params.committeeId,
      name: params.name,
      scope: params.scope,
      is_reusable: params.isReusable,
      default_variant_key: 'default',
      created_by: params.createdBy,
    })
    .select('id')
    .single()

  if (error || !data) {
    if (isMissingPlaybookSchemaError(error)) {
      throw new Error(MISSING_PLAYBOOK_SCHEMA_HINT)
    }
    throw new Error(toErrorMessage(error, 'Failed to create playbook'))
  }

  return data.id
}

async function syncPlaybookVariants(params: {
  supabase: ServerSupabase
  playbookId: string
  committeeId: string
  baseName: string
  variants: Array<{ variantKey: MinutePlaybookVariantKey; promptText: string }>
  compileMode?: MinuteTemplateCompileMode
}) {
  const activeVariantKeys: MinutePlaybookVariantKey[] = []

  for (const variant of params.variants) {
    const promptText = variant.promptText.trim()
    if (!promptText) continue

    const { templateId } = await insertFormatTemplate(params.supabase, {
      committeeId: params.committeeId,
      name: `${params.baseName} (${getMinutePlaybookVariantLabel(variant.variantKey)})`,
      promptText: variant.promptText,
      compileMode: params.compileMode,
    })

    const { error } = await params.supabase
      .from('minute_playbook_variants')
      .upsert({
        playbook_id: params.playbookId,
        variant_key: variant.variantKey,
        format_template_id: templateId,
      }, { onConflict: 'playbook_id,variant_key' })

    if (error) {
      if (isMissingPlaybookSchemaError(error)) {
        throw new Error(MISSING_PLAYBOOK_SCHEMA_HINT)
      }
      throw new Error(error.message)
    }

    activeVariantKeys.push(variant.variantKey)
  }

  const removableVariantKeys = MINUTE_PLAYBOOK_VARIANT_KEYS.filter(
    variantKey => !activeVariantKeys.includes(variantKey),
  )

  if (removableVariantKeys.length > 0) {
    const { error } = await params.supabase
      .from('minute_playbook_variants')
      .delete()
      .eq('playbook_id', params.playbookId)
      .in('variant_key', removableVariantKeys)

    if (error && !isMissingPlaybookSchemaError(error)) {
      throw new Error(error.message)
    }
  }
}

export async function upsertFormatFromPaste(
  agendaId: string,
  committeeId: string,
  name: string,
  playbookMode: MinutePlaybookMode,
  resolutionPathsEnabled: boolean,
  variants: Array<{ variantKey: MinutePlaybookVariantKey; promptText: string }>,
  additionalInfo?: string,
  saveAsCommitteePlaybook = false,
): Promise<SavedAgendaFormatting> {
  const parsed = saveAgendaFormattingSchema.safeParse({
    agendaId,
    committeeId,
    name: name.trim(),
    playbookMode,
    resolutionPathsEnabled,
    variants,
    additionalInfo: additionalInfo ?? '',
    saveAsCommitteePlaybook,
  })
  if (!parsed.success) {
    const tooLarge = parsed.error.issues.some(
      issue =>
        issue.code === 'too_big'
        && (
          issue.path.includes('variants')
          || issue.path.includes('additionalInfo')
        ),
    )
    if (tooLarge) {
      throw new Error('Formatting content too large. Please reduce size.')
    }
    throw new Error('Invalid formatting input')
  }

  const {
    agendaId: parsedAgendaId,
    committeeId: parsedCommitteeId,
    name: parsedName,
    playbookMode: parsedPlaybookMode,
    resolutionPathsEnabled: parsedResolutionPathsEnabled,
    variants: parsedVariants,
    additionalInfo: parsedAdditionalInfo,
    saveAsCommitteePlaybook: shouldSaveCommitteePlaybook,
  } = parsed.data

  const normalizedVariants = (
    parsedPlaybookMode === 'resolution_paths' && !parsedResolutionPathsEnabled
      ? parsedVariants.filter(variant => variant.variantKey === 'default')
      : parsedVariants
  )
    .map(variant => ({
      variantKey: variant.variantKey,
      promptText: variant.promptText ?? '',
    }))
    .filter(variant => variant.promptText.trim().length > 0)

  const defaultVariant = normalizedVariants.find(variant => variant.variantKey === 'default')
  if (!defaultVariant) {
    throw new Error('Default exact template is required')
  }

  validateResolutionPathVariants({
    normalizedVariants,
    resolutionPathsEnabled: parsedPlaybookMode === 'resolution_paths' && parsedResolutionPathsEnabled,
    compileMode: resolvePlaybookTemplateCompileMode({
      scope: 'agenda',
      isReusable: false,
    }),
  })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const agenda = await loadAgendaPlaybookContext(supabase, parsedAgendaId)

  let currentPlaybook: MinutePlaybookRecord | null = null
  if (agenda.minute_playbook_id) {
    const playbooks = await loadMinutePlaybooksByIds(supabase as unknown as DatabaseClient, [agenda.minute_playbook_id])
    currentPlaybook = playbooks.get(agenda.minute_playbook_id) ?? null
  }

  const overrideVariantKeyToCarry = getMinutePlaybookVariantById(
    currentPlaybook,
    agenda.minute_playbook_variant_override_id,
  )?.variantKey ?? null

  const agendaPlaybookId = await ensureMinutePlaybook(supabase, {
    playbookId: currentPlaybook && currentPlaybook.scope === 'agenda' && !currentPlaybook.isReusable
      ? currentPlaybook.id
      : null,
    committeeId: parsedCommitteeId,
    name: parsedName,
    scope: 'agenda',
    isReusable: false,
    createdBy: user.id,
  })

  await syncPlaybookVariants({
    supabase,
    playbookId: agendaPlaybookId,
    committeeId: parsedCommitteeId,
    baseName: parsedName,
    variants: normalizedVariants,
    compileMode: resolvePlaybookTemplateCompileMode({
      scope: 'agenda',
      isReusable: false,
    }),
  })

  if (shouldSaveCommitteePlaybook) {
    const libraryPlaybookId = await ensureMinutePlaybook(supabase, {
      playbookId: null,
      committeeId: parsedCommitteeId,
      name: parsedName,
      scope: 'committee',
      isReusable: true,
      createdBy: user.id,
    })

    await syncPlaybookVariants({
      supabase,
      playbookId: libraryPlaybookId,
      committeeId: parsedCommitteeId,
      baseName: parsedName,
      variants: normalizedVariants,
      compileMode: resolvePlaybookTemplateCompileMode({
        scope: 'committee',
        isReusable: true,
      }),
    })
  }

  const savedPlaybooks = await loadMinutePlaybooksByIds(supabase as unknown as DatabaseClient, [agendaPlaybookId])
  const savedPlaybook = savedPlaybooks.get(agendaPlaybookId)
  if (!savedPlaybook) {
    throw new Error('Saved playbook could not be loaded')
  }

  const overrideVariant = overrideVariantKeyToCarry
    ? savedPlaybook.variants.find(variant => variant.variantKey === overrideVariantKeyToCarry) ?? null
    : null
  const defaultPlaybookVariant = getMinutePlaybookDefaultVariant(savedPlaybook)
  if (!defaultPlaybookVariant) {
    throw new Error('Default playbook variant is missing')
  }

  const { data: linked, error: linkError } = await supabase
    .from('agendas')
    .update({
      format_template_id: defaultPlaybookVariant.formatTemplateId,
      minute_playbook_id: savedPlaybook.id,
      minute_playbook_variant_override_id: overrideVariant?.id ?? null,
      additional_info: parsedAdditionalInfo || null,
    })
    .eq('id', parsedAgendaId)
    .select('id')
    .single()

  if (linkError || !linked) {
    if (isMissingPlaybookSchemaError(linkError)) {
      throw new Error(MISSING_PLAYBOOK_SCHEMA_HINT)
    }
    if (isMissingAdditionalInfoColumnError(linkError)) {
      const { data: fallbackLinked, error: fallbackError } = await supabase
        .from('agendas')
        .update({
          format_template_id: defaultPlaybookVariant.formatTemplateId,
          minute_playbook_id: savedPlaybook.id,
          minute_playbook_variant_override_id: overrideVariant?.id ?? null,
        })
        .eq('id', parsedAgendaId)
        .select('id')
        .single()
      if (fallbackError || !fallbackLinked) {
        throw new Error(toErrorMessage(fallbackError, 'Failed to link playbook to agenda'))
      }
    } else {
      throw new Error(toErrorMessage(linkError, 'Failed to link playbook to agenda'))
    }
  }

  return buildSavedAgendaFormattingFromPlaybook({
    agendaId: parsedAgendaId,
    playbook: savedPlaybook,
    additionalInfo: parsedAdditionalInfo,
    variantOverrideId: overrideVariant?.id ?? null,
  })
}

export async function attachCommitteePlaybookToAgenda(
  agendaId: string,
  playbookId: string,
) {
  const parsedAgendaId = uuidSchema.parse(agendaId)
  const parsedPlaybookId = uuidSchema.parse(playbookId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const agenda = await loadAgendaPlaybookContext(supabase, parsedAgendaId)
  const playbooks = await loadMinutePlaybooksByIds(supabase as unknown as DatabaseClient, [parsedPlaybookId])
  const playbook = playbooks.get(parsedPlaybookId)
  if (!playbook) {
    throw new Error('Playbook not found')
  }

  const defaultVariant = getMinutePlaybookDefaultVariant(playbook)
  if (!defaultVariant) {
    throw new Error('Selected playbook has no default variant')
  }

  const { error } = await supabase
    .from('agendas')
    .update({
      format_template_id: defaultVariant.formatTemplateId,
      minute_playbook_id: playbook.id,
      minute_playbook_variant_override_id: null,
    })
    .eq('id', parsedAgendaId)

  if (error) {
    if (isMissingPlaybookSchemaError(error)) {
      throw new Error(MISSING_PLAYBOOK_SCHEMA_HINT)
    }
    throw new Error(error.message)
  }

  return buildSavedAgendaFormattingFromPlaybook({
    agendaId: parsedAgendaId,
    playbook,
    additionalInfo: agenda.additional_info ?? '',
    variantOverrideId: null,
  })
}

export async function updateAgendaPlaybookVariantOverride(
  agendaId: string,
  variantOverrideId: string | null,
) {
  const parsedAgendaId = uuidSchema.parse(agendaId)
  const parsedVariantOverrideId = variantOverrideId ? uuidSchema.parse(variantOverrideId) : null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const agenda = await loadAgendaPlaybookContext(supabase, parsedAgendaId)
  let playbook: MinutePlaybookRecord | null = null
  if (agenda.minute_playbook_id) {
    const playbooks = await loadMinutePlaybooksByIds(supabase as unknown as DatabaseClient, [agenda.minute_playbook_id])
    playbook = playbooks.get(agenda.minute_playbook_id) ?? null
  }
  if (!playbook) {
    throw new Error('No playbook is attached to this agenda')
  }

  if (parsedVariantOverrideId && !getMinutePlaybookVariantById(playbook, parsedVariantOverrideId)) {
    throw new Error('Selected variant does not belong to the current playbook')
  }

  const modeState = buildFormattingModeState({ playbook })
  if (modeState.playbookMode === 'resolution_paths' && !modeState.resolutionPathsEnabled && parsedVariantOverrideId) {
    throw new Error('Manual RESOLVED variant override is disabled while RESOLVED structure needed is off')
  }

  const { error } = await supabase
    .from('agendas')
    .update({ minute_playbook_variant_override_id: parsedVariantOverrideId })
    .eq('id', parsedAgendaId)

  if (error) {
    if (isMissingPlaybookSchemaError(error)) {
      throw new Error(MISSING_PLAYBOOK_SCHEMA_HINT)
    }
    throw new Error(error.message)
  }

  return buildSavedAgendaFormattingFromPlaybook({
    agendaId: parsedAgendaId,
    playbook,
    additionalInfo: agenda.additional_info ?? '',
    variantOverrideId: parsedVariantOverrideId,
  })
}

export async function getAgendaFormattingState(agendaId: string): Promise<AgendaFormattingState> {
  const parsedAgendaId = uuidSchema.parse(agendaId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const agenda = await loadAgendaPlaybookContext(supabase, parsedAgendaId)
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('committee_id')
    .eq('id', agenda.meeting_id)
    .single()
  if (meetingError) {
    throw new Error(toErrorMessage(meetingError, 'Failed to load meeting context'))
  }

  const availablePlaybooksMap = meeting?.committee_id
    ? await listCommitteeMinutePlaybooks(supabase as unknown as DatabaseClient, meeting.committee_id)
    : new Map<string, MinutePlaybookRecord>()
  const availablePlaybooks = buildCommitteePlaybookOptions(Array.from(availablePlaybooksMap.values()))

  if (agenda.minute_playbook_id) {
    const playbooks = await loadMinutePlaybooksByIds(supabase as unknown as DatabaseClient, [agenda.minute_playbook_id])
    const playbook = playbooks.get(agenda.minute_playbook_id) ?? null
    if (playbook) {
      const defaultVariant = getMinutePlaybookDefaultVariant(playbook)
      const overrideVariant = getMinutePlaybookVariantById(playbook, agenda.minute_playbook_variant_override_id)
      return {
        agendaId: parsedAgendaId,
        playbookId: playbook.id,
        playbookName: playbook.name,
        playbookScope: playbook.scope,
        playbookMode: buildFormattingModeState({ playbook }).playbookMode,
        resolutionPathsEnabled: buildFormattingModeState({ playbook }).resolutionPathsEnabled,
        hasResolutionAnchor: buildFormattingModeState({ playbook }).hasResolutionAnchor,
        templateId: defaultVariant?.formatTemplateId ?? null,
        templateName: defaultVariant?.templateName ?? null,
        promptText: defaultVariant?.promptText ?? '',
        additionalInfo: agenda.additional_info ?? '',
        compiledTemplateVersion: defaultVariant?.compiledTemplateVersion ?? null,
        isCompiled: defaultVariant?.isCompiled ?? false,
        variantOverrideId: overrideVariant?.id ?? null,
        variantOverrideKey: overrideVariant?.variantKey ?? null,
        defaultVariantKey: playbook.defaultVariantKey,
        variants: buildVariantStatesFromPlaybook(playbook),
        availablePlaybooks,
      }
    }
  }

  if (!agenda.format_template_id) {
    return {
      agendaId: parsedAgendaId,
      playbookId: null,
      playbookName: null,
      playbookScope: null,
      playbookMode: 'resolution_paths',
      resolutionPathsEnabled: false,
      hasResolutionAnchor: false,
      templateId: null,
      templateName: null,
      promptText: '',
      additionalInfo: agenda.additional_info ?? '',
      compiledTemplateVersion: null,
      isCompiled: false,
      variantOverrideId: null,
      variantOverrideKey: null,
      defaultVariantKey: null,
      variants: MINUTE_PLAYBOOK_VARIANT_KEYS.map(emptyVariantState),
      availablePlaybooks,
    }
  }

  const { data: template, error: templateError } = await supabase
    .from('format_templates')
    .select('id, name, prompt_text, compiled_template_json, compiled_template_version')
    .eq('id', agenda.format_template_id)
    .single()
  if (templateError) {
    if (isMissingCompiledTemplateColumnError(templateError)) {
      throw new Error(MISSING_COMPILED_TEMPLATE_HINT)
    }
    throw new Error(toErrorMessage(templateError, 'Failed to load template formatting'))
  }

  return {
    agendaId: parsedAgendaId,
    playbookId: null,
    playbookName: null,
    playbookScope: null,
    playbookMode: buildFormattingModeState({ template: template ?? null }).playbookMode,
    resolutionPathsEnabled: buildFormattingModeState({ template: template ?? null }).resolutionPathsEnabled,
    hasResolutionAnchor: buildFormattingModeState({ template: template ?? null }).hasResolutionAnchor,
    templateId: template?.id ?? agenda.format_template_id,
    templateName: template?.name ?? null,
    promptText: template?.prompt_text ?? '',
    additionalInfo: agenda.additional_info ?? '',
    compiledTemplateVersion: template?.compiled_template_version ?? null,
    isCompiled: Boolean(
      template?.compiled_template_json
      && typeof template.compiled_template_json === 'object'
      && (template.compiled_template_json as { kind?: string }).kind === 'minute_template',
    ),
    variantOverrideId: null,
    variantOverrideKey: null,
    defaultVariantKey: 'default',
    variants: buildVariantStatesFromLegacyTemplate(template ?? null),
    availablePlaybooks,
  }
}

export async function updateAgendaStatus(
  agendaIds: string[],
  status: 'done' | 'ongoing' | 'pending',
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  if (agendaIds.length === 0) return

  const { data: agenda } = await supabase
    .from('agendas')
    .select('meeting_id')
    .eq('id', uuidSchema.parse(agendaIds[0]))
    .single()
  if (!agenda?.meeting_id) {
    throw new Error('Agenda not found')
  }

  await updateAgendaStatusWithClient({
    supabase: supabase as unknown as DatabaseClient,
    meetingId: agenda.meeting_id,
    agendaIds,
    status,
  })
}

export async function updateAgendaSkipped(agendaId: string, isSkipped: boolean) {
  const parsedId = uuidSchema.parse(agendaId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  await supabase.from('agendas').update({ is_skipped: isSkipped }).eq('id', parsedId)
}

export async function bulkSaveSkipped(meetingId: string, skippedIds: string[]) {
  const parsedMeetingId = uuidSchema.parse(meetingId)
  skippedIds.forEach(id => uuidSchema.parse(id))
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  await supabase.from('agendas').update({ is_skipped: false }).eq('meeting_id', parsedMeetingId)
  if (skippedIds.length > 0) {
    await supabase.from('agendas').update({ is_skipped: true }).in('id', skippedIds)
  }
}

export async function applyFormatToSubItems(
  params: {
    sourceAgendaId: string
  },
  subItemIds: string[],
) {
  const parsedSourceAgendaId = uuidSchema.parse(params.sourceAgendaId)
  subItemIds.forEach(id => uuidSchema.parse(id))
  if (subItemIds.length === 0) {
    return { shouldAutoSaveCommitteeDefault: false }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const sourceAgenda = await loadAgendaPlaybookContext(supabase, parsedSourceAgendaId)

  if (!sourceAgenda.format_template_id && !sourceAgenda.minute_playbook_id) {
    throw new Error('No format source was provided')
  }

  let shouldAutoSaveCommitteeDefault = false

  if (sourceAgenda.minute_playbook_id) {
    const playbooks = await loadMinutePlaybooksByIds(
      supabase as unknown as DatabaseClient,
      [sourceAgenda.minute_playbook_id],
    )
    const sourcePlaybook = playbooks.get(sourceAgenda.minute_playbook_id)
    const defaultVariant = getMinutePlaybookDefaultVariant(sourcePlaybook)
    if (!sourcePlaybook || !defaultVariant) {
      throw new Error('Playbook not found')
    }

    if (sourcePlaybook.scope === 'committee' && sourcePlaybook.isReusable) {
      shouldAutoSaveCommitteeDefault = true
    } else {
      const { data: meeting, error: meetingError } = await supabase
        .from('meetings')
        .select('committee_id')
        .eq('id', sourceAgenda.meeting_id)
        .single()

      if (meetingError) {
        throw new Error(`Failed to load source meeting context: ${meetingError.message}`)
      }

      if (meeting?.committee_id) {
        const reusablePlaybooks = await listCommitteeMinutePlaybooks(
          supabase as unknown as DatabaseClient,
          meeting.committee_id,
        )
        shouldAutoSaveCommitteeDefault = hasMatchingReusableCommitteePlaybook(
          sourcePlaybook,
          Array.from(reusablePlaybooks.values()),
        )
      }
    }
  }

  const { error } = await supabase
    .from('agendas')
    .update({
      format_template_id: sourceAgenda.format_template_id,
      minute_playbook_id: sourceAgenda.minute_playbook_id,
      minute_playbook_variant_override_id: sourceAgenda.minute_playbook_variant_override_id,
      additional_info: sourceAgenda.additional_info || null,
    })
    .in('id', subItemIds)

  if (error) {
    throw new Error(`Failed to apply format to sub-items: ${error.message}`)
  }

  return { shouldAutoSaveCommitteeDefault }
}

export async function clearAgendaFormatting(agendaId: string) {
  const parsedAgendaId = uuidSchema.parse(agendaId)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { error: rpcError } = await supabase
    .rpc('clear_agenda_formatting_for_org_member', { p_agenda_id: parsedAgendaId })

  if (!rpcError) return

  if (isMissingRpcFunctionError(rpcError, 'clear_agenda_formatting_for_org_member')) {
    try {
      await clearAgendaFormattingLegacy(supabase, parsedAgendaId)
      return
    } catch (legacyError) {
      const legacyMessage = legacyError instanceof Error ? ` (${legacyError.message})` : ''
      throw new Error(`${MISSING_CLEAR_FORMATTING_RPC_HINT}${legacyMessage}`)
    }
  }

  throw new Error(toErrorMessage(rpcError, 'Failed to clear formatting'))
}

export async function clearMeetingFormatting(meetingId: string) {
  const parsedMeetingId = uuidSchema.parse(meetingId)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { error: rpcError } = await supabase
    .rpc('clear_meeting_formatting_for_org_member', { p_meeting_id: parsedMeetingId })

  if (!rpcError) return

  if (isMissingRpcFunctionError(rpcError, 'clear_meeting_formatting_for_org_member')) {
    try {
      await clearMeetingFormattingLegacy(supabase, parsedMeetingId)
      return
    } catch (legacyError) {
      const legacyMessage = legacyError instanceof Error ? ` (${legacyError.message})` : ''
      throw new Error(`${MISSING_CLEAR_FORMATTING_RPC_HINT}${legacyMessage}`)
    }
  }

  throw new Error(toErrorMessage(rpcError, 'Failed to clear meeting formatting'))
}

export async function clearAllGeneratedMinutes(meetingId: string) {
  const parsedId = uuidSchema.parse(meetingId)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: agendas } = await supabase
    .from('agendas').select('id').eq('meeting_id', parsedId)
  if (!agendas?.length) return

  const agendaIds = agendas.map(a => a.id)

  await supabase.from('minutes').delete().in('agenda_id', agendaIds)
  await supabase.from('agendas').update({ minute_status: 'pending' }).eq('meeting_id', parsedId)

  revalidatePath(`/meeting/${parsedId}/setup`)
}
