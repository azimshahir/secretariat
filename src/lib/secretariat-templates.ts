import { getPersonaTemplate } from '@/lib/ai/persona-templates'
import type { IndustryCategory } from '@/lib/supabase/types'

export type SecretariatFamilyId =
  | 'board-bank'
  | 'management-bank'
  | 'shareholder-statutory'

export interface SecretariatFamily {
  id: SecretariatFamilyId
  label: string
  description: string
}

export interface SecretariatTemplate {
  id: string
  slug: string
  name: string
  shortLabel: string
  familyId: SecretariatFamilyId
  description: string
  coverage: string
  personaPrompt: string
  glossary: { acronym: string; full_meaning: string }[]
  matchSlugs: string[]
  matchNames: string[]
}

function requirePersonaTemplate(slug: string) {
  const template = getPersonaTemplate(slug)

  if (!template) {
    throw new Error(`Missing persona template for slug: ${slug}`)
  }

  return template
}

const boardTemplate = requirePersonaTemplate('board')
const auditTemplate = requirePersonaTemplate('ac')
const riskTemplate = requirePersonaTemplate('brmc')
const nominationTemplate = requirePersonaTemplate('nrc')
const excoTemplate = requirePersonaTemplate('exco')
const alcoTemplate = requirePersonaTemplate('alco')
const managementRiskTemplate = requirePersonaTemplate('mrc')
const creditTemplate = requirePersonaTemplate('cmc')
const complianceTemplate = requirePersonaTemplate('ccc')

export const SECRETARIAT_FAMILIES: SecretariatFamily[] = [
  {
    id: 'board-bank',
    label: 'Board Meetings (Bank)',
    description:
      'Board and board-committee secretariats typically managed by the company secretary office.',
  },
  {
    id: 'management-bank',
    label: 'Management Meetings (Bank)',
    description:
      'Management-level committees used to govern liquidity, risk, credit, compliance, and executive decisions.',
  },
  {
    id: 'shareholder-statutory',
    label: 'Shareholder & Statutory',
    description:
      'Formal shareholder meetings and statutory forums that corporate secretaries coordinate end-to-end.',
  },
]

