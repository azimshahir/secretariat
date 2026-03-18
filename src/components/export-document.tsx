interface AgendaMinute {
  agendaNo: string
  title: string
  content: string
}

interface ActionItemRow {
  agendaNo: string
  description: string
  pic: string | null
}

interface ExportDocumentProps {
  title: string
  meetingDate: string
  committeeName: string
  agendas: AgendaMinute[]
  actionItems: ActionItemRow[]
}

export function ExportDocument({
  title,
  meetingDate,
  committeeName,
  agendas,
  actionItems,
}: ExportDocumentProps) {
  return (
    <div className="space-y-6">
      <header className="rounded-[30px] border border-border/70 bg-white/94 p-6 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.42)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.24em] text-primary/65">Final Minutes</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.05em]">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {committeeName} • {new Date(meetingDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </header>

      <section className="rounded-[30px] border border-border/70 bg-white/94 p-6 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.42)] backdrop-blur">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.04em]">Full Document Preview</h2>
        <div className="mt-4 space-y-6">
          {agendas.map(agenda => (
            <article key={`${agenda.agendaNo}-${agenda.title}`} className="border-t pt-4 first:border-t-0 first:pt-0">
              <h3 className="text-base font-semibold">
                Agenda {agenda.agendaNo}: {agenda.title}
              </h3>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                {agenda.content || 'No minutes generated for this agenda yet.'}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[30px] border border-border/70 bg-white/94 p-6 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.42)] backdrop-blur">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.04em]">Action Item Summary</h2>
        {actionItems.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No action items extracted yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-zinc-500">
                  <th className="py-2 pr-4">No. Agenda</th>
                  <th className="py-2 pr-4">Tugasan</th>
                  <th className="py-2">PIC</th>
                </tr>
              </thead>
              <tbody>
                {actionItems.map((item, i) => (
                  <tr key={`${item.agendaNo}-${i}`} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 align-top">{item.agendaNo}</td>
                    <td className="py-2 pr-4">{item.description}</td>
                    <td className="py-2">{item.pic ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
