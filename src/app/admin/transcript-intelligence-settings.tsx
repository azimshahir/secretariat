'use client'

import { useMemo, useState, useTransition } from 'react'
import { AudioLines, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { postJson } from '@/lib/api/client'
import {
  getTranscriptIntelligenceConfig,
  TRANSCRIPT_INTELLIGENCE_PRESETS,
  type TranscriptIntelligencePreset,
} from '@/lib/ai/transcript-intelligence'
import { Button } from '@/components/ui/button'

interface Props {
  initialPreset: TranscriptIntelligencePreset
}

export function TranscriptIntelligenceSettings({ initialPreset }: Props) {
  const [savedPreset, setSavedPreset] = useState(initialPreset)
  const [preset, setPreset] = useState(initialPreset)
  const [pending, startTransition] = useTransition()

  const isDirty = preset !== savedPreset
  const selectedConfig = useMemo(() => getTranscriptIntelligenceConfig(preset), [preset])

  return (
    <section className="mb-6 rounded-lg border bg-white p-4 dark:bg-zinc-900">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Transcript Intelligence Preset
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Choose the OpenAI transcript pipeline for future audio and video uploads. Existing transcripts stay unchanged.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => {
            startTransition(async () => {
              try {
                await postJson<{ ok: true; message?: string }>(
                  '/api/admin/transcript-intelligence',
                  { preset },
                )
                setSavedPreset(preset)
                toast.success('Transcript intelligence preset updated')
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Failed to update transcript preset')
              }
            })
          }}
          disabled={pending || !isDirty}
          className="gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? 'Saving...' : 'Save Preset'}
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {TRANSCRIPT_INTELLIGENCE_PRESETS.map(option => {
          const config = getTranscriptIntelligenceConfig(option)
          const selected = option === preset

          return (
            <button
              key={option}
              type="button"
              onClick={() => setPreset(option)}
              className={[
                'rounded-xl border p-4 text-left transition',
                selected
                  ? 'border-teal-500 bg-teal-50 shadow-sm dark:border-teal-500 dark:bg-teal-950/20'
                  : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900',
              ].join(' ')}
              disabled={pending}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {config.title}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {config.badge}
                  </div>
                </div>
                {selected ? (
                  <span className="rounded-full border border-teal-500 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:bg-zinc-900 dark:text-teal-300">
                    Selected
                  </span>
                ) : null}
              </div>

              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                {config.summary}
              </p>

              <div className="mt-4 space-y-2 text-xs text-zinc-600 dark:text-zinc-300">
                <div className="flex items-center gap-2">
                  <AudioLines className="h-3.5 w-3.5 text-zinc-400" />
                  <span>STT: {config.sttModel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Cleanup: {config.cleanupModel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Agenda refinement: {config.refinementModel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-zinc-400" />
                  <span>
                    Numeric review: {config.numericVerifierModel ?? 'Not used'}
                  </span>
                </div>
              </div>

              <p className="mt-4 text-xs text-zinc-500">
                {config.note}
              </p>
            </button>
          )
        })}
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
        Current saved preset: <span className="font-medium">{getTranscriptIntelligenceConfig(savedPreset).title}</span>. Conservative number correction stays enabled in all modes.
      </div>

      <div className="mt-3 text-xs text-zinc-500">
        Selected now: {selectedConfig.title}. This affects future raw audio/video uploads only.
      </div>
    </section>
  )
}
