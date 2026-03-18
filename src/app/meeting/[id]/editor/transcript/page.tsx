import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function TranscriptPage({
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

  const { data: minute } = await supabase
    .from('minutes')
    .select('prompt_1_output')
    .eq('agenda_id', agendaId)
    .eq('is_current', true)
    .single()

  const transcript = minute?.prompt_1_output ?? 'No cleaned transcript available.'

  return (
    <div className="min-h-screen bg-white p-8 dark:bg-zinc-950">
      <h1 className="mb-4 text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
        Cleaned Transcript
      </h1>
      <p className="mb-4 text-[11px] text-blue-600/70 dark:text-blue-400/70">
        AI-cleaned transcript cross-referenced with attached PDF and RAG documents. Verify key terms and definitions.
      </p>
      <div className="whitespace-pre-wrap rounded-md border border-blue-200 bg-zinc-50 p-4 text-xs leading-5 dark:border-blue-900/40 dark:bg-zinc-900">
        {transcript}
      </div>
    </div>
  )
}
