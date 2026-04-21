'use client'

import { useRef, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { toast } from 'sonner'
import {
  Send,
  MessageCircleQuestion,
  Bot,
  Globe,
  ExternalLink,
  Trash2,
  Check,
  X,
  BookmarkPlus,
  Loader2,
} from 'lucide-react'
import { postJson } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { MinuteMindEntryDialogValue } from '@/components/minute-mind-entry-dialog'
import type { ResolvedOutcomeMode } from '@/lib/meeting-generation/resolved-outcome'
import {
  ASK_CHAT_MODEL_OPTIONS,
  readStoredAskChatModelId,
  writeStoredAskChatModelId,
} from '@/lib/ai/ask-chat-model'
import type { AiModelOption } from '@/lib/ai/catalog'
import { inferMinuteMindEntryTypeFromText } from '@/lib/meeting-generation/minute-mind'
import { cn } from '@/lib/utils'
import {
  splitGoDeeperAgentResponse,
  type GoDeeperAgentActionMetadata,
  type GoDeeperAgentApplyScope,
  type GoDeeperAgentIntent,
} from '@/lib/meeting-generation/go-deeper-agent-actions'

interface DualChatbotProps {
  meetingId: string
  agendaId: string
  minuteContent: string
  askModelOptions?: AiModelOption[]
  defaultAskModelId?: string
  selectedText?: string
  onClearSelection?: () => void
  onContentChange: (newContent: string) => Promise<void> | void
  onSwitchResolvedOutcome?: (
    nextMode: ResolvedOutcomeMode,
    minuteContent?: string,
  ) => Promise<void> | void
}

function coerceMindDraftToCommittee(value: MinuteMindEntryDialogValue): MinuteMindEntryDialogValue {
  return {
    ...value,
    scopeType: 'committee',
    entryType: inferMinuteMindEntryTypeFromText({
      title: value.title,
      content: value.content,
      existingEntryType: value.entryType,
    }),
  }
}

type AgentApplyStatus = 'idle' | 'applying' | 'applied' | 'failed' | 'discarded'
type AgentSaveStatus = 'idle' | 'opening' | 'saved' | 'failed' | 'discarded'
type AgentOutcomeSwitchStatus = 'idle' | 'switching' | 'switched' | 'failed' | 'discarded'

type AgentActionState = {
  intent: GoDeeperAgentIntent
  applyScope: GoDeeperAgentApplyScope
  proposedMinuteContent: string | null
  mindDraft: MinuteMindEntryDialogValue | null
  resolvedOutcomeMode: ResolvedOutcomeMode | null
  applyStatus: AgentApplyStatus
  saveStatus: AgentSaveStatus
  outcomeSwitchStatus: AgentOutcomeSwitchStatus
  applyError: string | null
  saveError: string | null
  outcomeSwitchError: string | null
}

type ChatMessagePart = {
  type?: string
  text?: string
  url?: string
  title?: string
  sourceId?: string
}

type ChatMessageLike = {
  parts?: ReadonlyArray<ChatMessagePart>
  content?: string
}

type AskResponseSections = {
  intro: string
  analysis: string
  meetingContext: string
  references: string
}

type AskSourceLink = {
  key: string
  url: string
  label: string
  host: string
}

type RememberForFutureResult = {
  saved: boolean
  error?: string
}

function getMessageTextContent(message: {
  parts?: ReadonlyArray<ChatMessagePart>
  content?: string
}) {
  const textParts = message.parts?.filter(part => part.type === 'text') ?? []
  const joined = textParts.map(part => part.text ?? '').join('')
  return joined || message.content || ''
}

function getVisibleAssistantMessageText(
  message: ChatMessageLike,
  mode: 'ask' | 'agent',
) {
  const rawText = getMessageTextContent(message)
  const visibleText = mode === 'agent'
    ? splitGoDeeperAgentResponse(rawText).visibleText
    : rawText

  return mode === 'ask'
    ? sanitizeAskResponseText(visibleText)
    : visibleText
}

function truncateLabel(value: string, maxLength = 84) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function getSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Reference'
  }
}

