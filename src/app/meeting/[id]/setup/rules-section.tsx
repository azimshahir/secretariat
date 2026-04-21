'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

interface RulesSectionProps {
  mode: 'committee' | 'meeting'
  committeeId: string | null
  meetingId?: string | null
  initialInstruction: string
  committeeSettingsHref?: string | null
}

function stripRulePrefix(value: string) {
  return value
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim()
}

function normalizeRules(rows: string[]) {
  const dedup = new Set<string>()
  const normalized: string[] = []

  rows.forEach(row => {
    const rule = stripRulePrefix(row)
    if (!rule) return
    const key = rule.toLowerCase()
    if (dedup.has(key)) return
    dedup.add(key)
    normalized.push(rule)
  })

  return normalized
}

function parseInstructionToRows(instruction: string) {
  const rows = instruction
    .split(/\r?\n+/)
    .map(line => stripRulePrefix(line))
    .filter(Boolean)

  if (rows.length === 0) return ['']
  return rows
}

function serializeRulesForStorage(rows: string[]) {
  const normalized = normalizeRules(rows)
  if (normalized.length === 0) return ''
  return normalized.map(rule => `- ${rule}`).join('\n')
}

async function saveCommitteeMinuteInstructionRequest(committeeId: string, instruction: string) {
  const response = await fetch('/api/committee-generation/minute-instruction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ committeeId, instruction }),
  })

  const contentType = response.headers.get('content-type') ?? ''
  const result = contentType.includes('application/json')
    ? await response.json() as { ok?: boolean; message?: string }
    : {
        ok: false,
        message: `Request failed with status ${response.status}`,
      }
  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to save committee rules')
  }
}

async function saveMeetingRulesRequest(meetingId: string, rules: string) {
  const response = await fetch(`/api/meeting/${meetingId}/meeting-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  })

  const contentType = response.headers.get('content-type') ?? ''
  const result = contentType.includes('application/json')
    ? await response.json() as { ok?: boolean; message?: string }
    : {
        ok: false,
        message: `Request failed with status ${response.status}`,
      }

  if (!response.ok || !result.ok) {
    throw new Error(result.message || 'Failed to save meeting rules')
  }
}

export function RulesSection({
  mode,
  committeeId,
  meetingId = null,
  initialInstruction,
  committeeSettingsHref = null,
}: RulesSectionProps) {
  const initialRows = useMemo(() => parseInstructionToRows(initialInstruction), [initialInstruction])
  const [rules, setRules] = useState<string[]>(initialRows)
  const [isSectionOpen, setIsSectionOpen] = useState(false)
  const [openRuleIndexes, setOpenRuleIndexes] = useState<Set<number>>(() => new Set())
  const [isPending, startTransition] = useTransition()
  const isMeetingMode = mode === 'meeting'
  const isDisabled = isMeetingMode ? !meetingId : !committeeId

  function updateRule(index: number, value: string) {
    setRules(prev => prev.map((item, currentIndex) => (currentIndex === index ? value : item)))
  }

  function addRule() {
    setRules(prev => [...prev, ''])
    setOpenRuleIndexes(prev => {
      const next = new Set(prev)
      next.add(rules.length)
      return next
    })
  }

  function removeRule(index: number) {
    setRules(prev => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index)
      return next.length === 0 ? [''] : next
    })
    setOpenRuleIndexes(prev => {
      const next = new Set<number>()
      Array.from(prev).forEach(currentIndex => {
        if (currentIndex === index) return
        next.add(currentIndex > index ? currentIndex - 1 : currentIndex)
      })
      return next
    })
  }

  function toggleRule(index: number) {
    setOpenRuleIndexes(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function getRulePreview(rule: string) {
    const value = stripRulePrefix(rule)
    if (!value) return 'No detail yet'
    return value.length > 110 ? `${value.slice(0, 110).trim()}...` : value
  }

  function handleSave() {
    if (isMeetingMode && !meetingId) {
      toast.error('Meeting not found')
      return
    }

    if (!isMeetingMode && !committeeId) {
      toast.error('No committee linked — assign a committee first')
      return
    }

    const serialized = serializeRulesForStorage(rules)

    startTransition(async () => {
      try {
        if (isMeetingMode) {
          await saveMeetingRulesRequest(meetingId!, serialized)
        } else {
          await saveCommitteeMinuteInstructionRequest(committeeId!, serialized)
        }
        setRules(parseInstructionToRows(serialized))
        toast.success(isMeetingMode ? 'Saved this meeting-only rule override' : 'Committee rules saved')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save rules')
      }
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{isMeetingMode ? 'Meeting Rules' : 'Rules'}</CardTitle>
          <CardDescription>
            {isMeetingMode
              ? 'Override the committee wording and terminology rules for this meeting only.'
              : 'Define committee-level wording and terminology rules for minute generation.'}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={isSectionOpen ? 'Collapse rules section' : 'Expand rules section'}
          onClick={() => setIsSectionOpen(open => !open)}
        >
          {isSectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </CardHeader>
      {isSectionOpen && (
        <CardContent className="space-y-3">
          {rules.map((rule, index) => {
            const isOpen = openRuleIndexes.has(index)
            return (
              <div key={`rule-row-${index}`} className="rounded-2xl border border-zinc-200 bg-white/80">
                <div className="flex items-start justify-between gap-2 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => toggleRule(index)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    aria-expanded={isOpen}
                  >
                    <span className="mt-0.5 shrink-0 text-zinc-400">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-zinc-900">Rule {index + 1}</span>
                      <span className="mt-0.5 block text-sm text-zinc-500">{getRulePreview(rule)}</span>
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeRule(index)}
                    disabled={isDisabled || isPending}
                    className="shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {isOpen && (
                  <div className="border-t border-zinc-100 px-3 pb-3 pt-3">
                    <Textarea
                      value={rule}
                      onChange={event => updateRule(index, event.target.value)}
                      placeholder='e.g. Use "Head, TD" instead of "The Section Head of TD"'
                      disabled={isDisabled || isPending}
                      rows={3}
                      className="min-h-[4.5rem] resize-y"
                    />
                  </div>
                )}
              </div>
            )
          })}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRule}
              disabled={isDisabled || isPending}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add rule
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isDisabled || isPending}
              className="gap-1.5"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save rules
            </Button>
          </div>

          {isMeetingMode && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <div className="flex items-center gap-2 font-medium">
                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Meeting-only
                </span>
                <span>Applies to this meeting only</span>
              </div>
              {committeeSettingsHref ? (
                <p className="mt-1 leading-5 text-emerald-700">
                  Committee-wide defaults are managed in{' '}
                  <Link href={committeeSettingsHref} className="font-semibold underline underline-offset-2">
                    Committee Settings
                  </Link>.
                </p>
              ) : null}
            </div>
          )}

          {isDisabled && (
            <p className="text-xs text-zinc-500">
              {isMeetingMode
                ? 'Meeting context is required to save meeting-only rule overrides.'
                : 'Attach this meeting to a committee first to manage committee rules.'}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  )
}
