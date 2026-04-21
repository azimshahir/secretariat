'use client'

import { useSearchParams } from 'next/navigation'
import { useNavigationTransition } from '@/components/navigation-transition-provider'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { LayoutDashboard, Users, BarChart3, Building2, Bot, ScrollText, Inbox } from 'lucide-react'
import type { AdminAiTask, AiProvider, EffectiveAiConfig } from '@/lib/ai/catalog'
import type { TranscriptIntelligencePreset } from '@/lib/ai/transcript-intelligence'
import type { PlanTier, UserSubscriptionUsageMonthly } from '@/lib/supabase/types'
import { TabOverview } from './tab-overview'
import { TabUsers } from './tab-users'
import { TabSubscription } from './tab-subscription'
import { TabCommittees } from './tab-committees'
import { AiModelSettings } from './ai-model-settings'
import { TranscriptIntelligenceSettings } from './transcript-intelligence-settings'
import { TabAuditLogs } from './tab-audit-logs'
import { TabCustomRequests } from './tab-custom-requests'
import type { CustomIndustryRequestStatus } from '@/lib/supabase/types'

interface AuditEntry { id: string; action: string; created_at: string; user_name: string | null }
interface AuditLog { id: string; action: string; details: Record<string, unknown>; created_at: string; meeting_title: string | null; user_name: string | null }
interface OrgUser {
  id: string
  full_name: string
  email: string
  role: string
  plan: string
  credit_balance: number
  usage: UserSubscriptionUsageMonthly | null
  created_at: string
}
interface RagDoc { id: string; category: string; document_name: string; file_name: string; created_at: string }
interface CommitteeData { id: string; name: string; slug: string; category: string; persona_prompt: string | null; glossary_count: number; rag_docs: RagDoc[] }
interface MonthlyMeetings { month: string; count: number }

interface CustomRequestData {
  id: string
  custom_industry: string | null
  detected_industry: string | null
  custom_meeting_type: string | null
  selected_industry: string | null
  selected_meeting_type: string | null
  status: CustomIndustryRequestStatus
  admin_notes: string | null
  created_at: string
  user_name: string | null
}

interface Props {
  currentUserId: string
  // overview
  totalUsers: number
  totalMeetings: number
  activeMeetings: number
  meetingsThisMonth: number
  totalCommittees: number
  recentActivity: AuditEntry[]
  // users
  orgUsers: OrgUser[]
  // subscription
  planBreakdown: Record<PlanTier, number>
  totalWalletCredits: number
  totalCreditsConsumedThisMonth: number
  monthlyMeetings: MonthlyMeetings[]
  // committees
  committees: CommitteeData[]
  categories: string[]
  // ai model
  aiConfigs: Record<PlanTier, Record<AdminAiTask, EffectiveAiConfig>>
  transcriptPreset: TranscriptIntelligencePreset
  aiOptions: Record<AiProvider, string[]>
  // audit
  auditLogs: AuditLog[]
  // custom requests
  customRequests: CustomRequestData[]
  subscriptionSetupPending: boolean
  planAiSetupPending: boolean
}

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'users', label: 'Users', icon: Users },
  { value: 'subscription', label: 'Subscription', icon: BarChart3 },
  { value: 'committees', label: 'Committees', icon: Building2 },
  { value: 'custom-requests', label: 'Custom Requests', icon: Inbox },
  { value: 'ai-model', label: 'AI Model', icon: Bot },
  { value: 'audit-logs', label: 'Audit Logs', icon: ScrollText },
]

export function AdminTabs(props: Props) {
  const { push } = useNavigationTransition()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'overview'

  return (
    <Tabs value={activeTab} onValueChange={v => { push(`/admin?tab=${v}`, { scroll: false }) }}>
      <div className="space-y-4">
        {props.subscriptionSetupPending || props.planAiSetupPending ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {props.subscriptionSetupPending ? (
              <p>Usage and credits will appear once the latest subscription database update is ready.</p>
            ) : null}
            {props.planAiSetupPending ? (
              <p>Plan-based AI model settings need the latest database update before changes can be saved.</p>
            ) : null}
          </div>
        ) : null}
      <TabsList className="flex w-full flex-wrap gap-1">
        {TABS.map(t => (
          <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview" className="mt-6">
        <TabOverview
          totalUsers={props.totalUsers}
          totalMeetings={props.totalMeetings}
          activeMeetings={props.activeMeetings}
          totalCommittees={props.totalCommittees}
          recentActivity={props.recentActivity}
        />
      </TabsContent>
      <TabsContent value="users" className="mt-6">
        <TabUsers users={props.orgUsers} currentUserId={props.currentUserId} />
      </TabsContent>
      <TabsContent value="subscription" className="mt-6">
        <TabSubscription
          planBreakdown={props.planBreakdown}
          totalWalletCredits={props.totalWalletCredits}
          totalCreditsConsumedThisMonth={props.totalCreditsConsumedThisMonth}
          totalUsers={props.totalUsers}
          monthlyMeetings={props.monthlyMeetings}
          meetingsThisMonth={props.meetingsThisMonth}
          totalMeetings={props.totalMeetings}
        />
      </TabsContent>
      <TabsContent value="committees" className="mt-6">
        <TabCommittees committees={props.committees} categories={props.categories} />
      </TabsContent>
      <TabsContent value="custom-requests" className="mt-6">
        <TabCustomRequests requests={props.customRequests} />
      </TabsContent>
      <TabsContent value="ai-model" className="mt-6">
        <TranscriptIntelligenceSettings initialPreset={props.transcriptPreset} />
        <AiModelSettings initialConfigs={props.aiConfigs} options={props.aiOptions} />
      </TabsContent>
      <TabsContent value="audit-logs" className="mt-6">
        <TabAuditLogs logs={props.auditLogs} />
      </TabsContent>
      </div>
    </Tabs>
  )
}
