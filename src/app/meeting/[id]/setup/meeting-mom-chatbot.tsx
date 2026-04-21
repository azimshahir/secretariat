'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import {
  Bot,
  BookmarkPlus,
  FileText,
  Loader2,
  MessageCircleQuestion,
  ScrollText,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { postJson } from '@/lib/api/client'
import {
  ASK_CHAT_MODEL_OPTIONS,
  readStoredAskChatModelId,
  writeStoredAskChatModelId,
} from '@/lib/ai/ask-chat-model'
import type { AiModelOption } from '@/lib/ai/catalog'
import { inferMinuteMindEntryTypeFromText } from '@/lib/meeting-generation/minute-mind'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { MinuteMindEntryDialogValue } from '@/components/minute-mind-entry-dialog'

interface MeetingMomChatbotProps {
  meetingId: string
  meetingTitle: string
  hasTranscript: boolean
  minutesCount: number
  isGenerating?: boolean
  askModelOptions?: AiModelOption[]
  defaultAskModelId?: string
}

const SUGGESTED_QUESTIONS = [
  'What were the main decisions from this meeting?',
  'List all action items, PICs, and due dates mentioned.',
  'What issues or risks were raised across the whole meeting?',
]

function buildMindDraftFromText(text: string): MinuteMindEntryDialogValue {
  const trimmed = text.trim()
  const firstLine = trimmed.split('\n').find(line => line.trim())?.trim() ?? trimmed
  const title = firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}...` : firstLine

  return {
    scopeType: 'committee',
    entryType: inferMinuteMindEntryTypeFromText({
      title,
      content: trimmed,
    }),
    title,
    content: trimmed,
    appliesToGeneration: true,
    appliesToChat: true,
    isActive: true,
  }
}

function loadChatHistory(meetingId: string) {
  try {
    const raw = localStorage.getItem(`mom-chat-${meetingId}`)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export function MeetingMomChatbot({
  meetingId,
  meetingTitle,
  hasTranscript,
  minutesCount,
  isGenerating = false,
  askModelOptions = ASK_CHAT_MODEL_OPTIONS,
  defaultAskModelId = '',
}: MeetingMomChatbotProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const allowedAskModelIds = askModelOptions.map(model => model.id)
  const [inputValue, setInputValue] = useState('')
  const [initialMessages] = useState(() => loadChatHistory(meetingId))
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
  const [isSavingMind, setIsSavingMind] = useState(false)
  const requiresAskModelSelection = !effectiveAskModelId.trim()

  const contextSummary = useMemo(() => {
    const parts = [
      hasTranscript ? 'Whole transcript ready' : 'Transcript unavailable',
      `${minutesCount} generated minute${minutesCount === 1 ? '' : 's'}`,
    ]
    if (isGenerating) {
      parts.push('Minutes may still be updating')
    }
    return parts.join(' • ')
  }, [hasTranscript, isGenerating, minutesCount])

  useEffect(() => {
    if (typeof window === 'undefined') return
    writeStoredAskChatModelId(window.localStorage, effectiveAskModelId, allowedAskModelIds)
  }, [allowedAskModelIds, effectiveAskModelId])

  const { messages, sendMessage, setMessages, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: `/api/meeting/${meetingId}/mom-chat`,
      body: {
        modelId: effectiveAskModelId || undefined,
      },
    }),
    onError(chatError) {
      toast.error(chatError.message || 'Meeting chatbot failed')
    },
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`mom-chat-${meetingId}`, JSON.stringify(messages))
    }
  }, [meetingId, messages])

  useEffect(() => {
    setMessages(loadChatHistory(meetingId) ?? [])
  }, [meetingId, setMessages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  function getMessageText(message: typeof messages[number]) {
    const textParts = message.parts?.filter(part => part.type === 'text') ?? []
    return textParts.map(part => part.text).join('') || ''
  }

  function clearHistory() {
    localStorage.removeItem(`mom-chat-${meetingId}`)
    setMessages([])
  }

  function submitText(text: string) {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    if (requiresAskModelSelection) {
      toast.error('Choose an Ask model before sending your question.')
      return
    }
    sendMessage({ text: trimmed })
    setInputValue('')
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    submitText(inputValue)
  }

  async function rememberForFuture(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const committeeValue = buildMindDraftFromText(trimmed)
    setIsSavingMind(true)
    try {
      await postJson<{ ok: true }>(
        `/api/meeting/${meetingId}/mind`,
        {
          ...committeeValue,
          agendaId: null,
        },
      )
      toast.success('Saved for future minutes and chat')
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to remember this instruction')
    } finally {
      setIsSavingMind(false)
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">MoM Chatbot</p>
              <h3 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950">
                <Bot className="h-6 w-6 text-primary" />
                Ask about the whole meeting
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                Chat against the full meeting context for <span className="font-medium text-zinc-700">{meetingTitle}</span>.
                {' '}Answers are grounded in the latest saved transcript and all current generated minutes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <select
                value={effectiveAskModelId}
                onChange={event => setAskModelId(event.target.value)}
                disabled={isLoading}
                className="h-9 min-w-[220px] rounded-full border border-zinc-200 bg-white px-3 text-xs text-zinc-700 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Choose Ask model</option>
                {askModelOptions.map(model => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
                <ScrollText className="h-3.5 w-3.5" />
                {hasTranscript ? 'Transcript attached' : 'No transcript'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
                <FileText className="h-3.5 w-3.5" />
                {minutesCount} minute{minutesCount === 1 ? '' : 's'}
              </span>
              {isGenerating ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Updating live
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map(question => (
              <button
                key={question}
                type="button"
                onClick={() => submitText(question)}
                disabled={isLoading || requiresAskModelSelection}
                className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-zinc-500">{contextSummary}</p>
        </div>

        <div className="flex h-[640px] flex-col">
          {requiresAskModelSelection ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Choose an Ask model above to start chatting across the whole meeting.
            </div>
          ) : null}
          {messages.length > 0 ? (
            <div className="flex justify-end border-b border-zinc-200 px-4 py-2">
              <button
                type="button"
                onClick={clearHistory}
                className="flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
                Clear chat
              </button>
            </div>
          ) : null}

          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-zinc-400">
                  <MessageCircleQuestion className="h-10 w-10" />
                  <div className="max-w-sm text-center">
                    <p className="text-sm font-medium text-zinc-500">Ask across the entire meeting</p>
                    <p className="mt-1 text-xs leading-6 text-zinc-400">
                      Use this chatbot to ask about decisions, discussion context, follow-up actions, or anything that spans multiple agendas.
                    </p>
                  </div>
                </div>
              ) : null}

              {messages.map(message => {
                const text = getMessageText(message)

                return (
                  <div key={message.id} className="space-y-1.5">
                    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                          message.role === 'user'
                            ? 'bg-zinc-900 text-white'
                            : 'border border-zinc-200 bg-zinc-50 text-zinc-900'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{text}</div>
                      </div>
                    </div>
                    {message.role === 'user' && text.trim() ? (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => { void rememberForFuture(text) }}
                          disabled={isSavingMind}
                          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <BookmarkPlus className="h-3 w-3" />
                          {isSavingMind ? 'Saving...' : 'Remember for future'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}

              {isLoading && messages[messages.length - 1]?.role !== 'assistant' ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '0ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '150ms' }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="flex justify-start">
                  <div className="max-w-[86%] rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    Error: {error.message}
                  </div>
                </div>
              ) : null}
            </div>
          </ScrollArea>

          <form onSubmit={handleSubmit} className="border-t border-zinc-200 p-4">
            <div className="flex gap-2">
              <Input
                value={inputValue}
                onChange={event => setInputValue(event.target.value)}
                placeholder={requiresAskModelSelection
                  ? 'Choose an Ask model to start chatting...'
                  : 'Ask about the whole meeting, transcript, or generated minutes...'}
                className="text-sm"
                disabled={isLoading || requiresAskModelSelection}
              />
              <Button type="submit" size="icon" disabled={isLoading || !inputValue.trim() || requiresAskModelSelection}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </div>
      </section>
    </>
  )
}
