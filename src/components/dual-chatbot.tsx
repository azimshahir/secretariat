'use client'

import { useRef, useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { toast } from 'sonner'
import { Send, MessageCircleQuestion, Bot, Globe, Trash2, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'

const CHAT_MODELS = [
  { id: '', label: 'Default' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
]

interface DualChatbotProps {
  agendaId: string
  minuteContent: string
  selectedText?: string
  onClearSelection?: () => void
  onContentChange: (newContent: string) => void
}

export function DualChatbot({
  agendaId,
  minuteContent,
  selectedText,
  onClearSelection,
  onContentChange,
}: DualChatbotProps) {
  const [modelId, setModelId] = useState('')
  const [webSearch, setWebSearch] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  function clearHistory(mode: 'ask' | 'agent') {
    localStorage.removeItem(`chat-${agendaId}-${mode}`)
    setResetKey(k => k + 1)
  }

  return (
    <Tabs defaultValue="ask" className="flex flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <TabsList className="grid flex-1 grid-cols-2">
          <TabsTrigger value="ask" className="gap-1.5 text-xs">
            <MessageCircleQuestion className="h-3.5 w-3.5" />
            Ask
          </TabsTrigger>
          <TabsTrigger value="agent" className="gap-1.5 text-xs">
            <Bot className="h-3.5 w-3.5" />
            Agent
          </TabsTrigger>
        </TabsList>
        <select
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          className="h-8 rounded-md border bg-white px-2 text-[11px] dark:bg-zinc-800"
        >
          {CHAT_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <TabsContent value="ask" className="flex flex-1 flex-col mt-0">
        <ChatPanel
          key={`ask-${modelId}-${webSearch}-${resetKey}`}
          agendaId={agendaId}
          mode="ask"
          modelId={modelId}
          webSearch={webSearch}
          onToggleWebSearch={() => setWebSearch(prev => !prev)}
          placeholder="Ask about the context of the meeting..."
          onClearHistory={() => clearHistory('ask')}
        />
      </TabsContent>
      <TabsContent value="agent" className="flex flex-1 flex-col mt-0">
        <ChatPanel
          key={`agent-${modelId}-${resetKey}`}
          agendaId={agendaId}
          mode="agent"
          modelId={modelId}
          placeholder="Ask Agent to change your minute..."
          minuteContent={minuteContent}
          selectedText={selectedText}
          onClearSelection={onClearSelection}
          onContentChange={onContentChange}
          onClearHistory={() => clearHistory('agent')}
        />
      </TabsContent>
    </Tabs>
  )
}

function loadChatHistory(agendaId: string, mode: string) {
  try {
    const raw = localStorage.getItem(`chat-${agendaId}-${mode}`)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch { return undefined }
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
  onClearHistory,
  webSearch = false,
  onToggleWebSearch,
}: {
  agendaId: string
  mode: 'ask' | 'agent'
  modelId: string
  placeholder: string
  minuteContent?: string
  selectedText?: string
  onClearSelection?: () => void
  onContentChange?: (content: string) => void
  onClearHistory?: () => void
  webSearch?: boolean
  onToggleWebSearch?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [initialMessages] = useState(() => loadChatHistory(agendaId, mode))
  // Track the latest pending change so user can discard (undo)
  const [pendingChange, setPendingChange] = useState<{
    messageId: string
    previousContent: string
  } | null>(null)
  // Track discarded message IDs
  const [discarded, setDiscarded] = useState<Set<string>>(new Set())

  function replaceSelectedExcerpt(fullContent: string, selected: string, rewritten: string) {
    if (!selected || !rewritten) return fullContent
    const trimmed = selected.trim()
    const idx = fullContent.indexOf(trimmed)
    if (idx >= 0) {
      return `${fullContent.slice(0, idx)}${rewritten}${fullContent.slice(idx + trimmed.length)}`
    }
    return fullContent
  }

  const { messages, sendMessage, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { agendaId, mode, modelId: modelId || undefined, webSearch },
    }),
    onError(error) {
      toast.error(error.message || 'Chat failed — check API key or model')
    },
    onFinish({ message }) {
      if (mode === 'agent' && onContentChange && message.role === 'assistant') {
        const parts = message.parts?.filter(p => p.type === 'text') ?? []
        const text = parts.map(p => p.text).join('')

        if (isAgentChange(text)) {
          // Save current content for undo, then auto-apply
          setPendingChange({ messageId: message.id, previousContent: minuteContent ?? '' })
          if (selectedText?.trim() && minuteContent) {
            onContentChange(replaceSelectedExcerpt(minuteContent, selectedText.trim(), text.trim()))
          } else {
            onContentChange(text)
          }
        }
      }
    },
  })

  function isAgentChange(text: string) {
    return text.includes('NOTED') || text.includes('DISCUSSED') || text.includes('ACTION') || text.includes('**')
  }

  function handleDiscard() {
    if (!pendingChange || !onContentChange) return
    onContentChange(pendingChange.previousContent)
    setDiscarded(prev => new Set(prev).add(pendingChange.messageId))
    setPendingChange(null)
    toast('Change discarded — reverted to previous version')
  }

  // Persist messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`chat-${agendaId}-${mode}`, JSON.stringify(messages))
    }
  }, [messages, agendaId, mode])

  const isLoading = status === 'streaming' || status === 'submitted'

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!inputValue.trim() || isLoading) return
    // Sending next message = implicitly confirms pending change
    if (pendingChange) setPendingChange(null)
    const text = mode === 'agent' && selectedText?.trim()
      ? `Rewrite ONLY the selected excerpt based on the instruction.
Return ONLY the rewritten excerpt text (no heading, no code block, no extra explanation).

SELECTED EXCERPT:
"""${selectedText.trim()}"""

INSTRUCTION:
${inputValue}`
      : inputValue
    sendMessage({ text })
    setInputValue('')
  }

  function getMessageText(message: typeof messages[number]): string {
    const textParts = message.parts?.filter(p => p.type === 'text') ?? []
    return textParts.map(p => p.text).join('')
  }

  return (
    <div className="flex flex-1 flex-col">
      {messages.length > 0 && (
        <div className="flex justify-end border-b px-4 py-1.5">
          <button
            type="button"
            onClick={onClearHistory}
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Clear chat
          </button>
        </div>
      )}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-zinc-400">
              {mode === 'ask' ? (
                <MessageCircleQuestion className="h-8 w-8" />
              ) : (
                <Bot className="h-8 w-8" />
              )}
              <p className="text-xs text-center max-w-[220px]">
                {mode === 'ask'
                  ? 'Ask questions about the transcript, paper, and discussion'
                  : 'Request changes to the minutes — brainstorm and apply edits'}
              </p>
            </div>
          )}
          {messages.map(m => {
            const text = getMessageText(m)
            const isChange = mode === 'agent' && m.role === 'assistant' && isAgentChange(text)
            const isDiscardedMsg = discarded.has(m.id)
            const isPending = pendingChange?.messageId === m.id
            const displayText = m.role === 'user' && text.startsWith('Rewrite ONLY')
              ? text.split('INSTRUCTION:\n')[1] ?? text
              : text

            // Agent change — show short status + discard button
            if (isChange) {
              return (
                <div key={m.id} className="space-y-2">
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                      {isDiscardedMsg
                        ? 'Change discarded — reverted to previous version.'
                        : 'Done! Changes applied to the minutes.'}
                    </div>
                  </div>
                  {isPending && !isDiscardedMsg && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 rounded-full text-xs"
                        disabled
                      >
                        <Check className="h-3 w-3 text-emerald-600" />
                        Applied
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDiscard}
                        className="h-7 gap-1.5 rounded-full text-xs hover:text-red-600 hover:border-red-300 dark:hover:text-red-400 dark:hover:border-red-800"
                      >
                        <X className="h-3 w-3" />
                        Discard
                      </Button>
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{displayText}</div>
                </div>
              </div>
            )
          })}
          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
                Error: {error.message}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="border-t p-3">
        {mode === 'agent' && selectedText?.trim() && (
          <div className="mb-2 rounded-md border bg-zinc-50 p-2 text-xs dark:bg-zinc-900/40">
            <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-300">Selected text context</p>
            <p className="line-clamp-3 whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
              {selectedText.trim()}
            </p>
            {onClearSelection && (
              <button
                type="button"
                onClick={onClearSelection}
                className="mt-2 text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                Clear selection
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          {mode === 'ask' && onToggleWebSearch && (
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
          )}
          <Input
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder={webSearch ? 'Ask anything (web + meeting context)...' : (mode === 'ask' ? 'Ask about the context of the meeting...' : placeholder)}
            className="text-sm"
            disabled={isLoading}
          />
          <Button type="submit" size="icon" disabled={isLoading || !inputValue.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
