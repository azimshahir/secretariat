'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { MinuteMindEntryType, MinuteMindScopeType } from '@/lib/meeting-generation/minute-mind'

export interface MinuteMindEntryDialogValue {
  scopeType: MinuteMindScopeType
  entryType: MinuteMindEntryType
  title: string
  content: string
  appliesToGeneration: boolean
  appliesToChat: boolean
  isActive: boolean
}

const ENTRY_TYPE_OPTIONS: Array<{ value: MinuteMindEntryType; label: string }> = [
  { value: 'formatting_rule', label: 'Formatting Rule' },
  { value: 'writing_preference', label: 'Writing Preference' },
  { value: 'committee_fact', label: 'Committee Fact' },
  { value: 'exception', label: 'Exception' },
]

export function MinuteMindEntryDialog({
  open,
  onOpenChange,
  title,
  description,
  scopeOptions,
  initialValue,
  hideScopeSelect = false,
  submitLabel = 'Save to Memory',
  isSubmitting = false,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  scopeOptions: Array<{ value: MinuteMindScopeType; label: string }>
  initialValue: MinuteMindEntryDialogValue
  hideScopeSelect?: boolean
  submitLabel?: string
  isSubmitting?: boolean
  onSubmit: (value: MinuteMindEntryDialogValue) => Promise<void> | void
}) {
  const [value, setValue] = useState<MinuteMindEntryDialogValue>(initialValue)

  function update<K extends keyof MinuteMindEntryDialogValue>(key: K, nextValue: MinuteMindEntryDialogValue[K]) {
    setValue(prev => ({ ...prev, [key]: nextValue }))
  }

  async function handleSubmit() {
    await onSubmit({
      ...value,
      title: value.title.trim(),
      content: value.content.trim(),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!hideScopeSelect ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Scope</label>
              <Select value={value.scopeType} onValueChange={next => update('scopeType', next as MinuteMindScopeType)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  {scopeOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Type</label>
            <Select value={value.entryType} onValueChange={next => update('entryType', next as MinuteMindEntryType)}>
              <SelectTrigger>
                <SelectValue placeholder="Select memory type" />
              </SelectTrigger>
              <SelectContent>
                {ENTRY_TYPE_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Title</label>
            <Input
              value={value.title}
              onChange={event => update('title', event.target.value)}
              placeholder="Short label for this memory"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Content</label>
            <Textarea
              value={value.content}
              onChange={event => update('content', event.target.value)}
              placeholder="Describe the formatting rule, preference, fact, or exception to remember"
              rows={6}
            />
          </div>

          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 text-sm sm:grid-cols-3">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={value.appliesToGeneration}
                onCheckedChange={checked => update('appliesToGeneration', Boolean(checked))}
              />
              Generation
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={value.appliesToChat}
                onCheckedChange={checked => update('appliesToChat', Boolean(checked))}
              />
              Chat
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={value.isActive}
                onCheckedChange={checked => update('isActive', Boolean(checked))}
              />
              Active
            </label>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => { void handleSubmit() }}
              disabled={isSubmitting || !value.title.trim() || !value.content.trim()}
              className="gap-2"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
