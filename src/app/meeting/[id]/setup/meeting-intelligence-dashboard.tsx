'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Flame,
  LineChart as LineChartIcon,
  ListTodo,
  MessageSquareMore,
  Sparkles,
  ThermometerSun,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { CommitteeSpeaker } from '@/lib/committee-speakers'
import { getResolvedOutcomeLabel } from '@/lib/meeting-generation/resolved-outcome'
import type { Agenda } from '@/lib/supabase/types'
import type { AgendaLinkedDataState } from './agenda-linked-data'
import type { AgendaTimelineRow } from './agenda-timeline-row'
import {
  buildMeetingIntelligenceDataset,
  filterAgendaAnalytics,
  type AgendaAnalyticsRecord,
  type AgendaFilter,
  type GraphView,
} from './meeting-intelligence-data'
import type { MinuteEntry } from './minute-entry'

interface MeetingIntelligenceDashboardProps {
  meetingId: string
  meetingTitle: string
  meetingDate: string
  committeeName: string | null
  existingAgendas: Agenda[]
  timelineRows: AgendaTimelineRow[]
  currentMinutesByAgenda: Record<string, MinuteEntry>
  linkedDataByAgendaId: Record<string, AgendaLinkedDataState>
  committeeSpeakers: CommitteeSpeaker[]
  isUnlocked: boolean
}

const GRAPH_OPTIONS: Array<{ value: GraphView; label: string; icon: typeof BarChart3 }> = [
  { value: 'heatmap', label: 'Heatmap', icon: Flame },
  { value: 'bar', label: 'Bar', icon: BarChart3 },
  { value: 'line', label: 'Line', icon: LineChartIcon },
  { value: 'stacked', label: 'Stacked', icon: Activity },
]

const FILTER_OPTIONS: Array<{ value: AgendaFilter; label: string }> = [
  { value: 'all', label: 'All Agendas' },
  { value: 'heated', label: 'Heated' },
  { value: 'overrun', label: 'Overrun' },
]

const DATE_RANGE_OPTIONS = [
  { value: 'meeting', label: 'Meeting Day' },
  { value: 'month', label: 'Last 30 Days' },
  { value: 'quarter', label: 'Quarter to Date' },
]

