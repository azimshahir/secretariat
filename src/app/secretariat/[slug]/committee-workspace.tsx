'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  Clock3,
  FileStack,
  MessageSquareText,
  Settings2,
} from 'lucide-react'

import {
  DashboardPill,
  DashboardSectionIntro,
  DashboardSurface,
} from '@/components/dashboard-primitives'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MeetingTable } from '@/components/meeting-table'
import type { CommitteeSpeaker } from '@/lib/committee-speakers'
import type { Committee, MeetingStatus } from '@/lib/supabase/types'
import type { CommitteeRagDocumentSummary } from '@/app/meeting/[id]/setup/rag-types'
import { MatchSpeakerSection } from '@/app/meeting/[id]/setup/match-speaker-section'
import { RagTab } from '@/app/meeting/[id]/setup/rag-tab'
import { RulesSection } from '@/app/meeting/[id]/setup/rules-section'
import { SettingsTemplateTab } from '@/app/meeting/[id]/setup/settings-template-tab'
import type { TemplateGroup } from '@/app/meeting/[id]/setup/settings-template-model'
import { CommitteeChatbot } from './committee-chatbot'

export type CommitteeWorkspaceTab = 'meetings' | 'chatbot' | 'settings'
type MeetingRegisterStatus = MeetingStatus | 'done'

interface CommitteeWorkspaceMeetingRow {
  id: string
  title: string
  meeting_date: string
  status: MeetingStatus
  registerStatus: MeetingRegisterStatus
  committee_name: string | null
}

interface LatestFormattingUpdate {
  savedAt: string
  sourceMeetingId: string | null
  sourceMeetingTitle: string | null
  sourceMeetingDate: string | null
}

interface CommitteeWorkspaceProps {
  committeeId: string
  committeeName: string
  committeeSlug: string
  committees: Committee[]
  initialTab: CommitteeWorkspaceTab
  meetings: CommitteeWorkspaceMeetingRow[]
  initialMinuteInstruction: string
  initialTemplateGroups: TemplateGroup[]
  initialSpeakers: CommitteeSpeaker[]
  initialRagDocuments: CommitteeRagDocumentSummary[]
  latestFormattingUpdate: LatestFormattingUpdate | null
}

