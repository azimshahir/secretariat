import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'
import { AI_PROVIDER_MODELS } from '@/lib/ai/catalog'
import { getPlanAiConfigMatrixForOrganization } from '@/lib/ai/model-config'
import { getTranscriptIntelligencePresetForOrganization } from '@/lib/ai/transcript-intelligence-server'
import { INDUSTRY_CATEGORIES } from '@/lib/ai/persona-templates'
import { listCurrentMonthUsageForOrganization } from '@/lib/subscription/entitlements'
import { getSubscriptionSchemaCompatibility } from '@/lib/subscription/schema-compat'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminTabs } from './admin-tabs'

export default async function AdminPage() {
  const { supabase, user, profile, committees, activeSecretariats } =
    await requireAuthedAppContext()

  if (profile.role !== 'admin') redirect('/')

  const orgId = profile.organization_id
  const admin = createAdminClient()
  const subscriptionCompatibility = await getSubscriptionSchemaCompatibility({ organizationId: orgId })

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
  const profilesQuery = subscriptionCompatibility.profilesCreditBalanceAvailable
    ? admin
        .from('profiles')
        .select('id, full_name, role, plan, credit_balance, created_at')
        .eq('organization_id', orgId)
    : admin
        .from('profiles')
        .select('id, full_name, role, plan, created_at')
        .eq('organization_id', orgId)
  const { data: profiles, error: profilesError } = await profilesQuery.order('created_at')
  if (profilesError) {
    console.error('Failed to load organization users for admin dashboard', profilesError)
  }
  const userIds = (profiles ?? []).map(p => p.id)
  let emailMap: Record<string, string> = {}
  if (userIds.length > 0) {
    try {
      const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 })
      if (authData?.users) {
        emailMap = Object.fromEntries(authData.users.map(u => [u.id, u.email ?? '']))
      }
    } catch (error) {
      console.error('Failed to load auth user emails for admin dashboard', error)
    }
  }
  let usageRows = [] as Awaited<ReturnType<typeof listCurrentMonthUsageForOrganization>>
  if (subscriptionCompatibility.usageTrackingAvailable) {
    try {
      usageRows = await listCurrentMonthUsageForOrganization({ organizationId: orgId })
    } catch (error) {
      console.error('Failed to load subscription usage rows for admin dashboard', error)
      usageRows = []
    }
  }
  const usageByUserId = new Map(usageRows.map(row => [row.user_id, row]))
  const totalWalletCredits = subscriptionCompatibility.profilesCreditBalanceAvailable
    ? (profiles ?? []).reduce((sum, profileRow) => sum + ((profileRow as { credit_balance?: number | null }).credit_balance ?? 0), 0)
    : 0
  const totalCreditsConsumedThisMonth = usageRows.reduce((sum, row) => sum + (row.credits_consumed ?? 0), 0)

  const orgUsers = (profiles ?? []).map(p => ({
    id: p.id, full_name: p.full_name, email: emailMap[p.id] ?? '',
    role: p.role,
    plan: p.plan ?? 'free',
    credit_balance: subscriptionCompatibility.profilesCreditBalanceAvailable
      ? ((p as { credit_balance?: number | null }).credit_balance ?? 0)
      : 0,
    usage: usageByUserId.get(p.id) ?? null,
    created_at: p.created_at,
  }))

  if (!orgUsers.some(orgUser => orgUser.id === user.id)) {
    orgUsers.unshift({
      id: user.id,
      full_name: profile.full_name,
      email: user.email ?? '',
      role: profile.role,
      plan: profile.plan ?? 'free',
      credit_balance: subscriptionCompatibility.profilesCreditBalanceAvailable
        ? (typeof profile.credit_balance === 'number' ? profile.credit_balance : 0)
        : 0,
      usage: usageByUserId.get(user.id) ?? null,
      created_at: profile.created_at,
    })
  }

  // Plan breakdown for subscription tab
  const planBreakdown = { free: 0, basic: 0, pro: 0, premium: 0 }
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
  const { data: customRequests } = await admin
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

  let adminAiConfigs: Awaited<ReturnType<typeof getPlanAiConfigMatrixForOrganization>>
  try {
    adminAiConfigs = await getPlanAiConfigMatrixForOrganization(orgId)
  } catch (error) {
    console.error('Failed to load plan AI config matrix for admin dashboard', error)
    adminAiConfigs = await getPlanAiConfigMatrixForOrganization(null)
  }

  let transcriptPreset: Awaited<ReturnType<typeof getTranscriptIntelligencePresetForOrganization>>
  try {
    transcriptPreset = await getTranscriptIntelligencePresetForOrganization(orgId)
  } catch (error) {
    console.error('Failed to load transcript intelligence preset for admin dashboard', error)
    transcriptPreset = 'balanced'
  }

  return (
    <AppShell
      profile={profile}
      committees={activeSecretariats.length > 0 ? activeSecretariats : committeeList}
      eyebrow="Admin"
      title="Admin Dashboard"
      description="Manage users, subscriptions, committee knowledge bases, and organization-wide settings."
      containerClassName="max-w-[1500px]"
      initialBuildId={getActiveBuildId()}
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
          totalWalletCredits={totalWalletCredits}
          totalCreditsConsumedThisMonth={totalCreditsConsumedThisMonth}
          monthlyMeetings={monthlyMeetings}
          committees={committeesData}
          categories={[...INDUSTRY_CATEGORIES]}
          aiConfigs={adminAiConfigs}
          transcriptPreset={transcriptPreset}
          aiOptions={AI_PROVIDER_MODELS}
          auditLogs={formattedLogs}
          customRequests={customRequestsFormatted}
          subscriptionSetupPending={subscriptionCompatibility.subscriptionSetupPending}
          planAiSetupPending={!subscriptionCompatibility.planAiMatrixAvailable}
        />
      </Suspense>
    </AppShell>
  )
}
