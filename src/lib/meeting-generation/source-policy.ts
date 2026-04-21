export interface ReferenceExcerpt {
  source: string
  text: string
}

export interface CanonicalMinuteReport {
  paperSummary: string
  discussionExplanation: string
  noted: string[]
  discussed: string[]
  resolved: string[]
}

const RETRIEVAL_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'were', 'been', 'into', 'their',
  'there', 'about', 'which', 'shall', 'would', 'could', 'should', 'agenda', 'meeting', 'minutes',
  'committee', 'noted', 'discussed', 'resolved', 'action', 'items', 'bank', 'secretariat',
])

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function tokenizeForScore(text: string) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2 && !RETRIEVAL_STOP_WORDS.has(token))
}

function scoreExcerpt(queryTokens: string[], candidate: string) {
  if (queryTokens.length === 0 || !candidate.trim()) return 0
  const haystack = candidate.toLowerCase()
  let score = 0
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += 1
    }
  }
  return score / queryTokens.length
}

export function selectTopRelevantExcerpts(
  queryText: string,
  candidates: Array<{ source: string; text: string }>,
  topK: number,
): ReferenceExcerpt[] {
  const tokens = tokenizeForScore(queryText)
  const ranked = candidates
    .map(candidate => ({
      source: candidate.source,
      text: normalizeWhitespace(candidate.text),
      score: scoreExcerpt(tokens, `${candidate.source}\n${candidate.text}`),
    }))
    .filter(candidate => candidate.text.length > 0 && candidate.score > 0)
    .sort((left, right) => right.score - left.score)

  return ranked.slice(0, topK).map(({ source, text }) => ({ source, text }))
}

export function buildWritingRulePriorityBlock() {
  return `WRITING RULE PRIORITY:
1. Agenda-specific instructions / additional info
2. Meeting Rules
3. Agenda Mind hard rules
4. Meeting Mind hard rules
5. Committee Mind hard rules
6. Persona baseline`
}

export function buildGenerationFactualPriorityBlock() {
  return `FACTUAL GROUNDING PRIORITY:
1. Agenda reference paper / agenda PDF excerpts
2. Transcript evidence for who said what, challenge points, and discussion flow
3. Committee RAG for bank-specific terminology, frameworks, policy context, and institutional background
4. Mind standing facts only for short committee facts or terminology, never to override agenda-paper facts`
}

export function buildAgendaChatSourcePolicyBlock() {
  return `SOURCE POLICY:
- Meeting transcript is primary for who said what, timing, speaker tone, and discussion flow.
- Current minutes are primary for current decisions, summaries, and secretary-ready conclusions already drafted for this agenda.
- Agenda paper / slides are primary for agenda-specific figures, proposal details, dates, and paper facts.
- Committee reference context is for bank terminology, policy context, product definitions, and institutional background when the meeting record assumes that knowledge.
- Mind instructions shape wording, terminology, role naming, and style. They do not replace factual sources.
- If sources conflict, say so clearly instead of blending them silently.
- End every answer with one line in this exact format: Source basis: Meeting record | Committee reference context | Both.`
}

export function buildMeetingChatSourcePolicyBlock() {
  return `SOURCE POLICY:
- For meeting-specific questions, rely on transcript context and current generated minutes first.
- Use committee reference context only when the meeting record assumes bank-specific terminology, policy knowledge, or product context that needs explanation.
- Mind instructions shape terminology, role naming, and answer style. They do not replace factual sources.
- If the answer combines meeting record evidence and committee reference context, say so explicitly.
- If transcript evidence and minutes conflict, say that clearly instead of guessing.
- End every answer with one line in this exact format: Source basis: Meeting record | Committee reference context | Both.`
}

export function buildCommitteeChatSourcePolicyBlock() {
  return `SOURCE POLICY:
- Historical meeting records are primary when the user asks whether the committee discussed, decided, or raised something before.
- Committee reference context is primary for bank terminology, policy context, product definitions, frameworks, and institutional background.
- Mind instructions shape naming, terminology, and writing style. They do not replace factual evidence.
- If the answer uses both matched meeting records and committee reference context, say so explicitly.
- End every answer with one line in this exact format: Source basis: Historical meeting record | Committee reference context | Both.`
}

function renderCanonicalList(items: string[]) {
  if (items.length === 0) return 'None recorded.'
  return items.map(item => `- ${item}`).join('\n')
}

export function renderCanonicalMinuteReport(report: CanonicalMinuteReport) {
  return renderCanonicalMinuteReportWithOptions(report, {})
}

export function renderCanonicalMinuteReportWithOptions(
  report: CanonicalMinuteReport,
  options: {
    omitDiscussedSection?: boolean
  } = {},
) {
  const sections = [
    '1. Summarization of the Paper',
    report.paperSummary.trim() || 'No agenda paper or slide-backed summary was available for this agenda.',
    '2. Explanation of Discussions',
    report.discussionExplanation.trim() || 'No discussion explanation was recorded beyond the presented materials.',
    '3. NOTED',
    renderCanonicalList(report.noted),
  ]

  if (!options.omitDiscussedSection) {
    sections.push(
      '4. DISCUSSED',
      renderCanonicalList(report.discussed),
    )
  }

  sections.push(
    options.omitDiscussedSection ? '4. RESOLVED' : '5. RESOLVED',
    renderCanonicalList(report.resolved),
  )

  return sections.join('\n\n')
}

export function buildCanonicalMinuteReportContext(report: CanonicalMinuteReport) {
  return buildCanonicalMinuteReportContextWithOptions(report, {})
}

export function buildCanonicalMinuteReportContextWithOptions(
  report: CanonicalMinuteReport,
  options: {
    omitDiscussedSection?: boolean
  } = {},
) {
  return `CANONICAL ${options.omitDiscussedSection ? 'FOUR' : 'FIVE'}-PART REPORT:
---
1. Summarization of the Paper
${report.paperSummary.trim() || 'None recorded.'}

2. Explanation of Discussions
${report.discussionExplanation.trim() || 'None recorded.'}

3. NOTED
${renderCanonicalList(report.noted)}
${options.omitDiscussedSection ? '' : `
4. DISCUSSED
${renderCanonicalList(report.discussed)}
`}
${options.omitDiscussedSection ? '4. RESOLVED' : '5. RESOLVED'}
${renderCanonicalList(report.resolved)}
---`
}

const STRUCTURE_REQUIREMENTS: Array<{
  label: string
  requestedWhen: RegExp
  templateMustContain: RegExp[]
}> = [
  {
    label: 'Summarization of the Paper',
    requestedWhen: /summarization of the paper/i,
    templateMustContain: [/summarization of the paper/i],
  },
  {
    label: 'Explanation of Discussions',
    requestedWhen: /explanation of discussions/i,
    templateMustContain: [/explanation of discussions/i],
  },
]

export function getMeetingRuleTemplateConflict(
  meetingRulesPrompt: string | null | undefined,
  templateSkeleton: string,
) {
  const rules = meetingRulesPrompt?.trim()
  if (!rules) return null

  const compactTemplate = normalizeWhitespace(templateSkeleton)

  for (const requirement of STRUCTURE_REQUIREMENTS) {
    if (!requirement.requestedWhen.test(rules)) continue
    const satisfied = requirement.templateMustContain.some(pattern => pattern.test(compactTemplate))
    if (!satisfied) {
      return `Meeting Rules require the section "${requirement.label}", but the selected exact template does not contain that structure.`
    }
  }

  return null
}
