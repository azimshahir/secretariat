import { AppShell } from '@/components/app-shell'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { requireAuthedAppContext } from '@/lib/authenticated-app'

function buildDiffPreview(oldText: string, newText: string) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const removed = oldLines
    .filter(line => line.trim() && !newLines.includes(line))
    .slice(0, 4)
  const added = newLines
    .filter(line => line.trim() && !oldLines.includes(line))
    .slice(0, 4)
  return { removed, added }
}

export default async function AuditPage() {
  const { supabase, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  const { data: auditLogs } = await supabase
    .from('audit_logs')
    .select('id, action, details, created_at, meetings(title), user_id')
    .order('created_at', { ascending: false })
    .limit(200)

  const { data: versions } = await supabase
    .from('minute_versions')
    .select('id, minute_id, content, version, change_summary, created_at')
    .order('created_at', { ascending: false })
    .limit(120)
  const minuteIds = [...new Set((versions ?? []).map(version => version.minute_id))]
  const { data: minutes } =
    minuteIds.length > 0
      ? await supabase
          .from('minutes')
          .select('id, content, agendas(agenda_no, title, meetings(title))')
          .in('id', minuteIds)
      : { data: [] }
  const minuteMap = new Map((minutes ?? []).map(item => [item.id, item]))

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committees}
      eyebrow="Compliance"
      title="Audit and version history"
      description="Monitor immutable activity, review minute edits, and surface change deltas in a cleaner review workspace built for governance stakeholders."
      containerClassName="max-w-[1500px]"
    >
      <Card>
        <CardHeader>
          <CardTitle>Immutable activity log</CardTitle>
          <CardDescription>
            Chronological record of uploads, generation, edits, finalization,
            and purge events.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[0.72rem] uppercase tracking-[0.22em] text-muted-foreground">
                <th className="py-3 pr-4">Timestamp</th>
                <th className="py-3 pr-4">Action</th>
                <th className="py-3 pr-4">Meeting</th>
                <th className="py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {(auditLogs ?? []).map(log => (
                <tr key={log.id} className="border-b border-border/50 last:border-b-0">
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString('en-MY')}
                  </td>
                  <td className="py-3 pr-4 font-medium">{log.action}</td>
                  <td className="py-3 pr-4">
                    {(log.meetings as unknown as { title: string } | null)?.title ??
                      '-'}
                  </td>
                  <td className="py-3 text-xs text-muted-foreground">
                    {JSON.stringify(log.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Version control history</CardTitle>
          <CardDescription>
            Diff preview between stored historical versions and the current
            minute content.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(versions ?? []).map(version => {
            const current = minuteMap.get(version.minute_id)
            const agenda = current?.agendas as
              | {
                  agenda_no: string
                  title: string
                  meetings: { title: string }
                }
              | undefined
            const diff = buildDiffPreview(version.content, current?.content ?? '')

            return (
              <div
                key={version.id}
                className="rounded-[24px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,251,250,0.94))] p-4"
              >
                <p className="text-sm font-medium text-foreground">
                  {agenda?.meetings?.title ?? 'Meeting'} - Agenda{' '}
                  {agenda?.agenda_no ?? '-'}: {agenda?.title ?? 'Unknown Agenda'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  v{version.version} - {version.change_summary ?? 'Update'} -{' '}
                  {new Date(version.created_at).toLocaleString('en-MY')}
                </p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-[22px] border border-red-200 bg-red-50/70 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-red-700">
                      Removed
                    </p>
                    <p className="whitespace-pre-wrap text-xs leading-6 text-red-900/85">
                      {diff.removed.join('\n') || 'No removed lines in preview.'}
                    </p>
                  </div>
                  <div className="rounded-[22px] border border-emerald-200 bg-emerald-50/70 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      Added
                    </p>
                    <p className="whitespace-pre-wrap text-xs leading-6 text-emerald-950/80">
                      {diff.added.join('\n') || 'No added lines in preview.'}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </AppShell>
  )
}