const PIE_COLORS = ['#2563eb', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#22c55e']
const GRAPH_PANEL_HEIGHT_CLASS = 'h-[288px]'
function formatMinutes(value: number) {
  if (value >= 60) {
    const hours = Math.floor(value / 60)
    const minutes = Math.round(value % 60)
    return `${hours}h ${minutes}m`
  }
  return `${Math.round(value)} min`
}

function agendaTitleTooltip(agenda: AgendaAnalyticsRecord) {
  return `${agenda.displayLabel} — ${agenda.title}`
}

function getHeatmapCellBackground(intensity: number) {
  const clamped = Math.max(0, Math.min(1, intensity))
  const hue = 145 - (clamped * 137)
  const startLightness = 96 - (clamped * 16)
  const endLightness = 92 - (clamped * 24)
  const startAlpha = 0.22 + (clamped * 0.22)
  const endAlpha = 0.14 + (clamped * 0.34)

  return `linear-gradient(135deg, hsla(${hue}, 72%, ${startLightness}%, ${startAlpha}) 0%, hsla(${Math.max(0, hue - 18)}, 84%, ${endLightness}%, ${endAlpha}) 100%)`
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | string; color?: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-2 font-semibold text-zinc-900">{label}</p> : null}
      <div className="space-y-1.5">
        {payload.map(entry => (
          <div key={entry.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-zinc-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color ?? '#2563eb' }} />
              {entry.name}
            </span>
            <span className="font-medium text-zinc-900">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GraphTypeSwitcher({
  value,
  onChange,
}: {
  value: GraphView
  onChange: (value: GraphView) => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-[18px] border border-white/70 bg-white/88 p-0.5 shadow-sm">
      {GRAPH_OPTIONS.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1 rounded-[14px] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] transition-all ${
              active
                ? 'bg-[linear-gradient(135deg,rgba(8,98,98,1),rgba(20,184,166,0.9))] text-white shadow-[0_14px_28px_-18px_rgba(8,98,98,0.55)]'
                : 'text-zinc-500 hover:bg-secondary/70 hover:text-zinc-800'
            }`}
          >
            <Icon className="h-3 w-3" />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function HeatmapGrid({ agendas }: { agendas: AgendaAnalyticsRecord[] }) {
  const columns = [
    {
      key: 'heatScore',
      label: 'Heat Score',
      getDisplay: (agenda: AgendaAnalyticsRecord) => `${agenda.heatScore}`,
      getIntensity: (agenda: AgendaAnalyticsRecord) => agenda.heatScore / 100,
    },
    {
      key: 'duration',
      label: 'Duration',
      getDisplay: (agenda: AgendaAnalyticsRecord) => `${Math.round(agenda.durationMinutes)}m`,
      getIntensity: (agenda: AgendaAnalyticsRecord) => agenda.normalizedMetrics.duration,
    },
    {
      key: 'speakers',
      label: 'Speakers',
      getDisplay: (agenda: AgendaAnalyticsRecord) => `${agenda.speakerCount}`,
      getIntensity: (agenda: AgendaAnalyticsRecord) => agenda.normalizedMetrics.speakers,
    },
    {
      key: 'interruptions',
      label: 'Interruptions',
      getDisplay: (agenda: AgendaAnalyticsRecord) => `${agenda.interruptions}`,
      getIntensity: (agenda: AgendaAnalyticsRecord) => agenda.normalizedMetrics.interruptions,
    },
    {
      key: 'objections',
      label: 'Objections',
      getDisplay: (agenda: AgendaAnalyticsRecord) => `${agenda.objections}`,
      getIntensity: (agenda: AgendaAnalyticsRecord) => agenda.normalizedMetrics.objections,
    },
  ] as const

  return (
    <div className="overflow-x-auto pr-1">
      <div className="min-w-[584px]">
        <div className="grid grid-cols-[92px_repeat(5,minmax(68px,1fr))] gap-1.5">
          <div className="px-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Agenda</div>
          {columns.map(column => (
            <div
              key={column.key}
              className="rounded-full border border-white/70 bg-white/88 px-2 py-1 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500 shadow-sm"
            >
              {column.label}
            </div>
          ))}

          {agendas.map(agenda => (
            <Tooltip key={agenda.id}>
              <TooltipTrigger asChild>
                <div className="contents">
                  <div className="flex min-h-[48px] items-center rounded-[14px] border border-white/70 bg-white px-2 py-1.5 text-[10px] font-semibold text-zinc-900 shadow-sm">
                    {agenda.displayLabel}
                  </div>
                  {columns.map(column => {
                    const intensity = column.getIntensity(agenda)
                    return (
                      <div
                        key={`${agenda.id}-${column.key}`}
                        className="flex min-h-[48px] flex-col items-center justify-center rounded-[14px] border border-white/70 px-1.5 py-1 text-center shadow-sm transition-transform hover:-translate-y-0.5"
                        style={{
                          background: getHeatmapCellBackground(intensity),
                        }}
                      >
                        <div className="text-[12px] font-semibold leading-none text-zinc-950">{column.getDisplay(agenda)}</div>
                        <div className="mt-0.5 text-[7px] uppercase tracking-[0.12em] text-zinc-700">
                          {column.label}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="space-y-1">
                  <p className="font-semibold">{agenda.displayLabel}</p>
                  <p className="text-xs text-zinc-500">{agenda.title}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  )
}

function InsightCard({
  icon: Icon,
  iconClassName,
  label,
  value,
  detail,
  className = '',
}: {
  icon: typeof Flame
  iconClassName: string
  label: string
  value: string
  detail: string
  className?: string
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[18px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] p-2.5 shadow-[0_16px_36px_-28px_rgba(15,23,42,0.18)] ${className}`.trim()}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/70 via-teal-400/70 to-sky-400/70 opacity-80" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            <Icon className={`h-3 w-3 shrink-0 ${iconClassName}`} />
            <span>{label}</span>
          </div>
          <p className="mt-2 text-[0.92rem] font-semibold leading-tight text-zinc-950">{value}</p>
          <p className="mt-1 text-[11px] leading-[1.05rem] text-zinc-500">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function AgendaOutcomeBadge({
  mode,
}: {
  mode: AgendaAnalyticsRecord['resolvedOutcomeMode']
}) {
  if (!mode) {
    return (
      <span className="text-[10px] text-zinc-400">—</span>
    )
  }

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${
        mode === 'follow_up'
          ? 'border-violet-200 bg-violet-50 text-violet-700'
          : 'border-sky-200 bg-sky-50 text-sky-700'
      }`}
    >
      {getResolvedOutcomeLabel(mode)}
    </span>
  )
}

function KpiCards({
  temperatureLabel,
  temperatureScore,
  totalAgendas,
  totalDecisions,
  totalActionItems,
  totalSpeakers,
}: {
  temperatureLabel: string
  temperatureScore: number
  totalAgendas: number
  totalDecisions: number
  totalActionItems: number
  totalSpeakers: number
}) {
  const cards = [
    {
      label: 'Meeting Temperature',
      value: `${temperatureLabel} · ${temperatureScore}`,
      description: 'Average discussion heat across all agendas',
      icon: ThermometerSun,
      accent: 'from-orange-100 to-rose-50',
    },
    {
      label: 'Total Agenda',
      value: `${totalAgendas}`,
      description: 'Agenda items tracked in this session',
      icon: BarChart3,
      accent: 'from-blue-100 to-sky-50',
    },
    {
      label: 'Decisions Made',
      value: `${totalDecisions}`,
      description: 'Agendas with a recorded decision outcome',
      icon: CheckCircle2,
      accent: 'from-emerald-100 to-teal-50',
    },
    {
      label: 'Action Items',
      value: `${totalActionItems}`,
      description: 'Follow-ups extracted from agenda activity',
      icon: ListTodo,
      accent: 'from-violet-100 to-fuchsia-50',
    },
    {
      label: 'Total Speakers',
      value: `${totalSpeakers}`,
      description: 'Distinct participants with measurable activity',
      icon: Users,
      accent: 'from-amber-100 to-orange-50',
    },
  ] as const

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.label}
            className={`rounded-[18px] border border-white/80 bg-gradient-to-br ${card.accent} p-2.5 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.15)]`}
          >
            <div className="flex items-center justify-between gap-2.5">
              <div className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{card.label}</p>
                <p className="text-[1rem] font-semibold tracking-[-0.03em] text-zinc-950">{card.value}</p>
              </div>
              <div className="flex h-7 w-7 items-center justify-center rounded-[12px] bg-white/85 text-zinc-700 shadow-sm">
                <Icon className="h-3.5 w-3.5" />
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-zinc-600">{card.description}</p>
          </div>
        )
      })}
    </div>
  )
}

function DashboardSkeleton({ withMessage }: { withMessage: boolean }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/80" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="h-[360px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/80" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/80" />
          ))}
        </div>
      </div>
      {withMessage ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-6 text-sm text-zinc-600">
          Generate transcript timestamps first to unlock agenda heat analytics, speaker participation, and action tracking.
        </div>
      ) : null}
    </div>
  )
}

export function MeetingIntelligenceDashboard({
  meetingId,
  meetingTitle,
  meetingDate,
  committeeName,
  existingAgendas,
  timelineRows,
  currentMinutesByAgenda,
  linkedDataByAgendaId,
  committeeSpeakers,
  isUnlocked,
}: MeetingIntelligenceDashboardProps) {
  const [graphView, setGraphView] = useState<GraphView>('heatmap')
  const [agendaFilter, setAgendaFilter] = useState<AgendaFilter>('all')
  const [dateRange, setDateRange] = useState(DATE_RANGE_OPTIONS[0].value)
  const [showSkeleton, setShowSkeleton] = useState(
    () => isUnlocked && timelineRows.length > 0,
  )

  const dataset = useMemo(() => buildMeetingIntelligenceDataset({
    meetingId,
    meetingTitle,
    meetingDate,
    committeeName,
    existingAgendas,
    timelineRows,
    currentMinutesByAgenda,
    linkedDataByAgendaId,
    committeeSpeakers,
  }), [
    committeeName,
    committeeSpeakers,
    currentMinutesByAgenda,
    existingAgendas,
    linkedDataByAgendaId,
    meetingDate,
    meetingId,
    meetingTitle,
    timelineRows,
  ])

  const filteredAgendas = useMemo(
    () => filterAgendaAnalytics(dataset.agendas, agendaFilter),
    [agendaFilter, dataset.agendas],
  )

  useEffect(() => {
    if (!showSkeleton) {
      return
    }
    const timer = window.setTimeout(() => setShowSkeleton(false), 320)
    return () => window.clearTimeout(timer)
  }, [showSkeleton])

  const filteredInsights = useMemo(() => {
    const candidateAgendas = filteredAgendas.length > 0 ? filteredAgendas : dataset.agendas
    return {
      mostHeatedAgenda: [...candidateAgendas].sort((left, right) => right.heatScore - left.heatScore)[0] ?? null,
      longestDiscussion: [...candidateAgendas].sort((left, right) => right.actualMinutes - left.actualMinutes)[0] ?? null,
      agendaOverrunAlert: [...candidateAgendas]
        .filter(agenda => agenda.actualMinutes > agenda.plannedMinutes * 1.15)
        .sort((left, right) => (right.actualMinutes - right.plannedMinutes) - (left.actualMinutes - left.plannedMinutes))[0] ?? null,
    }
  }, [dataset.agendas, filteredAgendas])

  const barData = useMemo(
    () => [...filteredAgendas].sort((left, right) => right.heatScore - left.heatScore),
    [filteredAgendas],
  )
  const lineData = filteredAgendas.map(agenda => ({
    label: agenda.displayLabel,
    heatScore: agenda.heatScore,
  }))
  const stackedData = filteredAgendas.map(agenda => ({
    label: agenda.displayLabel,
    duration: agenda.contributionMetrics.duration,
    speakers: agenda.contributionMetrics.speakers,
    interruptions: agenda.contributionMetrics.interruptions,
    objections: agenda.contributionMetrics.objections,
  }))
  const speakerChartData = dataset.speakers.map(speaker => ({
    name: speaker.name,
    value: speaker.participationScore,
  }))

  const hasTimeline = timelineRows.length > 0

  function renderGraph() {
    if (filteredAgendas.length === 0) {
      return (
        <div className={`flex ${GRAPH_PANEL_HEIGHT_CLASS} items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-6 text-center text-sm text-zinc-500`}>
          No agenda matches the current filter. Switch back to <span className="mx-1 font-medium text-zinc-700">All Agendas</span> to view the full heat profile.
        </div>
      )
    }

    if (graphView === 'heatmap') {
      return (
        <div className={`${GRAPH_PANEL_HEIGHT_CLASS} overflow-auto rounded-[20px] pr-1`}>
          <HeatmapGrid agendas={filteredAgendas} />
        </div>
      )
    }

    if (graphView === 'bar') {
      return (
        <div className={GRAPH_PANEL_HEIGHT_CLASS}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="displayLabel" width={110} tickLine={false} axisLine={false} />
              <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
              <Bar dataKey="heatScore" name="Heat Score" radius={[0, 12, 12, 0]} fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )
    }

    if (graphView === 'line') {
      return (
        <div className={GRAPH_PANEL_HEIGHT_CLASS}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} domain={[0, 100]} />
              <RechartsTooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="heatScore"
                stroke="#8b5cf6"
                strokeWidth={3}
                dot={{ r: 4, fill: '#8b5cf6' }}
                activeDot={{ r: 6, fill: '#8b5cf6' }}
                name="Heat Score"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )
    }

    return (
      <div className={GRAPH_PANEL_HEIGHT_CLASS}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stackedData} layout="vertical" margin={{ left: 8, right: 20, top: 8, bottom: 8 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis type="number" tickLine={false} axisLine={false} domain={[0, 100]} />
            <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
            <Legend />
            <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
            <Bar dataKey="duration" stackId="heat" name="Duration" fill="#2563eb" />
            <Bar dataKey="speakers" stackId="heat" name="Speakers" fill="#8b5cf6" />
            <Bar dataKey="interruptions" stackId="heat" name="Interruptions" fill="#f59e0b" />
            <Bar dataKey="objections" stackId="heat" name="Objections" fill="#ef4444" radius={[0, 10, 10, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <section className="space-y-5">
        <div className="rounded-[26px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,250,249,0.95))] p-3.5 shadow-[0_22px_64px_-38px_rgba(15,23,42,0.22)] sm:p-4">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 shadow-sm">
                <Sparkles className="h-3 w-3" />
                Meeting Intelligence Dashboard
              </div>
              <div>
                <h3 className="text-[1rem] font-semibold tracking-[-0.03em] text-zinc-950 sm:text-[1.2rem]">Discussion heat, outcomes, and follow-up at agenda level</h3>
                <p className="mt-1 max-w-3xl text-[12px] leading-5 text-zinc-500">
                  A live-derived analytics layer for secretariat.my that highlights where the meeting spent time, where discussions intensified, and which agenda items need follow-up.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="h-[30px] w-[150px] gap-1.5 rounded-[14px] border-zinc-200 text-[11px]">
                  <CalendarRange className="h-3.5 w-3.5 text-zinc-500" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="inline-flex flex-wrap gap-0.5 rounded-[16px] border border-zinc-200 bg-zinc-50 p-0.5">
                {FILTER_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAgendaFilter(option.value)}
                    className={`rounded-[14px] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                      agendaFilter === option.value
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-500 hover:bg-white hover:text-zinc-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3.5">
            {!isUnlocked ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-8 text-sm text-zinc-600">
                Complete steps 1 and 2 in the workflow above to unlock meeting intelligence analytics.
              </div>
            ) : showSkeleton ? (
              <DashboardSkeleton withMessage={!hasTimeline} />
            ) : !hasTimeline ? (
              <DashboardSkeleton withMessage />
            ) : (
              <div className="space-y-3.5">
                <KpiCards
                  temperatureLabel={dataset.summary.meetingTemperature.label}
                  temperatureScore={dataset.summary.meetingTemperature.score}
                  totalAgendas={dataset.summary.totalAgendas}
                  totalDecisions={dataset.summary.totalDecisions}
                  totalActionItems={dataset.summary.totalActionItems}
                  totalSpeakers={dataset.summary.totalSpeakers}
                />

                <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_248px]">
                  <div className="rounded-[22px] border border-white/80 bg-[linear-gradient(180deg,rgba(237,249,248,0.94),rgba(255,255,255,0.98))] p-2.5 shadow-[0_18px_42px_-32px_rgba(15,23,42,0.16)]">
                    <div className="rounded-[18px] border border-white/80 bg-[linear-gradient(135deg,rgba(8,98,98,0.98),rgba(20,184,166,0.9))] px-3 py-2.5 text-white shadow-[0_18px_36px_-24px_rgba(8,98,98,0.45)]">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/12 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/80">
                            <Activity className="h-3 w-3" />
                            Discussion Instrument
                          </div>
                          <h4 className="mt-2 text-[13px] font-semibold md:text-[14px]">Agenda Discussion Heat</h4>
                          <p className="mt-1 max-w-xl text-[11px] leading-[1.05rem] text-white/72">
                            This view highlights which agenda items triggered the most intense discussion based on duration, speaker count, interruptions, and objections.
                          </p>
                        </div>
                        <GraphTypeSwitcher value={graphView} onChange={setGraphView} />
                      </div>
                    </div>
                    <div className="mt-2.5 rounded-[18px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,248,250,0.96))] p-2 shadow-sm">
                      <div key={graphView} className="transition-opacity duration-200">
                        {renderGraph()}
                      </div>
                    </div>
                  </div>

                  <div className="grid content-start gap-2 self-start xl:grid-cols-1">
                    <InsightCard
                      icon={Flame}
                      iconClassName="text-amber-500"
                      label="Most Heated Agenda"
                      value={filteredInsights.mostHeatedAgenda?.displayLabel ?? '—'}
                      detail={filteredInsights.mostHeatedAgenda ? `${filteredInsights.mostHeatedAgenda.heatScore} heat score` : 'No matching agenda'}
                      className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,247,237,0.94))]"
                    />
                    <InsightCard
                      icon={Clock3}
                      iconClassName="text-blue-500"
                      label="Longest Discussion"
                      value={filteredInsights.longestDiscussion?.displayLabel ?? '—'}
                      detail={filteredInsights.longestDiscussion ? formatMinutes(filteredInsights.longestDiscussion.actualMinutes) : 'No matching agenda'}
                      className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(239,246,255,0.94))]"
                    />
                    <InsightCard
                      icon={Users}
                      iconClassName="text-violet-500"
                      label="Most Active Speaker"
                      value={dataset.insights.mostActiveSpeaker?.name ?? '—'}
                      detail={dataset.insights.mostActiveSpeaker ? `${dataset.insights.mostActiveSpeaker.participationScore} participation score` : 'No speaker activity'}
                      className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,243,255,0.94))]"
                    />
                    <InsightCard
                      icon={Activity}
                      iconClassName="text-emerald-500"
                      label="Meeting Efficiency Score"
                      value={`${dataset.insights.meetingEfficiencyScore}`}
                      detail="Combines overrun ratio, interruption load, and decision rate."
                      className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(236,253,245,0.94))]"
                    />
                    <InsightCard
                      icon={AlertTriangle}
                      iconClassName="text-red-500"
                      label="Agenda Overrun Alert"
                      value={filteredInsights.agendaOverrunAlert?.displayLabel ?? 'No Overrun'}
                      detail={filteredInsights.agendaOverrunAlert
                        ? `${formatMinutes(filteredInsights.agendaOverrunAlert.actualMinutes - filteredInsights.agendaOverrunAlert.plannedMinutes)} over planned time`
                        : 'All visible agendas are within expected range.'}
                      className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(254,242,242,0.94))]"
                    />
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.22fr)_332px]">
                  <div className="rounded-[24px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))] p-3 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.16)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-[15px] font-semibold text-zinc-950 md:text-base">Agenda Details</h4>
                        <p className="mt-0.5 text-[12px] text-zinc-500">Operational view of timing, discussion heat, and final agenda outcome.</p>
                      </div>
                      <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[10px]">
                        {filteredAgendas.length} visible agenda{filteredAgendas.length === 1 ? '' : 's'}
                      </Badge>
                    </div>

                    <div className="mt-2.5 overflow-x-auto rounded-[18px] border border-white/80 bg-white/92 shadow-sm">
                      <table className="min-w-[700px] text-left text-[12px]">
                        <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-[linear-gradient(180deg,rgba(233,247,244,0.98),rgba(255,255,255,0.96))] text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                          <tr>
                            <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">Agenda</th>
                            <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">Planned Time</th>
                            <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">Actual Time</th>
                            <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">Heat Score</th>
                            <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">Speakers</th>
                            <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">Interruptions</th>
                            <th className="whitespace-nowrap px-2.5 py-2.5 font-semibold">Outcome</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {filteredAgendas.map(agenda => (
                            <tr key={agenda.id} className="align-middle transition-colors hover:bg-primary/5">
                              <td className="px-2.5 py-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex cursor-help font-semibold text-zinc-900">{agenda.displayLabel}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>{agendaTitleTooltip(agenda)}</TooltipContent>
                                </Tooltip>
                              </td>
                              <td className="whitespace-nowrap px-2.5 py-2 text-zinc-600">{formatMinutes(agenda.plannedMinutes)}</td>
                              <td className="whitespace-nowrap px-2.5 py-2 text-zinc-600">{formatMinutes(agenda.actualMinutes)}</td>
                              <td className="whitespace-nowrap px-2.5 py-2 font-medium text-zinc-900">{agenda.heatScore}</td>
                              <td className="whitespace-nowrap px-2.5 py-2 text-zinc-600">{agenda.speakerCount}</td>
                              <td className="whitespace-nowrap px-2.5 py-2 text-zinc-600">{agenda.interruptions}</td>
                              <td className="whitespace-nowrap px-2.5 py-2">
                                <AgendaOutcomeBadge mode={agenda.resolvedOutcomeMode} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-[15px] font-semibold text-zinc-950">Speaker Participation</h4>
                          <p className="mt-0.5 text-[12px] text-zinc-500">Compact view of who drove the conversation most frequently.</p>
                        </div>
                        <Users className="h-4 w-4 text-zinc-400" />
                      </div>

                      <div className="mt-3 grid gap-3">
                        <div className="mx-auto h-[168px] w-full max-w-[220px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={speakerChartData}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={46}
                                outerRadius={68}
                                paddingAngle={3}
                              >
                                {speakerChartData.map((entry, index) => (
                                  <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <RechartsTooltip content={<ChartTooltip />} />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="max-h-[248px] space-y-2 overflow-auto pr-1">
                          {dataset.speakers.map((speaker, index) => (
                            <div key={speaker.name} className="flex items-center justify-between rounded-[18px] border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-[12px] font-medium text-zinc-900">{speaker.name}</p>
                                <p className="text-[11px] text-zinc-500">{speaker.agendasCovered} agendas · {speaker.speakingMoments} speaking moments</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                                <span className="text-[12px] font-semibold text-zinc-900">{speaker.participationScore}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-[15px] font-semibold text-zinc-950">Action Items</h4>
                          <p className="mt-0.5 text-[12px] text-zinc-500">Follow-up tasks inferred from active agendas and meeting outcomes.</p>
                        </div>
                        <ListTodo className="h-4 w-4 text-zinc-400" />
                      </div>

                      <div className="mt-3 max-h-[320px] space-y-2 overflow-auto pr-1">
                        {dataset.actionItems.length === 0 ? (
                          <div className="rounded-[18px] border border-dashed border-zinc-300 bg-zinc-50 px-3.5 py-5 text-[12px] text-zinc-500">
                            No follow-up items were derived from the current meeting dataset.
                          </div>
                        ) : dataset.actionItems.map(item => (
                          <div key={item.id} className="rounded-[18px] border border-zinc-200 bg-zinc-50/70 px-3.5 py-2.5">
                            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[10px]">
                                    Agenda {item.agendaNo}
                                  </Badge>
                                  <span className="text-[10px] text-zinc-400">•</span>
                                  <span className="text-[10px] text-zinc-500">{item.status}</span>
                                </div>
                                <p className="mt-1.5 text-[12px] font-medium text-zinc-900">{item.task}</p>
                              </div>
                              <div className="shrink-0 text-right text-[11px] text-zinc-500">
                                <p className="font-medium text-zinc-700">{item.owner}</p>
                                <p>{item.deadline}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-zinc-200 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800 p-4 text-white shadow-sm">
                  <div className="grid gap-4 lg:grid-cols-[1.15fr_0.95fr]">
                    <div className="space-y-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300">Meeting Summary</p>
                        <h4 className="mt-1.5 text-[1.2rem] font-semibold tracking-tight">{dataset.summary.meetingTitle}</h4>
                      </div>
                      <div className="flex flex-wrap gap-2.5 text-[12px] text-zinc-300">
                        <span>{dataset.summary.date}</span>
                        <span>Chairman: {dataset.summary.chairman}</span>
                        <span>{dataset.summary.totalDuration} min total duration</span>
                      </div>
                      <p className="max-w-3xl text-[12px] leading-6 text-zinc-300">{dataset.summary.overallSummary}</p>
                    </div>

                    <div className="rounded-[20px] border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
                        <MessageSquareMore className="h-3.5 w-3.5 text-violet-300" />
                        AI Narrative
                      </div>
                      <p className="mt-3 text-[13px] leading-6 text-zinc-100">{dataset.summary.narrative}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </TooltipProvider>
  )
}
