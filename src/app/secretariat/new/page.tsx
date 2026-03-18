import Link from 'next/link'

import { AppShell } from '@/components/app-shell'
import { SecretariatWizard } from '@/components/secretariat-wizard/wizard-shell'
import { Button } from '@/components/ui/button'
import { PERSONA_TEMPLATES } from '@/lib/ai/persona-templates'
import { requireAuthedAppContext } from '@/lib/authenticated-app'

export default async function NewSecretariatPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string }>
}) {
  const { committees, profile } = await requireAuthedAppContext()
  const { first } = await searchParams
  const firstRun = first === '1' || committees.length === 0

  return (
    <AppShell
      profile={profile}
      committees={committees}
      eyebrow="Workspace"
      title={
        firstRun
          ? 'Create your first secretariat'
          : 'Create a new secretariat workspace'
      }
      description="Secretariats come first in this workflow. Once a secretariat exists, the dashboard calendar, meeting creation, and operational insights become available."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to dashboard</Link>
        </Button>
      }
      containerClassName="max-w-[1320px]"
    >
      <SecretariatWizard
        existingSecretariats={committees.map(committee => ({
          slug: committee.slug,
          name: committee.name,
        }))}
        firstRun={firstRun}
        personaTemplates={PERSONA_TEMPLATES}
      />
    </AppShell>
  )
}