function sanitizeAskResponseText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1')
    .replace(/\((https?:\/\/[^\s)]+)\)/gi, '')
    .replace(/https?:\/\/[^\s)]+/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseAskResponseSections(text: string): AskResponseSections {
  const trimmed = text.trim()
  if (!trimmed) {
    return {
      intro: '',
      analysis: '',
      meetingContext: '',
      references: '',
    }
  }

  const markerPattern = /\[(Analysis|Meeting Context|References)\]/gi
  const matches = [...trimmed.matchAll(markerPattern)]

  if (matches.length === 0) {
    return {
      intro: trimmed,
      analysis: '',
      meetingContext: '',
      references: '',
    }
  }

  const sections: AskResponseSections = {
    intro: trimmed.slice(0, matches[0]?.index ?? 0).trim(),
    analysis: '',
    meetingContext: '',
    references: '',
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    if (!match?.index) {
      if (match?.index !== 0) continue
    }

    const nextMatch = matches[index + 1]
    const start = match.index + match[0].length
    const end = nextMatch?.index ?? trimmed.length
    const content = trimmed.slice(start, end).trim()
    const label = match[1]?.toLowerCase()

    if (!content) continue

    if (label === 'analysis') {
      sections.analysis = content
    } else if (label === 'meeting context') {
      sections.meetingContext = content
    } else if (label === 'references') {
      sections.references = content
    }
  }

  return sections
}

function getMessageSourceLinks(message: ChatMessageLike): AskSourceLink[] {
  const links: AskSourceLink[] = []
  const seen = new Set<string>()

  for (const part of message.parts ?? []) {
    if (part.type !== 'source-url' || !part.url) continue

    const key = part.sourceId || part.url
    if (seen.has(key)) continue
    seen.add(key)

    const host = getSourceHost(part.url)
    links.push({
      key,
      url: part.url,
      label: truncateLabel((part.title || '').trim() || host),
      host,
    })
  }

  return links
}

function replaceSelectedExcerpt(fullContent: string, selected: string, rewritten: string) {
  const trimmedSelection = selected.trim()
  if (!trimmedSelection || !rewritten.trim()) return null

  const index = fullContent.indexOf(trimmedSelection)
  if (index < 0) return null

  return `${fullContent.slice(0, index)}${rewritten}${fullContent.slice(index + trimmedSelection.length)}`
}

function buildAgentActionState(params: {
  metadata: GoDeeperAgentActionMetadata
  baseContent: string
  fallbackSelectedExcerpt?: string
}): AgentActionState | null {
  const { metadata, baseContent, fallbackSelectedExcerpt } = params

  if (metadata.intent === 'none') {
    if (!metadata.resolvedOutcomeChange) {
      return null
    }
  }

  const hasApplyIntent = metadata.intent === 'apply_only' || metadata.intent === 'both'
  const hasSaveIntent = metadata.intent === 'save_only' || metadata.intent === 'both'
  const resolvedOutcomeMode = metadata.resolvedOutcomeChange?.nextMode ?? null
  const hasOutcomeSwitch = Boolean(resolvedOutcomeMode)
  let proposedMinuteContent: string | null = null

  if (hasApplyIntent) {
    if (metadata.applyScope === 'selection') {
      const sourceExcerpt = metadata.sourceExcerpt?.trim() || fallbackSelectedExcerpt?.trim()
      if (!sourceExcerpt) return null

      proposedMinuteContent = replaceSelectedExcerpt(
        baseContent,
        sourceExcerpt,
        metadata.minuteProposalText,
      )

      if (!proposedMinuteContent) return null
    } else if (metadata.applyScope === 'minute') {
      const proposalText = metadata.minuteProposalText.trim()
      if (!proposalText) return null
      proposedMinuteContent = proposalText
    } else {
      return null
    }
  }

  const mindDraft = hasSaveIntent ? metadata.mindDraft ?? null : null
  if (hasSaveIntent && !mindDraft) {
    return null
  }

  return {
    intent: metadata.intent,
    applyScope: metadata.applyScope,
    proposedMinuteContent,
    mindDraft,
    resolvedOutcomeMode,
    applyStatus: hasApplyIntent && !hasOutcomeSwitch ? 'idle' : 'discarded',
    saveStatus: hasSaveIntent ? 'idle' : 'discarded',
    outcomeSwitchStatus: hasOutcomeSwitch ? 'idle' : 'discarded',
    applyError: null,
    saveError: null,
    outcomeSwitchError: null,
  }
}

function hasPendingApplyAction(state: AgentActionState) {
  return state.proposedMinuteContent != null
    && (state.applyStatus === 'idle' || state.applyStatus === 'failed')
}

function hasPendingSaveAction(state: AgentActionState) {
  return state.mindDraft != null
    && (state.saveStatus === 'idle' || state.saveStatus === 'failed')
}

function hasPendingOutcomeSwitchAction(state: AgentActionState) {
  return state.resolvedOutcomeMode != null
    && (state.outcomeSwitchStatus === 'idle' || state.outcomeSwitchStatus === 'failed')
}

