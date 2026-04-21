import { AppShell } from '@/components/app-shell'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'
import { INDUSTRY_CATEGORIES } from '@/lib/ai/persona-templates'
import { getUserEntitlementSnapshot } from '@/lib/subscription/entitlements'
import { AccountSection } from './account-section'
import { PlanSection } from './plan-section'
import { CommitteeSettingsCard } from './committee-settings-card'
import Link from 'next/link'

const CATEGORY_COLORS: Record<string, string> = {
  'Banking': 'bg-blue-100 text-blue-700',
  'Construction & Property': 'bg-amber-100 text-amber-700',
  'Oil & Gas': 'bg-orange-100 text-orange-700',
  'NGOs & Foundations': 'bg-emerald-100 text-emerald-700',
  'Others': 'bg-zinc-100 text-zinc-700',
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ committee?: string }>
}) {
  const { supabase, user, profile, committees: allCommittees } =
    await requireAuthedAppContext()
  const { committee: focusedId } = await searchParams

  // Only show secretariats created by this user
  const committees = allCommittees.filter(c => c.created_by === user.id)

  const { count: totalMeetings } = await supabase
    .from('meetings').select('*', { count: 'exact', head: true })
    .eq('created_by', user.id)
  const entitlement = await getUserEntitlementSnapshot({
    userId: user.id,
    organizationId: profile.organization_id,
  })

  const committeeIds = committees.map(c => c.id)
  const { data: templates } =
    committeeIds.length > 0
      ? await supabase
          .from('format_templates')
          .select('*')
          .in('committee_id', committeeIds)
          .order('created_at', { ascending: false })
      : { data: [] }
  const { data: glossary } =
    committeeIds.length > 0
      ? await supabase
          .from('glossary')
          .select('*')
          .in('committee_id', committeeIds)
          .order('acronym')
      : { data: [] }
  const { data: memberships } =
    committeeIds.length > 0
      ? await supabase
          .from('committee_memberships')
          .select('committee_id, user_id, role, created_at')
          .in('committee_id', committeeIds)
          .order('created_at', { ascending: true })
      : { data: [] }
  const { data: invitations } =
    committeeIds.length > 0
      ? await supabase
          .from('committee_invitations')
          .select('committee_id, email, status, created_at, accepted_at')
          .in('committee_id', committeeIds)
          .order('created_at', { ascending: false })
      : { data: [] }

  const memberIds = Array.from(
    new Set((memberships ?? []).map(row => row.user_id).filter(Boolean))
  )
  const { data: memberProfiles } =
    memberIds.length > 0
      ? await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', memberIds)
      : { data: [] }

  type TemplateRow = { id: string; committee_id: string; name: string; prompt_text: string }
  type GlossaryRow = { id: string; committee_id: string; acronym: string; full_meaning: string }
  type MembershipRow = {
    committee_id: string
    user_id: string
    role: 'operator'
    created_at: string
  }
  type InvitationRow = {
    committee_id: string
    email: string
    status: 'pending' | 'accepted' | 'revoked' | 'expired'
    created_at: string
    accepted_at: string | null
  }

  const templatesByCommittee = new Map<string, TemplateRow[]>()
  for (const t of (templates ?? []) as TemplateRow[]) {
    const arr = templatesByCommittee.get(t.committee_id) ?? []
    arr.push(t)
    templatesByCommittee.set(t.committee_id, arr)
  }
  const glossaryByCommittee = new Map<string, GlossaryRow[]>()
  for (const g of (glossary ?? []) as GlossaryRow[]) {
    const arr = glossaryByCommittee.get(g.committee_id) ?? []
    arr.push(g)
    glossaryByCommittee.set(g.committee_id, arr)
  }
  const profileMap = new Map(
    (memberProfiles ?? []).map(profileRow => [profileRow.id, profileRow.full_name])
  )
  const membershipsByCommittee = new Map<
    string,
    {
      user_id: string
      full_name: string
      role: 'operator'
      created_at: string
    }[]
  >()
  for (const membership of (memberships ?? []) as MembershipRow[]) {
    const arr = membershipsByCommittee.get(membership.committee_id) ?? []
    arr.push({
      user_id: membership.user_id,
      full_name: profileMap.get(membership.user_id) ?? 'Unknown user',
      role: membership.role,
      created_at: membership.created_at,
    })
    membershipsByCommittee.set(membership.committee_id, arr)
  }
  const invitationsByCommittee = new Map<string, InvitationRow[]>()
  for (const invitation of (invitations ?? []) as InvitationRow[]) {
    const arr = invitationsByCommittee.get(invitation.committee_id) ?? []
    arr.push(invitation)
    invitationsByCommittee.set(invitation.committee_id, arr)
  }

  return (
    <AppShell
      profile={profile}
      committees={committees}
      eyebrow="Account"
      title="Settings"
      description="Manage your account, subscription, accessible secretariats, playbooks, glossary, and operator access."
      containerClassName="max-w-[1400px]"
      initialBuildId={getActiveBuildId()}
    >
      <div className="grid gap-6">
        {/* Account & Security */}
        <AccountSection fullName={profile.full_name} email={user.email ?? ''} />

        <Separator />

        {/* Billing & Subscription */}
        <PlanSection
          plan={profile.plan ?? 'free'}
          entitlement={entitlement}
          totalMeetings={totalMeetings ?? 0}
        />

        <Separator />

        {/* Committee Settings */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Accessible Secretariats</h2>
            <p className="text-sm text-muted-foreground">
              Secretariats you created or were assigned to. Operator access is
              managed per secretariat.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/secretariat/new">New Secretariat</Link>
          </Button>
        </div>

        {committees.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No secretariats yet. Create one first, then meetings and operator
            invites can be managed here.
          </p>
        )}

        {INDUSTRY_CATEGORIES.map(cat => {
          const items = committees.filter(c => (c.category ?? 'Others') === cat)
          if (items.length === 0) return null
          return (
            <div key={cat} className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge className={CATEGORY_COLORS[cat] ?? ''}>{cat}</Badge>
                <span className="text-xs text-muted-foreground">{items.length} committee{items.length > 1 ? 's' : ''}</span>
              </div>
              {items.map(c => (
                <CommitteeSettingsCard
                  key={c.id}
                  committee={c}
                  templates={templatesByCommittee.get(c.id) ?? []}
                  glossary={glossaryByCommittee.get(c.id) ?? []}
                  members={membershipsByCommittee.get(c.id) ?? []}
                  invitations={invitationsByCommittee.get(c.id) ?? []}
                  defaultTab={focusedId === c.id ? 'profile' : undefined}
                />
              ))}
            </div>
          )
        })}
      </div>
    </AppShell>
  )
}
