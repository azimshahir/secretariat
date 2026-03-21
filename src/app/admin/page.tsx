import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { updateCustomRequestStatus } from '@/actions/admin-custom-requests'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { AI_PROVIDER_MODELS } from '@/lib/ai/catalog'
import { getEffectiveAiConfigsForOrganization } from '@/lib/ai/model-config'
import { INDUSTRY_CATEGORIES } from '@/lib/ai/persona-templates'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminTabs } from './admin-tabs'

export default async function AdminPage() {
  const { supabase, user, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  if (profile.role !== 'admin') redirect('/')

  const orgId = profile.organization_id

  const committeeList = committees

  // Fetch glossary counts & RAG docs per committee
  const committeeIds = committeeList.map(c => c.id)
  const { data: glossaryRows } = committeeIds.length > 0
    ? await supabase.from('glossary').select('committee_id').in('committee_id', committeeIds)
    : { data: [] }
  const glossaryCounts: Record<string, number> = {}
  for (const g of glossaryRows ?? []) {
    glossaryCounts[g.committee_id] = (glossaryCounts[g.committee_id] ?? 0) + 1
  }

  const { data: ragDocs } = committeeIds.length > 0
    ? await supabase.from('committee_rag_documents')
        .select('id, committee_id, category, document_name, file_name, created_at')
        .in('committee_id', committeeIds)
        .order('created_at', { ascending: false })
    : { data: [] }
  const ragByCommittee: Record<string, typeof ragDocs> = {}
  for (const d of ragDocs ?? []) {
    ;(ragByCommittee[d.committee_id] ??= []).push(d)
  }

  const committeesData = committeeList.map(c => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    category: c.category ?? 'Others',
    persona_prompt: c.persona_prompt,
    glossary_count: glossaryCounts[c.id] ?? 0,
    rag_docs: (ragByCommittee[c.id] ?? []).map(d => ({
      id: d.id, category: d.category, document_name: d.document_name,
      file_name: d.file_name, created_at: d.created_at,
    })),
  }))

  // Fetch org users with emails
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role, plan, created_at')
    .order('created_at')
  const userIds = (profiles ?? []).map(p => p.id)
  let emailMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const admin = createAdminClient()
    const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (authData?.users) {
      emailMap = Object.fromEntries(authData.users.map(u => [u.id, u.email ?? '']))
    }
  }
  const orgUsers = (profiles ?? []).map(p => ({
    id: p.id, full_name: p.full_name, email: emailMap[p.id] ?? '',
    role: p.role, plan: p.plan ?? 'free', created_at: p.created_at,
  }))

  // Plan breakdown for subscription tab
  const planBreakdown = { free: 0, pro: 0, max: 0 }
  for (const p of profiles ?? []) {
    const plan = (p.plan ?? 'free') as keyof typeof planBreakdown
    if (plan in planBreakdown) planBreakdown[plan]++
    else planBreakdown.free++
  }

  // Meeting stats
  const { count: totalMeetings } = await supabase
    .from('meetings').select('*', { count: 'exact', head: true })
  const { count: activeMeetings } = await supabase
    .from('meetings').select('*', { count: 'exact', head: true })
    .in('status', ['draft', 'pending_setup', 'mapping', 'generating', 'in_progress'])
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const { count: meetingsThisMonth } = await supabase
    .from('meetings').select('*', { count: 'exact', head: true })
    .gte('created_at', startOfMonth.toISOString())

  // Monthly meetings for last 6 months (for chart)
  const monthlyMeetings: { month: string; count: number }[] = []
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const { count } = await supabase
      .from('meetings').select('*', { count: 'exact', head: true })
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
    monthlyMeetings.push({ month: MONTH_NAMES[d.getMonth()], count: count ?? 0 })
  }

  // Audit logs
  const { data: auditLogs } = await supabase
    .from('audit_logs')
    .select('id, action, details, created_at, meetings(title), user_id')
    .order('created_at', { ascending: false })
    .limit(100)
  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.full_name]))
  const formattedLogs = (auditLogs ?? []).map(log => ({
    id: log.id, action: log.action,
    details: (log.details ?? {}) as Record<string, unknown>,
    created_at: log.created_at,
    meeting_title: (log.meetings as unknown as { title: string } | null)?.title ?? null,
    user_name: (log.user_id ? profileMap[log.user_id] : null) ?? null,
  }))
  const recentActivity = formattedLogs.slice(0, 8).map(l => ({
    id: l.id, action: l.action, created_at: l.created_at, user_name: l.user_name,
  }))

  // Custom industry requests
  const admin2 = createAdminClient()
  const { data: customRequests } = await admin2
    .from('custom_industry_requests')
    .select('id, custom_industry, detected_industry, custom_meeting_type, selected_industry, selected_meeting_type, status, admin_notes, created_at, user_id')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  const customRequestsFormatted = (customRequests ?? []).map(req => ({
    id: req.id,
    custom_industry: req.custom_industry,
    detected_industry: req.detected_industry,
    custom_meeting_type: req.custom_meeting_type,
    selected_industry: req.selected_industry,
    selected_meeting_type: req.selected_meeting_type,
    status: req.status as 'pending' | 'reviewed' | 'template_created' | 'dismissed',
    admin_notes: req.admin_notes,
    created_at: req.created_at,
    user_name: (req.user_id ? profileMap[req.user_id] : null) ?? null,
  }))

  const aiConfigs = await getEffectiveAiConfigsForOrganization(orgId)

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committeeList}
      eyebrow="Admin"
      title="Admin Dashboard"
      description="Manage users, subscriptions, committee knowledge bases, and organization-wide settings."
      containerClassName="max-w-[1500px]"
    >
      <Suspense fallback={null}>
        <AdminTabs
          currentUserId={user.id}
          totalUsers={orgUsers.length}
          totalMeetings={totalMeetings ?? 0}
          activeMeetings={activeMeetings ?? 0}
          meetingsThisMonth={meetingsThisMonth ?? 0}
          totalCommittees={committeeList.length}
          recentActivity={recentActivity}
          orgUsers={orgUsers}
          planBreakdown={planBreakdown}
          monthlyMeetings={monthlyMeetings}
          committees={committeesData}
          categories={[...INDUSTRY_CATEGORIES]}
          aiConfigs={aiConfigs}
          aiOptions={AI_PROVIDER_MODELS}
          auditLogs={formattedLogs}
          customRequests={customRequestsFormatted}
          onUpdateCustomRequestStatus={updateCustomRequestStatus}
        />
      </Suspense>
    </AppShell>
  )
}
