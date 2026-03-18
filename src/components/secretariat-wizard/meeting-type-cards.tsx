'use client'

import { Building2, Landmark, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { PersonaTemplate } from '@/lib/ai/persona-templates'
import type { SecretariatTemplate, SecretariatFamily } from '@/lib/secretariat-templates'
import { cn } from '@/lib/utils'

export function FamilyCards({ families, selectedId, onSelect }: {
  families: SecretariatFamily[]; selectedId: string | null; onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {families.map(family => {
        const selected = family.id === selectedId
        return (
          <button key={family.id} type="button" onClick={() => onSelect(family.id)}
            className={cn(
              'rounded-[18px] border px-4 py-4 text-left transition-all duration-200',
              selected
                ? 'border-primary/30 bg-primary text-primary-foreground shadow-[0_18px_45px_-28px_rgba(8,98,98,0.72)]'
                : 'border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.98))] hover:-translate-y-0.5 hover:border-primary/20'
            )}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="font-medium">{family.label}</p>
                <p className={cn('text-sm leading-6', selected ? 'text-primary-foreground/82' : 'text-muted-foreground')}>
                  {family.description}
                </p>
              </div>
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]',
                selected ? 'bg-white/14 text-white' : 'bg-primary/8 text-primary')}>
                <Landmark className="h-4 w-4" />
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function TemplateCards({ templates, selectedId, onSelect }: {
  templates: SecretariatTemplate[]; selectedId: string | null; onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {templates.map(t => {
        const selected = t.id === selectedId
        return (
          <button key={t.id} type="button" onClick={() => onSelect(t.id)}
            className={cn(
              'rounded-[20px] border text-left transition-all duration-200',
              selected
                ? 'border-primary/30 bg-primary/5 shadow-[0_18px_40px_-28px_rgba(8,98,98,0.2)]'
                : 'border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))] hover:-translate-y-0.5 hover:border-primary/20'
            )}>
            <div className="flex items-start justify-between gap-4 px-4 py-4">
              <div className="space-y-3">
                <Badge className="rounded-full bg-primary/10 px-3 py-1 text-primary">{t.shortLabel}</Badge>
                <div>
                  <p className="text-lg font-semibold text-foreground">{t.name}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.description}</p>
                </div>
              </div>
              <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]',
                selected ? 'bg-primary text-primary-foreground' : 'bg-primary/8 text-primary')}>
                <Building2 className="h-5 w-5" />
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function PersonaCards({ templates, selectedSlug, onSelect }: {
  templates: PersonaTemplate[]; selectedSlug: string | null; onSelect: (slug: string) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map(t => {
        const selected = t.slug === selectedSlug
        return (
          <button key={t.slug} type="button" onClick={() => onSelect(t.slug)}
            className={cn(
              'rounded-[20px] border px-4 py-4 text-left transition-all duration-200',
              selected
                ? 'border-primary/30 bg-primary/5 shadow-[0_18px_40px_-28px_rgba(8,98,98,0.2)]'
                : 'border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(255,255,255,0.98))] hover:-translate-y-0.5 hover:border-primary/20'
            )}>
            <div className="space-y-2">
              <p className="font-semibold text-foreground">{t.name}</p>
              <p className="text-sm leading-6 text-muted-foreground">{t.description}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function SuggestionCards({ suggestions, selectedName, onSelect, customValue, onCustomChange }: {
  suggestions: { name: string; description: string }[]; selectedName: string
  onSelect: (name: string) => void; customValue: string; onCustomChange: (value: string) => void
}) {
  return (
    <div className="space-y-4">
      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Suggested meeting types</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {suggestions.map(s => (
              <button key={s.name} type="button" onClick={() => onSelect(s.name)}
                className={cn('rounded-[16px] border px-4 py-3 text-left transition-all',
                  selectedName === s.name ? 'border-primary/30 bg-primary/5' : 'border-border/70 hover:border-primary/20')}>
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary/60" />
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor="custom-meeting" className="text-sm font-medium">Or type a custom meeting name</label>
        <Input id="custom-meeting" value={customValue} onChange={e => onCustomChange(e.target.value)}
          placeholder="e.g. Technology Steering Committee" />
      </div>
    </div>
  )
}
