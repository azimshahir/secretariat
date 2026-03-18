'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, CalendarDays, Building2, Activity } from 'lucide-react'

interface AuditEntry {
  id: string
  action: string
  created_at: string
  user_name: string | null
}

interface Props {
  totalUsers: number
  totalMeetings: number
  activeMeetings: number
  totalCommittees: number
  recentActivity: AuditEntry[]
}

const stats = (p: Props) => [
  { label: 'Total Users', value: p.totalUsers, icon: Users, color: 'text-blue-600 bg-blue-100' },
  { label: 'Total Meetings', value: p.totalMeetings, icon: CalendarDays, color: 'text-emerald-600 bg-emerald-100' },
  { label: 'Active Meetings', value: p.activeMeetings, icon: Activity, color: 'text-amber-600 bg-amber-100' },
  { label: 'Committees', value: p.totalCommittees, icon: Building2, color: 'text-purple-600 bg-purple-100' },
]

export function TabOverview(props: Props) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats(props).map(s => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 py-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.color}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-semibold tracking-tight">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {props.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="space-y-2">
              {props.recentActivity.map(entry => (
                <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{entry.action.replaceAll('_', ' ')}</p>
                    <p className="text-xs text-muted-foreground">{entry.user_name ?? 'System'}</p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString('en-MY')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
