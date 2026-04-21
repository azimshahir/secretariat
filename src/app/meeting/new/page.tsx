import Link from 'next/link'

import { AppShell } from '@/components/app-shell'
import { MeetingCreateForm } from '@/components/meeting-create-form'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'

interface NewMeetingPageProps {
  searchParams: Promise<{
    committee?: string
    createdSecretariat?: string
  }>
}

export default async function NewMeetingPage({
  searchParams,
}: NewMeetingPageProps) {
  const { committees, profile } = await requireAuthedAppContext()
  const { committee: selectedCommitteeId, createdSecretariat } =
    await searchParams

  if (committees.length === 0) {
    return <AppShell
      profile={profile}
      committees={committees}
      eyebrow="Workspace"
      title="Create a secretariat first"
      description="Meetings must be created under a secretariat. Start there, then return here."
      actions={
        <Button asChild size="sm">
          <Link href="/secretariat/new?first=1">Create your first secretariat</Link>
        </Button>
      }
      containerClassName="max-w-4xl"
      initialBuildId={getActiveBuildId()}
    >
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Meeting creation is locked</CardTitle>
          <CardDescription>
            You do not have any accessible secretariat yet. Once a secretariat
            exists, `New Meeting` will be enabled automatically.
          </CardDescription>
        </CardHeader>
      </Card>
    </AppShell>
  }

  const selectedCommittee = selectedCommitteeId
    ? committees.find(committee => committee.id === selectedCommitteeId) ?? null
    : committees.length === 1
      ? committees[0]
      : null
  const currentYear = new Date().getFullYear()

  return (
    <AppShell
      profile={profile}
      committees={committees}
      eyebrow="Workspace"
      title={
        selectedCommittee
          ? `Create a meeting for ${selectedCommittee.name}`
          : 'Create a meeting under a secretariat'
      }
      description={
        selectedCommittee
          ? 'Your workspace is ready. Create the first meeting record under it and continue directly into agenda setup, transcript mapping, and minute generation.'
          : 'Choose the secretariat first, then create the meeting record and continue into agenda setup, transcript mapping, and AI-assisted minute generation.'
      }
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to dashboard</Link>
        </Button>
      }
      containerClassName="max-w-5xl"
      initialBuildId={getActiveBuildId()}
    >
      {createdSecretariat === '1' && selectedCommittee ? (
        <div className="mx-auto w-full max-w-2xl rounded-[22px] border border-emerald-200 bg-emerald-50/90 px-5 py-4 text-sm text-emerald-900 shadow-[0_18px_40px_-32px_rgba(16,185,129,0.45)]">
          <p className="font-medium">
            {selectedCommittee.name} workspace is ready.
          </p>
          <p className="mt-1 text-emerald-800/85">
            Next step: create the first meeting under this workspace.
          </p>
        </div>
      ) : null}

      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>
            {selectedCommittee
              ? `New meeting for ${selectedCommittee.name}`
              : 'New meeting'}
          </CardTitle>
          <CardDescription>
            {selectedCommittee
              ? 'Create the meeting shell first, then refine agenda, transcript, and minute generation from the workspace dashboard.'
              : 'Create the shell first, then refine agenda, transcript, and MoM generation from the workspace dashboard.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MeetingCreateForm
            committees={committees.map(committee => ({
              id: committee.id,
              name: committee.name,
            }))}
            selectedCommitteeId={selectedCommittee?.id}
            titlePlaceholder={
              selectedCommittee
                ? `e.g., ${selectedCommittee.name} Meeting No. 3/${currentYear}`
                : `e.g., ALCO Meeting No. 3/${currentYear}`
            }
          />
        </CardContent>
      </Card>
    </AppShell>
  )
}
