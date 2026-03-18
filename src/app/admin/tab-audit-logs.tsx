'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

interface AuditLog {
  id: string
  action: string
  details: Record<string, unknown>
  created_at: string
  meeting_title: string | null
  user_name: string | null
}

export function TabAuditLogs({ logs }: { logs: AuditLog[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit Log</CardTitle>
        <CardDescription>
          Chronological record of all admin and user actions.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[0.72rem] uppercase tracking-[0.22em] text-muted-foreground">
              <th className="py-3 pr-4">Timestamp</th>
              <th className="py-3 pr-4">User</th>
              <th className="py-3 pr-4">Action</th>
              <th className="py-3 pr-4">Meeting</th>
              <th className="py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="border-b border-border/50 last:border-b-0">
                <td className="py-3 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString('en-MY')}
                </td>
                <td className="py-3 pr-4 text-xs">{log.user_name ?? '-'}</td>
                <td className="py-3 pr-4 font-medium">{log.action.replaceAll('_', ' ')}</td>
                <td className="py-3 pr-4 text-xs">{log.meeting_title ?? '-'}</td>
                <td className="py-3 text-xs text-muted-foreground max-w-[300px] truncate">
                  {JSON.stringify(log.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No audit logs yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
