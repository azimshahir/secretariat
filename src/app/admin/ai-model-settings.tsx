'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { updateOrganizationAiModel } from './actions'

type AiProvider = 'anthropic' | 'openai' | 'google'

interface Props {
  initialProvider: AiProvider
  initialModel: string
  options: Record<AiProvider, string[]>
}

const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
}

export function AiModelSettings({ initialProvider, initialModel, options }: Props) {
  const [provider, setProvider] = useState<AiProvider>(initialProvider)
  const [model, setModel] = useState(initialModel)
  const [pending, startTransition] = useTransition()

  const modelOptions = useMemo(() => options[provider] ?? [], [options, provider])
  const isDirty = provider !== initialProvider || model !== initialModel

  return (
    <section className="mb-8 rounded-lg border bg-white p-4 dark:bg-zinc-900">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          AI Model Control
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Admin-only setting for meeting generation model. End users cannot change this.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
        <select
          value={provider}
          onChange={(event) => {
            const nextProvider = event.target.value as AiProvider
            const nextModels = options[nextProvider] ?? []
            setProvider(nextProvider)
            setModel(nextModels[0] ?? '')
          }}
          className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          disabled={pending}
        >
          <option value="anthropic">{PROVIDER_LABEL.anthropic}</option>
          <option value="openai">{PROVIDER_LABEL.openai}</option>
          <option value="google">{PROVIDER_LABEL.google}</option>
        </select>

        <select
          value={model}
          onChange={(event) => setModel(event.target.value)}
          className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          disabled={pending || modelOptions.length === 0}
        >
          {modelOptions.map(item => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <Button
          type="button"
          onClick={() => {
            startTransition(async () => {
              try {
                await updateOrganizationAiModel({ provider, model })
                toast.success(`AI model updated to ${PROVIDER_LABEL[provider]} - ${model}`)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Failed to update AI model')
              }
            })
          }}
          disabled={pending || !isDirty || !model}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? 'Saving...' : 'Save Model'}
        </Button>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        Current: {PROVIDER_LABEL[initialProvider]} - {initialModel}
      </p>
    </section>
  )
}
