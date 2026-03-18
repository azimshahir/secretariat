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
import type { CommitteeSpeaker } from '@/actions/committee-speakers'
import type { Agenda } from '@/lib/supabase/types'
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
const STATUS_STYLES: Record<AgendaAnalyticsRecord['status'], string> = {
  'On Track': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Heated: 'border-amber-200 bg-amber-50 text-amber-700',
  Overrun: 'border-red-200 bg-red-50 text-red-700',
  'Needs Follow-up': 'border-violet-200 bg-violet-50 text-violet-700',
}

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
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-zinc-200 bg-zinc-100 p-1">
      {GRAPH_OPTIONS.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              active
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:bg-white/70 hover:text-zinc-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
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
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[140px_repeat(5,minmax(110px,1fr))] gap-2">
          <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Agenda</div>
          {columns.map(column => (
            <div
              key={column.key}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500"
            >
              {column.label}
            </div>
          ))}

          {agendas.map(agenda => (
            <Tooltip key={agenda.id}>
              <TooltipTrigger asChild>
                <div className="contents">
                  <div className="flex items-center rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm font-semibold text-zinc-900 shadow-sm">
                    {agenda.displayLabel}
                  </div>
                  {columns.map(column => {
                    const intensity = column.getIntensity(agenda)
                    return (
                      <div
                        key={`${agenda.id}-${column.key}`}
                        className="rounded-xl border border-zinc-200 px-3 py-3 text-center shadow-sm transition-transform hover:-translate-y-0.5"
                        style={{
                          background: `linear-gradient(135deg, rgba(37,99,235,${0.12 + (intensity * 0.42)}) 0%, rgba(139,92,246,${0.08 + (intensity * 0.16)}) 100%)`,
                        }}
                      >
                        <div className="text-base font-semibold text-zinc-900">{column.getDisplay(agenda)}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
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

function AgendaStatusBadge({ status }: { status: AgendaAnalyticsRecord['status'] }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
      {status}
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.label}
            className={`rounded-2xl border border-zinc-200 bg-gradient-to-br ${card.accent} p-4 shadow-sm`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{card.label}</p>
                <p className="text-2xl font-semibold tracking-tight text-zinc-950">{card.value}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/80 text-zinc-700 shadow-sm">
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-zinc-600">{card.description}</p>
          </div>
        )
      })}
    </div>
  )
}

function DashboardSkeleton({ withMessage }: { withMessage: boolean }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/80" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="h-[420px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/80" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100/80" />
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
  committeeSpeakers,
  isUnlocked,
}: MeetingIntelligenceDashboardProps) {
  const [graphView, setGraphView] = useState<GraphView>('heatmap')
  const [agendaFilter, setAgendaFilter] = useState<AgendaFilter>('all')
  const [dateRange, setDateRange] = useState(DATE_RANGE_OPTIONS[0].value)
  const [showSkeleton, setShowSkeleton] = useState(true)

  const dataset = useMemo(() => buildMeetingIntelligenceDataset({
    meetingId,
    meetingTitle,
    meetingDate,
    committeeName,
    existingAgendas,
    timelineRows,
    currentMinutesByAgenda,
    committeeSpeakers,
  }), [
    committeeName,
    committeeSpeakers,
    currentMinutesByAgenda,
    existingAgendas,
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
    if (!isUnlocked || timelineRows.length === 0) {
      setShowSkeleton(false)
      return
    }
    setShowSkeleton(true)
    const timer = window.setTimeout(() => setShowSkeleton(false), 320)
    return () => window.clearTimeout(timer)
  }, [isUnlocked, meetingId, timelineRows.length])

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
        <div className="flex h-[360px] items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-6 text-center text-sm text-zinc-500">
          No agenda matches the current filter. Switch back to <span className="mx-1 font-medium text-zinc-700">All Agendas</span> to view the full heat profile.
        </div>
      )
    }

    if (graphView === 'heatmap') {
      return <HeatmapGrid agendas={filteredAgendas} />
    }

    if (graphView === 'bar') {
      return (
        <div className="h-[360px]">
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
        <div className="h-[360px]">
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
      <div className="h-[360px]">
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
      <section className="space-y-6">
        <div className="rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm sm:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                <Sparkles className="h-3.5 w-3.5" />
                Meeting Intelligence Dashboard
              </div>
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-zinc-950">Discussion heat, outcomes, and follow-up at agenda level</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                  A live-derived analytics layer for secretariat.my that highlights where the meeting spent time, where discussions intensified, and which agenda items need follow-up.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="h-10 w-[180px] gap-2 rounded-xl border-zinc-200">
                  <CalendarRange className="h-4 w-4 text-zinc-500" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_RANGE_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="inline-flex flex-wrap gap-2 rounded-full border border-zinc-200 bg-zinc-50 p-1.5">
                {FILTER_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAgendaFilter(option.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
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

          <div className="mt-6">
            {!isUnlocked ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-8 text-sm text-zinc-600">
                Complete steps 1 and 2 in the workflow above to unlock meeting intelligence analytics.
              </div>
            ) : showSkeleton ? (
              <DashboardSkeleton withMessage={!hasTimeline} />
            ) : !hasTimeline ? (
              <DashboardSkeleton withMessage />
            ) : (
              <div className="space-y-6">
                <KpiCards
                  temperatureLabel={dataset.summary.meetingTemperature.label}
                  temperatureScore={dataset.summary.meetingTemperature.score}
                  totalAgendas={dataset.summary.totalAgendas}
                  totalDecisions={dataset.summary.totalDecisions}
                  totalActionItems={dataset.summary.totalActionItems}
                  totalSpeakers={dataset.summary.totalSpeakers}
                />

                <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
                  <div className="rounded-3xl border border-zinc-200 bg-zinc-50/60 p-5 shadow-sm">
                    <div className="flex flex-col gap-4 border-b border-zinc-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h4 className="text-lg font-semibold text-zinc-950">Agenda Discussion Heat</h4>
                        <p className="mt-1 text-sm text-zinc-500">
                          This view highlights which agenda items triggered the most intense discussion based on duration, speaker count, interruptions, and objections.
                        </p>
                      </div>
                      <GraphTypeSwitcher value={graphView} onChange={setGraphView} />
                    </div>
                    <div key={graphView} className="mt-5 transition-opacity duration-200">
                      {renderGraph()}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        <Flame className="h-3.5 w-3.5 text-amber-500" />
                        Most Heated Agenda
                      </div>
                      <p className="mt-3 text-lg font-semibold text-zinc-950">{filteredInsights.mostHeatedAgenda?.displayLabel ?? '—'}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {filteredInsights.mostHeatedAgenda ? `${filteredInsights.mostHeatedAgenda.heatScore} heat score` : 'No matching agenda'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        <Clock3 className="h-3.5 w-3.5 text-blue-500" />
                        Longest Discussion
                      </div>
                      <p className="mt-3 text-lg font-semibold text-zinc-950">{filteredInsights.longestDiscussion?.displayLabel ?? '—'}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {filteredInsights.longestDiscussion ? formatMinutes(filteredInsights.longestDiscussion.actualMinutes) : 'No matching agenda'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        <Users className="h-3.5 w-3.5 text-violet-500" />
                        Most Active Speaker
                      </div>
                      <p className="mt-3 text-lg font-semibold text-zinc-950">{dataset.insights.mostActiveSpeaker?.name ?? '—'}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {dataset.insights.mostActiveSpeaker ? `${dataset.insights.mostActiveSpeaker.participationScore} participation score` : 'No speaker activity'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        <Activity className="h-3.5 w-3.5 text-emerald-500" />
                        Meeting Efficiency Score
                      </div>
                      <p className="mt-3 text-lg font-semibold text-zinc-950">{dataset.insights.meetingEfficiencyScore}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        Combines overrun ratio, interruption load, and decision rate.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:col-span-2 xl:col-span-1">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                        Agenda Overrun Alert
                      </div>
                      <p className="mt-3 text-lg font-semibold text-zinc-950">{filteredInsights.agendaOverrunAlert?.displayLabel ?? 'No Overrun'}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {filteredInsights.agendaOverrunAlert
                          ? `${formatMinutes(filteredInsights.agendaOverrunAlert.actualMinutes - filteredInsights.agendaOverrunAlert.plannedMinutes)} over planned time`
                          : 'All visible agendas are within expected range.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-semibold text-zinc-950">Agenda Details</h4>
                      <p className="mt-1 text-sm text-zinc-500">Operational view of plan vs actual time, discussion heat, and outcome readiness.</p>
                    </div>
                    <Badge variant="secondary" className="rounded-full px-3 py-1">
                      {filteredAgendas.length} visible agenda{filteredAgendas.length === 1 ? '' : 's'}
                    </Badge>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-zinc-200 text-xs uppercase tracking-[0.16em] text-zinc-500">
                        <tr>
                          <th className="pb-3 pr-4 font-semibold">Agenda</th>
                          <th className="pb-3 pr-4 font-semibold">Planned Time</th>
                          <th className="pb-3 pr-4 font-semibold">Actual Time</th>
                          <th className="pb-3 pr-4 font-semibold">Heat Score</th>
                          <th className="pb-3 pr-4 font-semibold">Speakers</th>
                          <th className="pb-3 pr-4 font-semibold">Interruptions</th>
                          <th className="pb-3 pr-4 font-semibold">Decision Made</th>
                          <th className="pb-3 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {filteredAgendas.map(agenda => (
                          <tr key={agenda.id} className="align-middle">
                            <td className="py-3 pr-4">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex cursor-help font-medium text-zinc-900">{agenda.displayLabel}</span>
                                </TooltipTrigger>
                                <TooltipContent>{agendaTitleTooltip(agenda)}</TooltipContent>
                              </Tooltip>
                            </td>
                            <td className="py-3 pr-4 text-zinc-600">{formatMinutes(agenda.plannedMinutes)}</td>
                            <td className="py-3 pr-4 text-zinc-600">{formatMinutes(agenda.actualMinutes)}</td>
                            <td className="py-3 pr-4 font-medium text-zinc-900">{agenda.heatScore}</td>
                            <td className="py-3 pr-4 text-zinc-600">{agenda.speakerCount}</td>
                            <td className="py-3 pr-4 text-zinc-600">{agenda.interruptions}</td>
                            <td className="py-3 pr-4 text-zinc-600">{agenda.decisionMade ? 'Yes' : 'No'}</td>
                            <td className="py-3">
                              <AgendaStatusBadge status={agenda.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
                  <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-lg font-semibold text-zinc-950">Speaker Participation</h4>
                        <p className="mt-1 text-sm text-zinc-500">Compact view of who drove the conversation most frequently.</p>
                      </div>
                      <Users className="h-5 w-5 text-zinc-400" />
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={speakerChartData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={58}
                              outerRadius={86}
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

                      <div className="space-y-3">
                        {dataset.speakers.map((speaker, index) => (
                          <div key={speaker.name} className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-zinc-900">{speaker.name}</p>
                              <p className="text-xs text-zinc-500">{speaker.agendasCovered} agendas · {speaker.speakingMoments} speaking moments</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                              <span className="text-sm font-semibold text-zinc-900">{speaker.participationScore}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-lg font-semibold text-zinc-950">Action Items</h4>
                        <p className="mt-1 text-sm text-zinc-500">Follow-up tasks inferred from active agendas and meeting outcomes.</p>
                      </div>
                      <ListTodo className="h-5 w-5 text-zinc-400" />
                    </div>

                    <div className="mt-4 space-y-3">
                      {dataset.actionItems.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
                          No follow-up items were derived from the current meeting dataset.
                        </div>
                      ) : dataset.actionItems.map(item => (
                        <div key={item.id} className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[11px]">
                                  Agenda {item.agendaNo}
                                </Badge>
                                <span className="text-xs text-zinc-400">•</span>
                                <span className="text-xs text-zinc-500">{item.status}</span>
                              </div>
                              <p className="mt-2 text-sm font-medium text-zinc-900">{item.task}</p>
                            </div>
                            <div className="shrink-0 text-right text-xs text-zinc-500">
                              <p className="font-medium text-zinc-700">{item.owner}</p>
                              <p>{item.deadline}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-zinc-200 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800 p-6 text-white shadow-sm">
                  <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                    <div className="space-y-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">Meeting Summary</p>
                        <h4 className="mt-2 text-2xl font-semibold tracking-tight">{dataset.summary.meetingTitle}</h4>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm text-zinc-300">
                        <span>{dataset.summary.date}</span>
                        <span>Chairman: {dataset.summary.chairman}</span>
                        <span>{dataset.summary.totalDuration} min total duration</span>
                      </div>
                      <p className="max-w-3xl text-sm leading-7 text-zinc-300">{dataset.summary.overallSummary}</p>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
                        <MessageSquareMore className="h-3.5 w-3.5 text-violet-300" />
                        AI Narrative
                      </div>
                      <p className="mt-4 text-base leading-7 text-zinc-100">{dataset.summary.narrative}</p>
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