function AskSectionBlock({
  title,
  content,
  tone,
}: {
  title: string
  content: string
  tone: 'analysis' | 'meeting'
}) {
  return (
    <div className="mt-4 first:mt-0">
      <span
        className={cn(
          'inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]',
          tone === 'analysis'
            ? 'border-sky-200/90 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300'
            : 'border-emerald-200/90 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
        )}
      >
        {title}
      </span>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-800 dark:text-zinc-100">
        {content}
      </div>
    </div>
  )
}

function AskReferencesCard({
  sources,
  fallbackText,
}: {
  sources: AskSourceLink[]
  fallbackText?: string
}) {
  if (sources.length === 0 && !fallbackText?.trim()) {
    return null
  }

  return (
    <div className="rounded-[22px] border border-zinc-200/80 bg-zinc-50/92 px-4 py-3 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.38)] dark:border-zinc-700 dark:bg-zinc-900/70">
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          References
        </p>
      </div>

      {sources.length > 0 ? (
        <div className="mt-3 space-y-2">
          {sources.map(source => (
            <a
              key={source.key}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white/92 px-3 py-2.5 transition-colors hover:border-zinc-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/60 dark:hover:border-zinc-600"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {source.label}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {source.host}
                </p>
              </div>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-600 dark:group-hover:text-zinc-200" />
            </a>
          ))}
        </div>
      ) : null}

      {sources.length === 0 && fallbackText?.trim() ? (
        <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-zinc-200/80 bg-white/92 px-3 py-2.5 text-sm leading-6 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-200">
          {fallbackText.trim()}
        </div>
      ) : null}
    </div>
  )
}

