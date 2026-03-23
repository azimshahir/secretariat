'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { LayoutDashboard, Users, BarChart3, Building2, Bot, ScrollText, Inbox } from 'lucide-react'
import type { AiProvider, AiTask, EffectiveAiConfig } from '@/lib/ai/catalog'
import { TabOverview } from './tab-overview'
import { TabUsers } from './tab-users'
import { TabSubscription } from './tab-subscription'
import { TabCommittees } from './tab-committees'
import { AiModelSettings } from './ai-model-settings'
import { TabAuditLogs } from './tab-audit-logs'
import { TabCustomRequests } from './tab-custom-requests'
import type { CustomIndustryRequestStatus } from '@/lib/supabase/types'

interface AuditEntry { id: string; action: string; created_at: string; user_name: string | null }
interface AuditLog { id: string; action: string; details: Record<string, unknown>; created_at: string; meeting_title: string | null; user_name: string | null }
interface OrgUser { id: string; full_name: string; email: string; role: string; plan: string; created_at: string }
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
  planBreakdown: { free: number; pro: number; max: number }
  monthlyMeetings: MonthlyMeetings[]
  // committees
  committees: CommitteeData[]
  categories: string[]
  // ai model
  aiConfigs: Record<AiTask, EffectiveAiConfig>
  aiOptions: Record<AiProvider, string[]>
  // audit
  auditLogs: AuditLog[]
  // custom requests
  customRequests: CustomRequestData[]
  onUpdateCustomRequestStatus: (id: string, status: CustomIndustryRequestStatus, notes: string) => Promise<void>
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
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') ?? 'overview'

  return (
    <Tabs value={activeTab} onValueChange={v => router.push(`/admin?tab=${v}`, { scroll: false })}>
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
        <TabCustomRequests
          requests={props.customRequests}
          onUpdateStatus={props.onUpdateCustomRequestStatus}
        />
      </TabsContent>
      <TabsContent value="ai-model" className="mt-6">
        <AiModelSettings initialConfigs={props.aiConfigs} options={props.aiOptions} />
      </TabsContent>
      <TabsContent value="audit-logs" className="mt-6">
        <TabAuditLogs logs={props.auditLogs} />
      </TabsContent>
    </Tabs>
  )
}
