import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { MindSection } from '@/app/settings/mind-section'
import { requireAuthedAppContext } from '@/lib/authenticated-app'
import { getActiveBuildId } from '@/lib/app-build'

export default async function AdminMemoryDebugPage({
  searchParams,
}: {
  searchParams: Promise<{ committee?: string }>
}) {
  const { profile, committees } = await requireAuthedAppContext()
  if (profile.role !== 'admin') redirect('/')

  const { committee: focusedCommitteeId } = await searchParams
  const focusedCommittee = committees.find(committee => committee.id === focusedCommitteeId) ?? committees[0] ?? null

  return (
    <AppShell
      profile={profile}
      committees={committees}
      eyebrow="Admin Debug"
      title="Backend Memory"
      description="Hidden internal tool for reviewing, editing, and clearing backend memory entries. This surface is not shown in the normal product UI."
      containerClassName="max-w-[1400px]"
      initialBuildId={getActiveBuildId()}
    >
      <div className="space-y-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Use this only for internal debugging or cleanup when remembered rules drift from what the committee actually wants.
        </div>

        {committees.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {committees.map(committee => {
              const isActive = committee.id === focusedCommittee?.id
              return (
                <Button
                  key={committee.id}
                  asChild
                  size="sm"
                  variant={isActive ? 'default' : 'outline'}
                >
                  <Link href={`/admin/debug/memory?committee=${committee.id}`}>
                    {committee.name}
                  </Link>
                </Button>
              )
            })}
          </div>
        ) : null}

        {focusedCommittee ? (
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="mb-4">
              <p className="text-sm font-semibold text-zinc-950">{focusedCommittee.name}</p>
              <p className="mt-1 text-sm text-zinc-500">
                Review backend memory for this committee. These entries still influence future chat and minute generation even though they are hidden from normal users.
              </p>
            </div>
            <MindSection committeeId={focusedCommittee.id} />
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
            No committees available for backend memory review.
          </div>
        )}
      </div>
    </AppShell>
  )
}