export function DualChatbot({
  meetingId,
  agendaId,
  minuteContent,
  askModelOptions = ASK_CHAT_MODEL_OPTIONS,
  defaultAskModelId = '',
  selectedText,
  onClearSelection,
  onContentChange,
  onSwitchResolvedOutcome,
}: DualChatbotProps) {
  const allowedAskModelIds = askModelOptions.map(model => model.id)
  const [activeTab, setActiveTab] = useState<'ask' | 'agent'>('ask')
  const [askModelId, setAskModelId] = useState(() => (
    typeof window === 'undefined'
      ? ''
      : (
          readStoredAskChatModelId(window.localStorage, allowedAskModelIds)
          || (allowedAskModelIds.includes(defaultAskModelId) ? defaultAskModelId : '')
        )
  ))
  const effectiveAskModelId = (
    allowedAskModelIds.includes(askModelId.trim())
      ? askModelId.trim()
      : (allowedAskModelIds.includes(defaultAskModelId) ? defaultAskModelId : '')
  )
  const [webSearch, setWebSearch] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    writeStoredAskChatModelId(window.localStorage, effectiveAskModelId, allowedAskModelIds)
  }, [allowedAskModelIds, effectiveAskModelId])

  function clearHistory(mode: 'ask' | 'agent') {
    localStorage.removeItem(`chat-${agendaId}-${mode}`)
    setResetKey(key => key + 1)
  }

  async function openPrefilledMindDialog(
    value: MinuteMindEntryDialogValue,
  ): Promise<RememberForFutureResult> {
    const committeeValue = coerceMindDraftToCommittee(value)
    try {
      await postJson<{ ok: true }>(
        `/api/meeting/${meetingId}/mind`,
        {
          ...committeeValue,
          agendaId: null,
        },
      )
      toast.success('Saved for future minutes and chat')
      return { saved: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remember this instruction'
      toast.error(message)
      return {
        saved: false,
        error: message,
      }
    }
  }

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as 'ask' | 'agent')}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,250,249,0.88))] px-4 py-3">
          <TabsList className="grid flex-1 grid-cols-2 rounded-[22px] bg-zinc-100/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <TabsTrigger value="ask" className="gap-1.5 text-xs">
              <MessageCircleQuestion className="h-3.5 w-3.5" />
              Ask
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-1.5 text-xs">
              <Bot className="h-3.5 w-3.5" />
              Agent
            </TabsTrigger>
          </TabsList>
          {activeTab === 'ask' ? (
            <select
              value={effectiveAskModelId}
              onChange={event => setAskModelId(event.target.value)}
              className="h-8 min-w-[180px] rounded-full border border-zinc-200 bg-white/92 px-3 text-[11px] shadow-[0_12px_24px_-20px_rgba(15,23,42,0.45)] dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">Choose Ask model</option>
              {askModelOptions.map(model => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
          ) : null}
        </div>
        <TabsContent value="ask" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatPanel
            key={`ask-${effectiveAskModelId || 'none'}-${webSearch}-${resetKey}`}
            agendaId={agendaId}
            mode="ask"
            modelId={effectiveAskModelId}
            webSearch={webSearch}
            onToggleWebSearch={() => setWebSearch(prev => !prev)}
            placeholder="Ask about the context of the meeting..."
            onClearHistory={() => clearHistory('ask')}
            onOpenMindDialog={openPrefilledMindDialog}
          />
        </TabsContent>
        <TabsContent value="agent" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatPanel
            key={`agent-${resetKey}`}
            agendaId={agendaId}
            mode="agent"
            placeholder="Ask Agent to change your minute..."
            minuteContent={minuteContent}
            selectedText={selectedText}
            onClearSelection={onClearSelection}
            onContentChange={onContentChange}
            onSwitchResolvedOutcome={onSwitchResolvedOutcome}
            onClearHistory={() => clearHistory('agent')}
            onOpenMindDialog={openPrefilledMindDialog}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}

function loadChatHistory(agendaId: string, mode: string) {
  try {
    const raw = localStorage.getItem(`chat-${agendaId}-${mode}`)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

function ChatPanel({
  agendaId,
  mode,
  modelId,
  placeholder,
  minuteContent,
  selectedText,
  onClearSelection,
  onContentChange,
  onSwitchResolvedOutcome,
  onClearHistory,
  webSearch = false,
  onToggleWebSearch,
  onOpenMindDialog,
}: {
  agendaId: string
  mode: 'ask' | 'agent'
  modelId?: string
  placeholder: string
  minuteContent?: string
  selectedText?: string
  onClearSelection?: () => void
  onContentChange?: (content: string) => Promise<void> | void
  onSwitchResolvedOutcome?: (
    nextMode: ResolvedOutcomeMode,
    minuteContent?: string,
  ) => Promise<void> | void
  onClearHistory?: () => void
  webSearch?: boolean
  onToggleWebSearch?: () => void
  onOpenMindDialog: (
    value: MinuteMindEntryDialogValue,
  ) => Promise<RememberForFutureResult>
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [initialMessages] = useState(() => loadChatHistory(agendaId, mode))
  const [agentActionStates, setAgentActionStates] = useState<Record<string, AgentActionState>>({})
  const agentContextRef = useRef<{
    baseContent: string
    selectedExcerpt?: string
  } | null>(null)
  const requiresAskModelSelection = mode === 'ask' && !modelId?.trim()

  const { messages, sendMessage, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: mode === 'ask'
        ? { agendaId, mode, modelId: modelId || undefined, webSearch }
        : { agendaId, mode, webSearch },
    }),
    onError(chatError) {
      toast.error(chatError.message || 'Chat failed — check API key or model')
    },
    onFinish({ message }) {
      if (mode === 'agent' && message.role === 'assistant') {
        const text = getMessageTextContent(message)
        const { metadata } = splitGoDeeperAgentResponse(text)

        if (metadata) {
          const nextState = buildAgentActionState({
            metadata,
            baseContent: agentContextRef.current?.baseContent ?? (minuteContent ?? ''),
            fallbackSelectedExcerpt: agentContextRef.current?.selectedExcerpt,
          })

          if (nextState) {
            setAgentActionStates(prev => ({
              ...prev,
              [message.id]: nextState,
            }))
          }
        }

        agentContextRef.current = null
      }
    },
  })

  function updateAgentActionState(
    messageId: string,
    updater: (state: AgentActionState) => AgentActionState,
  ) {
    setAgentActionStates(prev => {
      const current = prev[messageId]
      if (!current) return prev

      return {
        ...prev,
        [messageId]: updater(current),
      }
    })
  }

  async function handleApplyAction(messageId: string) {
    if (!onContentChange) return

    const actionState = agentActionStates[messageId]
    if (!actionState?.proposedMinuteContent) return

    updateAgentActionState(messageId, current => ({
      ...current,
      applyStatus: 'applying',
      applyError: null,
    }))

    try {
      await onContentChange(actionState.proposedMinuteContent)
      updateAgentActionState(messageId, current => ({
        ...current,
        applyStatus: 'applied',
        applyError: null,
      }))
    } catch (applyError) {
      const message = applyError instanceof Error ? applyError.message : 'Failed to apply changes to the minute'
      updateAgentActionState(messageId, current => ({
        ...current,
        applyStatus: 'failed',
        applyError: message,
      }))
    }
  }

  async function handleSaveMindAction(messageId: string) {
    const actionState = agentActionStates[messageId]
    if (!actionState?.mindDraft) return

    updateAgentActionState(messageId, current => ({
      ...current,
      saveStatus: 'opening',
      saveError: null,
    }))

    const result = await onOpenMindDialog(actionState.mindDraft)

    updateAgentActionState(messageId, current => ({
      ...current,
      saveStatus: result.saved ? 'saved' : 'failed',
      saveError: result.saved ? null : (result.error ?? 'Failed to remember this instruction'),
    }))
  }

  async function handleSwitchResolvedOutcome(messageId: string) {
    if (!onSwitchResolvedOutcome) return

    const actionState = agentActionStates[messageId]
    if (!actionState?.resolvedOutcomeMode) return

    updateAgentActionState(messageId, current => ({
      ...current,
      outcomeSwitchStatus: 'switching',
      outcomeSwitchError: null,
    }))

    try {
      await onSwitchResolvedOutcome(
        actionState.resolvedOutcomeMode,
        actionState.proposedMinuteContent ?? undefined,
      )
      updateAgentActionState(messageId, current => ({
        ...current,
        outcomeSwitchStatus: 'switched',
        outcomeSwitchError: null,
      }))
    } catch (switchError) {
      const message = switchError instanceof Error ? switchError.message : 'Failed to switch RESOLVED outcome'
      updateAgentActionState(messageId, current => ({
        ...current,
        outcomeSwitchStatus: 'failed',
        outcomeSwitchError: message,
      }))
    }
  }

  function handleDiscardAction(messageId: string) {
    let discardedSomething = false

    updateAgentActionState(messageId, current => {
      const nextState = { ...current }

      if (hasPendingApplyAction(current)) {
        nextState.applyStatus = 'discarded'
        nextState.applyError = null
        discardedSomething = true
      }

      if (hasPendingSaveAction(current)) {
        nextState.saveStatus = 'discarded'
        nextState.saveError = null
        discardedSomething = true
      }

      if (hasPendingOutcomeSwitchAction(current)) {
        nextState.outcomeSwitchStatus = 'discarded'
        nextState.outcomeSwitchError = null
        discardedSomething = true
      }

      return nextState
    })

    if (discardedSomething) {
      toast('Pending action dismissed')
    }
  }

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`chat-${agendaId}-${mode}`, JSON.stringify(messages))
    }
  }, [messages, agendaId, mode])

  const isLoading = status === 'streaming' || status === 'submitted'
  const hasBusyAction = Object.values(agentActionStates).some(state => (
    state.applyStatus === 'applying'
    || state.saveStatus === 'opening'
    || state.outcomeSwitchStatus === 'switching'
  ))
  const isBusy = isLoading || hasBusyAction
  const lastMessage = messages[messages.length - 1]
  const lastAssistantVisibleText = lastMessage?.role === 'assistant'
    ? getVisibleAssistantMessageText(lastMessage, mode)
    : ''
  const shouldShowThinkingBubble = messages.length > 0
    && isLoading
    && (
      status === 'submitted'
      || lastMessage?.role !== 'assistant'
      || lastAssistantVisibleText.trim().length === 0
    )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return

    composer.style.height = '0px'
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`
  }, [inputValue])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!inputValue.trim() || isBusy) return
    if (requiresAskModelSelection) {
      toast.error('Choose an Ask model before sending your question')
      return
    }
    const trimmedSelection = selectedText?.trim()

    if (mode === 'agent') {
      agentContextRef.current = {
        baseContent: minuteContent ?? '',
        selectedExcerpt: trimmedSelection || undefined,
      }
    }

    const text = mode === 'agent' && trimmedSelection
      ? `Rewrite ONLY the selected excerpt based on the instruction.
