import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  buildCompiledMinuteTemplateFromPrompt,
  getMinutePlaybookMode,
  getMinutePlaybookVariantLabel,
  listCommitteeMinutePlaybooks,
  loadMinutePlaybooksByIds,
  playbookHasResolutionAnchor,
  MINUTE_PLAYBOOK_VARIANT_KEYS,
} from '@/lib/meeting-generation/minute-playbooks'
import {
  findActionLikeMinuteTemplateLabels,
  findClosureOnlyMinuteTemplateSignals,
  getCompiledMinuteTemplate,
  hasMinuteTemplateResolutionAnchor,
  isMinuteTemplateCompileError,
  RESOLUTION_PATH_PLACEHOLDER,
} from '@/lib/meeting-generation/minute-template'
import { minutePlaybookLibrarySchema, uuidSchema } from '@/lib/validation'

const deleteSchema = z.object({
  playbookId: uuidSchema,
})

async function requireUserOrg() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) throw new Error('Profile not found')
  return { supabase, userId: user.id, organizationId: profile.organization_id }
}

function mapPlaybooksResponse(
  playbooks: Awaited<ReturnType<typeof listCommitteeMinutePlaybooks>>,
) {
  return Array.from(playbooks.values()).map(playbook => ({
    playbookId: playbook.id,
    name: playbook.name,
    scope: playbook.scope,
    isReusable: playbook.isReusable,
    playbookMode: getMinutePlaybookMode(playbook),
    resolutionPathsEnabled: playbookHasResolutionAnchor(playbook),
    hasResolutionAnchor: playbookHasResolutionAnchor(playbook),
    defaultVariantKey: playbook.defaultVariantKey,
    variants: MINUTE_PLAYBOOK_VARIANT_KEYS.map(variantKey => {
      const variant = playbook.variants.find(item => item.variantKey === variantKey) ?? null
      return {
        id: variant?.id ?? null,
        variantKey,
        label: getMinutePlaybookVariantLabel(variantKey),
        templateId: variant?.formatTemplateId ?? null,
        templateName: variant?.templateName ?? null,
        promptText: variant?.promptText ?? '',
        compiledTemplateVersion: variant?.compiledTemplateVersion ?? null,
        isCompiled: variant?.isCompiled ?? false,
      }
    }),
  }))
}

async function insertFormatTemplate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    committeeId: string
    name: string
    promptText: string
  },
) {
  const compiledTemplate = buildCompiledMinuteTemplateFromPrompt(params.promptText)
  const { data, error } = await supabase
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

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to save playbook template')
  }

  return data.id
}

function validateResolutionPathVariants(params: {
  variants: Array<{ variantKey: 'default' | 'with_action' | 'without_action'; promptText: string }>
  resolutionPathsEnabled: boolean
}) {
  const defaultVariant = params.variants.find(variant => variant.variantKey === 'default')
  if (!defaultVariant) {
    throw new Error('Default exact template is required')
  }

  const compiledDefault = getCompiledMinuteTemplate(
    buildCompiledMinuteTemplateFromPrompt(defaultVariant.promptText).compiledTemplateJson,
  )
  if (!params.resolutionPathsEnabled) {
    if (compiledDefault && hasMinuteTemplateResolutionAnchor(compiledDefault)) {
      throw new Error(`Remove ${RESOLUTION_PATH_PLACEHOLDER} or enable Resolution Paths`)
    }
    return
  }

  if (!compiledDefault || !hasMinuteTemplateResolutionAnchor(compiledDefault)) {
    throw new Error(`Base format must include ${RESOLUTION_PATH_PLACEHOLDER}`)
  }

  const branchVariants = params.variants.filter(variant => variant.variantKey !== 'default')
  if (branchVariants.length === 0) {
    throw new Error('Add at least one Resolution Paths branch before saving')
  }

  for (const variant of branchVariants) {
    const compiledVariant = getCompiledMinuteTemplate(
      buildCompiledMinuteTemplateFromPrompt(variant.promptText).compiledTemplateJson,
    )
    if (compiledVariant && hasMinuteTemplateResolutionAnchor(compiledVariant)) {
      throw new Error(`Resolution branch templates cannot contain ${RESOLUTION_PATH_PLACEHOLDER}`)
    }
  }

  const withoutActionVariant = branchVariants.find(variant => variant.variantKey === 'without_action')
  if (withoutActionVariant) {
    const actionLabels = findActionLikeMinuteTemplateLabels(withoutActionVariant.promptText)
    if (actionLabels.length > 0) {
      const preview = actionLabels.slice(0, 4).join(', ')
      const suffix = actionLabels.length > 4 ? `, +${actionLabels.length - 4} more` : ''
      throw new Error(`Decision / Closure Only cannot include follow-up labels: ${preview}${suffix}`)
    }
  }

  const withActionVariant = branchVariants.find(variant => variant.variantKey === 'with_action')
  if (withActionVariant) {
    const closureSignals = findClosureOnlyMinuteTemplateSignals(withActionVariant.promptText)
    if (closureSignals.length > 0) {
      const preview = closureSignals.slice(0, 4).join(', ')
      const suffix = closureSignals.length > 4 ? `, +${closureSignals.length - 4} more` : ''
      throw new Error(`Decision + Follow-up cannot include closure-only wording: ${preview}${suffix}`)
    }
  }
}

