'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { saveCommitteeMinuteInstruction } from './committee-generation-actions'

interface RulesSectionProps {
  committeeId: string | null
  initialInstruction: string
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

export function RulesSection({ committeeId, initialInstruction }: RulesSectionProps) {
  const initialRows = useMemo(() => parseInstructionToRows(initialInstruction), [initialInstruction])
  const [rules, setRules] = useState<string[]>(initialRows)
  const [isPending, startTransition] = useTransition()
  const isDisabled = !committeeId

  useEffect(() => {
    setRules(initialRows)
  }, [initialRows])

  function updateRule(index: number, value: string) {
    setRules(prev => prev.map((item, currentIndex) => (currentIndex === index ? value : item)))
  }

  function addRule() {
    setRules(prev => [...prev, ''])
  }

  function removeRule(index: number) {
    setRules(prev => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index)
      return next.length === 0 ? [''] : next
    })
  }

  function handleSave() {
    if (!committeeId) {
      toast.error('No committee linked — assign a committee first')
      return
    }

    const serialized = serializeRulesForStorage(rules)

    startTransition(async () => {
      try {
        await saveCommitteeMinuteInstruction(committeeId, serialized)
        setRules(parseInstructionToRows(serialized))
        toast.success('Committee rules saved')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save committee rules')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rules</CardTitle>
        <CardDescription>
          Define committee-level wording and terminology rules for minute generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.map((rule, index) => (
          <div key={`rule-row-${index}`} className="flex items-start gap-2">
            <Textarea
              value={rule}
              onChange={event => updateRule(index, event.target.value)}
              placeholder='e.g. Use "Head, TD" instead of "The Section Head of TD"'
              disabled={isDisabled || isPending}
              rows={3}
              className="min-h-[4.5rem] resize-y"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeRule(index)}
              disabled={isDisabled || isPending}
              className="shrink-0 mt-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

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

        {isDisabled && (
          <p className="text-xs text-zinc-500">
            Attach this meeting to a committee first to manage committee rules.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
