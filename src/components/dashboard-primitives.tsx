import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type SurfaceTone = 'default' | 'muted' | 'accent'
type SurfacePadding = 'sm' | 'md' | 'lg'
type StatTone = 'default' | 'primary' | 'success' | 'warning'

const surfaceToneClass: Record<SurfaceTone, string> = {
  default: 'border-border/70 bg-white/92 shadow-[0_22px_68px_-40px_rgba(15,23,42,0.28)]',
  muted: 'border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,251,250,0.9))] shadow-[0_20px_60px_-42px_rgba(15,23,42,0.22)]',
  accent: 'border-primary/18 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(236,253,250,0.96)_56%,rgba(220,252,231,0.9))] shadow-[0_24px_64px_-42px_rgba(8,98,98,0.32)]',
}

const surfacePaddingClass: Record<SurfacePadding, string> = {
  sm: 'p-3.5 md:p-4',
  md: 'p-4 md:p-5',
  lg: 'p-5 md:p-6',
}

const statToneClass: Record<StatTone, string> = {
  default: 'from-white to-zinc-50/80',
  primary: 'from-teal-50 to-cyan-50',
  success: 'from-emerald-50 to-teal-50',
  warning: 'from-amber-50 to-orange-50',
}

const statIconToneClass: Record<StatTone, string> = {
  default: 'text-zinc-600',
  primary: 'text-primary',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
}

const statValueToneClass: Record<StatTone, string> = {
  default: 'text-foreground',
  primary: 'text-primary',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
}

export function DashboardSurface({
  children,
  className,
  tone = 'default',
  padding = 'md',
}: {
  children: ReactNode
  className?: string
  tone?: SurfaceTone
  padding?: SurfacePadding
}) {
  return (
    <section
      className={cn(
        'rounded-[24px] border backdrop-blur',
        surfaceToneClass[tone],
        surfacePaddingClass[padding],
        className,
      )}
    >
      {children}
    </section>
  )
}

export function DashboardSectionIntro({
  eyebrow,
  title,
  description,
  actions,
  compact = false,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3 md:flex-row md:items-end md:justify-between', className)}>
      <div className={cn('space-y-1.5', compact && 'space-y-1')}>
        {eyebrow ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70">
            {eyebrow}
          </div>
        ) : null}
        <div>
          <h3 className={cn('font-display font-semibold tracking-[-0.04em] text-foreground', compact ? 'text-[1.15rem] sm:text-[1.3rem]' : 'text-[1.35rem] sm:text-[1.65rem]')}>
            {title}
          </h3>
          {description ? (
            <p className={cn('max-w-2xl text-sm text-muted-foreground', compact ? 'mt-1 leading-5' : 'mt-1.5 leading-6')}>
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function DashboardStatCard({
  label,
  value,
  description,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label: ReactNode
  value: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  tone?: StatTone
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-[20px] border border-border/70 bg-gradient-to-br p-3.5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.18)]',
        statToneClass[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className={cn('text-[1.32rem] font-semibold tracking-[-0.04em]', statValueToneClass[tone])}>
            {value}
          </p>
        </div>
        {Icon ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-[16px] border border-white/70 bg-white/88 shadow-sm">
            <Icon className={cn('h-4 w-4', statIconToneClass[tone])} />
          </div>
        ) : null}
      </div>
      {description ? (
        <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  )
}

export function DashboardPill({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode
  tone?: 'default' | 'primary' | 'success' | 'warning'
  className?: string
}) {
  const toneClass = tone === 'primary'
    ? 'border-primary/15 bg-primary/8 text-primary'
    : tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-border/70 bg-secondary/45 text-muted-foreground'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  )
}