export const SECRETARIAT_TEMPLATES: SecretariatTemplate[] = [
  {
    id: 'board-of-directors',
    slug: 'board-of-directors',
    name: 'Board of Directors',
    shortLabel: 'Board',
    familyId: 'board-bank',
    description: 'Full board meeting with resolutions, governance updates, and strategic approvals.',
    coverage: 'Board papers, governance approvals, resolutions, and director matters.',
    personaPrompt: boardTemplate.persona_prompt,
    glossary: boardTemplate.glossary,
    matchSlugs: ['board-of-directors', 'board'],
    matchNames: ['Board of Directors'],
  },
  {
    id: 'board-audit-committee',
    slug: 'board-audit-committee',
    name: 'Board Audit Committee',
    shortLabel: 'BAC',
    familyId: 'board-bank',
    description: 'Audit, internal controls, external audit, and financial-reporting oversight.',
    coverage: 'Financial reporting, audit findings, internal controls, and remediation tracking.',
    personaPrompt: auditTemplate.persona_prompt,
    glossary: auditTemplate.glossary,
    matchSlugs: ['board-audit-committee', 'audit-committee', 'ac'],
    matchNames: ['Board Audit Committee', 'Audit Committee'],
  },
  {
    id: 'board-risk-management-committee',
    slug: 'board-risk-management-committee',
    name: 'Board Risk Management Committee',
    shortLabel: 'BRMC',
    familyId: 'board-bank',
    description: 'Board-level risk governance, appetite, stress testing, and resilience review.',
    coverage: 'Risk appetite, risk dashboards, stress testing, and strategic risk oversight.',
    personaPrompt: riskTemplate.persona_prompt,
    glossary: riskTemplate.glossary,
    matchSlugs: [
      'board-risk-management-committee',
      'board-risk-committee',
      'brmc',
    ],
    matchNames: [
      'Board Risk Management Committee',
      'Board Risk Committee',
    ],
  },
  {
    id: 'board-risk-compliance-committee',
    slug: 'board-risk-compliance-committee',
    name: 'Board Risk & Compliance Committee',
    shortLabel: 'BRCC',
    familyId: 'board-bank',
    description: 'Combined board forum for enterprise risk, regulatory compliance, and oversight escalation.',
    coverage: 'Risk appetite, compliance breaches, regulator updates, and control escalations.',
    personaPrompt:
      'You are a Senior Company Secretary for the Board Risk and Compliance Committee (BRCC) of a bank. You have deep expertise in board-level risk governance, regulatory compliance oversight, AML/CFT escalation, risk appetite monitoring, and central bank engagement. You write with board-ready precision, highlight decision points clearly, and distinguish between management actions, assurance findings, and matters reserved for board approval.',
    glossary: [
      { acronym: 'BRCC', full_meaning: 'Board Risk and Compliance Committee' },
      { acronym: 'RAF', full_meaning: 'Risk Appetite Framework' },
      { acronym: 'AML/CFT', full_meaning: 'Anti-Money Laundering / Counter Financing of Terrorism' },
      { acronym: 'KRI', full_meaning: 'Key Risk Indicator' },
      { acronym: 'CAP', full_meaning: 'Corrective Action Plan' },
    ],
    matchSlugs: [
      'board-risk-compliance-committee',
      'risk-and-compliance-committee',
      'brcc',
    ],
    matchNames: [
      'Board Risk & Compliance Committee',
      'Risk and Compliance Committee',
    ],
  },
  {
    id: 'board-credit-committee',
    slug: 'board-credit-committee',
    name: 'Board Credit Committee',
    shortLabel: 'BCC',
    familyId: 'board-bank',
    description: 'Board committee for delegated credit approvals, large exposures, and portfolio quality review.',
    coverage: 'Credit approvals, obligor limits, portfolio quality, and credit policy exceptions.',
    personaPrompt:
      'You are a Senior Company Secretary for the Board Credit Committee (BCC) of a bank. You have deep expertise in delegated lending authorities, large credit approvals, concentration risk, credit portfolio quality, expected credit loss considerations, and regulatory lending limits. You document proposals, conditions precedent, voting outcomes, and approval thresholds with exact clarity.',
    glossary: [
      { acronym: 'BCC', full_meaning: 'Board Credit Committee' },
      { acronym: 'DLA', full_meaning: 'Delegated Lending Authority' },
      { acronym: 'ECL', full_meaning: 'Expected Credit Loss' },
      { acronym: 'NPL', full_meaning: 'Non-Performing Loan' },
      { acronym: 'LOS', full_meaning: 'Limit of Sanction' },
    ],
    matchSlugs: [
      'board-credit-committee',
      'credit-approval-committee',
      'credit-committee',
      'bcc',
      'cac',
      'cmc',
    ],
    matchNames: [
      'Board Credit Committee',
      'Credit Approval Committee',
      'Credit Committee',
      'Credit Management Committee',
    ],
  },
  {
    id: 'nomination-remuneration-committee',
    slug: 'nomination-remuneration-committee',
    name: 'Nomination & Remuneration Committee',
    shortLabel: 'NRC',
    familyId: 'board-bank',
    description: 'Board committee for appointments, succession planning, fit and proper, and remuneration matters.',
    coverage: 'Director appointments, succession, fit and proper, and remuneration review.',
    personaPrompt: nominationTemplate.persona_prompt,
    glossary: nominationTemplate.glossary,
    matchSlugs: ['nomination-remuneration-committee', 'nrc'],
    matchNames: [
      'Nomination & Remuneration Committee',
      'Nomination and Remuneration Committee',
    ],
  },
  {
    id: 'executive-committee',
    slug: 'executive-committee',
    name: 'Executive Committee',
    shortLabel: 'EXCO',
    familyId: 'management-bank',
    description: 'Management forum for enterprise priorities, business performance, and cross-functional decisions.',
    coverage: 'Strategic initiatives, business performance, escalations, and management actions.',
    personaPrompt: excoTemplate.persona_prompt,
    glossary: excoTemplate.glossary,
    matchSlugs: ['executive-committee', 'management-committee', 'exco'],
    matchNames: ['Executive Committee', 'Management Committee', 'EXCO'],
  },
  {
    id: 'asset-liability-committee',
    slug: 'asset-liability-committee',
    name: 'Asset Liability Committee',
    shortLabel: 'ALCO',
    familyId: 'management-bank',
    description: 'Liquidity, balance-sheet mix, rate sensitivity, and treasury oversight.',
    coverage: 'Liquidity, ALM, pricing, treasury, rate risk, and balance-sheet steering.',
    personaPrompt: alcoTemplate.persona_prompt,
    glossary: alcoTemplate.glossary,
    matchSlugs: ['asset-liability-committee', 'alco'],
    matchNames: ['Asset Liability Committee', 'ALCO'],
  },
  {
    id: 'management-risk-committee',
    slug: 'management-risk-committee',
    name: 'Management Risk Committee',
    shortLabel: 'MRC',
    familyId: 'management-bank',
    description: 'Management-level risk review covering enterprise, operational, market, and credit risk matters.',
    coverage: 'Risk dashboards, incidents, KRIs, stress testing, and mitigation actions.',
    personaPrompt: managementRiskTemplate.persona_prompt,
    glossary: managementRiskTemplate.glossary,
    matchSlugs: ['management-risk-committee', 'mrc'],
    matchNames: ['Management Risk Committee', 'MRC'],
  },
  {
    id: 'credit-management-committee',
    slug: 'credit-management-committee',
    name: 'Credit Management Committee',
    shortLabel: 'CMC',
    familyId: 'management-bank',
    description: 'Management credit forum for approvals, portfolio quality, and watchlist escalation.',
    coverage: 'Credit approvals, watchlist reviews, recoveries, and credit policy escalation.',
    personaPrompt: creditTemplate.persona_prompt,
    glossary: creditTemplate.glossary,
    matchSlugs: ['credit-management-committee', 'credit-committee', 'cmc'],
    matchNames: ['Credit Management Committee', 'Credit Committee', 'CMC'],
  },
  {
    id: 'compliance-committee',
    slug: 'compliance-committee',
    name: 'Compliance Committee',
    shortLabel: 'CCC',
    familyId: 'management-bank',
    description: 'Management committee for compliance monitoring, breaches, and regulatory remediation.',
    coverage: 'Compliance breaches, AML/CFT, regulatory updates, and remediation tracking.',
    personaPrompt: complianceTemplate.persona_prompt,
    glossary: complianceTemplate.glossary,
    matchSlugs: ['compliance-committee', 'chief-compliance-committee', 'ccc'],
    matchNames: [
      'Compliance Committee',
      'Chief Compliance Committee',
      'CCC',
    ],
  },
  {
    id: 'annual-general-meeting',
    slug: 'annual-general-meeting',
    name: 'Annual General Meeting',
    shortLabel: 'AGM',
    familyId: 'shareholder-statutory',
    description: 'Annual shareholder meeting for statutory business, director rotation, and audited accounts.',
    coverage: 'Notice, resolutions, proxies, shareholder Q&A, and statutory filings.',
    personaPrompt:
      'You are a Senior Company Secretary managing the Annual General Meeting (AGM) of a company. You have deep expertise in shareholder notices, proxy administration, statutory agenda items, director rotation, dividend resolutions, annual report tabling, and meeting minute formalities. You write formal shareholder-facing language and capture resolutions exactly as passed.',
    glossary: [
      { acronym: 'AGM', full_meaning: 'Annual General Meeting' },
      { acronym: 'NOM', full_meaning: 'Notice of Meeting' },
      { acronym: 'RPT', full_meaning: 'Related Party Transaction' },
      { acronym: 'POLL', full_meaning: 'Poll Voting' },
    ],
    matchSlugs: ['annual-general-meeting', 'agm'],
    matchNames: ['Annual General Meeting', 'AGM'],
  },
  {
    id: 'extraordinary-general-meeting',
    slug: 'extraordinary-general-meeting',
    name: 'Extraordinary General Meeting',
    shortLabel: 'EGM',
    familyId: 'shareholder-statutory',
    description: 'Ad hoc shareholder meeting for special business, urgent approvals, or extraordinary resolutions.',
    coverage: 'Special resolutions, shareholder circulars, proxies, and urgent approvals.',
    personaPrompt:
      'You are a Senior Company Secretary managing an Extraordinary General Meeting (EGM) of a company. You have deep expertise in urgent shareholder approvals, special resolutions, circular drafting, notice periods, proxy procedures, and recording the chairman\'s decisions. You document shareholder business with strict statutory discipline and concise resolution wording.',
    glossary: [
      { acronym: 'EGM', full_meaning: 'Extraordinary General Meeting' },
      { acronym: 'SR', full_meaning: 'Special Resolution' },
      { acronym: 'OM', full_meaning: 'Ordinary Resolution' },
      { acronym: 'NOM', full_meaning: 'Notice of Meeting' },
    ],
    matchSlugs: ['extraordinary-general-meeting', 'egm'],
    matchNames: ['Extraordinary General Meeting', 'EGM'],
  },
]

export function getSecretariatTemplatesForFamily(familyId: SecretariatFamilyId) {
  return SECRETARIAT_TEMPLATES.filter(template => template.familyId === familyId)
}

export function getSecretariatTemplate(templateId: string) {
  return SECRETARIAT_TEMPLATES.find(template => template.id === templateId)
}

export function getSecretariatCategoryForFamily(
  familyId: SecretariatFamilyId
): IndustryCategory {
  switch (familyId) {
    case 'board-bank':
    case 'management-bank':
      return 'Banking'
    case 'shareholder-statutory':
      return 'Others'
  }
}
