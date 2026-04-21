'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Bot,
  CalendarDays,
  ExternalLink,
  Loader2,
  MessageCircleQuestion,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api/client'
import type { CommitteeChatMeetingMatch, CommitteeChatResponse } from '@/lib/committee-chat'

interface CommitteeChatbotMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  meetingMatches?: CommitteeChatMeetingMatch[]
}

interface CommitteeChatbotProps {
  committeeId: string
  committeeName: string
}

const SUGGESTED_QUESTIONS = [
  'Ada tak meeting mention pasal perubahan OPR?',
  'What recurring decisions has this committee made recently?',
  'Summarise the main risk themes across past meetings.',
]

function buildStorageKey(committeeId: string) {
  return `committee-ask-chat-${committeeId}`
}

function loadStoredMessages(committeeId: string): CommitteeChatbotMessage[] {
  try {
    const raw = localStorage.getItem(buildStorageKey(committeeId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(message => (
      message
      && typeof message.id === 'string'
      && (message.role === 'user' || message.role === 'assistant')
      && typeof message.text === 'string'
    )) as CommitteeChatbotMessage[]
  } catch {
    return []
  }
}

function formatMeetingDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function createMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `committee-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function CommitteeChatbot({
  committeeId,
  committeeName,
}: CommitteeChatbotProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<CommitteeChatbotMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setMessages(loadStoredMessages(committeeId))
  }, [committeeId])

  useEffect(() => {
    localStorage.setItem(buildStorageKey(committeeId), JSON.stringify(messages))
  }, [committeeId, messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const contextSummary = useMemo(
    () => `${committeeName} Ask mode uses committee knowledge, saved minutes, and historical meeting context.`,
    [committeeName],
  )

  function clearChat() {
    localStorage.removeItem(buildStorageKey(committeeId))
    setMessages([])
  }

  async function submitText(rawText: string) {
    const text = rawText.trim()
    if (!text || isLoading) return

    const userMessage: CommitteeChatbotMessage = {
      id: createMessageId(),
      role: 'user',
      text,
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    try {
      const result = await postJson<CommitteeChatResponse>(
        `/api/committee/${committeeId}/ask`,
        { query: text },
      )

      const assistantMessage: CommitteeChatbotMessage = {
        id: createMessageId(),
        role: 'assistant',
        text: result.answer,
        meetingMatches: result.meetingMatches,
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Committee chatbot failed'
      toast.error(message)
      setMessages(prev => [...prev, {
        id: createMessageId(),
        role: 'assistant',
        text: `I hit an error while checking the committee record: ${message}`,
      }])
    } finally {
      setIsLoading(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitText(inputValue)
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Committee Chatbot</p>
            <h3 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950">
              <Bot className="h-6 w-6 text-primary" />
              Ask the {committeeName} expert
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              Ask across committee knowledge, previous generated minutes, and historical meeting context.
              When relevant, matching meetings appear underneath the answer so you can jump straight into them.
            </p>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
            <Search className="h-3.5 w-3.5" />
            Ask mode only
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map(question => (
            <button
              key={question}
              type="button"
              onClick={() => { void submitText(question) }}
              disabled={isLoading}
              className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-white hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {question}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-zinc-500">{contextSummary}</p>
      </div>

      <div className="flex h-[680px] flex-col">
        {messages.length > 0 ? (
          <div className="flex justify-end border-b border-zinc-200 px-4 py-2">
            <button
              type="button"
              onClick={clearChat}
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
                  <p className="text-sm font-medium text-zinc-500">Ask across the whole committee</p>
                  <p className="mt-1 text-xs leading-6 text-zinc-400">
                    Search old minutes, current generated content, and committee knowledge in one place.
                  </p>
                </div>
              </div>
            ) : null}

            {messages.map(message => (
              <div key={message.id} className="space-y-2">
                <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.role === 'user'
                        ? 'bg-zinc-900 text-white'
                        : 'border border-zinc-200 bg-zinc-50 text-zinc-900'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{message.text}</div>
                  </div>
                </div>

                {message.role === 'assistant' && message.meetingMatches && message.meetingMatches.length > 0 ? (
                  <div className="space-y-2 pl-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      Matching Meetings
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {message.meetingMatches.map(match => (
                        <Link
                          key={`${message.id}-${match.meetingId}`}
                          href={match.href}
                          className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 transition-colors hover:border-primary/35 hover:bg-zinc-50"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-zinc-900">{match.title}</p>
                              <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {formatMeetingDate(match.meetingDate)}
                              </div>
                              <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">
                                {match.excerpt}
                              </p>
                            </div>
                            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}

            {isLoading ? (
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
          </div>
        </ScrollArea>

        <div className="border-t border-zinc-200 p-4">
          <div className="flex gap-2">
            <Textarea
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${committeeName}, previous minutes, trends, or specific topics...`}
              className="min-h-[52px] resize-none text-sm"
              disabled={isLoading}
            />
            <Button
              type="button"
              size="icon"
              className="mt-auto"
              disabled={isLoading || !inputValue.trim()}
              onClick={() => { void submitText(inputValue) }}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">Press Enter to send. Use Shift+Enter for a new line.</p>
        </div>
      </div>
    </section>
  )
}
