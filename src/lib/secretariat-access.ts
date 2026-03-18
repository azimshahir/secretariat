import type { IndustryCategory, UserRole } from '@/lib/supabase/types'

export type DashboardScope = 'my' | 'org'

export function canViewOrganizationScope(role: UserRole) {
  return role === 'admin' || role === 'auditor'
}

export function normalizeDashboardScope(
  scope: string | null | undefined,
  role: UserRole
): DashboardScope {
  if (scope === 'org' && canViewOrganizationScope(role)) {
    return 'org'
  }

  return 'my'
}

export function slugifySecretariatName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function parseInviteEmails(value: FormDataEntryValue | null) {
  return Array.from(
    new Set(
      String(value ?? '')
        .split(/[\n,;]+/)
        .map(email => email.trim().toLowerCase())
        .filter(Boolean)
    )
  )
}

export function buildPersonalizedCommitteePrompt(params: {
  category: IndustryCategory
  committeeName: string
  note?: string | null
}) {
  const contextByCategory: Record<IndustryCategory, string> = {
    Banking:
      'Use formal banking governance language, highlight approvals, risks, actions, and regulatory implications.',
    'Construction & Property':
      'Use structured project-governance language, track milestones, cost/safety issues, and operational decisions.',
    'Oil & Gas':
      'Use technical energy-sector governance language, note HSE, operational risk, approvals, and follow-up actions.',
    'NGOs & Foundations':
      'Use governance language suitable for trustees, grants, program oversight, donor obligations, and compliance matters.',
    Others:
      'Use formal Malaysian corporate secretarial language, capture decisions, resolutions, owners, and due dates clearly.',
  }

  const noteBlock = params.note?.trim()
    ? `Additional committee guidance: ${params.note.trim()}`
    : 'Additional committee guidance: none provided.'

  return `You are the company secretary for the ${params.committeeName} secretariat.
Industry category: ${params.category}.
${contextByCategory[params.category]}
${noteBlock}
Write meeting outputs in a formal, board-ready style. Keep actions explicit, identify owners when available, and preserve exact resolution wording where decisions are passed.`
}
