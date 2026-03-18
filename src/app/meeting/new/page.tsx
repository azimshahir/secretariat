import Link from 'next/link'

import { AppShell } from '@/components/app-shell'
import { FormSubmitButton } from '@/components/form-submit-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createMeeting } from '@/actions/meeting'
import { requireAuthedAppContext } from '@/lib/authenticated-app'

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
          <form action={createMeeting} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="title" className="text-sm font-medium">
                Meeting Title
              </label>
              <Input
                id="title"
                name="title"
                placeholder={
                  selectedCommittee
                    ? `e.g., ${selectedCommittee.name} Meeting No. 3/${currentYear}`
                    : `e.g., ALCO Meeting No. 3/${currentYear}`
                }
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="meetingDate" className="text-sm font-medium">
                Meeting Date
              </label>
              <Input id="meetingDate" name="meetingDate" type="date" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="committeeId" className="text-sm font-medium">
                Secretariat
              </label>
              <select
                id="committeeId"
                name="committeeId"
                defaultValue={selectedCommittee?.id ?? ''}
                required
                className="h-11 rounded-2xl border border-border/80 bg-white/80 px-4 text-sm shadow-[0_12px_32px_-28px_rgba(15,23,42,0.45)] outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
              >
                <option value="" disabled>
                  Select a secretariat
                </option>
                {committees.map(committee => (
                  <option key={committee.id} value={committee.id}>
                    {committee.name}
                  </option>
                ))}
              </select>
            </div>
            <FormSubmitButton
              className="mt-2"
              idleLabel="Create Meeting"
              pendingLabel="Creating..."
            />
          </form>
        </CardContent>
      </Card>
    </AppShell>
  )
}
