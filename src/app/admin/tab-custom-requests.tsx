'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Clock, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { CustomIndustryRequestStatus } from '@/lib/supabase/types'

interface CustomRequest {
  id: string; custom_industry: string | null; detected_industry: string | null
  custom_meeting_type: string | null; selected_industry: string | null
  selected_meeting_type: string | null; status: CustomIndustryRequestStatus
  admin_notes: string | null; created_at: string; user_name: string | null
}

interface Props {
  requests: CustomRequest[]
  onUpdateStatus: (id: string, status: CustomIndustryRequestStatus, notes: string) => Promise<void>
}

const BADGE_STYLE: Record<CustomIndustryRequestStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  reviewed: 'border-blue-200 bg-blue-50 text-blue-700',
  template_created: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  dismissed: 'border-zinc-200 bg-zinc-50 text-zinc-500',
}

function fmtDate(v: string) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function TabCustomRequests({ requests, onUpdateStatus }: Props) {
  const [editId, setEditId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()

  function update(id: string, status: CustomIndustryRequestStatus) {
    startTransition(async () => {
      try { await onUpdateStatus(id, status, notes); toast.success('Updated'); setEditId(null); setNotes('') }
      catch { toast.error('Failed to update') }
    })
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-white/92 px-6 py-12 text-center">
        <Clock className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm text-muted-foreground">No custom requests yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Custom Requests</h3>
        <Badge variant="secondary">{requests.length} total</Badge>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">User</th>
              <th className="px-4 py-3 text-left font-medium">Industry</th>
              <th className="px-4 py-3 text-left font-medium">Meeting Type</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {requests.map(r => (
              <tr key={r.id} className="bg-white/80">
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-3">{r.user_name ?? 'Unknown'}</td>
                <td className="px-4 py-3">
                  {r.custom_industry ?? r.selected_industry ?? '—'}
                  {r.detected_industry && <p className="text-xs text-muted-foreground">Detected: {r.detected_industry}</p>}
                </td>
                <td className="px-4 py-3">{r.custom_meeting_type ?? r.selected_meeting_type ?? '—'}</td>
                <td className="px-4 py-3"><Badge variant="outline" className={BADGE_STYLE[r.status]}>{r.status}</Badge></td>
                <td className="px-4 py-3">
                  {editId === r.id ? (
                    <div className="space-y-2">
                      <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes..." className="min-h-[50px] text-xs" />
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" disabled={isPending} onClick={() => update(r.id, 'reviewed')} className="h-7 gap-1 text-xs">
                          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}<CheckCircle2 className="h-3 w-3" /> Review
                        </Button>
                        <Button size="sm" variant="outline" disabled={isPending} onClick={() => update(r.id, 'dismissed')} className="h-7 gap-1 text-xs">
                          <X className="h-3 w-3" /> Dismiss
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)} className="h-7 text-xs">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      disabled={r.status === 'template_created' || r.status === 'dismissed'}
                      onClick={() => { setEditId(r.id); setNotes(r.admin_notes ?? '') }}>
                      Review
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