Return ONLY the rewritten excerpt text (no heading, no code block, no extra explanation).

SELECTED EXCERPT:
"""${trimmedSelection}"""

INSTRUCTION:
${inputValue}`
      : inputValue
    sendMessage({ text })
    setInputValue('')
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return

    event.preventDefault()

    if (!inputValue.trim() || isBusy) return
    if (requiresAskModelSelection) {
      toast.error('Choose an Ask model before sending your question')
      return
    }

    handleSubmit(event)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {messages.length > 0 ? (
        <div className="shrink-0 flex justify-end border-b border-border/70 bg-white/72 px-4 py-1.5">
          <button
            type="button"
            onClick={onClearHistory}
            className="flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
            Clear chat
          </button>
        </div>
      ) : null}

      <ScrollArea
        className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(236,248,246,0.7),rgba(255,255,255,0.96)_42%)]"
        viewportRef={scrollRef}
      >
        <div className={cn(
          'min-h-full',
          messages.length === 0 ? 'flex items-center justify-center p-6' : 'space-y-4 p-4',
        )}>
          {messages.length === 0 ? (
            <div className="mx-auto flex w-full max-w-sm flex-col items-center rounded-[30px] border border-zinc-200/80 bg-white/90 px-8 py-10 text-center shadow-[0_32px_70px_-42px_rgba(15,23,42,0.35)] backdrop-blur">
              <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-zinc-100 text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                {mode === 'ask' ? (
                  <MessageCircleQuestion className="h-8 w-8" />
                ) : (
                  <Bot className="h-8 w-8" />
                )}
              </div>
              <p className="mt-5 text-sm font-semibold text-zinc-700">
                {mode === 'ask' ? 'Chat here for deeper context' : 'Refine the minute from here'}
              </p>
              <p className="mt-2 max-w-[260px] text-xs leading-5 text-zinc-500">
                {mode === 'ask'
                  ? 'Ask about the transcript, paper, discussion flow, or hidden context behind this agenda.'
                  : 'Ask Agent to rewrite sections, tighten language, and preview edits before applying them to this minute.'}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {(mode === 'ask'
                  ? ['Transcript context', 'Paper context', 'Discussion cues']
                  : ['Rewrite excerpt', 'Tighten wording', 'Apply to minute']
                ).map(item => (
                  <span
                    key={item}
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] text-zinc-500"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            messages.map(message => {
              const rawText = getMessageTextContent(message)
              const agentSplit = mode === 'agent' && message.role === 'assistant'
                ? splitGoDeeperAgentResponse(rawText)
                : null
              const visibleText = mode === 'agent' && message.role === 'assistant'
                ? agentSplit?.visibleText ?? rawText
                : rawText
              const askVisibleText = mode === 'ask' && message.role === 'assistant'
                ? sanitizeAskResponseText(visibleText)
                : visibleText
              const displayText = message.role === 'user' && rawText.startsWith('Rewrite ONLY')
                ? rawText.split('INSTRUCTION:\n')[1] ?? rawText
                : askVisibleText
              const actionState = mode === 'agent' && message.role === 'assistant'
                ? agentActionStates[message.id]
                : undefined
              const askSections = mode === 'ask' && message.role === 'assistant'
                ? parseAskResponseSections(displayText)
                : null
              const askSourceLinks = mode === 'ask' && message.role === 'assistant'
                ? getMessageSourceLinks(message)
                : []
              const askIntroText = askSections?.intro ?? ''
              const isStructuredAskAssistant = mode === 'ask' && message.role === 'assistant'
              const showAskReferences = askSourceLinks.length > 0 || Boolean(askSections?.references.trim())
              const showAskMainBubble = isStructuredAskAssistant
                ? Boolean(
                    askIntroText.trim()
                    || askSections?.analysis.trim()
                    || askSections?.meetingContext.trim()
                    || (!showAskReferences && displayText.trim()),
                  )
                : (displayText.trim().length > 0 || message.role === 'user')
              const hasPendingOutcomeSwitch = actionState ? hasPendingOutcomeSwitchAction(actionState) : false
              const hasPendingApply = actionState
                ? (!hasPendingOutcomeSwitch && hasPendingApplyAction(actionState))
                : false
              const hasPendingSave = actionState ? hasPendingSaveAction(actionState) : false
              const showDiscardAction = hasPendingApply || hasPendingSave || hasPendingOutcomeSwitch
              const statusChips: Array<{
                key: string
                label: string
                tone: 'success' | 'muted'
              }> = []

              if (actionState?.applyStatus === 'applied') {
                statusChips.push({
                  key: 'apply-applied',
                  label: 'Applied to minute',
                  tone: 'success',
                })
              } else if (actionState?.applyStatus === 'discarded' && actionState?.saveStatus !== 'discarded') {
                statusChips.push({
                  key: 'apply-discarded',
                  label: 'Minute change discarded',
                  tone: 'muted',
                })
              }

              if (actionState?.saveStatus === 'saved') {
                statusChips.push({
                  key: 'save-saved',
                  label: 'Saved for future minutes and chat',
                  tone: 'success',
                })
              } else if (actionState?.saveStatus === 'discarded' && actionState?.applyStatus !== 'discarded') {
                statusChips.push({
                  key: 'save-discarded',
                  label: 'Remember for future discarded',
                  tone: 'muted',
                })
              }

              if (actionState?.outcomeSwitchStatus === 'switched' && actionState.resolvedOutcomeMode) {
                statusChips.push({
                  key: 'outcome-switched',
                  label: `Switched to ${actionState.resolvedOutcomeMode === 'follow_up' ? 'Follow-up' : 'Closed'}`,
                  tone: 'success',
                })
              } else if (
                actionState?.outcomeSwitchStatus === 'discarded'
                && actionState?.applyStatus !== 'discarded'
                && actionState?.saveStatus !== 'discarded'
              ) {
                statusChips.push({
                  key: 'outcome-discarded',
                  label: 'Outcome switch discarded',
                  tone: 'muted',
                })
              }

              if (
                actionState
                && actionState.applyStatus === 'discarded'
                && actionState.saveStatus === 'discarded'
                && statusChips.length === 0
              ) {
                statusChips.push({
                  key: 'all-discarded',
                  label: 'Suggestion discarded',
                  tone: 'muted',
                })
              }

              const showActionCard = Boolean(actionState)
              const showAgentFormatWarning = mode === 'agent'
                && message.role === 'assistant'
                && rawText.trim().length > 0
                && displayText.trim().length === 0
                && !showActionCard
              const showMessageBubble = showAskMainBubble

              return (
                <div key={message.id} className="space-y-1.5">
                  {isStructuredAskAssistant ? (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] space-y-2">
                        {showMessageBubble ? (
                          <div className="rounded-[24px] border border-zinc-200/80 bg-white/92 px-4 py-3.5 text-sm text-zinc-900 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.35)] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                            {askIntroText.trim() ? (
                              <div className="whitespace-pre-wrap leading-6">{askIntroText}</div>
                            ) : null}
                            {askSections?.analysis ? (
                              <AskSectionBlock
                                title="Analysis"
                                content={askSections.analysis}
                                tone="analysis"
                              />
                            ) : null}
                            {askSections?.meetingContext ? (
                              <AskSectionBlock
                                title="Meeting Context"
                                content={askSections.meetingContext}
                                tone="meeting"
                              />
                            ) : null}
                            {!askSections?.analysis && !askSections?.meetingContext && !askIntroText.trim() && displayText.trim() ? (
                              <div className="whitespace-pre-wrap leading-6">{displayText}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {showAskReferences ? (
                          <AskReferencesCard
                            sources={askSourceLinks}
                            fallbackText={askSourceLinks.length === 0 ? askSections?.references : ''}
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : showMessageBubble ? (
                    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-[0_16px_36px_-30px_rgba(15,23,42,0.35)] ${
                          message.role === 'user'
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : actionState
                              ? 'border border-emerald-200/80 bg-emerald-50/85 text-zinc-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-zinc-100'
                              : 'border border-zinc-200/80 bg-white/90 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{displayText}</div>
                      </div>
                    </div>
                  ) : null}
                  {showActionCard ? (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl border border-zinc-200/80 bg-white/90 px-3.5 py-3 text-xs shadow-[0_18px_40px_-34px_rgba(15,23,42,0.38)] dark:border-zinc-700 dark:bg-zinc-900/80">
                        {actionState?.resolvedOutcomeMode ? (
                          <p className="font-medium text-zinc-700 dark:text-zinc-200">
                            This will switch the agenda outcome to {actionState.resolvedOutcomeMode === 'follow_up' ? 'Follow-up' : 'Closed'} and sync the RESOLVED branch, minute content, action items, and dashboard state together.
                          </p>
                        ) : null}
                        {actionState?.proposedMinuteContent && !actionState?.resolvedOutcomeMode ? (
                          <p className="font-medium text-zinc-700 dark:text-zinc-200">
                            {actionState.applyScope === 'selection'
                              ? 'This will replace the selected section only.'
                              : 'This will replace the current minute for this agenda.'}
                          </p>
                        ) : null}
                        {actionState?.mindDraft ? (
                          <p className={cn(
                            'font-medium text-zinc-700 dark:text-zinc-200',
                            actionState.proposedMinuteContent ? 'mt-1.5' : '',
                          )}>
                            This will help future chat and minute generation remember the same instruction.
                          </p>
                        ) : null}

                        {(hasPendingApply || hasPendingSave || hasPendingOutcomeSwitch || showDiscardAction) ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {hasPendingOutcomeSwitch ? (
                              <Button
                                size="sm"
                                onClick={() => { void handleSwitchResolvedOutcome(message.id) }}
                                disabled={actionState?.outcomeSwitchStatus === 'switching' || actionState?.saveStatus === 'opening'}
                                className="h-8 gap-1.5 rounded-full text-xs"
                              >
                                {actionState?.outcomeSwitchStatus === 'switching' ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                                {actionState?.outcomeSwitchStatus === 'switching'
                                  ? 'Switching...'
                                  : `Switch to ${actionState?.resolvedOutcomeMode === 'follow_up' ? 'Follow-up' : 'Closed'}`}
                              </Button>
                            ) : null}
                            {hasPendingApply ? (
                              <Button
                                size="sm"
                                onClick={() => { void handleApplyAction(message.id) }}
                                disabled={actionState?.applyStatus === 'applying' || actionState?.saveStatus === 'opening'}
                                className="h-8 gap-1.5 rounded-full text-xs"
                              >
                                {actionState?.applyStatus === 'applying' ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                                {actionState?.applyStatus === 'applying' ? 'Applying...' : 'Apply changes to the minute'}
                              </Button>
                            ) : null}
                            {hasPendingSave ? (
                              <Button
                                size="sm"
                                variant={hasPendingApply || hasPendingOutcomeSwitch ? 'outline' : 'default'}
                                onClick={() => { void handleSaveMindAction(message.id) }}
                                disabled={
                                  actionState?.saveStatus === 'opening'
                                  || actionState?.applyStatus === 'applying'
                                  || actionState?.outcomeSwitchStatus === 'switching'
                                }
                                className="h-8 gap-1.5 rounded-full text-xs"
                              >
                                {actionState?.saveStatus === 'opening' ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <BookmarkPlus className="h-3.5 w-3.5" />
                                )}
                                {actionState?.saveStatus === 'opening' ? 'Saving...' : 'Remember for future'}
                              </Button>
                            ) : null}
                            {showDiscardAction ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDiscardAction(message.id)}
                                disabled={
                                  actionState?.applyStatus === 'applying'
                                  || actionState?.saveStatus === 'opening'
                                  || actionState?.outcomeSwitchStatus === 'switching'
                                }
                                className="h-8 gap-1.5 rounded-full text-xs hover:border-red-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400"
                              >
                                <X className="h-3.5 w-3.5" />
                                Discard
                              </Button>
                            ) : null}
                          </div>
                        ) : null}

                        {actionState?.applyError ? (
                          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
                            Failed to apply changes to the minute. {actionState.applyError}
                          </div>
                        ) : null}
                        {actionState?.saveError ? (
                          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
                            Failed to remember this instruction. {actionState.saveError}
                          </div>
                        ) : null}
                        {actionState?.outcomeSwitchError ? (
                          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
                            Failed to switch RESOLVED outcome. {actionState.outcomeSwitchError}
                          </div>
                        ) : null}

                        {statusChips.length > 0 ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {statusChips.map(statusChip => (
                              <div
                                key={statusChip.key}
                                className={cn(
                                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                                  statusChip.tone === 'success'
                                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                                    : 'border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
                                )}
                              >
                                {statusChip.tone === 'success' ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <X className="h-3 w-3" />
                                )}
                                {statusChip.label}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {showAgentFormatWarning ? (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl border border-amber-200 bg-amber-50/90 px-3.5 py-3 text-xs text-amber-800 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.28)] dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        Agent replied, but the action format could not be interpreted here. Try again, or switch model if this keeps happening.
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}

          {shouldShowThinkingBubble ? (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-zinc-200/80 bg-white/92 px-3.5 py-2.5 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.35)] dark:border-zinc-700 dark:bg-zinc-800">
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  {mode === 'ask'
                    ? 'Secretariat is reviewing the record...'
                    : 'Secretariat is drafting the update...'}
                </p>
                <div className="mt-1.5 flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          ) : null}

          {messages.length > 0 && error ? (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
                Error: {error.message}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="shrink-0 border-t border-border/70 bg-white/86 p-3">
        {requiresAskModelSelection ? (
          <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Choose an Ask model above to start chatting.
          </div>
        ) : null}
        {mode === 'agent' && selectedText?.trim() ? (
          <div className="mb-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900/40">
            <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">Selected text context</p>
            <p className="line-clamp-3 whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
              {selectedText.trim()}
            </p>
            {onClearSelection ? (
              <button
                type="button"
                onClick={onClearSelection}
                className="mt-2 text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Clear selection
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-[26px] border border-zinc-200/80 bg-white/94 p-2 shadow-[0_20px_40px_-34px_rgba(15,23,42,0.4)]">
          {mode === 'ask' && onToggleWebSearch ? (
            <Button
              type="button"
              size="icon"
              variant={webSearch ? 'default' : 'outline'}
              onClick={onToggleWebSearch}
              title={webSearch ? 'Web mode ON — using general knowledge too' : 'Web mode OFF — meeting context only'}
              className="shrink-0"
            >
              <Globe className="h-4 w-4" />
            </Button>
          ) : null}
            <Textarea
              ref={composerRef}
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={requiresAskModelSelection
                ? 'Choose an Ask model to start chatting...'
                : (webSearch
                    ? 'Ask anything (web + meeting context)...'
                    : (mode === 'ask' ? 'Ask about the context of the meeting...' : placeholder))}
              rows={1}
              className="max-h-40 min-h-[40px] resize-none border-0 bg-transparent px-0 py-2 shadow-none focus-visible:ring-0"
              disabled={isBusy}
            />
            <Button type="submit" size="icon" disabled={isBusy || !inputValue.trim() || requiresAskModelSelection}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
    </div>
  )
}