function isCommitteeWorkspaceTab(
  value: string | null | undefined
): value is CommitteeWorkspaceTab {
  return value === 'meetings' || value === 'chatbot' || value === 'settings'
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function LatestFormattingUpdateCard({
  latestFormattingUpdate,
}: {
  latestFormattingUpdate: LatestFormattingUpdate | null
}) {
  return (
    <DashboardSurface tone="muted" padding="md">
      <DashboardSectionIntro
        eyebrow="Formatting default"
        title="Latest Committee Snapshot"
        description="The newest Step 2 formatting baseline saved through Save as Committee Default for future meetings in this committee."
        compact
        actions={(
          <DashboardPill tone="primary">
            <Clock3 className="h-3.5 w-3.5" />
            Committee-wide
          </DashboardPill>
        )}
      />

      <div className="mt-4">
        {latestFormattingUpdate ? (
          <div className="space-y-3">
            <div className="rounded-[18px] border border-border/70 bg-white/90 px-4 py-3.5 shadow-sm">
              <p className="text-sm font-semibold text-foreground">
                Saved on {formatDateTime(latestFormattingUpdate.savedAt)}
              </p>
              {latestFormattingUpdate.sourceMeetingTitle ? (
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  Source meeting: {latestFormattingUpdate.sourceMeetingTitle}
                  {latestFormattingUpdate.sourceMeetingDate
                    ? ` • ${formatDate(latestFormattingUpdate.sourceMeetingDate)}`
                    : ''}
                </p>
              ) : (
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  The original source meeting is no longer available, but the committee default snapshot is still stored for reuse.
                </p>
              )}
            </div>

            {latestFormattingUpdate.sourceMeetingId &&
            latestFormattingUpdate.sourceMeetingTitle ? (
              <Button asChild variant="outline" className="gap-2 rounded-[12px]">
                <Link
                  href={`/meeting/${latestFormattingUpdate.sourceMeetingId}/setup?tab=generate`}
                >
                  <FileStack className="h-4 w-4" />
                  Open Source Meeting
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[18px] border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
            No committee formatting default has been saved yet.
          </div>
        )}
      </div>
    </DashboardSurface>
  )
}

export function CommitteeWorkspace({
  committeeId,
  committeeName,
  committeeSlug,
  committees,
  initialTab,
  meetings,
  initialMinuteInstruction,
  initialTemplateGroups,
  initialSpeakers,
  initialRagDocuments,
  latestFormattingUpdate,
}: CommitteeWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<CommitteeWorkspaceTab>(initialTab)
  const [templateGroups, setTemplateGroups] =
    useState<TemplateGroup[]>(initialTemplateGroups)
  const [speakers, setSpeakers] = useState<CommitteeSpeaker[]>(initialSpeakers)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const current = new URL(window.location.href)
    if (activeTab === 'meetings') {
      current.searchParams.delete('tab')
    } else {
      current.searchParams.set('tab', activeTab)
    }

    const nextHref = `${current.pathname}${current.search}${current.hash}`
    const existingHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextHref !== existingHref) {
      window.history.replaceState(window.history.state, '', nextHref)
    }
  }, [activeTab])

  return (
    <Tabs
      value={activeTab}
      onValueChange={value => setActiveTab(value as CommitteeWorkspaceTab)}
      className="gap-5"
    >
      <DashboardSurface tone="muted" padding="sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70">
              Committee workspace
            </p>
            <div>
              <h2 className="font-display text-[1.2rem] font-semibold tracking-[-0.04em] text-foreground">
                Work Modes For {committeeName}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Move between the live meeting register, committee chatbot, and committee-wide defaults without leaving the workspace.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="inline-flex w-max gap-1 rounded-full bg-white/95 p-1 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.24)]">
                <TabsTrigger
                  value="meetings"
                  className="h-8 flex-none gap-1.5 px-3 text-xs sm:text-sm"
                >
                  <FileStack className="h-3.5 w-3.5" />
                  Meeting List
                </TabsTrigger>
                <TabsTrigger
                  value="chatbot"
                  className="h-8 flex-none gap-1.5 px-3 text-xs sm:text-sm"
                >
                  <MessageSquareText className="h-3.5 w-3.5" />
                  Chatbot
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="h-8 flex-none gap-1.5 px-3 text-xs sm:text-sm"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>
            <DashboardPill>{meetings.length} meeting record{meetings.length === 1 ? '' : 's'}</DashboardPill>
          </div>
        </div>
      </DashboardSurface>

      {activeTab === 'meetings' ? (
        <TabsContent value="meetings" className="mt-0">
          <MeetingTable
            meetings={meetings}
            committees={committees}
            activeCommitteeId={committeeId}
          />
        </TabsContent>
      ) : null}

      {activeTab === 'chatbot' ? (
        <TabsContent value="chatbot" className="mt-0">
          <CommitteeChatbot
            committeeId={committeeId}
            committeeName={committeeName}
          />
        </TabsContent>
      ) : null}

      {activeTab === 'settings' ? (
        <TabsContent value="settings" className="mt-0">
          <div className="space-y-5">
            <DashboardSurface tone="muted" padding="md">
              <DashboardSectionIntro
                eyebrow="Committee defaults"
                title="Rules, formatting, speakers, and reference context"
                description="Use this space for standing committee behaviour. Meeting-specific overrides still belong inside each meeting setup screen."
                compact
              />
            </DashboardSurface>

            <LatestFormattingUpdateCard
              latestFormattingUpdate={latestFormattingUpdate}
            />
            <RulesSection
              mode="committee"
              committeeId={committeeId}
              initialInstruction={initialMinuteInstruction}
            />
            <SettingsTemplateTab
              scope="committee"
              committeeId={committeeId}
              groups={templateGroups}
              onGroupsChange={setTemplateGroups}
            />
            <MatchSpeakerSection
              scope="committee"
              committeeId={committeeId}
              initialSpeakers={speakers}
              onSpeakersChange={setSpeakers}
            />
            <RagTab
              committeeId={committeeId}
              initialDocuments={initialRagDocuments}
            />

            <DashboardSurface tone="muted" padding="sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <p className="text-sm leading-6 text-muted-foreground">
                  Meeting-level overrides remain available inside each meeting setup screen and will not overwrite the committee defaults managed here.
                </p>
                <Button asChild variant="outline" className="rounded-[12px]">
                  <Link
                    href={`/secretariat/${committeeSlug}`}
                    onClick={event => {
                      event.preventDefault()
                      setActiveTab('meetings')
                    }}
                  >
                    Back To Meeting List
                  </Link>
                </Button>
              </div>
            </DashboardSurface>
          </div>
        </TabsContent>
      ) : null}
    </Tabs>
  )
}

export function normalizeCommitteeWorkspaceTab(
  value: string | null | undefined
): CommitteeWorkspaceTab {
  return isCommitteeWorkspaceTab(value) ? value : 'meetings'
}
