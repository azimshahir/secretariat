import { redirect } from 'next/navigation'
import { getCanonicalCurrentMinuteForAgendaId } from '@/lib/meeting-generation/current-minute'
import { createClient } from '@/lib/supabase/server'

const SECTION_STYLES = {
  emerald: {
    border: 'border-emerald-200 dark:border-emerald-900/40',
    bg: 'bg-emerald-50/40 dark:bg-emerald-950/20',
    title: 'text-emerald-700 dark:text-emerald-300',
  },
  blue: {
    border: 'border-blue-200 dark:border-blue-900/40',
    bg: 'bg-blue-50/40 dark:bg-blue-950/20',
    title: 'text-blue-700 dark:text-blue-300',
  },
  rose: {
    border: 'border-rose-200 dark:border-rose-900/40',
    bg: 'bg-rose-50/40 dark:bg-rose-950/20',
    title: 'text-rose-700 dark:text-rose-300',
  },
} as const

export default async function SummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ agenda?: string }>
}) {
  await params
  const { agenda: agendaId } = await searchParams
  if (!agendaId) redirect('/')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const minute = await getCanonicalCurrentMinuteForAgendaId<{
    id: string
    agenda_id: string
    summary_paper: string | null
    summary_discussion: string | null
    summary_heated: string | null
  }>({
    supabase,
    agendaId,
    extraColumns: 'summary_paper, summary_discussion, summary_heated',
  })

  const paper = minute?.summary_paper
  const discussion = minute?.summary_discussion
  const heated = minute?.summary_heated
  const hasSummary = !!(paper || discussion || heated)

  return (
    <div className="min-h-screen bg-white p-8 dark:bg-zinc-950">
      <h1 className="mb-6 text-sm font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        Meeting Summary
      </h1>
      {hasSummary ? (
        <div className="space-y-4">
          {paper && <Section title="Summary of the Paper" content={paper} color="emerald" />}
          {discussion && <Section title="Beyond the Paper — Key Discussions" content={discussion} color="blue" />}
          {heated && <Section title="Perdebatan Hangat" content={heated} color="rose" />}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-violet-500">
          Summary not available yet. Regenerate minutes to get the summary.
        </p>
      )}
    </div>
  )
}

function Section({ title, content, color }: { title: string; content: string; color: keyof typeof SECTION_STYLES }) {
  const c = SECTION_STYLES[color]
  return (
    <div className={`rounded-md border ${c.border} ${c.bg} p-4`}>
      <h2 className={`mb-2 text-xs font-semibold ${c.title}`}>{title}</h2>
      <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">{content}</p>
    </div>
  )
}