async function saveCommitteePlaybook(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  committeeId: string
  playbookId?: string | null
  name: string
  playbookMode: 'resolution_paths' | 'legacy_full'
  resolutionPathsEnabled: boolean
  variants: Array<{ variantKey: 'default' | 'with_action' | 'without_action'; promptText: string }>
}) {
  const normalizedVariants = params.playbookMode === 'resolution_paths' && !params.resolutionPathsEnabled
    ? params.variants.filter(variant => variant.variantKey === 'default' && variant.promptText.trim().length > 0)
    : params.variants.filter(variant => variant.promptText.trim().length > 0)
  if (!normalizedVariants.some(variant => variant.variantKey === 'default')) {
    throw new Error('Default exact template is required')
  }
  validateResolutionPathVariants({
    variants: normalizedVariants,
    resolutionPathsEnabled: params.playbookMode === 'resolution_paths' && params.resolutionPathsEnabled,
  })

  let playbookId = params.playbookId ?? null
  if (playbookId) {
    const { error } = await params.supabase
      .from('minute_playbooks')
      .update({
        name: params.name,
        scope: 'committee',
        is_reusable: true,
        default_variant_key: 'default',
      })
      .eq('id', playbookId)

    if (error) throw new Error(error.message)
  } else {
    const { data, error } = await params.supabase
      .from('minute_playbooks')
      .insert({
        committee_id: params.committeeId,
        name: params.name,
        scope: 'committee',
        is_reusable: true,
        default_variant_key: 'default',
        created_by: params.userId,
      })
      .select('id')
      .single()

    if (error || !data) throw new Error(error?.message ?? 'Failed to create playbook')
    playbookId = data.id
  }

  for (const variant of normalizedVariants) {
    const templateId = await insertFormatTemplate(params.supabase, {
      committeeId: params.committeeId,
      name: `${params.name} (${getMinutePlaybookVariantLabel(variant.variantKey)})`,
      promptText: variant.promptText,
    })

    const { error } = await params.supabase
      .from('minute_playbook_variants')
      .upsert({
        playbook_id: playbookId,
        variant_key: variant.variantKey,
        format_template_id: templateId,
      }, { onConflict: 'playbook_id,variant_key' })

    if (error) throw new Error(error.message)
  }

  const removableKeys = MINUTE_PLAYBOOK_VARIANT_KEYS.filter(
    variantKey => !normalizedVariants.some(variant => variant.variantKey === variantKey),
  )

  if (removableKeys.length > 0) {
    const { error } = await params.supabase
      .from('minute_playbook_variants')
      .delete()
      .eq('playbook_id', playbookId)
      .in('variant_key', removableKeys)
    if (error) throw new Error(error.message)
  }

  if (!playbookId) {
    throw new Error('Failed to resolve playbook id')
  }

  const playbooks = await loadMinutePlaybooksByIds(params.supabase as never, [playbookId])
  return playbooks.get(playbookId) ?? null
}

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUserOrg()
    const committeeId = uuidSchema.parse(new URL(request.url).searchParams.get('committeeId'))
    const playbooks = await listCommitteeMinutePlaybooks(supabase as never, committeeId)
    return NextResponse.json({
      ok: true,
      playbooks: mapPlaybooksResponse(playbooks),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to load playbooks',
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireUserOrg()
    const parsed = minutePlaybookLibrarySchema.parse(await request.json())
    const playbook = await saveCommitteePlaybook({
      supabase,
      userId,
      committeeId: parsed.committeeId,
      playbookId: parsed.playbookId,
      name: parsed.name,
      playbookMode: parsed.playbookMode,
      resolutionPathsEnabled: parsed.resolutionPathsEnabled,
      variants: parsed.variants.map(variant => ({
        variantKey: variant.variantKey,
        promptText: variant.promptText ?? '',
      })),
    })

    return NextResponse.json({
      ok: true,
      playbook: playbook
        ? mapPlaybooksResponse(new Map([[playbook.id, playbook]])).at(0) ?? null
        : null,
    })
  } catch (error) {
    if (isMinuteTemplateCompileError(error)) {
      return NextResponse.json(
        {
          ok: false,
          message: error.message,
          code: 'minute_template_compile_error',
          details: { issues: error.issues },
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to save playbook',
      },
      { status: error instanceof Error ? 400 : 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase } = await requireUserOrg()
    const { playbookId } = deleteSchema.parse(await request.json())
    const { error } = await supabase
      .from('minute_playbooks')
      .delete()
      .eq('id', playbookId)

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to delete playbook',
      },
      { status: 500 },
    )
  }
}
